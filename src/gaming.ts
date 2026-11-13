// Game tests on a test machine, steered from the dashboard. The project's game-test workflow (Settings ›
// Install › Game tests) waits at its ask step for the owner's answer: Start, Later or Skip arrive as a
// commit status (state success) on the head commit of the PR the run is testing, each under its own name;
// Stop cancels the run. Its settings are the project's repository variables (VARS). The pure parts
// (which runs are game tests, their PR and commit, what's waiting, the variables) are tested in
// test/gaming.test.ts; the GitHub calls are at the bottom.
import type { Ctx } from "./dispatch.ts";
import { ciMachines, machineOf, type ApiJob } from "./devices.ts";
import { install, type Install, type Machine } from "./install.ts";

export type Answer = "start" | "later" | "skip";
export const ANSWERS: Answer[] = ["start", "later", "skip"];

export interface ApiRun {
  id: number;
  path: string;
  status: string;
  head_sha: string;
  head_branch?: string | null;
  display_title?: string;
  html_url: string;
  run_started_at?: string | null;
  created_at?: string;
  pull_requests?: { number: number }[];
}

export interface OpenPull {
  number: number;
  title: string;
  head: { sha: string };
}

export interface GameTest {
  run: number;
  /** The machine its job is on (Settings › Install › Machines), or null when none matches. */
  machine: string | null;
  /** Waiting at the ask step for Start, Later or Skip, or running. */
  state: "waiting" | "running";
  /** The step it's on now. */
  step: string | null;
  pr: number | null;
  title: string;
  /** The commit its answer goes on; null when the run's PR can't be found. */
  sha: string | null;
  url: string;
  at: string | null;
  /** The answers it takes now: only while waiting, and only those with a status name in Settings › Install. */
  answers: Answer[];
}

type GameConfig = Install["gamingTest"];

/** Whether a run is of the game-test workflow (its file name, Settings › Install). */
export function isGameRun(run: Pick<ApiRun, "path">, workflow: string): boolean {
  if (!workflow) return false;
  const file = run.path.split("@")[0];
  return file === workflow || file.endsWith(`/${workflow}`);
}

/**
 * The PR a run is testing and the commit its answer goes on: the run's own PR, else the open PR whose head
 * is the run's commit (both: the run's commit), else a `#123` in the run's title, as a dispatched run names
 * its PR (that PR's head commit). Pure.
 */
