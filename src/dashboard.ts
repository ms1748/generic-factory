// The dashboard's API: one state document for the page, a condensed live transcript, and the controls.
// Controls change the dispatcher's own state or the project's labels; runs are queued for the serve
// loop, which still runs one thing at a time.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { activity, type Activity } from "./activity.ts";
import { nextRun, upcoming, type Lane } from "./config.ts";
import type { Ctx } from "./dispatch.ts";
import { budgetBlock, laneOn, limits } from "./dispatch.ts";
import { mergeLimits } from "./limits.ts";
import { dependencies } from "./deps.ts";
import { DONE_DAYS } from "./done.ts";
import { prScores } from "./scores.ts";
import { recordFrom, settingsFrom as autoQueueFrom } from "./autoqueue.ts";
import { devicesView, freshDevices } from "./devices.ts";
import { ANSWERS, answer, readVars, saveVars, stop as stopGame, type Answer } from "./gaming.ts";
import { install, needsSetup, saveInstall } from "./install.ts";
import type { DoneRecord } from "./state.ts";
import { OWNER_REPLY, ownerReplyBody } from "./feedback.ts";
import { snapshot, type Snapshot } from "./project.ts";
import { buildQueue, byPriority, hasMarker, issueOfPull, pickFor, priorityOf, sizeOf } from "./queue.ts";
import { env } from "./runner.ts";
import { MAX_PARALLEL } from "./slots.ts";
import { MAX_ROUNDS, reviewerGuide } from "./review.ts";
import { lastCleanup, MAX_DELETE_HOURS, MIN_DELETE_HOURS, parseTestBuilds, versionsForPage, type TestBuilds } from "./testbuilds.ts";

const SNAPSHOT_MS = 60_000;

/** A run asked for from the dashboard, waiting for the serve loop. */
export interface QueuedRun {
  lane: string;
  card?: number;
  /** The repo whose lane runs (and whose card it builds); the primary if left out. */
  repo?: string;
  live?: boolean;
}

/** Puts `repo` on every item of a board column or list. */
const tagged = <T extends object>(list: T[], repo: string): (T & { repo: string })[] => list.map((x) => ({ ...x, repo }));

export class Dashboard {
  private ctx: Ctx;
  private requestRun: () => void;
  private cached: Snapshot | undefined;
  private loading: Promise<Snapshot> | undefined;
  private others = new Map<string, { at: number; s: Snapshot }>();
  queued: QueuedRun[] = [];

  /** The Devices view: each test machine's job now, its queue and its last results (devices.ts). */
  devices() {
    return devicesView(this.ctx);
  }

  /** Settings › Game tests: the game-test workflow's repository variables (gaming.ts). */
  gaming() {
    return readVars(this.ctx);
  }

  constructor(ctx: Ctx, requestRun: () => void) {
    this.ctx = ctx;
    this.requestRun = requestRun;
    ctx.state.seedOnce("links-v1", () => {
      for (const [grp, title, url] of DEFAULT_LINKS(ctx.repo)) ctx.state.addLink(grp, title, url);
    });
  }

  /** The GitHub side, at most a minute old (fresh after any control). */
  private async snap(fresh = false): Promise<Snapshot> {
    if (!fresh && this.cached && Date.now() - this.cached.takenAt.getTime() < SNAPSHOT_MS) return this.cached;
    this.loading ??= snapshot(this.ctx.gh, this.ctx.repo, this.ctx.state.ownerReplies()).finally(() => (this.loading = undefined));
    this.cached = await this.loading;
    return this.cached;
  }

  /** The other repos' snapshots (cached a minute; a repo that can't be read is left out until it can). */
  private async otherSnaps(fresh = false): Promise<{ ctx: Ctx; s: Snapshot }[]> {
    const others = (this.ctx.all ?? []).filter((c) => c.repo !== this.ctx.repo);
    const out = await Promise.all(
      others.map(async (c) => {
        const hit = this.others.get(c.repo);
        if (hit && !fresh && Date.now() - hit.at < SNAPSHOT_MS) return { ctx: c, s: hit.s };
        try {
          const snap = await snapshot(c.gh, c.repo, this.ctx.state.ownerReplies());
          this.others.set(c.repo, { at: Date.now(), s: snap });
          return { ctx: c, s: snap };
        } catch {
          return hit ? { ctx: c, s: hit.s } : undefined;
        }
      }),
    );
    return out.filter((x): x is { ctx: Ctx; s: Snapshot } => Boolean(x));
  }

  /** The context for a repo named by the page (the primary if none). */
  private ctxFor(repo: unknown): Ctx {
    if (repo == null || repo === "" || repo === this.ctx.repo) return this.ctx;
    const c = (this.ctx.all ?? []).find((x) => x.repo === repo);
    if (!c) throw new HttpError(400, `${String(repo)} isn't one of the factory's repos`);
    return c;
  }

