// "Is it completely done?" in one line. When a factory PR merges, the dispatcher checks
// what's true now, not what anyone said: CI on the merged commit, the device tests among those checks, the
// reviewer's last verdict, and the follow-up ideas filed from it. Then it posts one line on the card:
//   Done: closes the card.
//   Not done: says what's missing and leaves the card open with `needs-owner`.
// Once per PR, only for PRs merged after this first ran (no burst of lines for old merges). The board's
// Done column shows the last week of them. It posts only while the reviewer lane is live (a Done line
// leans on its verdict); otherwise it records the line for the board and says it would have posted.
import { MARKER } from "./queue.ts";
import type { Ctx } from "./dispatch.ts";
import { laneOn } from "./dispatch.ts";
import { loadConfig } from "./project.ts";
import { IDEA_LABEL } from "./followups.ts";
import type { DoneRecord } from "./state.ts";
import { deviceCheck } from "./install.ts";
/** How long a Done line stays in the board's Done column. */
export const DONE_DAYS = 7;
/** Merges this old get no line even if missed (dispatcher down): it would only be noise by then. */
const MAX_AGE_MS = 3 * 24 * 3600_000;

export interface Check {
  name: string;
  /** "completed", or "queued"/"in_progress" for a check still going. */
  status: string;
  /** success, failure, skipped, neutral, cancelled, timed_out, action_required, or null while going. */
  conclusion: string | null;
}

export interface DoneFacts {
  pr: number;
  card: number | null;
  checks: Check[];
  /** The reviewer's last posted verdict on the PR, if it was reviewed. */
  verdict?: string;
  /** Idea issues filed from the PR's reviews. */
  followups: number[];
}

const PASSED = new Set(["success", "skipped", "neutral"]);

/** The line for a merged PR, and whether it's completely done. Pure. */
export function doneLine(f: DoneFacts, device: RegExp | null = deviceCheck()): { ok: boolean; line: string } {
  const failed = f.checks.filter((c) => c.status === "completed" && !PASSED.has(c.conclusion ?? ""));
  const going = f.checks.filter((c) => c.status !== "completed");
  const passed = f.checks.filter((c) => c.status === "completed" && PASSED.has(c.conclusion ?? ""));
  // A skipped device job didn't run (the tests are switched off, or not needed): not a failure.
  // Device tests are check runs on a test machine, by name (Settings › Install › Device checks; none if unset).
  const devices = device ? f.checks.filter((c) => device.test(c.name) && c.conclusion !== "skipped") : [];
  const ran = devices.filter((c) => c.status === "completed" && c.conclusion === "success");
  const names = (cs: Check[]) => cs.map((c) => c.name).join(", ");

  const missing: string[] = [];
  if (!f.checks.length) missing.push("no CI ran on it");
  if (failed.length) missing.push(`failed: ${names(failed)}`);
  if (going.length) missing.push(`still running at merge: ${names(going)}`);
  if (devices.length && ran.length < devices.length) missing.push(`device tests didn't pass: ${names(devices.filter((c) => !ran.includes(c)))}`);
  if (f.verdict !== "ready") missing.push(f.verdict ? `the reviewer's last verdict was "${f.verdict}"` : "the reviewer never passed it");

  const tests = ran.length ? ` Device tests passed: ${names(ran)}.` : f.checks.length && device ? " No device tests ran (none were needed for this change)." : "";
  const ideas = f.followups.length ? ` Follow-ups filed: ${f.followups.map((n) => `#${n}`).join(", ")}.` : " No follow-ups.";
  if (!missing.length) {
    return { ok: true, line: `✅ **Done.** Merged #${f.pr}. CI green (${passed.length} check${passed.length === 1 ? "" : "s"}).${tests}${ideas} Nothing waiting on you.` };
  }
  return { ok: false, line: `⚠️ **Not done yet.** #${f.pr} merged, but ${missing.join("; ")}.${ideas} Left open for you: close it if that's fine, or say what to do.` };
}

/** The card a PR closes: its `claude/issue-<n>-` branch, else the first `Closes #n` in its body. */
export function cardOf(branch: string, body: string | null | undefined): number | null {
  const b = Number(branch.match(/^claude\/issue-(\d+)-/)?.[1]);
  if (b) return b;
  const c = Number((body ?? "").match(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/i)?.[1]);
  return c || null;
}

export interface ApiPull {
  number: number;
  title: string;
  body?: string | null;
  merged_at: string | null;
  merge_commit_sha: string | null;
  head: { ref: string; sha: string };
  labels: { name: string }[];
}

