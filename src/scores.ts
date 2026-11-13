// Self-scoring: every merged factory PR gets a 0-100 score from what happened to it, so the owner can see
// which lane and model does best on which card size. The facts come from GitHub (review rounds, the
// owner's own commits on the PR, red CI, time to merge, a revert) and the runs table (cost). Only the facts
// are stored; the score is worked out from them when shown, so the formula below is the one in use.
// Reading only: nothing here writes to GitHub.
import type { Ctx } from "./dispatch.ts";
import { checksOf, ciState, cardOf, isFactory, type ApiPull } from "./done.ts";
import { loadConfig } from "./project.ts";
import { isAgent, sizeOf } from "./queue.ts";
import type { Lane } from "./config.ts";

/** What happened to one merged PR. */
export interface PrFacts {
  pr: number;
  card: number | null;
  title: string;
  /** The card's size label at scoring time ("S", "M", "L", "XL"), or "none". */
  size: string;
  /** The builder lane that made it: from the runs table, else the lane that builds its size. */
  lane: string;
  /** The model that wrote it, as "Opus 5.5" (its commits' co-author line), else the lane's model. */
  model: string;
  /** "Factory reviewer: needs work" verdicts. */
  reviewerRounds: number;
  /** The owner's comments and reviews on the PR (bare approvals don't count). */
  ownerRounds: number;
  /** The owner's own commits on the PR (no Claude co-author line, merges left out). */
  ownerCommits: number;
  /** Lines added plus removed in those commits. */
  ownerLines: number;
  /** Commits on the PR whose CI went red. */
  ciFailures: number;
  /** Opened to merged. */
  hours: number;
  /** The PR or commit that reverted it, if any ("#81" or a short sha). */
  reverted: string | null;
  /** API-equivalent cost of the live runs on the PR and its card; null when none were recorded here. */
  cost: number | null;
  merged: string;
}

/** The score's rules: points off 100 for each thing that went less than right. */
export const RULES = {
  /** Per review round, by the factory reviewer or the owner. */
  round: { each: 10, max: 30 },
  /** The owner had to change the code: some points for any change, plus one per so many lines. */
  owner: { any: 5, lines: 10, max: 25 },
  /** Per commit whose CI went red. */
  ci: { each: 5, max: 15 },
  /** Waiting to merge: free for the first hours, then so much a day. */
  wait: { freeHours: 24, perDay: 2, max: 10 },
  /** Reverted after merging. */
  revert: 40,
  /** One point per so many dollars (API-equivalent). */
  cost: { usd: 5, max: 10 },
};

export interface Scored extends PrFacts {
  score: number;
  /** What took points off, as "−10 review rounds (1 reviewer, 0 you)". */
  parts: { why: string; points: number }[];
}

/** The 0-100 score for a PR's facts, and what took points off. Pure. */
export function score(f: PrFacts): Scored {
  const R = RULES;
  const parts: { why: string; points: number }[] = [];
  const add = (points: number, why: string) => points > 0 && parts.push({ why, points: Math.round(points) });
  const rounds = f.reviewerRounds + f.ownerRounds;
  add(Math.min(R.round.max, rounds * R.round.each), `${rounds} review round${rounds === 1 ? "" : "s"} (${f.reviewerRounds} reviewer, ${f.ownerRounds} you)`);
  if (f.ownerCommits) add(Math.min(R.owner.max, R.owner.any + Math.floor(f.ownerLines / R.owner.lines)), `you changed ${f.ownerLines} line${f.ownerLines === 1 ? "" : "s"} in ${f.ownerCommits} commit${f.ownerCommits === 1 ? "" : "s"}`);
  add(Math.min(R.ci.max, f.ciFailures * R.ci.each), `CI red on ${f.ciFailures} commit${f.ciFailures === 1 ? "" : "s"}`);
  const days = Math.max(0, f.hours - R.wait.freeHours) / 24;
  add(Math.min(R.wait.max, Math.floor(days * R.wait.perDay)), `${Math.round(f.hours)} h to merge`);
  if (f.reverted) add(R.revert, `reverted by ${f.reverted}`);
  if (f.cost) add(Math.min(R.cost.max, Math.floor(f.cost / R.cost.usd)), `$${f.cost.toFixed(2)} API-equivalent`);
  const off = parts.reduce((a, p) => a + p.points, 0);
  return { ...f, score: Math.max(0, 100 - off), parts };
}