  async state(): Promise<unknown> {
    const { state, repo } = this.ctx;
    const s = await this.snap();
    const extra = await this.otherSnaps();
    process.env.TZ = s.config.timezone;
    const now = new Date();
    const pullOf = (sn: Snapshot) => (n: number) => sn.pulls.find((p) => p.branch.startsWith(`claude/issue-${n}-`) || new RegExp(`\\b(close[sd]?|fix(e[sd])?|resolve[sd]?)\\s+#${n}\\b`, "i").test(p.body));
    const ownQueue = buildQueue(s.ready, s.pulls, s.openIssues);
    // One queue over every repo, in build order, each card knowing its repo (the builders' own order).
    const queue = [
      ...tagged(ownQueue, repo).map((c) => ({ ...c, pr: pullOf(s)(c.number)?.number ?? null })),
      ...extra.flatMap(({ ctx: c, s: sn }) => tagged(buildQueue(sn.ready, sn.pulls, sn.openIssues), c.repo).map((x) => ({ ...x, pr: pullOf(sn)(x.number)?.number ?? null }))),
    ].sort(byPriority);
    const openFactoryPrs = [s, ...extra.map((x) => x.s)].reduce((n, sn) => n + sn.pulls.filter((p) => p.labels.includes("factory")).length, 0);
    const running = state.running();
    const runningAll = state.runningRuns();
    const day = new Date(now.getTime() - 24 * 3600_000).toISOString();
    const week = new Date(now.getTime() - 7 * 24 * 3600_000).toISOString();
    const verdicts = state.verdicts();
    const recent = [...state.recentRuns(400)].reverse();
    const lastRunOf = (scope: string) => {
      const m = new Map<number, number>();
      for (const r of recent) if (r.card && r.mode === "live" && (r.repo ?? "") === scope) m.set(r.card, r.id);
      return m;
    };
    const lastRun = lastRunOf("");
    const builds = await this.testBuilds(s);
    const runningCards = (scope: string) => runningAll.flatMap((r) => (r.card && (r.repo ?? "") === scope ? [r.card] : []));
    const startingCards = (r: string) => this.queued.filter((q) => q.card && (q.repo ?? repo) === r).map((q) => q.card!);
    const doneSince = new Date(now.getTime() - DONE_DAYS * 24 * 3600_000).toISOString();
    // Each repo's board, merged column by column; the other repos have no test builds.
    const boards = [
      { repo, b: board(s, ownQueue, runningCards(""), startingCards(repo), lastRun, verdicts, builds, now.getTime(), state.dones(doneSince)) },
      ...extra.map(({ ctx: c, s: sn }) => ({
        repo: c.repo,
        b: board(sn, buildQueue(sn.ready, sn.pulls, sn.openIssues), runningCards(c.state.scope), startingCards(c.repo), lastRunOf(c.state.scope), c.state.verdicts(), new Map(), now.getTime(), c.state.dones(doneSince)),
      })),
    ];
    const merged = Object.fromEntries(
      Object.keys(boards[0].b).map((k) => [k, boards.flatMap(({ repo: r, b }) => tagged((b as Record<string, object[]>)[k], r))]),
    ) as unknown as ReturnType<typeof board>;
    merged.next.sort((a, b) => byPriority(a as never, b as never));
    // Each repo's lanes and the next two days of their runs, with schedules in that repo's time zone. A builder
    // takes its own repo's cards, up to that repo's open-PR limit.
    const repoLanes = [{ c: this.ctx, sn: s }, ...extra.map((x) => ({ c: x.ctx, sn: x.s }))].map(({ c, sn }) => {
      process.env.TZ = sn.config.timezone;
      const own = queue.filter((card) => card.repo === c.repo);
      const prs = sn.pulls.filter((p) => p.labels.includes("factory")).length;
      const on = (l: Lane) => laneOn(c.state, l);
      const lanes = sn.config.lanes.map((l: Lane) => ({
        repo: c.repo,
        name: l.name,
        kind: l.kind,
        model: l.model,
        enabled: on(l),
        live: c.state.lane(l.name).live,
        schedule: l.schedule,
        nextRun: on(l) ? (nextRun(l.schedule, now)?.toISOString() ?? null) : null,
        pick: l.kind === "builder" ? pickFor(l, own, prs, sn.config.maxOpenPrs) : null,
        about: aboutLane(l),
        quality: this.quality(l.name, c.state.scope),
        prompt: l.prompt,
        timezone: sn.config.timezone,
        configSource: sn.config.source,
      }));
      const upcomingRuns = sn.config.lanes
        .filter(on)
        .flatMap((l) => upcoming(l.schedule, now, 48).map((t) => ({ repo: c.repo, lane: l.name, kind: l.kind, live: c.state.lane(l.name).live, at: t.toISOString() })));
      return { lanes, upcoming: upcomingRuns };
    });
    process.env.TZ = s.config.timezone;

    return {
      repo,
      repos: [repo, ...extra.map((x) => x.ctx.repo)],
      timezone: s.config.timezone,
      configSource: s.config.source,
      takenAt: s.takenAt.toISOString(),
      now: now.toISOString(),
      pause: state.pause() ?? null,
      stop: stopped(s),
      budgetBlock: budgetBlock(state) ?? null,
      usage: state.usage() ?? null,
      allowCredits: state.allowCredits(),
      settings: {
        allowCredits: state.allowCredits(),
        autoMerge: state.autoMerge(),
        shots: state.shotsOn(),
        autoQueue: { ...autoQueueFrom(state.autoQueueSettings()), last: [this.ctx, ...extra.map((x) => x.ctx)].map((c) => ({ repo: c.repo, ...recordFrom(c.state.autoQueueState()).last })).filter((l) => l.at) },
        testBuildDeleteHours: state.testBuildDeleteHours(),
        // The project's test-builds marker and cleanup workflow (.factory.yml `test_builds:`).
        testBuilds: s.config.testBuilds,
        parallelRuns: Math.min(MAX_PARALLEL, state.parallelRuns()),
        maxParallelRuns: MAX_PARALLEL,
        // Settings › Install (src/install.ts), and whether an old database still has to fill it in.
        install: install(),
        installNeedsSetup: needsSetup(),
      },
      // Closed PRs whose test builds are still up, from the last hourly check.
      testBuildCleanup: lastCleanup ?? null,
      // Settings › Limits in force (the usage stops are what the meters mark).
      limits: limits(state),
      spend: { day: state.spend(day), week: state.spend(week) },
      openFactoryPrs,
      maxOpenPrs: s.config.maxOpenPrs,
      running: running ? { ...running, log: this.log(running.id, 60) } : null,
      // Every run going now (more than one with Parallel runs above 1), newest first.
      runningAll: runningAll.map(({ id, lane, card, action, pr, started_at, repo: scope }) => ({ id, lane, card, action, pr, started_at, repo: scope || repo })),
      queuedRuns: this.queued,
      // Each repo's lanes from its own .factory.yml, the primary's first.
      lanes: repoLanes.flatMap((r) => r.lanes),
      queue,
      board: merged,
      // What depends on what, per repo: a chain per card and a tree per feature ("Part of #n" / "Blocked by #n").
      deps: dependencies(s.issues ?? [], new Set(s.pulls.map((p) => issueOfPull(p)).filter((n): n is number => n != null))),
      depsByRepo: Object.fromEntries(extra.map(({ ctx: c, s: sn }) => [c.repo, dependencies(sn.issues ?? [], new Set(sn.pulls.map((p) => issueOfPull(p)).filter((n): n is number => n != null)))])),
      waiting: {
        review: [{ c: this.ctx, sn: s }, ...extra.map((x) => ({ c: x.ctx, sn: x.s }))]
          .flatMap(({ c, sn }) => {
            const v = c === this.ctx ? verdicts : c.state.verdicts();
            return sn.pulls.filter((p) => !p.draft).map((p) => ({ number: p.number, repo: c.repo, title: p.title, factory: p.labels.includes("factory"), updatedAt: p.updatedAt ?? null, verdict: v.get(p.number) ?? null }));
          })
          .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "")),
        questions: [{ r: repo, sn: s }, ...extra.map((x) => ({ r: x.ctx.repo, sn: x.s }))].flatMap(({ r, sn }) => sn.open.filter((i) => i.labels.includes("needs-owner")).map(({ number, title }) => ({ number, title, repo: r }))),
        ideas: [{ r: repo, sn: s }, ...extra.map((x) => ({ r: x.ctx.repo, sn: x.s }))].flatMap(({ r, sn }) => sn.open.filter((i) => i.labels.includes("idea") && !i.labels.includes("ready")).map(({ number, title, labels }) => ({ number, title, labels, repo: r }))),
      },
      // The next two days of scheduled runs, in order (the timeline).
      upcoming: repoLanes.flatMap((r) => r.upcoming).sort((a, b) => a.at.localeCompare(b.at)),
      runs: state.recentRuns(60).map((r) => ({ ...r, repo: r.repo || repo })),
      links: state.links(),
      trials: this.trials(),
    };
  }

  private builds = new Map<number, { updatedAt: string; at: number; data: TestBuilds | undefined }>();

  /** Each open PR's test builds, from its Test builds comment (re-read when the PR changes, else every 5 minutes). */
  private async testBuilds(s: Snapshot): Promise<Map<number, TestBuilds>> {
    const out = new Map<number, TestBuilds>();
    await Promise.all(
      s.pulls.map(async (p) => {
        let hit = this.builds.get(p.number);
        if (!hit || hit.updatedAt !== (p.updatedAt ?? "") || Date.now() - hit.at > 300_000) {
          try {
            const comments = await this.ctx.gh.all<{ user: { login: string } | null; body: string | null }>(`/repos/${this.ctx.repo}/issues/${p.number}/comments`);
            hit = { updatedAt: p.updatedAt ?? "", at: Date.now(), data: parseTestBuilds(comments.map((c) => ({ author: c.user?.login ?? "", body: c.body ?? "" })), s.config.testBuilds.marker) };
            this.builds.set(p.number, hit);
          } catch {
            // keep the last good read, if any
          }
        }
        if (hit?.data) out.set(p.number, hit.data);
      }),
    );
    return out;
  }

  private acts = new Map<string, { at: number; data: Activity }>();

  /** The agents' recent actions (24h, 3d or 7d), cached for a minute, with the ones already undone marked. */
  async activity(window = "24h", fresh = false): Promise<unknown> {
    const hours = { "24h": 24, "3d": 72, "7d": 168 }[window];
    if (!hours) throw new HttpError(400, "window is 24h, 3d or 7d");
    const hit = this.acts.get(window);
    let data = hit && !fresh && Date.now() - hit.at < 60_000 ? hit.data : undefined;
    if (!data) {
      data = await activity(this.ctx.gh, this.ctx.repo, new Date(Date.now() - hours * 3600_000));
      this.acts.set(window, { at: Date.now(), data });
    }
    const undone = this.ctx.state.undone();
    // The owner's own answers (sent from the Answer view as the app) aren't agent actions.
    const mine = new Set([...this.ctx.state.ownerReplies()].map((n) => `comment-${n}`));
    const actions = data.actions.filter((a) => !mine.has(a.id));
    return { ...data, actions: actions.map(({ undo, ...a }) => ({ ...a, canUndo: Boolean(undo), undone: undone.has(a.id) })) };
  }

  private issues = new Map<string, { at: number; data: unknown }>();

  /** One issue's description and comments count, for the drawer (cached for a minute). */
  async issue(n: number, repo?: string): Promise<unknown> {
    const c = this.ctxFor(repo);
    const key = `${c.repo}#${n}`;
    const hit = this.issues.get(key);
    if (hit && Date.now() - hit.at < 60_000) return hit.data;
    const base = `/repos/${c.repo}`;
    const i = await this.ctx.gh.get<{ number: number; title: string; body: string | null; comments: number; created_at: string; state: string; user: { login: string } | null; labels: { name: string }[]; pull_request?: unknown }>(
      `${base}/issues/${n}`,
    );
    type Item = { author: string; at: string; body: string; kind: string };
    const comments = await this.ctx.gh.all<{ user: { login: string } | null; created_at: string; body: string | null }>(`${base}/issues/${n}/comments`);
    const thread: Item[] = comments.map((c) => ({ author: c.user?.login ?? "", at: c.created_at, body: c.body ?? "", kind: "comment" }));
    if (i.pull_request) {
      const [reviews, lines] = await Promise.all([
        this.ctx.gh.all<{ user: { login: string } | null; submitted_at: string | null; body: string | null; state: string }>(`${base}/pulls/${n}/reviews`),
        this.ctx.gh.all<{ user: { login: string } | null; created_at: string; body: string | null; path: string; line: number | null }>(`${base}/pulls/${n}/comments`),
      ]);
      for (const r of reviews) if (r.submitted_at && (r.body?.trim() || r.state !== "COMMENTED")) thread.push({ author: r.user?.login ?? "", at: r.submitted_at, body: r.body ?? "", kind: `review: ${r.state.toLowerCase().replace("_", " ")}` });
      for (const c of lines) thread.push({ author: c.user?.login ?? "", at: c.created_at, body: c.body ?? "", kind: `on ${c.path}${c.line ? ":" + c.line : ""}` });
    }
    thread.sort((a, b) => a.at.localeCompare(b.at));
    const data = {
      number: i.number, title: i.title, body: i.body ?? "", state: i.state, created: i.created_at, author: i.user?.login ?? "",
      labels: i.labels.map((l) => l.name), pr: Boolean(i.pull_request),
      comments: thread.map((t) => ({ ...t, bot: (t.author.endsWith("[bot]") || hasMarker(t.body)) && !t.body.includes(OWNER_REPLY) })),
    };
    this.issues.set(key, { at: Date.now(), data });
    return data;
  }

  private toolErrors = new Map<number, { steps: number; errors: number }>();

  /** How a lane's live runs went: outcomes, time, cost, and how often its tool steps failed. */
  quality(lane: string, scope = "") {
    const runs = this.ctx.state.recentRuns(400).filter((r) => r.lane === lane && (r.repo ?? "") === scope && r.mode === "live" && r.status !== "running");
    if (!runs.length) return null;
    let steps = 0;
    let errors = 0;
    for (const r of runs) {
      let t = this.toolErrors.get(r.id);
      if (!t) {
        const log = this.log(r.id, 100000);
        t = { steps: log.filter((e) => e.kind === "tool").length, errors: log.filter((e) => e.kind === "error").length };
        this.toolErrors.set(r.id, t);
      }
      steps += t.steps;
      errors += t.errors;
    }
    const took = runs.filter((r) => r.ended_at).map((r) => (Date.parse(r.ended_at!) - Date.parse(r.started_at)) / 60_000);
    return {
      runs: runs.length,
      done: runs.filter((r) => r.status === "done").length,
      failed: runs.filter((r) => r.status === "failed").length,
      limited: runs.filter((r) => r.status === "limited").length,
      avgMinutes: took.length ? Math.round(took.reduce((a, b) => a + b, 0) / took.length) : null,
      avgCost: runs.reduce((a, r) => a + (r.cost_usd ?? 0), 0) / runs.length,
      stepErrorRate: steps ? errors / steps : 0,
      steps,
    };
  }

  private prompts = new Map<string, { at: number; text: string }>();

  /** A factory prompt file from a repo's main branch (the primary if none; cached five minutes). */
  async prompt(path: string, repo?: string | null): Promise<string> {
    if (path === "factory:reviewer") return reviewerGuide();
    if (!/^docs\/factory\/prompts\/[a-z-]+\.md$/.test(path)) throw new HttpError(404, "not a factory prompt");
    const c = this.ctxFor(repo);
    const key = `${c.repo}:${path}`;
    const hit = this.prompts.get(key);
    if (hit && Date.now() - hit.at < 300_000) return hit.text;
    const f = await this.ctx.gh.maybe<{ content: string }>(`/repos/${c.repo}/contents/${path}`);
    if (!f) throw new HttpError(404, "not found");
    const text = Buffer.from(f.content, "base64").toString("utf8");
    this.prompts.set(key, { at: Date.now(), text });
    return text;
  }

  private history: { at: number; data: unknown } | undefined;

  /** The Data tab: the last 180 days of cards, PRs, runs and plan usage, as events the page buckets. */
  async data(): Promise<unknown> {
    if (this.history && Date.now() - this.history.at < 10 * 60_000) return this.history.data;
    const since = new Date(Date.now() - 180 * 24 * 3600_000).toISOString();
    type Item = { number: number; created_at: string; closed_at: string | null; labels: { name: string }[]; user: { login: string } | null; pull_request?: { merged_at: string | null } };
    const items = await this.ctx.gh.all<Item>(`/repos/${this.ctx.repo}/issues?state=all&since=${since}&sort=created&direction=desc`);
    const types = ["feature", "fix", "chore", "security"];
    const data = {
      issues: items
        .filter((i) => !i.pull_request)
        .map((i) => ({ created: i.created_at, closed: i.closed_at, type: i.labels.map((l) => l.name).find((l) => types.includes(l)) ?? "other", factory: i.labels.some((l) => l.name === "factory") })),
      pulls: items
        .filter((i) => i.pull_request)
        .map((i) => ({ created: i.created_at, merged: i.pull_request!.merged_at, closed: i.closed_at, factory: i.labels.some((l) => l.name === "factory") || (i.user?.login ?? "").endsWith("[bot]") })),
      runs: this.ctx.state.allRuns(since).map((r) => ({
        at: r.started_at, lane: r.lane, mode: r.mode, status: r.status, cost: r.cost_usd ?? 0,
        minutes: r.ended_at ? (Date.parse(r.ended_at) - Date.parse(r.started_at)) / 60_000 : null,
      })),
      usage: this.ctx.state.usageSamples(since),
      scores: prScores(this.ctx.state.allScoreFacts()),
    };
    this.history = { at: Date.now(), data };
    return data;
  }

  /** Quality trial reports (data/trials/*.md), newest first, with their headline. */
  trials(): { name: string; title: string; wins: string }[] {
    const dir = join(env.data, "trials");
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => /^\d+\.md$/.test(f))
      .sort()
      .reverse()
      .map((f) => {
        const text = readFileSync(join(dir, f), "utf8");
        return { name: f.replace(/\.md$/, ""), title: text.split("\n")[0].replace(/^#\s*/, ""), wins: text.match(/^Wins: .*$/m)?.[0] ?? "" };
      });
  }

  trial(name: string): string {
    if (!/^\d+$/.test(name)) throw new HttpError(404, "no such report");
    const file = join(env.data, "trials", `${name}.md`);
    if (!existsSync(file)) throw new HttpError(404, "no such report");
    return readFileSync(file, "utf8");
  }

  /** A run's transcript, condensed to what a person reads: Claude's words, tool calls, results, errors. */
  log(runId: number, limit = 300): LogEntry[] {
    const file = join(env.data, "transcripts", `${runId}.jsonl`);
    if (!existsSync(file)) return [];
    return condense(readFileSync(file, "utf8")).slice(-limit);
  }

  async control(path: string[], body: Record<string, unknown>): Promise<string> {
    const { state, gh, repo, log } = this.ctx;
    // A lane of the repo the page names (the primary if none), from that repo's .factory.yml.
    const configOf = async (c: Ctx) => (c === this.ctx ? await this.snap() : ((await this.otherSnaps()).find((x) => x.ctx === c)?.s ?? (await snapshot(c.gh, c.repo)))).config;
    const laneOf = async (name: string) => {
      const c = this.ctxFor(body.repo);
      const l = (await configOf(c)).lanes.find((x) => x.name === name);
      if (!l) throw new HttpError(404, `${c.repo} has no lane "${name}"`);
      return { c, l, label: c === this.ctx ? l.name : `${l.name} (${c.repo})` };
    };
    const [what, id, action] = path;
    if (what === "lanes" && action === "live") {
      const { c, l, label } = await laneOf(id);
      c.state.setLive(l.name, body.live === true);
      log(`dashboard: ${label} is now ${body.live === true ? "LIVE" : "dry"}`);
      return `${label} is ${body.live === true ? "live" : "dry"}`;
    }
    if (what === "lanes" && action === "mode") {
      // Off, dry or live in one control.
      const { c, l, label } = await laneOf(id);
      const mode = String(body.mode);
      if (!["off", "dry", "live"].includes(mode)) throw new HttpError(400, "mode is off, dry or live");
      c.state.setOn(l.name, mode !== "off");
      if (mode !== "off") c.state.setLive(l.name, mode === "live");
      log(`dashboard: ${label} is now ${mode}`);
      return `${label}: ${mode === "off" ? "off" : mode === "live" ? "live" : "dry"}`;
    }
    if (what === "lanes" && action === "run") {
      const { c, l, label } = await laneOf(id);
      if (!this.queued.some((q) => q.lane === l.name && !q.card && (q.repo ?? repo) === c.repo)) this.queued.push({ lane: l.name, repo: c.repo });
      this.requestRun();
      log(`dashboard: run ${label} now (${c.state.lane(l.name).live ? "live" : "dry"})`);
      return `${label} queued`;
    }
    if (what === "settings" && id === "credits") {
      state.setAllowCredits(body.on === true);
      log(`dashboard: paid credits are now ${body.on === true ? "allowed" : "off"} for factory runs`);
      return body.on === true ? "Runs may use paid credits" : "Runs stop when the plan runs out";
    }
    if (what === "settings" && id === "automerge") {
      state.setAutoMerge(body.on === true);
      log(`dashboard: auto-merge is now ${body.on === true ? "on" : "off"}`);
      return body.on === true ? "Factory PRs merge by themselves once they pass every check" : "Auto-merge off: factory PRs wait for you to merge them";
    }
    if (what === "settings" && id === "shots") {
      state.setShotsOn(body.on === true);
      log(`dashboard: before/after screenshots are now ${body.on === true ? "on" : "off"}`);
      return body.on === true ? "Website PRs get before/after screenshots once the reviewer hands them to you" : "Screenshots off";
    }
    if (what === "settings" && id === "autoqueue") {
      // Any of on, threshold and max; the rest stay as they were.
      const s = autoQueueFrom({ ...autoQueueFrom(state.autoQueueSettings()), ...body });
      state.setAutoQueueSettings(s);
      log(`dashboard: auto-queue is now ${s.on ? "on" : "off"} (below ${s.threshold} ready, up to ${s.max} ideas)`);
      return s.on ? `Auto-queue on: below ${s.threshold} ready cards, up to ${s.max} ideas are queued` : "Auto-queue off: ideas wait for you";
    }
    if (what === "settings" && id === "limits") {
      // Any of the limits; the rest stay as they were. Out of range is refused, not clamped.
      let next;
      try {
        next = mergeLimits(state.limitSettings(), body);
      } catch (e) {
        throw new HttpError(400, (e as Error).message);
      }
      state.setLimitSettings(next);
      const l = limits(state);
      log(`dashboard: limits saved (${Object.keys(body).join(", ")}): stops at ${Math.round(l.fiveHour * 100)}% / ${Math.round(l.sevenDay * 100)}%, runs ${l.runTimeoutMin} min, usage refresh ${l.usageRefreshMin} min, auto-queue every ${l.autoQueueEveryH} h`);
      return "Saved";
    }
    if (what === "settings" && id === "parallel") {
      const n = Number(body.runs);
      if (!Number.isInteger(n) || n < 1 || n > MAX_PARALLEL) throw new HttpError(400, `Pick 1 to ${MAX_PARALLEL} runs at once`);
      state.setParallelRuns(n);
      log(`dashboard: up to ${n} run${n === 1 ? "" : "s"} at once`);
      this.requestRun();
      return n === 1 ? "One run at a time" : `Up to ${n} runs at once`;
    }
    if (what === "settings" && id === "install") {
      let next;
      try {
        next = saveInstall(body);
      } catch (e) {
        throw new HttpError(400, (e as Error).message);
      }
      log(`dashboard: install settings saved (${Object.keys(body).join(", ")}); serving ${next.projects.join(", ")}`);
      this.requestRun();
      return "Saved";
    }
    if (what === "settings" && id === "gaming") {
      try {
        return await saveVars(this.ctx, body);
      } catch (e) {
        throw new HttpError(400, (e as Error).message);
      }
    }
    if (what === "gaming" && /^\d{1,15}$/.test(id ?? "") && (ANSWERS.includes(action as Answer) || action === "stop")) {
      // A game test's Start, Later, Skip or Stop (gaming.ts), on the primary repo's run.
      try {
        return action === "stop" ? await stopGame(this.ctx, Number(id)) : await answer(this.ctx, Number(id), action as Answer);
      } catch (e) {
        throw new HttpError(400, (e as Error).message);
      } finally {
        freshDevices();
      }
    }
    if (what === "settings" && id === "test-builds") {
      const hours = Number(body.hours);
      if (!Number.isFinite(hours) || hours < MIN_DELETE_HOURS || hours > MAX_DELETE_HOURS) throw new HttpError(400, `Pick between ${MIN_DELETE_HOURS} hour and ${MAX_DELETE_HOURS / 24} days`);
      const rounded = Math.round(hours);
      state.setTestBuildDeleteHours(rounded);
      const words = rounded % 24 === 0 ? `${rounded / 24} day${rounded === 24 ? "" : "s"}` : `${rounded} hour${rounded === 1 ? "" : "s"}`;
      log(`dashboard: test builds are now deleted ${words} after a PR is merged or closed`);
      return `Test builds are deleted ${words} after merge or close`;
    }
    if (what === "links" && !id) {
      const title = String(body.title ?? "").trim().slice(0, 80);
      const grp = String(body.group ?? "").trim().slice(0, 40) || "Other";
      let url: URL;
      try {
        url = new URL(String(body.url ?? "").trim());
      } catch {
        throw new HttpError(400, "That isn't a web address");
      }
      if (!["https:", "http:"].includes(url.protocol)) throw new HttpError(400, "Only http and https links");
      state.addLink(grp, title || url.host, url.href);
      return `Added ${title || url.host}`;
    }
    if (what === "links" && /^\d+$/.test(id ?? "") && action === "remove") {
      state.removeLink(Number(id));
      return "Removed";
    }
    if (what === "pause" && !id) {
      const hours = Math.min(Math.max(Number(body.hours ?? 24), 0.25), 24 * 14);
      state.setPause(new Date(Date.now() + hours * 3600_000), "paused from the dashboard");
      log(`dashboard: paused for ${hours} h`);
      return `paused for ${hours} h`;
    }
    if (what === "stop" && !id) {
      // The stop switch: factory-stop on the factory's plan issue. Agents check it at their next checkpoint.
      const n = install().stopIssue;
      if (!n) throw new HttpError(400, "No stop issue set: pick an issue number in Settings › Install (Stop switch issue)");
      await gh.send("POST", `/repos/${repo}/issues/${n}/labels`, { labels: ["factory-stop"] });
      log(`dashboard: stop switch on (factory-stop on #${n})`);
      await this.snap(true);
      const n2 = state.runningRuns().length;
      return n2 ? `Stopped: no new runs, and ${n2 === 1 ? "the current run stops" : `the ${n2} running runs stop`} at their next checkpoint` : "Stopped: no new runs start";
    }
    if (what === "start" && !id) {
      // Off everywhere it was put, from the dashboard or the phone.
      const on = await gh.all<{ number: number }>(`/repos/${repo}/issues?labels=factory-stop&state=open`);
      for (const i of on) await gh.send("DELETE", `/repos/${repo}/issues/${i.number}/labels/factory-stop`);
      log(`dashboard: stop switch off${on.length ? ` (removed from ${on.map((i) => "#" + i.number).join(" ")})` : ""}`);
      await this.snap(true);
      this.requestRun();
      return "Started: runs go ahead again";
    }
    if (what === "activity" && id && action === "undo") {
      // Look the action up again from GitHub; the page only names it.
      await this.activity("7d", true);
      const a = this.acts.get("7d")!.data.actions.find((x) => x.id === id);
      if (!a) throw new HttpError(404, "That action isn't in the last week's list");
      if (!a.undo) throw new HttpError(400, "That one can't be undone here");
      if (state.undone().has(id)) throw new HttpError(409, "Already undone");
      await gh.send(a.undo.method, a.undo.path, a.undo.body);
      state.markUndone(id);
      this.acts.clear();
      log(`dashboard: undid #${a.n} ${a.what.slice(0, 80)}`);
      await this.snap(true);
      return `Undone on #${a.n}`;
    }
    if (what === "unpause" && !id) {
      state.clearPause();
      log("dashboard: unpaused");
      return "unpaused";
    }
    if (what === "cards" && /^\d+$/.test(id ?? "") && action === "build") {
      // Build this card now, live, with the builder lane its size belongs to. An idea is queued first.
      const n = Number(id);
      const c = this.ctxFor(body.repo);
      const repo = c.repo;
      const issue = (c === this.ctx ? await this.snap(true) : (await this.otherSnaps(true)).find((x) => x.ctx === c)?.s)?.open.find((i) => i.number === n);
      if (!issue) throw new HttpError(404, `#${n} isn't an open issue`);
      const size = sizeOf(issue.labels) ?? "none";
      const l = (await configOf(c)).lanes.find((x) => x.kind === "builder" && x.enabled && (x.sizes.includes(size) || x.splits.includes(size)));
      if (!l) throw new HttpError(400, `no builder lane takes ${size === "none" ? "unsized" : "size:" + size} cards`);
      if (!issue.labels.includes("ready")) {
        await gh.send("POST", `/repos/${repo}/issues/${n}/labels`, { labels: ["ready"] });
        await gh.send("DELETE", `/repos/${repo}/issues/${n}/labels/idea`);
      }
      if (!this.queued.some((q) => q.card === n && (q.repo ?? this.ctx.repo) === repo)) this.queued.push({ lane: l.name, card: n, repo, live: true });
      this.requestRun();
      log(`dashboard: build ${repo}#${n} now with ${l.name}`);
      return `#${n} will build next (${l.name}, ${l.model})`;
    }
    if (what === "cards" && /^\d+$/.test(id ?? "") && action === "answer") {
      // The owner's answer to a card waiting on them, posted as the app. Its id is saved so the dispatcher counts it as
      // the owner's: the PR's session resumes (by webhook, or the next poll) and the board shows the card answered.
      const n = Number(id);
      const c = this.ctxFor(body.repo);
      const owner = c.repo.split("/")[0];
      let text: string;
      try {
        text = ownerReplyBody(String(body.text ?? ""), owner);
      } catch (e) {
        throw new HttpError(400, (e as Error).message);
      }
      const issue = (c === this.ctx ? await this.snap(true) : (await this.otherSnaps(true)).find((x) => x.ctx === c)?.s)?.open.find((i) => i.number === n);
      if (!issue) throw new HttpError(404, `#${n} isn't an open issue`);
      if (!issue.labels.includes("needs-owner")) throw new HttpError(409, `#${n} isn't waiting on you any more`);
      const res = await c.gh.request("POST", `/repos/${c.repo}/issues/${n}/comments`, { body: text });
      if (!res.ok) throw new HttpError(502, `GitHub ${res.status}: ${res.text.slice(0, 200)}`);
      state.addOwnerReply((JSON.parse(res.text) as { id: number }).id, c.repo, n);
      log(`dashboard: answered ${c.repo}#${n} (${text.length} characters)`);
      this.issues.delete(`${c.repo}#${n}`);
      this.acts.clear();
      if (c === this.ctx) await this.snap(true);
      else this.others.clear();
      return `Sent to #${n}`;
    }
    if (what === "cards" && /^\d+$/.test(id ?? "") && (action === "hold" || action === "requeue")) {
      const n = Number(id);
      const repo = this.ctxFor(body.repo).repo;
      if (action === "hold") {
        await gh.send("POST", `/repos/${repo}/issues/${n}/labels`, { labels: ["hold"] });
      } else {
        for (const l of ["hold", "needs-owner"]) await gh.send("DELETE", `/repos/${repo}/issues/${n}/labels/${l}`);
        await gh.send("POST", `/repos/${repo}/issues/${n}/labels`, { labels: ["ready"] });
      }
      log(`dashboard: ${repo}#${n} ${action}`);
      await this.snap(true);
      this.others.clear();
      return `#${n} ${action === "hold" ? "on hold" : "requeued"}`;
    }
    throw new HttpError(404, "unknown control");
  }
}