export function prOf(run: Pick<ApiRun, "head_sha" | "display_title" | "pull_requests">, pulls: OpenPull[]): { pr: number | null; title: string; sha: string | null } {
  const own = run.pull_requests?.[0]?.number;
  if (own) return { pr: own, title: pulls.find((p) => p.number === own)?.title ?? run.display_title ?? "", sha: run.head_sha };
  const byHead = pulls.find((p) => p.head.sha === run.head_sha);
  if (byHead) return { pr: byHead.number, title: byHead.title, sha: run.head_sha };
  const named = Number(run.display_title?.match(/#(\d+)\b/)?.[1] ?? 0);
  const p = pulls.find((x) => x.number === named);
  if (p) return { pr: p.number, title: p.title, sha: p.head.sha };
  return { pr: named || null, title: run.display_title ?? "", sha: null };
}

/** Whether `prOf` needs the open PRs for this run (it has no PR of its own). */
export const needsPulls = (run: Pick<ApiRun, "pull_requests">): boolean => !run.pull_requests?.length;

/** The game tests in progress, newest first, with where each is and what it takes now. Pure. */
export function gameTests(runs: ApiRun[], jobs: ApiJob[], pulls: OpenPull[], cfg: GameConfig = install().gamingTest, machines: Machine[] = ciMachines()): GameTest[] {
  const unique = [...new Map(runs.map((r) => [r.id, r])).values()];
  return unique
    .filter((r) => r.status === "in_progress" && isGameRun(r, cfg.workflow))
    .map((r) => {
      const mine = jobs.filter((j) => j.run_id === r.id);
      const job = mine.find((j) => j.status === "in_progress") ?? mine.find((j) => j.status !== "completed");
      const step = job?.steps?.find((s) => s.status === "in_progress")?.name ?? null;
      const waiting = Boolean(cfg.askStep && step && step.trim().toLowerCase() === cfg.askStep.toLowerCase());
      const { pr, title, sha } = prOf(r, pulls);
      return {
        run: r.id,
        machine: job ? machineOf(job, machines) : null,
        state: waiting ? "waiting" : "running",
        step,
        pr,
        title,
        sha,
        url: r.html_url,
        at: r.run_started_at ?? r.created_at ?? null,
        answers: waiting && sha ? ANSWERS.filter((a) => cfg[a]) : [],
      } satisfies GameTest;
    })
    .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
}

/** The commit status an answer posts. */
export function statusFor(answer: Answer, cfg: GameConfig, dashboardUrl = ""): { state: "success"; context: string; description: string; target_url?: string } {
  const context = cfg[answer];
  if (!context) throw new Error(`No status name for ${answer[0].toUpperCase() + answer.slice(1)}: set one in Settings › Install › Game tests`);
  const description = { start: "Start: from the factory dashboard", later: "Later: from the factory dashboard", skip: "Skip: from the factory dashboard" }[answer];
  return { state: "success", context, description, ...(dashboardUrl ? { target_url: dashboardUrl } : {}) };
}

// The project's repository variables the game-test workflow reads.
export const VARS = { on: "GAMING_TEST_ON", autoHours: "GAMING_AUTO_HOURS", limitMin: "GAMING_TEST_LIMIT_MIN", games: "GAMING_TEST_GAMES" } as const;
export const DEFAULT_LIMIT_MIN = 60;
export const MAX_LIMIT_MIN = 600;

export interface GameVars {
  /** GAMING_TEST_ON: "true" or "false". */
  on: boolean;
  /** GAMING_AUTO_HOURS: "1-7", hours in the test machine's local time, when tests start by themselves ("" off). */
  autoHours: string;
  /** GAMING_TEST_LIMIT_MIN: minutes a test may run (60 when unset). */
  limitMin: number;
  /** GAMING_TEST_GAMES: as the workflow reads it, kept as typed. */
  games: string;
}

/** The variables as the page shows them, from their values on GitHub (undefined: not set). Pure. */
export function varsFrom(values: Partial<Record<keyof GameVars, string | undefined>>): GameVars {
  const limit = Number(values.limitMin);
  return {
    on: (values.on ?? "").trim().toLowerCase() === "true",
    autoHours: (values.autoHours ?? "").trim(),
    limitMin: Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_LIMIT_MIN,
    games: values.games ?? "",
  };
}

/** "1-7" style hours, or "" for off; throws with a plain message on anything else. */
export function autoHours(v: unknown): string {
  const s = String(v ?? "").replace(/\s+/g, "");
  if (!s) return "";
  const m = s.match(/^(\d{1,2})-(\d{1,2})$/);
  const [a, b] = m ? [Number(m[1]), Number(m[2])] : [NaN, NaN];
  if (!m || a > 23 || b > 24 || a === b) throw new Error(`Automatic hours: "${String(v)}" isn't a range like 1-7 (hours 0-24, local time on the test machine)`);
  return `${a}-${b}`;
}

/**
 * A change from the page as the variable writes it makes: a value to set, or null to delete it (GitHub
 * keeps no empty variables, and the workflow reads a missing one as empty). Only the fields given change.
 * Throws with a plain message on a bad value. Pure.
 */
export function varsPatch(body: Record<string, unknown>): { name: string; value: string | null }[] {
  const out: { name: string; value: string | null }[] = [];
  if (body.on !== undefined) {
    if (typeof body.on !== "boolean") throw new Error("Game tests on: true or false");
    out.push({ name: VARS.on, value: String(body.on) });
  }
  if (body.autoHours !== undefined) out.push({ name: VARS.autoHours, value: autoHours(body.autoHours) || null });
  if (body.limitMin !== undefined) {
    const n = Number(body.limitMin);
    if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT_MIN) throw new Error(`Time limit: whole minutes from 1 to ${MAX_LIMIT_MIN}`);
    out.push({ name: VARS.limitMin, value: String(n) });
  }
  if (body.games !== undefined) {
    const g = String(body.games ?? "").trim();
    if (g.length > 2000) throw new Error("Games: at most 2000 characters");
    out.push({ name: VARS.games, value: g || null });
  }
  return out;
}

// --- GitHub ---

function config(): GameConfig {
  const cfg = install().gamingTest;
  if (!cfg.workflow) throw new Error("No game-test workflow: set it in Settings › Install › Game tests");
  return cfg;
}

/** A game-test run that's still going, or a plain error. */
async function liveRun(ctx: Ctx, id: number, cfg: GameConfig): Promise<ApiRun> {
  const run = await ctx.gh.maybe<ApiRun>(`/repos/${ctx.repo}/actions/runs/${id}`);
  if (!run || !isGameRun(run, cfg.workflow)) throw new Error(`Run ${id} isn't a game test`);
  if (run.status === "completed") throw new Error("That game test has already finished");
  return run;
}

/** Start, Later or Skip for a waiting game test: its status on the PR's head commit. */
export async function answer(ctx: Ctx, id: number, a: Answer): Promise<string> {
  const cfg = config();
  const status = statusFor(a, cfg, install().dashboardUrl);
  const run = await liveRun(ctx, id, cfg);
  const pulls = needsPulls(run) ? await ctx.gh.all<OpenPull>(`/repos/${ctx.repo}/pulls?state=open&per_page=100`) : [];
  const { pr, sha } = prOf(run, pulls);
  if (!sha) throw new Error("Can't tell which PR that game test is for, so there's no commit to answer on");
  await ctx.gh.send("POST", `/repos/${ctx.repo}/statuses/${sha}`, status);
  const what = { start: "Started", later: "Later", skip: "Skipped" }[a];
  ctx.log(`dashboard: game test ${id}${pr ? ` (#${pr})` : ""}: ${what.toLowerCase()} (${status.context} on ${sha.slice(0, 7)})`);
  return `${what}${pr ? `: the game test for #${pr}` : ""}. It picks this up within a minute`;
}

/** Stop: cancels the game test's run. */
export async function stop(ctx: Ctx, id: number): Promise<string> {
  const run = await liveRun(ctx, id, config());
  await ctx.gh.send("POST", `/repos/${ctx.repo}/actions/runs/${run.id}/cancel`);
  ctx.log(`dashboard: game test ${id} stopped (run cancelled)`);
  return "Stopping the game test";
}

const permission = (e: unknown) => {
  const m = (e as Error).message;
  return /\b403\b/.test(m) ? "The GitHub App may not read or write repository variables: give it Variables (read and write) in its settings" : m;
};

/** Settings › Game tests: the workflow's variables on the primary repo. */
export async function readVars(ctx: Ctx): Promise<{ workflow: string; repo: string; vars: GameVars | null; error: string | null }> {
  const { workflow } = install().gamingTest;
  if (!workflow) return { workflow, repo: ctx.repo, vars: null, error: null };
  try {
    const keys = Object.keys(VARS) as (keyof GameVars)[];
    const got = await Promise.all(keys.map((k) => ctx.gh.maybe<{ value: string }>(`/repos/${ctx.repo}/actions/variables/${VARS[k]}`)));
    return { workflow, repo: ctx.repo, vars: varsFrom(Object.fromEntries(keys.map((k, i) => [k, got[i]?.value]))), error: null };
  } catch (e) {
    return { workflow, repo: ctx.repo, vars: null, error: permission(e) };
  }
}

/** Saves the given variables: updated, created when missing, deleted when empty. */
export async function saveVars(ctx: Ctx, body: Record<string, unknown>): Promise<string> {
  config();
  const patch = varsPatch(body);
  if (!patch.length) return "Nothing to save";
  const base = `/repos/${ctx.repo}/actions/variables`;
  try {
    for (const { name, value } of patch) {
      if (value === null) {
        await ctx.gh.send("DELETE", `${base}/${name}`);
        continue;
      }
      const r = await ctx.gh.request("PATCH", `${base}/${name}`, { name, value });
      if (r.status === 404) {
        const c = await ctx.gh.request("POST", base, { name, value });
        if (!c.ok) throw new Error(`GitHub ${c.status} creating ${name}: ${c.text.slice(0, 200)}`);
      } else if (!r.ok) throw new Error(`GitHub ${r.status} on ${name}: ${r.text.slice(0, 200)}`);
    }
  } catch (e) {
    throw new Error(permission(e));
  }
  ctx.log(`dashboard: game test settings saved on ${ctx.repo} (${patch.map((p) => p.name).join(", ")})`);
  return "Saved: the next game test uses these";
}
