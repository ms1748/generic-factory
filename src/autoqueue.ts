// Auto-queue (Settings › Auto-queue ideas, off by default): when a served project's buildable `ready` queue
// drops below the threshold, one short Sonnet run picks which open `idea` issues the builders may take, and the
// dispatcher adds `ready` and one comment on each. At most once per project every few hours, and never while
// the factory is paused, stopped (factory-stop) or over the plan's usage stops. The agent only reads.
//
// It also keeps, per project, since when nothing has been ready to build: alerts.ts turns that into the
// "nothing ready to build" alert (with auto-queue on, only once auto-queue found nothing to add).
import type { QueueFact } from "./alerts.ts";
import type { DepIssue } from "./deps.ts";
import type { Ctx } from "./dispatch.ts";
import { budgetBlock, full, limits, pauseForLimit, stopSwitch } from "./dispatch.ts";
import { snapshot } from "./project.ts";
import { autoQueuePrompt, type IdeaBrief } from "./prompt.ts";
import { buildQueue } from "./queue.ts";
import { runAgent } from "./runner.ts";

export const MODEL = "sonnet";
/** The lane name auto-queue's runs are recorded under (it isn't a lane: Settings switches it). */
export const RUN_LANE = "auto-queue";
/** Ideas with these labels are never queued automatically. */
export const SKIP_LABELS = ["hold", "needs-owner", "p3", "ready", "building", "review", "factory-stop", "size:XL"];
const MARKER = "<!-- factory-autoqueue -->";
/** The note on an attempt whose run is still going. */
const RUNNING = "running";

export interface AutoQueueSettings {
  on: boolean;
  /** Refill when fewer buildable `ready` cards than this are left. */
  threshold: number;
  /** At most this many ideas per attempt. */
  max: number;
}

export const DEFAULTS: AutoQueueSettings = { on: false, threshold: 3, max: 5 };

const clamp = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d);

/** Saved settings over the defaults, in range. */
export function settingsFrom(raw: unknown): AutoQueueSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return { on: typeof r.on === "boolean" ? r.on : DEFAULTS.on, threshold: clamp(r.threshold, 1, 20, DEFAULTS.threshold), max: clamp(r.max, 1, 10, DEFAULTS.max) };
}

/** One project's bookkeeping, kept in state. */
export interface AutoQueueRecord {
  /** Since when it has had no buildable `ready` card, or null. */
  emptySince: string | null;
  /** The last attempt: when, what it queued, and in a few words what happened. */
  last?: { at: string; added: number[]; note: string };
}

export function recordFrom(raw: unknown): AutoQueueRecord {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<AutoQueueRecord>;
  return { emptySince: typeof r.emptySince === "string" ? r.emptySince : null, last: r.last && typeof r.last.at === "string" ? r.last : undefined };
}

/** The new "empty since": kept while still empty, set now when it just went empty, cleared once a card is ready. */
export function emptySince(prev: string | null, queued: number, now: Date): string | null {
  return queued > 0 ? null : (prev ?? now.toISOString());
}

/** Whether to try a refill now: on, below the threshold, and the last attempt long enough ago. */
export function refillDue(s: AutoQueueSettings, queued: number, lastAt: string | undefined, now: number, every: number): boolean {
  return s.on && queued < s.threshold && (!lastAt || now - Date.parse(lastAt) >= every);
}

