// Quality trial: does an agent image change the quality of the work? Each past card is rebuilt twice from
// the code as it was before its real PR merged, once per image (with and without the trial skills), on
// throwaway trial/* branches, with no PRs or comments. Then a fresh Opus judge, who doesn't know which
// image made which branch, runs the checks on both and scores them. The report lands in data/trials/.
//
//   node src/main.ts trial <issue> [<issue>...] [--at HH:MM]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "./project.ts";
import { homelabNotes } from "./prompt.ts";
import { sizeOf } from "./queue.ts";
import { budgetBlock, pauseForLimit, type Ctx } from "./dispatch.ts";
import { env, runAgent, type AgentResult } from "./runner.ts";

const VARIANTS = [
  // Built with --build-arg SKILLS=1 (the normal image is plain since the 2026-10-28 trial).
  { name: "skills", image: "factory-agent:skills", skills: true },
  { name: "plain", image: undefined, skills: false },
] as const;

interface Build {
  variant: string;
  branch: string;
  runId: number;
  ok: boolean;
  minutes: number;
  costUsd?: number;
  files?: number;
  additions?: number;
  deletions?: number;
  summary: string;
}

interface Verdict {
  winner?: string;
  why?: string;
  [label: string]: unknown;
}

export async function trial(ctx: Ctx, issues: number[], at?: string): Promise<void> {
  const { gh, state, log, repo } = ctx;
  const config = await loadConfig(gh, repo);
  process.env.TZ = config.timezone;
  if (at) await waitUntil(at, log);

  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  const results: { issue: number; title: string; base: string; builds: Build[]; labels: Record<string, string>; verdict: Verdict | null; judge: string }[] = [];

  for (const n of issues) {
    const issue = await gh.get<{ title: string; labels: { name: string }[] }>(`/repos/${repo}/issues/${n}`);
    const base = await baseOf(ctx, n);
    if (!base) {
      log(`trial: #${n} has no merged PR to start from; skipped`);
      continue;
    }
    const size = sizeOf(issue.labels.map((l) => l.name));
    const model = size === "S" ? "sonnet" : "opus";
    log(`trial: #${n} ${issue.title} (from ${base.slice(0, 7)}, ${model})`);
    const builds: Build[] = [];

    for (const v of VARIANTS) {
      const blocked = budgetBlock(state) ?? (state.pause() ? "paused" : undefined);
      if (blocked) {
        log(`trial: stopping, ${blocked}`);
        return finish();
      }
      const branch = `trial/${n}-${v.name}-${stamp}`;
      const runId = state.startRun({ lane: "trial", model, mode: "live", card: n, action: `trial ${v.name}`, status: "running" });
      const t0 = Date.now();
      const res = await runAgent(
        gh,
        { runId, repo, model, base, branch, image: v.image, prompt: buildPrompt(n, base, branch, v.skills) },
        log,
        (r) => state.saveUsage(r),
      );
      const cmp = await gh.maybe<{ files?: { additions: number; deletions: number }[] }>(`/repos/${repo}/compare/${base}...${encodeURIComponent(branch)}`);
      const files = cmp?.files ?? [];
      finishRun(state, runId, res);
      builds.push({
        variant: v.name, branch, runId, ok: res.ok, minutes: Math.round((Date.now() - t0) / 60_000), costUsd: res.costUsd,
        files: cmp ? files.length : undefined, additions: cmp ? files.reduce((t, f) => t + f.additions, 0) : undefined, deletions: cmp ? files.reduce((t, f) => t + f.deletions, 0) : undefined, summary: res.text.slice(0, 1500),
      });
      if (res.limited) {
        pauseForLimit(ctx, res.text, res.rateLimit?.resetsAt);
        return finish();
      }
    }

    // Blind labels: A and B are shuffled per card.
    const [a, b] = Math.random() < 0.5 ? [builds[0], builds[1]] : [builds[1], builds[0]];
    const labels: Record<string, string> = { A: a.variant, B: b.variant };
    let verdict: Verdict | null = null;
    let judgeText = "";
    if (a.ok && b.ok) {
      const runId = state.startRun({ lane: "trial", model: "opus", mode: "live", card: n, action: "trial judge", status: "running" });
      const res = await runAgent(
        gh,
        { runId, repo, model: "opus", fetch: [a.branch, b.branch], prompt: judgePrompt(n, base, a.branch, b.branch) },
        log,
        (r) => state.saveUsage(r),
      );
      finishRun(state, runId, res);
      judgeText = res.text;
      verdict = lastJson(res.text);
      if (res.limited) pauseForLimit(ctx, res.text, res.rateLimit?.resetsAt);
    } else {
      judgeText = "Not judged: a build failed.";
    }
    results.push({ issue: n, title: issue.title, base, builds, labels, verdict, judge: judgeText });
    log(`trial: #${n} judged: ${verdict?.winner ? `${verdict.winner} (${labels[verdict.winner] ?? "tie"})` : "no verdict"}`);
  }
  return finish();

  function finish(): void {
    const dir = join(env.data, "trials");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${stamp}.json`), JSON.stringify(results, null, 2));
    writeFileSync(join(dir, `${stamp}.md`), report(results));
    log(`trial: report in data/trials/${stamp}.md`);
  }
}

function finishRun(state: Ctx["state"], runId: number, res: AgentResult): void {
  state.updateRun(runId, { status: res.ok ? "done" : res.limited ? "limited" : "failed", session_id: res.sessionId ?? null, cost_usd: res.costUsd ?? null, summary: res.text.slice(0, 4000) }, true);
}

/** The commit a card's merged PR started from: the first parent of its merge commit. */
async function baseOf(ctx: Ctx, n: number): Promise<string | undefined> {
  const pulls = await ctx.gh.get<{ items: { number: number }[] }>(`/search/issues?q=${encodeURIComponent(`repo:${ctx.repo} is:pr is:merged ${n} in:body,title`)}`);
  for (const { number } of pulls.items) {
    const pr = await ctx.gh.get<{ merge_commit_sha: string | null; head: { ref: string }; body: string | null }>(`/repos/${ctx.repo}/pulls/${number}`);
    const forCard = pr.head.ref.startsWith(`claude/issue-${n}-`) || new RegExp(`\\b(close[sd]?|fix(e[sd])?|resolve[sd]?)\\s+#${n}\\b`, "i").test(pr.body ?? "");
    if (!forCard || !pr.merge_commit_sha) continue;
    const commit = await ctx.gh.get<{ parents: { sha: string }[] }>(`/repos/${ctx.repo}/commits/${pr.merge_commit_sha}`);
    return commit.parents[0]?.sha;
  }
  return undefined;
}

