// The reviewer lane: a Sonnet review of every ready factory PR before the owner sees it. It reads the card,
// the diff and CI, opens the Pages preview for website changes, and ends with a verdict. The agent only
// reads; the dispatcher posts the verdict, sets the `factory/review` status, and on "needs work" hands the
// list back to the PR's builder session (at most two rounds, then it's the owner's call). Small in-scope
// improvements ("polish") go back to the builder once, even on "ready", so the owner gets the finished PR
// instead of a list of nice-to-haves; bigger ideas ("later") become `idea` issues (src/followups.ts).
// A final "ready" also adds the `reviewed` label (REVIEWED_LABEL): a project's CI can hold its costly builds
// for factory PRs until that label is on, so each PR builds once it's worth the owner's time, not on every
// push while the builder and reviewer go back and forth. Settings › Install › Reviewer CI note tells the
// reviewer about any such checks.
import type { Ctx } from "./dispatch.ts";
import { budgetBlock, full, laneOn, pauseForLimit, stopSwitch } from "./dispatch.ts";
import type { PrItem } from "./feedback.ts";
import type { Followup } from "./followups.ts";
import { fileFollowups } from "./followups.ts";
import { loadConfig } from "./project.ts";
import { homelabNotes } from "./prompt.ts";
import { install, type Install } from "./install.ts";
import { resume } from "./resume.ts";
import { runAgent } from "./runner.ts";

export interface Verdict {
  verdict: "ready" | "needs-work";
  mustFix: string[];
  /** Small, in-scope improvements worth doing in this PR (an edge case, a missing test, a clearer message). */
  polish: string[];
  /** Bigger ideas for a follow-up card. */
  later: string[];
  /** The review in Markdown, without the JSON block. */
  review: string;
  /** The reviewer's call on merging without the owner (automerge.ts): true only when it said "ok". */
  mergeOk: boolean;
  /** Why it's the owner's call, when mergeOk is false. */
  mergeWhy: string;
}

/** Automatic "needs work" rounds per PR before the reviewer stops and leaves it to the owner. */
export const MAX_ROUNDS = 2;
/** Added on a final "ready"; a project's CI may wait for it before its costly builds (see the top). */
export const REVIEWED_LABEL = "reviewed";

/** Whether this verdict adds REVIEWED_LABEL: a "ready" that goes to the owner (after any polish round). */
export function labelsReviewed(verdict: Verdict["verdict"], next: Next): boolean {
  return verdict === "ready" && next === "owner";
}
const MARKER = "<!-- factory-review -->";

/** The reviewer's guide, with this install's CI note (Settings › Install). Shown in the dashboard's Lanes view. */
export const reviewerGuide = (i: Pick<Install, "reviewerCi"> = install()): string => `How the reviewer works (built into the dispatcher, src/review.ts):

1. Read the PR (title, body, files, checks) and the card it closes, with every comment on both.
2. Read the whole diff (\`gh pr diff\`), and check out the PR to read the code around the change.
3. Look at CI (the check runs on the PR's head commit).${i.reviewerCi ? ` ${i.reviewerCi}` : ""}
   If CI didn't cover something, run a targeted check when it's cheap
   (under ~10 minutes); run \`npm ci\` first if node_modules is missing (the npm cache makes it quick).
4. Website or demo changes, when the project has previews: open the PR's preview with the Access service
   token and check that the changed pages load and show the change.
5. Judge it against the card's "Done when", correctness, scope (nothing unasked), tests, the project's
   common.md rules, and security (no secrets, no keys, no unsafe input handling).
6. Change nothing on GitHub. End with a short Markdown review (its first line is a one-sentence summary)
   and a JSON verdict: {"verdict": "ready" | "needs-work", "must_fix": [...], "polish": [...], "later": [...],
   "merge": "ok" | "owner", "merge_why": "..."}.
   "ready" means nothing must be fixed. "polish" is small and inside the card's scope (an edge case, a
   missing test, a clearer message): the builder does those now. "later" is bigger, for a follow-up card:
   each one becomes an issue, so start it with a short title sentence, then a line on why.
   "merge": "ok" lets the factory merge it by itself once CI is green; say "owner" (and why, in one line)
   if it deletes or rewrites user data or save files, removes or changes a feature people use, or if
   you're unsure about any part of it.

The dispatcher posts the verdict as one short PR comment (the full review folded away), sets the
factory/review commit status, and resumes the PR's builder session with the must-fix list (at most
${MAX_ROUNDS} rounds) or, on "ready", the polish list (once per PR). Each "later" item becomes an \`idea\`
issue (no duplicates, at most 5 per PR), linked from the comment.`;

