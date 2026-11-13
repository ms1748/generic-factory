// Fires lanes on their schedules, as many at once as Parallel runs allows (slots.ts). A lane is dry until the owner switches it on
// (`lane <name> on`): a dry lane only records what it would have done.
import { lastSlot, type Lane } from "./config.ts";
import type { GitHub } from "./github.ts";
import { limitsFrom, type Limits } from "./limits.ts";
import { loadConfig, snapshot } from "./project.ts";
import { lanePrompt } from "./prompt.ts";
import { buildQueue, byPriority, pickFor, type Card, type Pick } from "./queue.ts";
import { runAgent } from "./runner.ts";
import { Slots, type Ticket } from "./slots.ts";
import type { State } from "./state.ts";

export interface Ctx {
  gh: GitHub;
  state: State;
  repo: string;
  log: (line: string) => void;
  /** The serve loop's run slots. Without them (the CLI) a run is awaited, and checks the same limit against
   *  the runs recorded as going. */
  slots?: Slots;
  /** Every repo the factory works on, the primary first (this one among them). */
  all?: Ctx[];
}

/** A short name for a repo in logs: "site" for owner/site, or nothing for the primary. */
export const tag = (ctx: Ctx): string => (ctx.repo === (ctx.all?.[0]?.repo ?? ctx.repo) ? "" : ` [${ctx.repo.split("/")[1]}]`);

/** Whether nothing more may start now: no free slot (or, without slots, a run is going). */
export const full = (ctx: Ctx): boolean => (ctx.slots ? !ctx.slots.free() : Boolean(ctx.state.running()));

/** The owner's chosen card, if it can be built now (queued, not blocked, no open PR). */
function pickCard(lane: Lane, queue: Card[], n: number): Pick {
  const card = queue.find((c) => c.number === n);
  if (!card) return { idle: `#${n} isn't labelled ready` };
  if (card.state !== "queued") return { idle: `#${n} can't be built now: ${card.reason}` };
  const action = lane.splits.includes(card.size ?? "none") ? "split" : card.draftPr ? "continue" : "build";
  return { card, action };
}

/**
 * The owner's stop switch: the `factory-stop` label on any open issue or PR (it works from the phone app).
 * While it's on, no live run starts. Returns why, or undefined.
 */
export async function stopSwitch(ctx: Ctx): Promise<string | undefined> {
  const hits = await ctx.gh.get<{ number: number }[]>(`/repos/${ctx.repo}/issues?labels=factory-stop&state=open&per_page=1`);
  return hits[0] ? `the owner put factory-stop on #${hits[0].number}` : undefined;
}

/** Whether a lane runs at all: the owner's switch on the dashboard, else the project's config. */
export const laneOn = (state: State, l: Lane): boolean => state.lane(l.name).on ?? l.enabled;

/** A slot missed by more than this (dispatcher down, a long run before it) is skipped, not caught up. */
const CATCH_UP_MS = 2 * 60 * 60_000;

/** One scheduler step for one repo: start its due lanes (its own .factory.yml), as many as there are free slots. */
export async function tick(ctx: Ctx): Promise<void> {
  const { state, log, slots } = ctx;
  if (state.pause() || full(ctx)) return;
  const config = await loadConfig(ctx.gh, ctx.repo);
  process.env.TZ = config.timezone;
  const now = new Date();
  for (const lane of config.lanes.filter((l) => laneOn(state, l))) {
    const slot = lastSlot(lane.schedule, now);
    if (!slot) continue;
    const prev = state.lane(lane.name).lastSlot;
    const iso = slot.toISOString();
    if (prev && iso <= prev) continue;
    state.setSlot(lane.name, iso);
    if (!prev) continue; // first sight of this lane: start from the next slot, don't fire on deploy
    if (now.getTime() - slot.getTime() > CATCH_UP_MS) {
      log(`${lane.name}${tag(ctx)}: missed the ${slot.toLocaleString()} run; waiting for the next one`);
      continue;
    }
    if (!slots) return void (await runLane(ctx, lane));
    slots.spawn(`${lane.name}${tag(ctx)} run`, lane.kind === "builder" ? "build" : "lane", log, (t) => runLane(ctx, lane, {}, t));
    if (!slots.free()) return;
  }
}