export const isFactory = (p: ApiPull) => /^claude\/issue-\d+-/.test(p.head.ref) || p.labels.some((l) => l.name === "factory");

/** Every check on a commit: check runs plus old-style commit statuses (factory/review among them). */
export async function checksOf(ctx: Ctx, sha: string): Promise<Check[]> {
  const { gh, repo } = ctx;
  const runs = await gh.get<{ check_runs: (Check & { started_at?: string | null })[] }>(`/repos/${repo}/commits/${sha}/check-runs?per_page=100`);
  const st = await gh.get<{ statuses: { context: string; state: string }[] }>(`/repos/${repo}/commits/${sha}/status`);
  const statuses = st.statuses
    .filter((s) => s.context !== "factory/review") // the verdict is judged on its own
    .map((s) => ({ name: s.context, status: s.state === "pending" ? "in_progress" : "completed", conclusion: s.state === "pending" ? null : s.state }));
  return latestChecks([...runs.check_runs, ...statuses]);
}

/** One entry per check name: the one that started last (a job skipped before `reviewed`, then run, counts as run). */
export function latestChecks(cs: (Check & { started_at?: string | null })[]): Check[] {
  const by = new Map<string, Check & { started_at?: string | null }>();
  for (const c of cs) {
    const had = by.get(c.name);
    if (!had || (c.started_at ?? "") > (had.started_at ?? "")) by.set(c.name, c);
  }
  return [...by.values()].map(({ name, status, conclusion }) => ({ name, status, conclusion }));
}

/** CI on a commit, judged: what failed, what's still going, and whether it's all green. */
export function ciState(checks: Check[]): { green: boolean; failed: string[]; going: string[] } {
  const failed = checks.filter((c) => c.status === "completed" && !PASSED.has(c.conclusion ?? "")).map((c) => c.name);
  const going = checks.filter((c) => c.status !== "completed").map((c) => c.name);
  const ran = checks.some((c) => c.status === "completed" && c.conclusion === "success");
  return { green: ran && !failed.length && !going.length, failed, going };
}

/** The serve loop's step: a Done line for each factory PR merged since the last look. */
export async function checkDone(ctx: Ctx, now = Date.now()): Promise<void> {
  const { gh, state, log, repo } = ctx;
  const since = state.doneSince(new Date(now));
  const pulls = (await gh.get<ApiPull[]>(`/repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=30`)).filter(
    (p) => p.merged_at && p.merged_at >= since && now - Date.parse(p.merged_at) < MAX_AGE_MS && isFactory(p) && !state.doneRecord(p.number),
  );
  if (!pulls.length) return;
  const reviewer = (await loadConfig(gh, repo)).lanes.find((l) => l.kind === "reviewer");
  const live = Boolean(reviewer && laneOn(state, reviewer) && state.lane(reviewer.name).live);
  let ideas: { number: number; body?: string | null }[] | undefined;
  for (const p of pulls) {
    const card = cardOf(p.head.ref, p.body);
    try {
      // CI ran on the PR's head; a squash merge's own commit usually has no checks of its own.
      const checks = await checksOf(ctx, p.head.sha);
      ideas ??= await gh.all<{ number: number; body?: string | null }>(`/repos/${repo}/issues?state=all&labels=${IDEA_LABEL}`);
      const followups = ideas.filter((i) => i.body?.includes(`<!-- factory-later pr=${p.number} -->`)).map((i) => i.number);
      const { ok, line } = doneLine({ pr: p.number, card, checks, verdict: state.lastVerdict(p.number), followups });
      const record: DoneRecord = { pr: p.number, card, title: p.title, ok, line, at: new Date(now).toISOString() };
      if (card && live) {
        await gh.send("POST", `/repos/${repo}/issues/${card}/comments`, { body: `${line}\n${MARKER}` });
        if (ok) await gh.send("PATCH", `/repos/${repo}/issues/${card}`, { state: "closed", state_reason: "completed" });
        else {
          await gh.send("PATCH", `/repos/${repo}/issues/${card}`, { state: "open" });
          await gh.send("POST", `/repos/${repo}/issues/${card}/labels`, { labels: ["needs-owner"] });
        }
      }
      state.saveDone(record);
      log(`done${live ? "" : " (dry)"}: PR #${p.number}${card ? ` (card #${card})` : ""} ${ok ? "is done" : "is not done yet"}${live || !card ? "" : "; would post that on the card"}`);
    } catch (e) {
      log(`done: couldn't check PR #${p.number} (${(e as Error).message}); trying again next poll`);
    }
  }
}