/** A "someday" item: a someday label, a title that starts with it, or a body line that does. */
export function isSomeday(i: { title: string; labels: string[]; body: string }): boolean {
  return i.labels.some((l) => /someday/i.test(l)) || /^\W*someday\b/i.test(i.title) || /^[#>*_\s-]*someday\b/im.test(i.body);
}

/** The open ideas auto-queue may consider: `idea`, open, none of SKIP_LABELS, not someday. */
export function eligibleIdeas(issues: DepIssue[]): DepIssue[] {
  return issues.filter((i) => !i.closed && i.labels.includes("idea") && !i.labels.some((l) => SKIP_LABELS.includes(l)) && !isSomeday(i));
}

/** The start of a body, for the prompt: no HTML comments, whitespace squeezed, at most `n` characters. */
export function excerpt(body: string, n = 500): string {
  const plain = body.replace(/<!--[\s\S]*?-->/g, "").replace(/\s+/g, " ").trim();
  return plain.length > n ? `${plain.slice(0, n - 3).replace(/\s+\S*$/, "")}...` : plain;
}

export interface Selection {
  number: number;
  reason: string;
}

/**
 * The agent's picks from its final message: the last ```json block (or the last {...} if there's no block),
 * `{"queue": [{"number", "reason"}]}`. Only eligible issues, each once, at most `max`, reasons one short line.
 */
export function parseSelection(text: string, eligible: Set<number>, max: number): Selection[] | undefined {
  const block = [...text.matchAll(/```json\s*([\s\S]*?)```/g)].at(-1)?.[1] ?? text.slice(text.lastIndexOf("{\"queue\""));
  let j: unknown;
  try {
    j = JSON.parse(block.trim());
  } catch {
    return undefined;
  }
  const list = Array.isArray(j) ? j : (j as { queue?: unknown })?.queue;
  if (!Array.isArray(list)) return undefined;
  const out: Selection[] = [];
  for (const x of list) {
    const number = Number((x as { number?: unknown })?.number ?? x);
    if (!Number.isInteger(number) || !eligible.has(number) || out.some((o) => o.number === number)) continue;
    const raw = String((x as { reason?: unknown })?.reason ?? "").replace(/\s+/g, " ").trim();
    const reason = raw.length > 160 ? `${raw.slice(0, 157).replace(/\s+\S*$/, "")}...` : raw;
    out.push({ number, reason: reason || "picked from the ideas" });
    if (out.length >= max) break;
  }
  return out;
}

/** The one comment on each queued issue. */
export const queueComment = (reason: string): string => `🤖 Queued by auto-queue: ${reason}\n${MARKER}`;

/** What the "nothing ready to build" alert reads for one project. */
export function queueFact(repo: string, r: AutoQueueRecord, on: boolean): QueueFact {
  // Its last finished attempt added nothing. One that did add cards (since built) waits for the next attempt.
  const tried = Boolean(r.last && r.last.note !== RUNNING);
  return { repo, emptySince: r.emptySince, autoQueue: on, autoQueueFoundNothing: tried && r.last!.added.length === 0 };
}

/** The alert facts for every served project (the serve loop hands this to Systems). */
export function queueFacts(ctxs: Ctx[]): QueueFact[] {
  const on = settingsFrom(ctxs[0]?.state.autoQueueSettings()).on;
  return ctxs.filter((c) => seen.has(c.repo)).map((c) => queueFact(c.repo, recordFrom(c.state.autoQueueState()), on));
}

/** Projects the serve loop has looked at since it started (only those can alert), and those being refilled now. */
const seen = new Set<string>();
const going = new Set<string>();

/**
 * The serve loop's step for one project: notes whether anything is ready to build, and refills the queue
 * from its ideas when auto-queue is on and it's due.
 */
export async function checkAutoQueue(ctx: Ctx, now = new Date()): Promise<void> {
  const { gh, state, log, repo } = ctx;
  const s = await snapshot(gh, repo);
  const queue = buildQueue(s.ready, s.pulls, s.openIssues);
  const queued = queue.filter((c) => c.state === "queued").length;
  const rec = recordFrom(state.autoQueueState());
  rec.emptySince = emptySince(rec.emptySince, queued, now);
  state.setAutoQueueState(rec);
  seen.add(repo);

  const settings = settingsFrom(state.autoQueueSettings());
  // At most one attempt per project every few hours (Settings › Limits, 3 by default).
  const every = limits(state).autoQueueEveryH * 3600_000;
  if (!refillDue(settings, queued, rec.last?.at, now.getTime(), every) || going.has(repo)) return;
  // The same stops as any new run: paused, over the plan's usage stops, factory-stop, no free slot.
  const why = state.pause() ? "the factory is paused" : (budgetBlock(state) ?? (await stopSwitch(ctx)) ?? (full(ctx) ? "no free run slot" : undefined));
  if (why) return log(`auto-queue${tag(ctx)}: ${queued} ready, waits: ${why}`);

  const record = (added: number[], note: string) => {
    const r = recordFrom(state.autoQueueState());
    r.last = { at: now.toISOString(), added, note };
    state.setAutoQueueState(r);
  };
  const ideas = eligibleIdeas(s.issues);
  if (!ideas.length) {
    record([], "no open ideas it could queue");
    return log(`auto-queue${tag(ctx)}: ${queued} ready and no open ideas it could queue`);
  }
  const queuedTitles = queue.map((c) => `#${c.number} ${c.title}`);
  const closedTitles = s.issues.filter((i) => i.closed).slice(0, 60).map((i) => `#${i.number} ${i.title}`);
  const briefs: IdeaBrief[] = ideas.map((i) => ({ number: i.number, title: i.title, labels: i.labels, excerpt: excerpt(i.body) }));
  const work = async () => {
    try {
      await refill(ctx, briefs, settings.max, queuedTitles, closedTitles, record);
    } finally {
      going.delete(repo);
    }
  };
  going.add(repo);
  record([], RUNNING); // counts as the attempt, so a restart or the next poll doesn't start another
  if (!ctx.slots) return void (await work());
  if (!ctx.slots.spawn(`auto-queue ${repo.split("/")[1]}`, "lane", log, work)) going.delete(repo);
}

const tag = (ctx: Ctx) => (ctx.all && ctx.all[0]?.repo !== ctx.repo ? ` [${ctx.repo.split("/")[1]}]` : "");

/** The agent run, then `ready` and a comment on each pick that's still an open idea without `ready`. */
async function refill(ctx: Ctx, ideas: IdeaBrief[], max: number, queued: string[], closed: string[], record: (added: number[], note: string) => void): Promise<void> {
  const { gh, state, log, repo } = ctx;
  const id = state.startRun({ lane: RUN_LANE, model: MODEL, mode: "live", card: null, action: "auto-queue", status: "running" });
  log(`auto-queue${tag(ctx)}: run ${id} picks from ${ideas.length} idea(s)`);
  const res = await runAgent(gh, { runId: id, repo, model: MODEL, prompt: autoQueuePrompt(repo, ideas, max, queued, closed) }, log, (r) => state.saveUsage(r));
  if (res.limited) pauseForLimit(ctx, res.text, res.rateLimit?.resetsAt);
  const picks = res.ok ? parseSelection(res.text, new Set(ideas.map((i) => i.number)), max) : undefined;
  if (!picks) {
    state.updateRun(id, { status: res.limited ? "limited" : "failed", session_id: res.sessionId ?? null, cost_usd: res.costUsd ?? null, summary: `no selection: ${res.text}`.slice(0, 4000) }, true);
    record([], "the run gave no selection");
    return log(`auto-queue${tag(ctx)}: run ${id} gave no selection`);
  }
  const added: number[] = [];
  for (const p of picks) {
    try {
      const issue = await gh.get<{ state: string; labels: { name: string }[] }>(`/repos/${repo}/issues/${p.number}`);
      const labels = issue.labels.map((l) => l.name);
      if (issue.state !== "open" || !labels.includes("idea") || labels.some((l) => SKIP_LABELS.includes(l))) continue; // changed since
      await gh.send("POST", `/repos/${repo}/issues/${p.number}/labels`, { labels: ["ready"] });
      await gh.send("POST", `/repos/${repo}/issues/${p.number}/comments`, { body: queueComment(p.reason) });
      added.push(p.number);
      log(`auto-queue${tag(ctx)}: queued #${p.number} (${p.reason})`);
    } catch (e) {
      log(`auto-queue${tag(ctx)}: couldn't queue #${p.number} (${(e as Error).message})`);
    }
  }
  const summary = added.length
    ? `Queued ${added.map((n) => "#" + n).join(", ")}:\n${picks.filter((p) => added.includes(p.number)).map((p) => `- #${p.number}: ${p.reason}`).join("\n")}`
    : "Found nothing to add";
  state.updateRun(id, { status: "done", session_id: res.sessionId ?? null, cost_usd: res.costUsd ?? null, summary }, true);
  record(added, added.length ? `queued ${added.length}` : "found nothing to add");
  log(`auto-queue${tag(ctx)}: run ${id} ${added.length ? `queued ${added.map((n) => "#" + n).join(" ")}` : "found nothing to add"}`);
}