/** Where the stop switch is on (issues and PRs carrying factory-stop), or null when it's off. */
function stopped(s: Snapshot): number[] | null {
  const on = [...s.open.filter((i) => i.labels.includes("factory-stop")), ...s.pulls.filter((p) => p.labels.includes("factory-stop"))].map((i) => i.number);
  return on.length ? on : null;
}

/** The bookmarks a new dashboard starts with: the primary repo's places on GitHub, the dashboard, and the
 *  plan's usage. The Links view adds and removes the rest. */
const DEFAULT_LINKS = (repo: string): [string, string, string][] => {
  const dash = install().dashboardUrl;
  return [
    ...(dash ? [["Sites", "Factory dashboard", `${dash}/`] as [string, string, string]] : []),
    ["GitHub", repo.split("/")[1] ?? repo, `https://github.com/${repo}`],
    ["GitHub", "Ready cards", `https://github.com/${repo}/issues?q=is%3Aopen+label%3Aready`],
    ["GitHub", "Pull requests", `https://github.com/${repo}/pulls`],
    ["GitHub", "Actions", `https://github.com/${repo}/actions`],
    ["Claude", "Plan usage", "https://claude.ai/settings/usage"],
  ];
};

/** What a lane does, in plain words, from its kind and settings. */
function aboutLane(l: Lane): string {
  const sizes = (list: string[]) => list.map((s) => (s === "none" ? "unsized" : s)).join(", ");
  switch (l.kind) {
    case "builder":
      return `Builds one queued card per run (sizes ${sizes(l.sizes)})${l.splits.length ? `; splits ${sizes(l.splits)} cards into smaller ideas` : ""}. Opens a PR you review; your replies on it continue the same session.`;
    case "maintainer":
      return "PR upkeep: requeues cards you answered, fixes red CI on factory PRs, resolves merge conflicts, applies your PR comments, tidies labels and triages new issues (type and size). Never queues anything.";
    case "ideas":
      return "Reads the roadmap, the build history and every issue, then files up to 8 new ideas with a type and size. Never queues them; you decide.";
    case "security":
      return "Reviews the week's changes and open factory PRs for security problems and files Security issues with a size and priority.";
    case "reviewer":
      return `Reviews every ready factory PR before you see it: the card, the diff, CI and the Pages preview. Posts "ready for you" or "needs work"; on needs work the builder session fixes it (at most ${MAX_ROUNDS} rounds).`;
  }
  return l.kind;
}