/** The formula in words, from RULES: what the dashboard and the README show. */
export function formula(): string[] {
  const R = RULES;
  return [
    "Every merged factory PR starts at 100 and loses points for what went less than right (never below 0):",
    `Review rounds: ${R.round.each} per "needs work" from the reviewer or comment or review from you (bare approvals don't count), at most ${R.round.max}.`,
    `Your changes: ${R.owner.any} if you committed to the PR yourself, plus 1 per ${R.owner.lines} lines you changed, at most ${R.owner.max}.`,
    `CI failures: ${R.ci.each} per commit whose CI went red, at most ${R.ci.max}.`,
    `Time to merge: free for ${R.wait.freeHours} hours, then ${R.wait.perDay} a day, at most ${R.wait.max}.`,
    `Reverted: ${R.revert}.`,
    `Cost: 1 per $${R.cost.usd} API-equivalent of its runs, at most ${R.cost.max}. PRs built outside the dispatcher have no cost here.`,
  ];
}

/** "Opus 5.5" from "Claude Opus 5.5", "claude-opus-5-5" or "opus". */
export function modelName(s: string): string {
  const m = s.match(/(opus|sonnet|haiku|fable)(?:[\s-]+(\d+(?:[.-]\d+)?))?/i);
  if (!m) return s.trim() || "unknown";
  const family = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
  return m[2] ? `${family} ${m[2].replace("-", ".")}` : family;
}

/** The model on a commit's `Co-Authored-By: Claude <model> <...>` line, if it has one. */
export function trailerModel(message: string): string | undefined {
  const m = message.match(/^Co-Authored-By:\s*Claude\b([^<\n]*)</im);
  return m ? (m[1].trim() ? modelName(m[1]) : "Claude") : undefined;
}

/** The builder lane for a size by the project's config, for PRs the runs table doesn't know. */
export function laneForSize(lanes: Lane[], size: string): string {
  return lanes.find((l) => l.kind === "builder" && l.sizes.includes(size))?.name ?? "unknown";
}

/**
 * The PR a merged PR or commit reverts: GitHub's Revert button ("Reverts owner/repo#12"), a
 * `Revert "<title>"` title, or a commit's "This reverts commit <sha>." naming a PR's merge commit.
 */
export function revertTarget(
  text: { title: string; body?: string | null },
  repo: string,
  merged: { pr: number; title: string; sha: string | null }[],
): number | null {
  const by = (text.body ?? "").match(new RegExp(`Reverts ${repo.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}#(\\d+)`, "i"));
  if (by) return Number(by[1]);
  const title = text.title.match(/^Revert "(.+)"$/)?.[1];
  const sha = (text.body ?? "").match(/This reverts commit ([0-9a-f]{7,40})/i)?.[1];
  for (const m of merged) {
    if (title && m.title === title) return m.pr;
    if (sha && m.sha && m.sha.startsWith(sha)) return m.pr;
  }
  return null;
}

