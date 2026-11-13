// Factory dispatcher CLI. Every lane is dry until the owner switches it on.
//
//   dry-run [repo] [--json]  print a repo's queue and what each of its lanes would do next (reads GitHub only)
//   serve                  fire lanes on their schedules and resume PR sessions on owner replies, up to
//                          Parallel runs at once
//   run <lane> [repo]      run a repo's lane now (live only if it's switched on)
//   parallel <1-3>         how many runs may go at once (also on the dashboard, Settings)
//   lane <lane> on|off [repo]  switch a lane between live and dry, in one repo or every repo that has it
//   status                 lanes, pause and the last runs
//   unpause                lift a usage-limit pause early
//   perf [n]               read new perf-* artifacts now and list the last n test runs (Performance view)
//   webhook-config [url]   point the GitHub App's webhook at the tunnel, with WEBHOOK_SECRET
//   trial <issue>... [--at HH:MM]  rebuild past cards with and without the trial skills; blind Opus judge
//   review <pr>... [--post]  a live reviewer run on each PR; without --post nothing is posted (a trial)
//   test-builds            check closed PRs' test builds now and dispatch any cleanup that's due
//   init-project <owner/repo> [--print]  a new project's labels, plus a PR with the starter prompts and
//                          .factory.yml (templates/project); --print only shows what it would do
//   doctor                 two tiny live runs: the agent image, token, clone, Claude, and resuming a session
import { join } from "node:path";
import { nextRun } from "./config.ts";
import { budgetBlock, laneOn, limits, refreshUsage, runLane, tick, usageStale, type Ctx } from "./dispatch.ts";
import { Dashboard } from "./dashboard.ts";
import { checkSessions } from "./resume.ts";
import { checkReviews, reviewPr } from "./review.ts";
import { checkDone } from "./done.ts";
import { checkScores } from "./scores.ts";
import { checkAutoMerge } from "./automerge.ts";
import { checkAutoQueue, queueFacts } from "./autoqueue.ts";
import { startServer } from "./server.ts";
import { Systems } from "./systems.ts";
import { Perf } from "./perf.ts";
import { checkTestBuilds } from "./testbuilds.ts";
import { GitHub } from "./github.ts";
import { loadConfig, snapshot, type Snapshot } from "./project.ts";
import { buildQueue, pickFor, type Card, type Pick } from "./queue.ts";
import { env, policy, runAgent } from "./runner.ts";
import { MAX_PARALLEL, Slots } from "./slots.ts";
import { State } from "./state.ts";
import { bindInstall, install, needsSetup, setAppSlug } from "./install.ts";
import { trial } from "./trial.ts";
import { initProject } from "./starter.ts";

const [command, ...rest] = process.argv.slice(2);
const log = (line: string) => console.log(`${new Date().toLocaleString("sv-SE")}  ${line}`);
const POLL_MS = 5 * 60_000;
/** Test builds of merged or closed PRs are checked for deletion this often. */
const CLEANUP_MS = 60 * 60_000;
const USAGE = "Usage: node src/main.ts dry-run [repo] [--json] | serve | run <lane> [repo] | lane <lane> on|off [repo] | status | devices [--watch] | parallel <1-3> | unpause | test-builds | perf [n] | webhook-config [url] | init-project <owner/repo> [--print] | doctor";

const gh = new GitHub();
const state = new State(join(env.data, "factory.db"));
bindInstall(state);
// The app's own slug from GitHub, so a new install needn't type it (Settings › Install only adds former ones).
// Without an answer, the saved or env slugs stand as before.
try {
  const slug = await gh.appSlug();
  if (slug) setAppSlug(slug);
} catch (e) {
  log(`couldn't read the GitHub App's slug, using Settings › Install's: ${(e as Error).message}`);
}
// The repos the factory works on (Settings › Projects, else FACTORY_PROJECTS), the primary first. Each runs the
// lanes and schedules of its own .factory.yml (builders take that repo's cards); the dashboard settings apply to all.
const repo = install().projects[0];
if (!repo) fail("No project: set FACTORY_PROJECTS=owner/name in .env (the repo whose issues the factory works).");
const ctx: Ctx = { gh, state, repo, log };
// One context per repo, sharing the database (runs, usage, pause) but not its PR sessions and reviews. The
// list follows Settings › Projects: a repo added there is served from the dispatcher's next loop.
let ctxs: Ctx[] = [];
function contexts(): Ctx[] {
  const want = install().projects;
  if (want.length !== ctxs.length || want.some((r, i) => ctxs[i].repo !== r)) {
    const next = want.map((r) => (r === repo ? ctx : (ctxs.find((c) => c.repo === r) ?? { gh, state: state.for(r), repo: r, log })));
    for (const c of next) (c.all = next), (c.slots = ctx.slots);
    ctxs = next;
  }
  return ctxs;
}
contexts();
const ctxFor = (r?: string) => contexts().find((c) => c.repo === r) ?? ctx;
policy.allowCredits = () => state.allowCredits();
policy.parallelRuns = () => new Slots(state).limit();
policy.timeoutMin = () => limits(state).runTimeoutMin;