interface BriefIssue {
  number: number;
  title: string;
  priority: string | null;
  size: string | null;
  labels: string[];
}

/** The board's columns, from the labels and open PRs. */
function board(
  s: Snapshot,
  queue: ReturnType<typeof buildQueue>,
  runningCards: number[],
  starting: number[],
  lastRun: Map<number, number>,
  verdicts: Map<number, { verdict: string; runId: number }>,
  builds: Map<number, TestBuilds>,
  now: number,
  done: DoneRecord[] = [],
) {
  const testBuilds = (pr: number | null | undefined) => {
    const b = pr == null ? undefined : builds.get(pr);
    return b ? { deleted: b.deleted ?? null, versions: versionsForPage(b, now) } : null;
  };
  const brief = (i: { number: number; title: string; labels: string[] }): BriefIssue => ({
    number: i.number,
    title: i.title,
    priority: priorityOf(i.labels),
    size: sizeOf(i.labels),
    labels: i.labels,
  });
  const has = (l: string) => s.open.filter((i) => i.labels.includes(l)).map(brief);
  const prFor = (n: number) => s.pulls.find((p) => issueOfPull(p) === n);
  // A card is "building" from the moment its run starts (or is queued with Build now), before the agent labels it.
  const active = new Set([...runningCards, ...starting]);
  const labelled = has("building");
  const extra = s.open.filter((i) => active.has(i.number) && !i.labels.includes("building")).map(brief);
  const answered = has("needs-owner").filter((i) => s.answered.has(i.number));
  return {
    next: [
      ...queue.filter((c) => c.state === "queued" && !active.has(c.number)).map((c) => ({ ...c, labels: [] as string[] })),
      ...answered.map((i) => ({ ...i, answered: true })),
    ],
    blocked: queue.filter((c) => c.state === "skipped" && c.reason?.startsWith("blocked")),
    building: [...extra, ...labelled].map((i) => ({
      ...i,
      pr: prFor(i.number)?.number ?? null,
      testBuilds: testBuilds(prFor(i.number)?.number),
      running: runningCards.includes(i.number),
      starting: starting.includes(i.number) && !runningCards.includes(i.number),
      run: lastRun.get(i.number) ?? null,
    })),
    review: s.pulls
      .filter((p) => !p.draft)
      .map((p) => ({ number: p.number, title: p.title, factory: p.labels.includes("factory"), issue: issueOfPull(p) ?? null, updatedAt: p.updatedAt ?? null, run: lastRun.get(issueOfPull(p) ?? -1) ?? null, verdict: verdicts.get(p.number)?.verdict ?? null, testBuilds: testBuilds(p.number) }))
      .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "")),
    needsYou: has("needs-owner").filter((i) => !s.answered.has(i.number)).map((i) => ({ ...i, pr: prFor(i.number)?.number ?? null })),
    hold: has("hold"),
    ideas: s.open.filter((i) => i.labels.includes("idea") && !i.labels.includes("ready")).map(brief),
    /** Merged factory PRs' Done lines (done.ts), newest first: the last DONE_DAYS. */
    done: done.map((r) => ({ number: r.card ?? r.pr, pr: r.pr, title: r.title, ok: r.ok, line: r.line, at: r.at })),
  };
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface LogEntry {
  kind: "text" | "tool" | "result" | "error" | "done" | "stderr";
  text: string;
  name?: string;
}