export function reviewerPrompt(repo: string, pr: number, title: string): string {
  return [
    `You are the factory's reviewer for ${repo}, reviewing PR #${pr} ("${title}"). The repo is cloned at /work/repo, on main.`,
    "",
    reviewerGuide().split("\n\n")[1], // the numbered steps
    "",
    "Useful commands:",
    `- \`gh pr view ${pr} --json title,body,headRefName,headRefOid,files,state,mergedAt,comments\``,
    `- \`gh pr diff ${pr}\` and \`gh pr checkout ${pr}\` (both work for merged PRs too; checkout has no -q flag)`,
    `- CI: \`gh api repos/${repo}/commits/$(gh pr view ${pr} --json headRefOid -q .headRefOid)/check-runs -q '.check_runs[] | [.name, .status, .conclusion] | @tsv'\` (and \`.../status\` for commit statuses). Not \`gh pr checks\` or \`statusCheckRollup\`: they also ask for workflow runs, which this token can't read.`,
    "- the card: the issue in the branch name (`claude/issue-<n>-...`) or the PR's `Closes #n`; `gh issue view <n> --comments`",
    ...(install().previewHost
      ? [
          `- the preview is the branch name with \`/\` replaced by \`-\`, cut to 28 characters: \`https://<that>.${install().previewHost}\` (e.g. \`claude/issue-131-demo-no-keys\` → \`claude-issue-131-demo-no-key\`). Look for the change in the HTML and the built JS it loads. Open it with \`curl -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET"\``,
        ]
      : []),
    "",
    "Rules: read only. Never comment, review, label, push, merge or edit anything on GitHub, and never print the Access values.",
    "Be concrete: cite file:line for each problem and say why it matters. Don't pad the review; if it's good, say so briefly.",
    "Your final message is the review (at most ~250 words; first line a one-sentence summary), then the JSON verdict in a ```json block, last. Only list polish you'd really want done: no style nits.",
    "",
    ...homelabNotes(false, install(), repo).filter((l) => !/Commits use|Finish with/.test(l)),
  ].join("\n");
}

/** The verdict from the reviewer's final message: its last ```json block. */
export function parseVerdict(text: string): Verdict | undefined {
  const blocks = [...text.matchAll(/```json\s*([\s\S]*?)```/g)];
  const last = blocks.at(-1);
  if (!last) return undefined;
  try {
    const j = JSON.parse(last[1]) as { verdict?: string; must_fix?: unknown; polish?: unknown; later?: unknown; nice_to_have?: unknown; merge?: unknown; merge_why?: unknown };
    const list = (v: unknown) => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);
    const mustFix = list(j.must_fix);
    if (j.verdict !== "ready" && j.verdict !== "needs-work") return undefined;
    // "ready" with must-fix items is a contradiction; the items win.
    const verdict = mustFix.length ? "needs-work" : j.verdict;
    const mergeOk = verdict === "ready" && j.merge === "ok";
    const mergeWhy = mergeOk ? "" : typeof j.merge_why === "string" && j.merge_why.trim() ? j.merge_why.trim().slice(0, 300) : "the reviewer didn't say it's safe to merge by itself";
    return { verdict, mustFix, polish: list(j.polish), later: [...list(j.later), ...list(j.nice_to_have)], review: text.slice(0, last.index).trim(), mergeOk, mergeWhy };
  } catch {
    return undefined;
  }
}

/** What happens after a verdict: the builder fixes, the builder polishes (once), or it's the owner's. */
export type Next = "fix" | "polish" | "owner";

