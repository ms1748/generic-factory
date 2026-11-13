// Resumes a factory PR's own Claude session when the owner replies on the PR (a comment, a review or a
// line comment) or on the card it's building (answering a question the agent asked there), and when the PR
// has merge conflicts with main (once per commit, so a fix that fails doesn't loop). Found by a webhook (instant) or by polling every few minutes (the fallback).
// A session resumes only if its lane is live; a dry lane records what it would have done.
import type { Ctx } from "./dispatch.ts";
import { budgetBlock, full, pauseForLimit, stopSwitch } from "./dispatch.ts";
import { ciFeedback, finishedSince, MAX_CI_RESUMES, notStarted, verdict, type CheckRun } from "./ci.ts";
import { authorOf, describe, newFeedback, type PrItem } from "./feedback.ts";
import { loadConfig } from "./project.ts";
import { resumePrompt } from "./prompt.ts";
import { runAgent } from "./runner.ts";
import type { Session } from "./state.ts";

interface ApiUser {
  login: string;
}
interface ApiComment {
  id: number;
  user: ApiUser | null;
  body: string | null;
  created_at: string;
}
interface ApiLineComment extends ApiComment {
  path: string;
  line: number | null;
}
interface ApiReview {
  user: ApiUser | null;
  body: string | null;
  state: string;
  submitted_at: string | null;
}

/** Checks open sessions (or only `prs`) and resumes the first one with new owner feedback. */
export async function checkSessions(ctx: Ctx, prs?: number[]): Promise<void> {
  const { state } = ctx;
  if (state.pause() || full(ctx)) return;
  await adoptPulls(ctx);
  const sessions = state.openSessions().filter((s) => !prs || prs.includes(s.pr) || (s.card !== null && prs.includes(s.card)));
  for (const s of sessions) {
    if (ctx.slots?.holds(s.card, s.pr, ctx.repo)) continue; // a run is already on this card or PR
    const pull = await ctx.gh.get<{ state: string; mergeable: boolean | null; mergeable_state: string; head: { sha: string } }>(`/repos/${ctx.repo}/pulls/${s.pr}`);
    if (pull.state !== "open") {
      state.closeSession(s.pr);
      continue;
    }
    const owner = ctx.repo.split("/")[0];
    // Each place on its own: an agent's later comment on the PR doesn't hide the owner's answer on the card.
    const feedback = [
      ...newFeedback(await prItems(ctx, s.pr), owner, s.handled_at),
      ...(s.card ? newFeedback(await cardItems(ctx, s.card), owner, s.handled_at) : []),
    ];
    // GitHub works mergeability out lazily: null now means "ask again on the next poll".
    if (!feedback.length && pull.mergeable === false && pull.mergeable_state === "dirty" && state.conflictTried(s.pr) !== pull.head.sha) {
      state.markConflictTried(s.pr, pull.head.sha);
      feedback.push(CONFLICT);
    }
    // CI finished red on the latest commit: the session fixes it instead of having waited for it.
    const tried = state.ciTried(s.pr);
    if (!feedback.length && tried.sha !== pull.head.sha && tried.count < MAX_CI_RESUMES) {
      const runs = (await ctx.gh.get<{ check_runs: CheckRun[] }>(`/repos/${ctx.repo}/commits/${pull.head.sha}/check-runs?per_page=100`)).check_runs;
      const v = verdict(runs);
      if (v.state === "red" && finishedSince(runs, s.handled_at)) {
        // Checks GitHub never started (minutes used up) aren't the PR's fault: only the rest go back.
        const skip = await notStarted(ctx.gh, ctx.repo, v.failed);
        const real = v.failed.filter((f) => !skip.has(f.id));
        if (skip.size && !blockedNoted.has(`${ctx.repo}#${pull.head.sha}`)) {
          blockedNoted.add(`${ctx.repo}#${pull.head.sha}`);
          ctx.log(`PR #${s.pr}: ${skip.size} check(s) never started (GitHub Actions minutes or spending limit); not sent to the builder`);
        }
        if (real.length) {
          state.markCiTried(s.pr, pull.head.sha);
          feedback.push(await ciFeedback(ctx.gh, ctx.repo, pull.head.sha, real));
        }
      }
    }
    if (!feedback.length) continue;
    if (!ctx.slots) return void (await resume(ctx, s, feedback)); // the CLI: one at a time
    ctx.slots.spawn(`resume ${ctx.repo.split("/")[1]} PR #${s.pr}`, "resume", ctx.log, () => resume(ctx, s, feedback), { card: s.card, pr: s.pr, repo: ctx.repo });
    if (!ctx.slots.free()) return; // the next check picks up the rest
  }
}

/** Commits whose never-started checks were already logged (once each, not every poll). */
const blockedNoted = new Set<string>();

/** Not the owner's words: the dispatcher noticed main moved under the PR. */
const CONFLICT: PrItem = {
  kind: "comment",
  author: "factory dispatcher",
  at: new Date(0).toISOString(),
  body: "This PR has merge conflicts with main (another PR merged first). Merge origin/main into your branch and resolve every conflict, keeping what both sides meant to do; then run the checks and push. Reply on the PR in one line: what conflicted and how you resolved it. Change nothing else.",
};