export function condense(jsonl: string): LogEntry[] {
  const out: LogEntry[] = [];
  const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    let ev: any;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (ev.type === "assistant") {
      for (const b of ev.message?.content ?? []) {
        if (b.type === "text" && b.text?.trim()) out.push({ kind: "text", text: clip(b.text.trim(), 4000) });
        if (b.type === "tool_use") out.push({ kind: "tool", name: b.name, text: clip(toolSummary(b.input ?? {}), 300) });
      }
    } else if (ev.type === "user") {
      for (const b of Array.isArray(ev.message?.content) ? ev.message.content : []) {
        if (b.type !== "tool_result") continue;
        const text = Array.isArray(b.content) ? b.content.map((c: any) => c.text ?? "").join("\n") : String(b.content ?? "");
        out.push({ kind: b.is_error ? "error" : "result", text: clip(text.trim(), 600) });
      }
    } else if (ev.type === "result") {
      const text = clip(String(ev.result ?? ev.subtype ?? ""), 4000);
      if (out.at(-1)?.kind === "text" && out.at(-1)?.text === text.trim()) out.pop(); // the final message, shown once
      out.push({ kind: "done", text });
    } else if (ev.type === "stderr" && String(ev.text).trim()) {
      out.push({ kind: "stderr", text: clip(String(ev.text).trim(), 600) });
    }
  }
  return out;
}

function toolSummary(input: Record<string, unknown>): string {
  for (const k of ["description", "command", "file_path", "pattern", "url", "prompt", "query"]) {
    if (typeof input[k] === "string") return k === "description" && typeof input.command === "string" ? `${input[k]}: ${input.command}` : String(input[k]);
  }
  return JSON.stringify(input);
}