/** The PR comment for a verdict: a few lines to read, the full review folded away. */
export function verdictComment(v: Verdict, round: number, next: Next, filed: Followup[] = []): string {
  const head =
    v.verdict === "needs-work"
      ? "🤖 **Factory reviewer: needs work** 🔧"
      : next === "polish"
        ? "🤖 **Factory reviewer: ready, polishing first** ✨"
        : "🤖 **Factory reviewer: ready for you** ✅";
  const [summary = "", ...rest] = v.review.split(/\n\s*\n/);
  const list = (title: string, items: string[]) => (items.length ? [`**${title}**`, ...items.map((i) => `- ${i}`), ""] : []);
  // "Later" items that are issues show as links (GitHub prints the title); the rest stay as text.
  const asIssue = new Map(filed.filter((f) => f.issue).map((f) => [f.item, f]));
  const later = v.later.map((i) => {
    const f = asIssue.get(i);
    return f ? `#${f.issue}${f.existing ? " (already open)" : ""}` : i;
  });
  const tail =
    next === "fix"
      ? `_Round ${round} of ${MAX_ROUNDS}: the builder session picks this list up now._`
      : next === "polish"
        ? "_The builder does the polish now (once), then I check it again._"
        : v.verdict === "needs-work"
          ? `_That was the last automatic round (${round} of ${MAX_ROUNDS}); over to you._`
          : v.mergeOk
            ? "_I merge it by myself once CI and the device tests are green; you'll get the Done line on the card._"
            : `_Over to you to merge: ${v.mergeWhy}._`;
  return [
    head,
    "",
    summary.trim(),
    "",
    ...list("Must fix", v.mustFix),
    ...list(next === "polish" ? "Polish (being done now)" : "Polish", v.polish),
    ...list(asIssue.size ? "Later (filed as ideas)" : "Later (follow-up ideas)", later),
    ...(rest.length ? ["<details><summary>Full review</summary>", "", rest.join("\n\n").trim(), "", "</details>", ""] : []),
    tail,
    MARKER,
  ].join("\n");
}

interface ApiPull {
  number: number;
  title: string;
  draft: boolean;
  state: string;
  head: { ref: string; sha: string };
  labels: { name: string }[];
}

const isFactoryPull = (p: ApiPull) => /^claude\/issue-\d+-/.test(p.head.ref) || p.labels.some((l) => l.name === "factory");

export interface ReviewOptions {
  /** Post the verdict, set the status and hand "needs work" back to the builder. Off for trial reviews. */
  post: boolean;
}

/** Reviews one PR with a live Sonnet run. Returns the verdict (or undefined if the run gave none). */
export async function reviewPr(ctx: Ctx, pr: number, opts: ReviewOptions): Promise<Verdict | undefined> {
  const { gh, state, log, repo } = ctx;
  const lane = (await loadConfig(gh, repo)).lanes.find((l) => l.kind === "reviewer");
  const model = lane?.model ?? "sonnet";
  const pull = await gh.get<ApiPull>(`/repos/${repo}/pulls/${pr}`);
  const card = Number(pull.head.ref.match(/^claude\/issue-(\d+)-/)?.[1]) || null;
  const id = state.startRun({ lane: lane?.name ?? "reviewer", model, mode: "live", card, action: opts.post ? "review" : "review (trial)", status: "running" });
  log(`reviewer: run ${id} reviews PR #${pr}${opts.post ? "" : " (trial: nothing posted)"}`);
  const res = await runAgent(gh, { runId: id, repo, model, prompt: reviewerPrompt(repo, pr, pull.title) }, log, (r) => state.saveUsage(r));
  if (res.limited) pauseForLimit(ctx, res.text, res.rateLimit?.resetsAt);
  const v = res.ok ? parseVerdict(res.text) : undefined;
  const status = !res.ok ? (res.limited ? "limited" : "failed") : v ? "done" : "failed";
  const summary = v ? `${v.verdict === "ready" ? "READY" : "NEEDS WORK"}: ${v.review}`.slice(0, 4000) : res.text.slice(0, 4000);
  state.updateRun(id, { status, session_id: res.sessionId ?? null, pr, cost_usd: res.costUsd ?? null, summary }, true);
  if (!v) {
    log(`reviewer: run ${id} gave no verdict (PR #${pr})`);
    return undefined;
  }
  const round = v.verdict === "needs-work" ? state.reviewRounds(pr) + 1 : state.reviewRounds(pr);
  const session = state.openSessions().find((s) => s.pr === pr);
  const next: Next =
    v.verdict === "needs-work" ? (round <= MAX_ROUNDS && session ? "fix" : "owner") : v.polish.length && session && !state.polished(pr) ? "polish" : "owner";
  // A polish round is stored as its own verdict so it happens once per PR.
  state.saveReview({ pr, sha: pull.head.sha, verdict: opts.post && next === "polish" ? "polish" : v.verdict, runId: id, posted: opts.post });
  if (opts.post) state.saveMergeCall(pr, { sha: pull.head.sha, ok: v.mergeOk, why: v.mergeWhy });
  log(`reviewer: run ${id}: PR #${pr} ${v.verdict}${res.costUsd ? `, $${res.costUsd.toFixed(2)} API-equivalent` : ""}`);
  if (!opts.post) return v;

  const filed = await fileFollowups(gh, repo, pr, card, v.later, log);
  await gh.send("POST", `/repos/${repo}/issues/${pr}/comments`, { body: verdictComment(v, round, next, filed) });
  await gh
    .send("POST", `/repos/${repo}/statuses/${pull.head.sha}`, {
      state: next === "polish" ? "pending" : v.verdict === "ready" ? "success" : "failure",
      context: "factory/review",
      description: next === "polish" ? `Polishing ${v.polish.length} item(s)` : v.verdict === "ready" ? "Ready for the owner" : `Needs work: ${v.mustFix.length} item(s)`,
    })
    .catch((e) => log(`reviewer: couldn't set the commit status (${(e as Error).message})`));
  if (labelsReviewed(v.verdict, next))
    await gh
      .send("POST", `/repos/${repo}/issues/${pr}/labels`, { labels: [REVIEWED_LABEL] })
      .catch((e) => log(`reviewer: couldn't add the ${REVIEWED_LABEL} label (${(e as Error).message})`));

  if (session && (next === "fix" || next === "polish")) {
    const items = (xs: string[]) => xs.map((m) => `- ${m}`);
    const body =
      next === "fix"
        ? [...items(v.mustFix), ...(v.polish.length ? ["", "Also, if small and in scope (polish):", ...items(v.polish)] : [])].join("\n")
        : ["The reviewer passed this PR. Do these small polish items now (skip any that turn out big or out of scope, and say why in one line):", ...items(v.polish)].join("\n");
    const item: PrItem = { kind: "review", author: "factory reviewer", body, at: new Date().toISOString(), where: next === "fix" ? "CHANGES_REQUESTED" : "COMMENTED" };
    await resume(ctx, session, [item]);
  }
  return v;
}