switch (command) {
  case "dry-run": {
    const c = repoArg(rest);
    const report = plan(c, await snapshot(gh, c.repo));
    console.log(rest.includes("--json") ? JSON.stringify(report, null, 2) : render(report));
    break;
  }
  case "serve": {
    const stale = state.failStale();
    if (stale) log(`marked ${stale} run(s) left over from a restart as failed`);
    if (needsSetup()) log("this database is from before Settings › Install: the dashboard address, machines, uptime checks, device checks, previews, app and stop issue are off until you set them there");
    log(`serving ${contexts().map((c) => c.repo).join(", ")}; live lanes: ${(await liveLanes()).join(", ") || "none (all dry)"}`);
    // Webhooks and dashboard buttons wake the loop at once; polling catches anything webhooks miss.
    // PRs a webhook named, per repo.
    const pending = new Map<string, Set<number>>();
    let wake = () => {};
    const slots = new Slots(state);
    ctx.slots = slots;
    for (const c of contexts()) c.slots = slots;
    slots.onDone = () => wake(); // a freed slot is filled at once
    const dashboard = new Dashboard(ctx, () => wake());
    let lastUsageCheck = 0;
    const systems = new Systems(state, log);
    systems.queues = () => queueFacts(ctxs);
    systems.start();
    const perf = new Perf(state, log);
    const pullPerf = async () => {
      let added = 0;
      try {
        for (const c of contexts()) added += await perf.pull(c);
        perf.last = { at: new Date().toISOString(), added, error: null };
      } catch (e) {
        perf.last = { at: new Date().toISOString(), added, error: (e as Error).message };
        log(`perf: ${(e as Error).message}`);
      }
      return added ? `Stored ${added} new run${added === 1 ? "" : "s"}` : "No new runs";
    };
    perf.pullAll = pullPerf;
    startServer({ port: Number(process.env.FACTORY_PORT ?? 8080), host: process.env.FACTORY_BIND || undefined, repos: () => contexts().map((c) => c.repo), onPr: (pr, r) => (pending.set(r, (pending.get(r) ?? new Set()).add(pr)), wake()), dashboard, systems, perf, log });
    let lastPoll = 0;
    let lastCleanup = 0;
    for (;;) {
      try {
        contexts(); // a repo added or removed on Settings › Install takes effect here
        // "Run now" and "Build now" start as soon as a slot is free; until then they wait in order.
        const manual = dashboard.queued[0];
        if (manual && !state.pause()) {
          const lane = (await loadConfig(gh, ctxFor(manual.repo).repo)).lanes.find((l) => l.name === manual.lane);
          const kind = lane?.kind === "builder" ? "build" : "lane";
          if (!lane || slots.spawn(`${manual.lane} run`, kind, log, (t) => runLane(ctxFor(manual.repo), lane, { card: manual.card, live: manual.live }, t), { card: manual.card, repo: manual.repo })) {
            dashboard.queued.shift();
          }
        }
        if (usageStale(state, lastUsageCheck)) {
          lastUsageCheck = Date.now();
          await refreshUsage(ctx);
        } else if (Date.now() - lastPoll >= POLL_MS) {
          lastPoll = Date.now();
          pending.clear();
          for (const c of contexts()) {
            await checkSessions(c);
            await checkReviews(c);
            await checkAutoMerge(c).catch((e) => log(`automerge: ${(e as Error).message}`));
            await checkDone(c).catch((e) => log(`done: ${(e as Error).message}`));
            await checkScores(c).catch((e) => log(`scores: ${(e as Error).message}`));
            await checkAutoQueue(c).catch((e) => log(`auto-queue: ${(e as Error).message}`));
          }
          await pullPerf();
        } else if (Date.now() - lastCleanup >= CLEANUP_MS) {
          lastCleanup = Date.now();
          const r = await checkTestBuilds(ctx, (await loadConfig(gh, repo)).testBuilds);
          if (r.problem) log(`test builds: ${r.problem}`);
        } else if (pending.size) {
          const named = [...pending];
          pending.clear();
          for (const [r, prs] of named) await checkSessions(ctxFor(r), [...prs]);
        }
        for (const c of contexts()) await tick(c);
      } catch (e) {
        log(`loop failed: ${(e as Error).message}`);
      }
      await new Promise<void>((r) => {
        const t = setTimeout(r, 60_000);
        wake = () => (clearTimeout(t), r());
      });
    }
  }
  case "run": {
    const c = repoArg(rest.slice(1));
    const lane = (await loadConfig(gh, c.repo)).lanes.find((l) => l.name === rest[0]);
    if (!lane) fail(`${c.repo} has no lane called "${rest[0]}".`);
    await runLane(c, lane);
    break;
  }
  case "parallel": {
    const n = Number(rest[0]);
    if (!Number.isInteger(n) || n < 1 || n > MAX_PARALLEL) fail(`Usage: parallel <1-${MAX_PARALLEL}>`);
    state.setParallelRuns(n);
    log(`up to ${n} run${n === 1 ? "" : "s"} at once, from the dispatcher's next loop`);
    break;
  }
  case "lane": {
    // In one repo, or (without one) every repo whose .factory.yml has the lane.
    const [name, onOff, only] = rest;
    const targets = only ? [repoArg([only])] : contexts();
    const has = await Promise.all(targets.map(async (c) => ({ c, lanes: (await loadConfig(gh, c.repo)).lanes.map((l) => l.name) })));
    const hit = has.filter((h) => h.lanes.includes(name)).map((h) => h.c);
    if (!hit.length || !["on", "off"].includes(onOff)) fail(`Usage: lane <${[...new Set(has.flatMap((h) => h.lanes))].join("|")}> on|off [owner/name]`);
    for (const c of hit) {
      c.state.setLive(name, onOff === "on");
      log(`${name} in ${c.repo} is now ${onOff === "on" ? "LIVE: its next scheduled run starts Claude" : "dry"}`);
    }
    break;
  }
  case "devices": {
    // Each test machine as CI sees it; --watch redraws every 15 s.
    const { devicesText, devicesView } = await import("./devices.ts");
    for (;;) {
      const text = devicesText(await devicesView(ctx));
      if (!rest.includes("--watch")) {
        console.log(text);
        break;
      }
      console.clear();
      console.log(`${new Date().toLocaleTimeString()}
${text}`);
      await new Promise((r) => setTimeout(r, 15_000));
    }
    break;
  }
  case "status": {
    const pause = state.pause();
    console.log(`Factory for ${contexts().map((c) => c.repo).join(", ")}${pause ? `: PAUSED until ${new Date(pause.until).toLocaleString()} (${pause.reason})` : ""}`);
    console.log(`Parallel runs: ${policy.parallelRuns()}`);
    for (const c of contexts()) {
      const config = await loadConfig(gh, c.repo);
      process.env.TZ = config.timezone;
      console.log(`\n${c.repo} (${config.source})`);
      for (const l of config.lanes) {
        const on = laneOn(c.state, l);
        const mode = !on ? "off" : c.state.lane(l.name).live ? "LIVE" : "dry";
        const next = on ? nextRun(l.schedule, new Date())?.toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" }) : "";
        console.log(`  ${l.name.padEnd(14)} ${mode.padEnd(5)} ${l.model.padEnd(7)} next: ${next ?? "-"}`);
      }
    }
    console.log("\nLast runs");
    for (const r of state.recentRuns(10)) {
      const card = r.card ? ` #${r.card}` : "";
      const cost = r.cost_usd ? ` $${r.cost_usd.toFixed(2)}` : "";
      console.log(`  ${r.id}. ${new Date(r.started_at).toLocaleString()}  ${r.lane} ${r.mode} ${r.status}${card}${r.pr ? ` PR #${r.pr}` : ""}${cost}  ${(r.summary ?? "").split("\n")[0].slice(0, 90)}`);
    }
    break;
  }
  case "webhook-config": {
    const base = install().dashboardUrl;
    const url = rest[0] ?? (base ? `${base}/webhooks/github` : "");
    if (!url) fail("Usage: webhook-config <url> (or set the dashboard address: FACTORY_URL, or Settings › Install).");
    if (!process.env.WEBHOOK_SECRET) fail("Set WEBHOOK_SECRET in .env first.");
    await gh.setAppWebhook(url, process.env.WEBHOOK_SECRET);
    log(`the GitHub App now sends webhooks to ${url}, signed with WEBHOOK_SECRET`);
    break;
  }
  case "trial": {
    const at = rest.includes("--at") ? rest[rest.indexOf("--at") + 1] : undefined;
    const issues = rest.filter((a, i) => /^\d+$/.test(a) && rest[i - 1] !== "--at").map(Number);
    if (!issues.length) fail("Usage: trial <issue> [<issue>...] [--at HH:MM]");
    await trial(ctx, issues, at);
    break;
  }
  case "review": {
    const prs = rest.filter((a) => /^\d+$/.test(a)).map(Number);
    if (!prs.length) fail("Usage: review <pr> [<pr>...] [--post]");
    const tight = budgetBlock(state);
    if (tight) fail(`Not now: ${tight}.`);
    for (const pr of prs) {
      const v = await reviewPr(ctx, pr, { post: rest.includes("--post") });
      console.log(`\n=== PR #${pr}: ${v ? v.verdict : "no verdict"} ===\n${v ? v.review + (v.mustFix.length ? "\n\nMust fix:\n- " + v.mustFix.join("\n- ") : "") + (v.polish.length ? "\n\nPolish:\n- " + v.polish.join("\n- ") : "") + (v.later.length ? "\n\nLater:\n- " + v.later.join("\n- ") : "") : ""}\n`);
    }
    break;
  }
  case "test-builds": {
    const r = await checkTestBuilds(ctx, (await loadConfig(gh, repo)).testBuilds);
    for (const p of r.prs) console.log(`  PR #${p.pr} ${p.merged ? "merged" : "closed"} ${new Date(p.closedAt).toLocaleString()}: ${JSON.stringify(p.step)}`);
    if (!r.prs.length) console.log("No closed PR has test builds waiting to be deleted.");
    if (r.problem) console.log(`\nProblem: ${r.problem}`);
    break;
  }
  case "perf": {
    // Reads new perf-* artifacts now and lists the latest runs (the Performance view in a terminal).
    const perf = new Perf(state, log);
    let added = 0;
    for (const c of contexts()) added += await perf.pull(c);
    console.log(`${added} new run(s) stored`);
    for (const r of perf.view().runs.slice(0, Number(rest[0]) || 15)) {
      const fps = Object.entries(r.summary.fps).map(([k, v]) => `${k} ${v.avg} fps (1% ${v.low1})`).join(", ");
      const worse = r.changes.filter((c) => c.bad).map((c) => `${c.what} ${c.pct > 0 ? "+" : ""}${Math.round(c.pct)}%`).join(", ");
      console.log(`#${r.id} ${r.started.slice(0, 16)} ${r.kind} on ${r.machine} ${r.build || r.sha.slice(0, 7)} ${r.outcome}: startup ${r.startup ?? "?"} ms, shutdown ${r.shutdown ?? "?"} ms${fps ? `, ${fps}` : ""}${worse ? `; worse: ${worse}` : ""}`);
    }
    break;
  }
  case "unpause":
    state.clearPause();
    log("pause lifted");
    break;
  case "init-project": {
    const target = rest.find((a) => !a.startsWith("--"));
    if (!target) fail("Usage: init-project <owner/repo> [--print]");
    await initProject(gh, target, rest.includes("--print"), (line) => console.log(line)).catch((e) => fail((e as Error).message));
    break;
  }
  case "doctor": {
    const id = state.startRun({ lane: "doctor", model: "haiku", mode: "live", card: null, action: null, status: "running" });
    log(`doctor: run ${id} starts an agent container`);
    const res = await runAgent(
      gh,
      {
        runId: id,
        repo,
        model: "haiku",
        prompt:
          "This is a setup check; change nothing. Run these three commands and report their output: " +
          "`gh api repos/$FACTORY_REPO --jq .full_name`, `git -C /work/repo log -1 --format=%h` and `git config user.name`. " +
          "Then reply with one line: `doctor ok <full_name> <commit> <git user>`, or `doctor failed: <why>`.",
      },
      log,
      (r) => state.saveUsage(r),
    );
    state.updateRun(id, { status: res.ok ? "done" : res.limited ? "limited" : "failed", session_id: res.sessionId ?? null, cost_usd: res.costUsd ?? null, summary: res.text }, true);
    console.log(`\n${res.text}\n\nsession ${res.sessionId ?? "-"}, transcript ${res.transcript}`);
    if (!res.ok || !/doctor ok/.test(res.text) || !res.sessionId) process.exit(1);

    // Resume that session in a new container, the way an owner's PR comment would.
    const id2 = state.startRun({ lane: "doctor", model: "haiku", mode: "live", card: null, action: "resume", status: "running" });
    log(`doctor: run ${id2} resumes session ${res.sessionId} in a new container`);
    const again = await runAgent(
      gh,
      {
        runId: id2,
        repo,
        model: "haiku",
        resume: res.sessionId,
        branch: "main",
        prompt: "Setup check, part 2; change nothing. Without running anything, reply with one line: `resume ok` followed by the commit you reported in your previous reply.",
      },
      log,
    );
    state.updateRun(id2, { status: again.ok ? "done" : "failed", session_id: again.sessionId ?? null, cost_usd: again.costUsd ?? null, summary: again.text }, true);
    console.log(`\n${again.text}\n\nsession ${again.sessionId ?? "-"}`);
    const commit = res.text.match(/doctor ok \S+ (\S+)/)?.[1] ?? "?";
    if (!again.ok || !again.text.includes("resume ok") || !again.text.includes(commit)) process.exit(1);
    break;
  }
  default:
    fail(USAGE);
}

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

/** The repo named in `args` (owner/name), else the primary. */
function repoArg(args: string[]): Ctx {
  const named = args.find((a) => a.includes("/"));
  if (!named) return ctx;
  const c = contexts().find((x) => x.repo === named);
  if (!c) fail(`${named} isn't one of the factory's repos (${contexts().map((x) => x.repo).join(", ")}).`);
  return c;
}

/** Every repo's live lanes, the other repos' tagged. */
async function liveLanes(): Promise<string[]> {
  const out: string[] = [];
  for (const c of contexts()) {
    const lanes = (await loadConfig(gh, c.repo)).lanes.filter((l) => laneOn(c.state, l) && c.state.lane(l.name).live);
    out.push(...lanes.map((l) => `${l.name}${c === ctx ? "" : ` [${c.repo}]`}`));
  }
  return out;
}

interface LanePlan {
  lane: string;
  kind: string;
  model: string;
  enabled: boolean;
  live: boolean;
  nextRun?: string;
  pick?: Pick;
}

interface Report {
  repo: string;
  config: string;
  identity: string;
  takenAt: string;
  openFactoryPrs: number;
  maxOpenPrs: number;
  lanes: LanePlan[];
  queue: Card[];
}

function plan(c: Ctx, s: Snapshot): Report {
  const { state } = c;
  process.env.TZ = s.config.timezone; // schedules are in the project's local time
  const queue = buildQueue(s.ready, s.pulls, s.openIssues);
  const openFactoryPrs = s.pulls.filter((p) => p.labels.includes("factory")).length;
  return {
    repo: s.config.repo,
    config: s.config.source,
    identity: gh.identity,
    takenAt: s.takenAt.toISOString(),
    openFactoryPrs,
    maxOpenPrs: s.config.maxOpenPrs,
    lanes: s.config.lanes.map((l) => ({
      lane: l.name,
      kind: l.kind,
      model: l.model,
      enabled: laneOn(state, l),
      live: state.lane(l.name).live,
      nextRun: laneOn(state, l) ? nextRun(l.schedule, s.takenAt)?.toISOString() : undefined,
      pick: l.kind === "builder" ? pickFor(l, queue, openFactoryPrs, s.config.maxOpenPrs) : undefined,
    })),
    queue,
  };
}

function render(r: Report): string {
  const when = (iso?: string) =>
    iso ? new Date(iso).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" }) : "paused";
  const card = (c: Card) => `#${c.number} ${c.priority ?? "--"} ${c.size ? "size:" + c.size : "unsized"}  ${c.title}`;
  const lines = [
    `Factory dry run: ${r.repo} (settings: ${r.config}; as ${r.identity}), ${when(r.takenAt)}`,
    `Open factory PRs: ${r.openFactoryPrs}${r.maxOpenPrs > 0 ? ` of ${r.maxOpenPrs}` : " (no limit)"}`,
    "",
    "Lanes",
  ];
  for (const l of r.lanes) {
    const head = `  ${l.lane.padEnd(14)} ${(l.live ? "LIVE" : "dry").padEnd(5)} ${l.model.padEnd(7)} next: ${when(l.nextRun).padEnd(14)}`;
    if (!l.pick) lines.push(head + (l.enabled ? "" : "(paused)"));
    else if (l.pick.card) lines.push(`${head}→ ${l.pick.action} ${card(l.pick.card)}${l.pick.card.draftPr ? ` (draft PR #${l.pick.card.draftPr})` : ""}`);
    else lines.push(`${head}→ nothing to do: ${l.pick.idle}`);
  }
  lines.push("", `Queue (${r.queue.filter((c) => c.state === "queued").length} queued, build order)`);
  if (!r.queue.length) lines.push("  (no open issues labelled ready)");
  let n = 0;
  for (const c of r.queue) lines.push(`  ${c.state === "queued" ? String(++n).padStart(2) + "." : "  -"} ${card(c)}${c.reason ? `   [skipped: ${c.reason}]` : ""}`);
  return lines.join("\n");
}