function buildPrompt(n: number, base: string, branch: string, skills: boolean): string {
  return [
    `QUALITY TRIAL, not a real build. Build card #${n} of the project exactly as \`docs/factory/prompts/builder.md\` and \`common.md\` describe, to your normal standard, with these differences:`,
    `- /work/repo is already on a new branch \`${branch}\`, started from commit ${base.slice(0, 12)}: the code as it was before this card was built for real. Read the card with \`gh issue view ${n} --comments\`.`,
    "- The card is closed and was already built once. Don't look at that PR or at anything committed after your starting point; build it fresh.",
    `- Don't touch GitHub: no labels, comments, issues or PRs. Commit your work and push only your branch (\`git push -u origin ${branch}\`).`,
    "- Run the checks builder.md asks for, and finish with what the PR body would have said: What you'll see, Choices I made, the checks and their results.",
    "",
    ...homelabNotes(skills),
  ].join("\n");
}

function judgePrompt(n: number, base: string, a: string, b: string): string {
  return [
    `You are judging a blind comparison: two AI builds of card #${n}, on branches \`${a}\` (call it A) and \`${b}\` (B). Both started from commit ${base.slice(0, 12)}. You don't know how either was made; judge only the work.`,
    "",
    `1. Read the card (\`gh issue view ${n} --comments\`, ignoring any PR it links to) and the repo's CLAUDE.md conventions.`,
    `2. For each branch, read the whole diff against the start (\`git diff ${base.slice(0, 12)}...<branch>\`), check it out, and run the checks the repo's CLAUDE.md and CI name for what the branch changes (give up on any one check after 20 minutes and say so).`,
    "3. Score each from 1 to 10 on: correctness, completeness against the card, tests, code quality (clear, simple, no bloat or needless abstraction, follows the repo's conventions), UI and UX polish (only if the card has UI), and safety (validation, error handling, security and accessibility not cut). Give concrete examples from the diffs.",
    "4. Change nothing: no commits, no pushes, nothing on GitHub.",
    "",
    'End your reply with one JSON object and nothing after it: {"A": {"correctness": n, "completeness": n, "tests": n, "code": n, "ui": n or null, "safety": n, "checks": "pass/fail per check", "notes": "..."}, "B": {...same...}, "winner": "A" | "B" | "tie", "why": "two or three sentences"}',
  ].join("\n");
}