/**
 * The serve loop's step: reviews the first ready (non-draft) factory PR whose latest commit has no review
 * yet. Live only when the reviewer lane is live; a dry lane notes once per commit what it would do.
 */
export async function checkReviews(ctx: Ctx): Promise<void> {
  const { gh, state, log, repo } = ctx;
  if (state.pause() || full(ctx)) return;
  const lane = (await loadConfig(gh, repo)).lanes.find((l) => l.kind === "reviewer");
  if (!lane || !laneOn(state, lane)) return;
  const pulls = (await gh.all<ApiPull>(`/repos/${repo}/pulls?state=open`)).filter((p) => !p.draft && isFactoryPull(p));
  for (const p of pulls) {
    const card = Number(p.head.ref.match(/^claude\/issue-(\d+)-/)?.[1]) || null;
    if (ctx.slots?.holds(card, p.number, repo)) continue; // a run is still changing it
    if (state.reviewed(p.number, p.head.sha) && !state.polishSettled(p.number)) continue;
    if (state.reviewRounds(p.number) >= MAX_ROUNDS && state.lastVerdict(p.number) === "needs-work") continue; // owner's call now
    if (!state.lane(lane.name).live) {
      const id = state.startRun({ lane: lane.name, model: lane.model, mode: "dry", card: null, action: "review", status: "dry" });
      state.updateRun(id, { pr: p.number, summary: `would review PR #${p.number} ${p.title}` }, true);
      state.saveReview({ pr: p.number, sha: p.head.sha, verdict: "dry", runId: id, posted: false });
      log(`${lane.name} (dry): would review PR #${p.number}`);
      continue;
    }
    const tight = budgetBlock(state) ?? (await stopSwitch(ctx));
    if (tight) return log(`${lane.name}: review of PR #${p.number} waits, ${tight}`);
    if (!ctx.slots) return void (await reviewPr(ctx, p.number, { post: true }));
    ctx.slots.spawn(`review ${repo.split("/")[1]} PR #${p.number}`, "review", log, () => reviewPr(ctx, p.number, { post: true }), { card, pr: p.number, repo });
    if (!ctx.slots.free()) return;
  }
}