export interface Group {
  lane: string;
  model: string;
  size: string;
  prs: number;
  score: number;
  /** Average cost over the PRs that have one; null if none do. */
  cost: number | null;
  rounds: number;
  reverted: number;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const SIZES = ["S", "M", "L", "XL", "none"];

/** Scores by lane × model × size, in size order, then by average score. Pure. */
export function groups(rows: Scored[]): Group[] {
  const by = new Map<string, Scored[]>();
  for (const r of rows) {
    const k = `${r.lane}\n${r.model}\n${r.size}`;
    by.set(k, [...(by.get(k) ?? []), r]);
  }
  return [...by.entries()]
    .map(([k, rs]) => {
      const [lane, model, size] = k.split("\n");
      const costs = rs.map((r) => r.cost).filter((c): c is number => c != null);
      return {
        lane, model, size, prs: rs.length,
        score: Math.round(avg(rs.map((r) => r.score))),
        cost: costs.length ? avg(costs) : null,
        rounds: Math.round(avg(rs.map((r) => r.reviewerRounds + r.ownerRounds)) * 10) / 10,
        reverted: rs.filter((r) => r.reverted).length,
      };
    })
    .sort((a, b) => SIZES.indexOf(a.size) - SIZES.indexOf(b.size) || b.score - a.score);
}

/** PRs a model needs on a size before it's compared. */
export const MIN_PRS = 3;
/** Within this many points, two models count as matching. */
export const MATCH = 5;
/** A model this many points ahead is clearly better. */
export const CLEAR = 10;

/**
 * Per size: which model to use, in a sentence. Models are compared on the same size only, once each has
 * MIN_PRS merged PRs; the cheaper one is the one with the lower average cost. Pure.
 */
export function recommend(rows: Scored[]): string[] {
  const out: string[] = [];
  for (const size of SIZES) {
    const on = rows.filter((r) => r.size === size);
    if (!on.length) continue;
    const label = size === "none" ? "unsized cards" : `size:${size}`;
    const models = [...new Set(on.map((r) => r.model))].map((model) => {
      const rs = on.filter((r) => r.model === model);
      const costs = rs.map((r) => r.cost).filter((c): c is number => c != null);
      const lanes = rs.map((r) => r.lane);
      const lane = lanes.sort((a, b) => lanes.filter((l) => l === b).length - lanes.filter((l) => l === a).length)[0];
      return { model, n: rs.length, score: avg(rs.map((r) => r.score)), cost: costs.length ? avg(costs) : null, lane };
    });
    const enough = models.filter((m) => m.n >= MIN_PRS);
    if (enough.length < 2) {
      out.push(
        models.length === 1
          ? `${label}: only ${models[0].model} has built these (${models[0].n} PR${models[0].n === 1 ? "" : "s"}, average ${Math.round(models[0].score)}), so there's nothing to compare yet.`
          : `${label}: not enough PRs to compare ${models.map((m) => `${m.model} (${m.n})`).join(" and ")} yet; each needs ${MIN_PRS}.`,
      );
      continue;
    }
    const best = [...enough].sort((a, b) => b.score - a.score)[0];
    const priced = enough.filter((m) => m.cost != null);
    const cheap = priced.length >= 2 ? [...priced].sort((a, b) => a.cost! - b.cost!)[0] : undefined;
    const pts = (m: { score: number; n: number }) => `${Math.round(m.score)} over ${m.n} PRs`;
    if (cheap && cheap !== best && best.score - cheap.score <= MATCH) {
      const share = best.cost ? Math.round((cheap.cost! / best.cost) * 100) : null;
      out.push(`${label}: ${cheap.model} matches ${best.model} (${pts(cheap)} vs ${pts(best)})${share != null ? ` at ${share}% of the cost` : ""}, so consider moving ${label} cards to the ${cheap.lane} lane.`);
    } else {
      const next = [...enough].sort((a, b) => b.score - a.score)[1];
      out.push(
        best.score - next.score >= CLEAR
          ? `${label}: ${best.model} does clearly better than ${next.model} (${pts(best)} vs ${pts(next)}), so keep ${label} cards on the ${best.lane} lane.`
          : `${label}: ${best.model} and ${next.model} are close (${pts(best)} vs ${pts(next)}); no change suggested yet.`,
      );
    }
  }
  return out;
}

// ---- Gathering the facts (GitHub and the runs table) ----

interface ApiCommit {
  sha: string;
  commit: { message: string };
  parents: { sha: string }[];
}

/** New merged PRs scored per pass, so a first backfill doesn't use up the app's API budget at once. */
const PER_PASS = 5;
/** How often a pass lists every closed PR (for the backfill); between, it reads the newest 100. */
const FULL_LIST_MS = 3600_000;
const lastFull = new Map<string, number>();

/** The facts for one merged PR. */
export async function prFacts(ctx: Ctx, p: ApiPull & { created_at: string }, lanes: Lane[]): Promise<PrFacts> {
  const { gh, repo, state } = ctx;
  const card = cardOf(p.head.ref, p.body);
  const owner = repo.split("/")[0];
  const [commits, comments, reviews, issue] = await Promise.all([
    gh.all<ApiCommit>(`/repos/${repo}/pulls/${p.number}/commits`),
    gh.all<{ user: { login: string } | null; body: string | null }>(`/repos/${repo}/issues/${p.number}/comments`),
    gh.all<{ user: { login: string } | null; body: string | null; state: string }>(`/repos/${repo}/pulls/${p.number}/reviews`),
    card ? gh.maybe<{ labels: { name: string }[] }>(`/repos/${repo}/issues/${card}`) : Promise.resolve(undefined),
  ]);
  const said = (c: { user: { login: string } | null; body: string | null }) => ({ author: c.user?.login ?? "", body: c.body ?? "" });
  const reviewerRounds = comments.filter((c) => /Factory reviewer: needs work/.test(c.body ?? "")).length;
  const ownerRounds =
    comments.filter((c) => c.user?.login === owner && !isAgent(said(c)) && (c.body ?? "").trim()).length +
    reviews.filter((r) => r.user?.login === owner && !isAgent(said(r)) && !(r.state === "APPROVED" && !(r.body ?? "").trim())).length;

  const own = commits.filter((c) => c.parents.length < 2 && !trailerModel(c.commit.message));
  let ownerLines = 0;
  for (const c of own) {
    const d = await gh.get<{ stats?: { additions: number; deletions: number } }>(`/repos/${repo}/commits/${c.sha}`);
    ownerLines += (d.stats?.additions ?? 0) + (d.stats?.deletions ?? 0);
  }
  let ciFailures = 0;
  for (const c of commits) if (ciState(await checksOf(ctx, c.sha)).failed.length) ciFailures++;

  const runs = state.prRuns(p.number, card);
  const builders = new Set(lanes.filter((l) => l.kind === "builder").map((l) => l.name));
  const builderRun = runs.find((r) => builders.has(r.lane));
  const size = sizeOf(issue?.labels.map((l) => l.name) ?? []) ?? "none";
  const lane = builderRun?.lane ?? laneForSize(lanes, size);
  const fromCommits = commits.map((c) => trailerModel(c.commit.message)).find((m) => m && m !== "Claude");
  const model = fromCommits ?? modelName(builderRun?.model ?? lanes.find((l) => l.name === lane)?.model ?? "unknown");
  const costs = runs.map((r) => r.cost_usd).filter((c): c is number => c != null);
  return {
    pr: p.number, card, title: p.title, size, lane, model,
    reviewerRounds, ownerRounds, ownerCommits: own.length, ownerLines, ciFailures,
    hours: Math.max(0, (Date.parse(p.merged_at!) - Date.parse(p.created_at)) / 3600_000),
    reverted: null,
    cost: costs.length ? Math.round(costs.reduce((a, b) => a + b, 0) * 100) / 100 : null,
    merged: p.merged_at!,
  };
}

/** The serve loop's step: score merged factory PRs that have no score yet, and mark reverts. */
export async function checkScores(ctx: Ctx, now = Date.now()): Promise<void> {
  const { gh, state, repo, log } = ctx;
  const full = now - (lastFull.get(repo) ?? 0) >= FULL_LIST_MS;
  type Pull = ApiPull & { created_at: string };
  const closed = full
    ? await gh.all<Pull>(`/repos/${repo}/pulls?state=closed&sort=updated&direction=desc`)
    : await gh.get<Pull[]>(`/repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=100`);
  if (full) lastFull.set(repo, now);
  const merged = closed.filter((p) => p.merged_at);

  // Reverts: a merged revert PR, or a revert commit pushed to the default branch (newest first, so the
  // first revert found for a PR is kept).
  const all = merged.map((p) => ({ pr: p.number, title: p.title, sha: p.merge_commit_sha }));
  const commits = await gh.get<ApiCommit[]>(`/repos/${repo}/commits?per_page=100`);
  const revertedBy = new Map<number, string>();
  for (const p of merged) {
    const t = revertTarget(p, repo, all);
    if (t != null && t !== p.number && !revertedBy.has(t)) revertedBy.set(t, `#${p.number}`);
  }
  for (const c of commits) {
    const [title, ...rest] = c.commit.message.split("\n");
    const t = revertTarget({ title, body: rest.join("\n") }, repo, all);
    if (t != null && !revertedBy.has(t)) revertedBy.set(t, c.sha.slice(0, 7));
  }
  const scored = state.scoreFacts();
  for (const f of scored) {
    const by = revertedBy.get(f.pr);
    if (by && !f.reverted) {
      state.saveScoreFacts({ ...f, reverted: by });
      log(`scores: PR #${f.pr} was reverted by ${by}`);
    }
  }

  // A revert PR isn't scored itself: it's the score of the PR it reverts.
  const done = new Set(scored.map((s) => s.pr));
  const todo = merged.filter((p) => isFactory(p) && !done.has(p.number) && revertTarget(p, repo, all) == null).slice(0, PER_PASS);
  if (!todo.length) return;
  const lanes = (await loadConfig(gh, repo)).lanes;
  for (const p of todo) {
    try {
      const f = { ...(await prFacts(ctx, p, lanes)), reverted: revertedBy.get(p.number) ?? null };
      state.saveScoreFacts(f);
      log(`scores: PR #${p.number} scored ${score(f).score}`);
    } catch (e) {
      log(`scores: couldn't score PR #${p.number} (${(e as Error).message}); trying again next poll`);
    }
  }
}

/** The Data view's scores: every scored PR (newest merge first), the table, the advice and the formula. */
export function prScores(facts: (PrFacts & { repo: string })[]): { rows: (Scored & { repo: string })[]; groups: Group[]; advice: string[]; formula: string[] } {
  const rows = facts.map((f) => ({ ...score(f), repo: f.repo })).sort((a, b) => b.merged.localeCompare(a.merged));
  return { rows, groups: groups(rows), advice: recommend(rows), formula: formula() };
}