function lastJson(text: string): Verdict | null {
  const start = text.lastIndexOf('{"A"');
  const i = start >= 0 ? start : text.lastIndexOf("{");
  for (let j = text.length; j > i && i >= 0; j--) {
    try {
      return JSON.parse(text.slice(i, j)) as Verdict;
    } catch {
      // keep trimming
    }
  }
  return null;
}

function report(results: { issue: number; title: string; builds: Build[]; labels: Record<string, string>; verdict: Verdict | null; judge: string }[]): string {
  const lines = ["# Skills quality trial", "", `${new Date().toISOString()} · ${results.length} card(s)`, ""];
  const wins: Record<string, number> = { skills: 0, plain: 0, tie: 0 };
  for (const r of results) {
    const w = r.verdict?.winner;
    const who = w === "tie" ? "tie" : w ? r.labels[w] : undefined;
    if (who) wins[who] = (wins[who] ?? 0) + 1;
    lines.push(`## #${r.issue} ${r.title}`, "", `Winner: **${who ?? "no verdict"}**. ${r.verdict?.why ?? ""}`, "");
    lines.push("| | built | time | cost | files | +/- | scores |", "|---|---|---|---|---|---|---|");
    for (const label of ["A", "B"]) {
      const variant = r.labels[label];
      const b = r.builds.find((x) => x.variant === variant)!;
      const s = r.verdict?.[label] as Record<string, unknown> | undefined;
      const scores = s ? ["correctness", "completeness", "tests", "code", "ui", "safety"].map((k) => `${k} ${s[k] ?? "–"}`).join(", ") : "";
      lines.push(`| ${variant} (${label}) | ${b.ok ? "ok" : "failed"} | ${b.minutes} min | ${b.costUsd ? "$" + b.costUsd.toFixed(2) : ""} | ${b.files ?? ""} | +${b.additions ?? "?"}/-${b.deletions ?? "?"} | ${scores} |`);
    }
    lines.push("", "<details><summary>Judge's notes</summary>", "", r.judge.slice(0, 6000), "", "</details>", "");
  }
  lines.splice(3, 0, `Wins: skills ${wins.skills}, plain ${wins.plain}, tie ${wins.tie}`, "");
  return lines.join("\n");
}

async function waitUntil(hhmm: string, log: (l: string) => void): Promise<void> {
  const [h, m] = hhmm.split(":").map(Number);
  const t = new Date();
  t.setHours(h, m, 0, 0);
  if (t <= new Date()) t.setDate(t.getDate() + 1);
  log(`trial: waiting until ${t.toLocaleString()}`);
  await new Promise((r) => setTimeout(r, t.getTime() - Date.now()));
}