const ADOPTED =
  "You didn't open this PR in this session: it came from an earlier run (or the cloud routines). Before changing anything, read the card, the PR's whole diff against main and every comment on both, so you know what was built and why.\n\n";

/**
 * Factory PRs without a session here (built in the cloud, or before the dispatcher kept sessions) are
 * adopted, so the owner's comments on them start a builder run too, fresh instead of resumed.
 */
async function adoptPulls(ctx: Ctx): Promise<void> {
  const known = new Set(ctx.state.openSessions().map((s) => s.pr));
  const pulls = await ctx.gh.all<{ number: number; draft: boolean; created_at: string; head: { ref: string }; labels: { name: string }[] }>(`/repos/${ctx.repo}/pulls?state=open`);
  for (const p of pulls) {
    const card = p.head.ref.match(/^claude\/issue-(\d+)-/);
    if (known.has(p.number) || !card || p.draft) continue;
    // From when the PR opened: owner comments no agent has answered yet count as new.
    ctx.state.saveSession({ pr: p.number, card: Number(card[1]), sessionId: "", lane: "builder", runId: 0, branch: p.head.ref, handledAt: p.created_at });
  }
}

async function cardItems(ctx: Ctx, card: number): Promise<PrItem[]> {
  const comments = await ctx.gh.all<ApiComment>(`/repos/${ctx.repo}/issues/${card}/comments`);
  const owner = ctx.repo.split("/")[0];
  const mine = ctx.state.ownerReplies();
  return comments.map((c): PrItem => ({ kind: "card comment", author: authorOf(c.user?.login, c.id, owner, mine), body: c.body ?? "", at: c.created_at, where: `#${card}` }));
}

async function prItems(ctx: Ctx, pr: number): Promise<PrItem[]> {
  const base = `/repos/${ctx.repo}`;
  const [comments, lines, reviews] = await Promise.all([
    ctx.gh.all<ApiComment>(`${base}/issues/${pr}/comments`),
    ctx.gh.all<ApiLineComment>(`${base}/pulls/${pr}/comments`),
    ctx.gh.all<ApiReview>(`${base}/pulls/${pr}/reviews`),
  ]);
  const owner = ctx.repo.split("/")[0];
  const mine = ctx.state.ownerReplies();
  return [
    ...comments.map((c): PrItem => ({ kind: "comment", author: authorOf(c.user?.login, c.id, owner, mine), body: c.body ?? "", at: c.created_at })),
    ...lines.map((c): PrItem => ({ kind: "line comment", author: c.user?.login ?? "", body: c.body ?? "", at: c.created_at, where: `${c.path}${c.line ? ":" + c.line : ""}` })),
    ...reviews
      .filter((r) => r.submitted_at && r.state !== "PENDING")
      .map((r): PrItem => ({ kind: "review", author: r.user?.login ?? "", body: r.body ?? "", at: r.submitted_at!, where: r.state })),
  ];
}

export async function resume(ctx: Ctx, s: Session, feedback: PrItem[]): Promise<void> {
  const { state, log } = ctx;
  const startedAt = new Date().toISOString();
  const live = state.lane(s.lane).live;
  const fromDispatcher = feedback.every((f) => f.author === "factory dispatcher");
  const what = fromDispatcher
    ? `resume PR #${s.pr}: ${feedback[0].body.startsWith("CI failed") ? "red CI" : "merge conflict"}`
    : `resume PR #${s.pr} for ${feedback.length} new owner item(s)`;
  const base = { lane: s.lane, model: "", mode: live ? "live" : "dry", card: s.card, action: "resume" } as const;
  const model = (await loadConfig(ctx.gh, ctx.repo)).lanes.find((l) => l.name === s.lane)?.model ?? "opus";

  if (!live) {
    const id = state.startRun({ ...base, model, status: "dry" });
    state.updateRun(id, { pr: s.pr, summary: `would ${what}` }, true);
    state.markHandled(s.pr, startedAt); // noted once, not every poll
    log(`${s.lane} (dry): would ${what}`);
    return;
  }

  const tight = budgetBlock(state) ?? (await stopSwitch(ctx));
  if (tight) return log(`${s.lane}: ${what} waits, ${tight}`); // not handled: it runs once there's room

  const id = state.startRun({ ...base, model, status: "running" });
  log(`${s.lane}: run ${id} starts: ${what}`);
  const res = await runAgent(
    ctx.gh,
    {
      runId: id,
      repo: ctx.repo,
      model,
      prompt: (s.session_id ? "" : ADOPTED) + resumePrompt(s.pr, s.branch, describe(feedback), fromDispatcher),
      resume: s.session_id || undefined,
      branch: s.branch,
    },
    log,
    (r) => state.saveUsage(r),
  );
  if (res.limited) {
    pauseForLimit(ctx, res.text, res.rateLimit?.resetsAt); // not marked handled: it resumes after the pause
  } else {
    // Done or failed, this feedback is dealt with; a failure is never retried in a loop.
    state.markHandled(s.pr, startedAt, res.ok ? res.sessionId : undefined);
  }
  const status = res.ok ? "done" : res.limited ? "limited" : "failed";
  state.updateRun(id, { status, session_id: res.sessionId ?? null, pr: s.pr, cost_usd: res.costUsd ?? null, summary: res.text.slice(0, 4000) }, true);
  log(`${s.lane}: run ${id} ${status} (PR #${s.pr})`);
}