/** Runs a lane now: live if the owner switched it on, otherwise dry. */
export interface RunOptions {
  /** Build this card instead of the queue's next one (the dashboard's "Build now"). */
  card?: number;
  /** Run live even if the lane is dry: the owner asked for this one run. */
  live?: boolean;
}

/** Runs `ctx`'s repo's lane on that repo (a builder takes that repo's cards). `ticket`: the serve loop's slot for
 *  this run; the CLI runs without one. */
export async function runLane(ctx: Ctx, lane: Lane, opts: RunOptions = {}, ticket?: Ticket): Promise<void> {
  const { gh, log, state } = ctx;
  const s = await snapshot(gh, ctx.repo);
  process.env.TZ = s.config.timezone;
  // No await from here to the claim: another run starting now must not pick the same card.
  // The serve loop passes its slots; a `run` command checks the same limit against the runs recorded as going.
  const slots = ctx.slots ?? new Slots(state);
  const held = slots.cards(ticket, ctx.repo);
  const queue = buildQueue(s.ready, s.pulls, s.openIssues)
    .filter((card) => card.number === opts.card || !held.has(card.number))
    .map((card): Card => ({ ...card, repo: ctx.repo }))
    .sort(byPriority);
  // Other builds in flight may be about to open PRs of their own (counted in any repo, to be safe).
  const building = Math.max(0, slots.building() - (ticket?.kind === "build" ? 1 : 0));
  const openFactoryPrs = s.pulls.filter((p) => p.labels.includes("factory")).length + building;
  const pick = lane.kind !== "builder" ? undefined : opts.card ? pickCard(lane, queue, opts.card) : pickFor(lane, queue, openFactoryPrs, s.config.maxOpenPrs);
  ticket?.claim(pick?.card?.number, null, ctx.repo);
  const name = `${lane.name}${tag(ctx)}`;
  const live = opts.live ?? state.lane(lane.name).live;
  const base = { lane: lane.name, model: lane.model, mode: live ? "live" : "dry", card: pick?.card?.number ?? null, action: pick?.action ?? null } as const;

  if (pick && !pick.card) {
    const id = state.startRun({ ...base, status: "idle" });
    state.updateRun(id, { summary: `nothing to do: ${pick.idle}` }, true);
    log(`${name}: nothing to do (${pick.idle})`);
    return;
  }
  const doing = pick?.card ? `${pick.action} #${pick.card.number} ${pick.card.title}` : `run ${lane.prompt}`;
  if (!live) {
    const id = state.startRun({ ...base, status: "dry" });
    state.updateRun(id, { summary: `would ${doing}` }, true);
    log(`${name} (dry): would ${doing}`);
    return;
  }
  if (!ticket && !slots.free()) {
    const going = state.runningRuns().map((r) => `${r.id} (${r.lane})`).join(", ");
    return log(`${name}: ${slots.count()} of ${slots.limit()} runs are going (${going}); not starting another`);
  }
  const paused = state.pause();
  if (paused) return log(`${name}: paused until ${paused.until} (${paused.reason})`);
  const tight = budgetBlock(state) ?? (await stopSwitch(ctx)) ?? (ctx.all?.[0] && ctx.all[0] !== ctx ? await stopSwitch(ctx.all[0]) : undefined);
  if (tight) {
    const id = state.startRun({ ...base, status: "idle" });
    state.updateRun(id, { summary: `skipped: ${tight}` }, true);
    return log(`${name}: skipped, ${tight}`);
  }

  const id = state.startRun({ ...base, status: "running" });
  const startedAt = new Date().toISOString();
  log(`${name}: run ${id} starts: ${doing}`);
  const res = await runAgent(gh, { runId: id, repo: ctx.repo, model: lane.model, prompt: lanePrompt(lane, ctx.repo, pick, false, s.config.promptDir), reports: lane.kind === "maintainer" }, log, (r) => state.saveUsage(r));

  let pr: number | null = null;
  if (pick?.card) {
    const pulls = await gh.all<{ number: number; head: { ref: string } }>(`/repos/${ctx.repo}/pulls?state=open`);
    const made = pulls.find((p) => p.head.ref.startsWith(`claude/issue-${pick.card!.number}-`));
    pr = made?.number ?? null;
    // Owner comments from the run's start on count as new, unless the agent already answered them.
    if (made && res.sessionId) {
      state.saveSession({ pr: made.number, card: pick.card.number, sessionId: res.sessionId, lane: lane.name, runId: id, branch: made.head.ref, handledAt: startedAt });
    }
  }
  if (res.limited) pauseForLimit(ctx, res.text, res.rateLimit?.resetsAt);
  const status = res.ok ? "done" : res.limited ? "limited" : "failed";
  state.updateRun(id, { status, session_id: res.sessionId ?? null, pr, cost_usd: res.costUsd ?? null, summary: res.text.slice(0, 4000) }, true);
  log(`${name}: run ${id} ${status}${pr ? `, PR #${pr}` : ""}${res.costUsd ? `, $${res.costUsd.toFixed(2)} API-equivalent` : ""}`);
}

/**
 * Why a live run shouldn't start now, if the plan is nearly used up. Leaves headroom for the owner's own
 * Claude use: by default no new run above 80% of the 5-hour window or 90% of the week (Settings › Limits).
 */
export function budgetBlock(state: State, now = Date.now()): string | undefined {
  const u = state.usage(now);
  const { fiveHour: max5, sevenDay: max7 } = limits(state);
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  if (u?.fiveHour && u.fiveHour.utilization >= max5) return `5-hour window at ${pct(u.fiveHour.utilization)} (limit ${pct(max5)})`;
  if (u?.sevenDay && u.sevenDay.utilization >= max7) return `weekly usage at ${pct(u.sevenDay.utilization)} (limit ${pct(max7)})`;
  if (u?.status === "rejected" && !state.allowCredits()) return "the plan's usage window is used up and paid credits are off";
  return undefined;
}

/** Settings › Limits in force: saved on the dashboard, else the env, else the defaults. */
export function limits(state: State): Limits {
  return limitsFrom(state.limitSettings(), process.env);
}

const usageEveryMs = (state: State) => limits(state).usageRefreshMin * 60_000;

/** True when it is time to look at the usage meters again (refreshUsage decides whether a call is needed). */
export function usageStale(state: State, lastCheck: number): boolean {
  const every = usageEveryMs(state);
  return every > 0 && Date.now() - lastCheck >= every;
}

/**
 * Refreshes the plan's usage meters with the smallest possible Claude call (Haiku, no repo clone), since
 * Claude Code only reports usage during a run. Skipped while something runs, paused, or if a run
 * reported usage recently.
 */
export async function refreshUsage(ctx: Ctx): Promise<void> {
  const { state } = ctx;
  if ((ctx.slots ? ctx.slots.count() > 0 : state.running()) || state.pause()) return;
  const u = state.usage();
  if (u && Date.now() - Date.parse(u.at) < usageEveryMs(state)) return;
  const res = await runAgent(ctx.gh, { runId: 0, repo: ctx.repo, model: "haiku", prompt: "Reply with: ok", bare: true }, () => {}, (r) => state.saveUsage(r));
  if (res.limited) pauseForLimit(ctx, res.text, res.rateLimit?.resetsAt);
}

export function pauseForLimit(ctx: Ctx, text: string, resetsAt?: string): void {
  const until = (resetsAt && Date.parse(resetsAt) > Date.now() ? new Date(resetsAt) : undefined) ?? resetTime(text) ?? new Date(Date.now() + 5 * 60 * 60_000);
  ctx.state.setPause(until, "Claude usage limit");
  ctx.log(`usage limit reached: everything pauses until ${until.toLocaleString()}`);
}

/** "resets 3pm" / "resets at 3:30 PM" in a usage-limit message, as the next such time. */
export function resetTime(text: string, now = new Date()): Date | undefined {
  const m = text.match(/resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*([ap]m)/i);
  if (!m) return undefined;
  const t = new Date(now);
  t.setHours((Number(m[1]) % 12) + (m[3].toLowerCase() === "pm" ? 12 : 0), Number(m[2] ?? 0), 0, 0);
  if (t <= now) t.setDate(t.getDate() + 1);
  return t;
}
