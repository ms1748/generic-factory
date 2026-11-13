// The Devices view: each test machine as CI sees it, so the owner never needs a remote desktop to check on
// tests. The machines are Settings › Install › Machines with a runner name or labels. For each machine: online (from Systems: its reporter or CI guard), the job it's running
// now with every step live, the jobs queued for it, and its last results with their artifacts (screenshots,
// logs, test builds). Read from the jobs of the project's recent workflow runs (the app can't list runners
// without admin), cached for 15 s.
import type { Ctx } from "./dispatch.ts";
import { gameTests, isGameRun, needsPulls, type ApiRun, type GameTest, type OpenPull } from "./gaming.ts";
import { install, type Machine } from "./install.ts";

/** The CI machines: those with a runner name or labels. */
export const ciMachines = (all: Machine[] = install().machines): Machine[] => all.filter((m) => m.runner || m.labels.length);

/** Labels every self-hosted runner has, so they don't pick a machine. */
const GENERIC = new Set(["self-hosted", "windows", "x64", "linux"]);

export interface ApiStep {
  name: string;
  status: string;
  conclusion: string | null;
  number: number;
  started_at?: string | null;
  completed_at?: string | null;
}

export interface ApiJob {
  id: number;
  run_id: number;
  name: string;
  status: string;
  conclusion: string | null;
  labels: string[];
  runner_name: string | null;
  html_url: string;
  head_branch?: string;
  created_at?: string;
  started_at?: string | null;
  completed_at?: string | null;
  steps?: ApiStep[];
}

export interface Artifact {
  name: string;
  size: number;
  url: string;
  expired: boolean;
}

export interface JobView {
  id: number;
  run: number;
  name: string;
  branch: string | null;
  status: string;
  conclusion: string | null;
  url: string;
  at: string | null;
  steps: { name: string; status: string; conclusion: string | null; seconds: number | null }[];
  artifacts: Artifact[];
}

/** Which machine a job is for: the one it ran on, else the one its labels pick (for queued jobs). */
export function machineOf(j: Pick<ApiJob, "runner_name" | "labels">, machines = ciMachines()): string | null {
  const ran = machines.find((m) => m.runner === j.runner_name);
  if (ran) return ran.name;
  const wanted = j.labels.map((l) => l.toLowerCase()).filter((l) => !GENERIC.has(l));
  if (!wanted.length || !j.labels.some((l) => l.toLowerCase() === "self-hosted")) return null;
  return machines.find((m) => m.labels.length && wanted.every((l) => m.labels.includes(l)))?.name ?? null;
}

const seconds = (a?: string | null, b?: string | null) => (a && b ? Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 1000)) : null);

export function jobView(j: ApiJob, artifacts: Artifact[] = []): JobView {
  return {
    id: j.id,
    run: j.run_id,
    name: j.name,
    branch: j.head_branch ?? null,
    status: j.status,
    conclusion: j.conclusion,
    url: j.html_url,
    at: j.started_at ?? j.created_at ?? null,
    steps: (j.steps ?? [])
      .filter((s) => !/^(Set up job|Complete job|Post )/.test(s.name))
      .map((s) => ({ name: s.name, status: s.status, conclusion: s.conclusion, seconds: seconds(s.started_at, s.completed_at ?? (s.status === "in_progress" ? new Date().toISOString() : null)) })),
    artifacts,
  };
}

export interface MachineView {
  name: string;
  role: string;
  now: JobView[];
  queue: JobView[];
  recent: JobView[];
}

/** Groups jobs by machine: running now, queued, and the last few finished ones. Pure. */
export function byMachine(jobs: ApiJob[], artifactsOf: (run: number) => Artifact[], recentN = 5, machines = ciMachines()): MachineView[] {
  return machines.map((m) => {
    const mine = jobs.filter((j) => machineOf(j, machines) === m.name);
    const done = mine.filter((j) => j.status === "completed" && j.conclusion !== "skipped").sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""));
    return {
      name: m.name,
      role: m.role,
      now: mine.filter((j) => j.status === "in_progress").map((j) => jobView(j)),
      queue: mine.filter((j) => j.status === "queued" || j.status === "waiting" || j.status === "pending").sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? "")).map((j) => jobView(j)),
      recent: done.slice(0, recentN).map((j) => jobView(j, artifactsOf(j.run_id))),
    };
  });
}

export interface DevicesView {
  machines: MachineView[];
  /** Game tests in progress (src/gaming.ts); each names its machine, or null when none matches. */
  games: GameTest[];
  error: string | null;
}

let cache: { at: number; repo: string; view: DevicesView } | undefined;

/** Forgets the cached view, so the next read shows a change made from the dashboard. */
export const freshDevices = (): void => void (cache = undefined);

/** The Devices view for the dashboard (GET /api/devices). */
export async function devicesView(ctx: Ctx, now = Date.now()): Promise<DevicesView> {
  if (cache && cache.repo === ctx.repo && now - cache.at < 15_000) return cache.view;
  if (!ciMachines().length && !install().gamingTest.workflow) return { machines: [], games: [], error: null };
  const { gh, repo } = ctx;
  try {
    const list = async (q: string) => (await gh.get<{ workflow_runs: ApiRun[] }>(`/repos/${repo}/actions/runs?${q}`)).workflow_runs;
    // The game-test workflow's own runs too: on a busy repo it can be past the first 10 in progress.
    const { workflow } = install().gamingTest;
    const games = workflow ? (await gh.get<{ workflow_runs: ApiRun[] }>(`/repos/${repo}/actions/workflows/${encodeURIComponent(workflow)}/runs?status=in_progress&per_page=10`).catch(() => ({ workflow_runs: [] }))).workflow_runs : [];
    const runs = [...(await list("status=in_progress&per_page=10")), ...games, ...(await list("status=queued&per_page=10")), ...(await list("status=completed&per_page=12"))];
    const ids = [...new Set(runs.map((r) => r.id))];
    const jobs = (await Promise.all(ids.map((id) => gh.get<{ jobs: ApiJob[] }>(`/repos/${repo}/actions/runs/${id}/jobs?per_page=50`).then((r) => r.jobs).catch(() => [])))).flat();
    // Artifacts only for the finished runs the view shows.
    const shown = new Set(byMachine(jobs, () => []).flatMap((m) => m.recent.map((j) => j.run)));
    const arts = new Map<number, Artifact[]>();
    await Promise.all(
      [...shown].map(async (id) => {
        const a = await gh.get<{ artifacts: { name: string; size_in_bytes: number; expired: boolean; id: number }[] }>(`/repos/${repo}/actions/runs/${id}/artifacts`).catch(() => ({ artifacts: [] }));
        arts.set(id, a.artifacts.map((x) => ({ name: x.name, size: x.size_in_bytes, expired: x.expired, url: `https://github.com/${repo}/actions/runs/${id}/artifacts/${x.id}` })));
      }),
    );
    const pulls = runs.some((r) => r.status === "in_progress" && isGameRun(r, workflow) && needsPulls(r)) ? await gh.all<OpenPull>(`/repos/${repo}/pulls?state=open&per_page=100`).catch(() => []) : [];
    const view = { machines: byMachine(jobs, (id) => arts.get(id) ?? []), games: gameTests(runs, jobs, pulls), error: null };
    cache = { at: now, repo, view };
    return view;
  } catch (e) {
    return { machines: ciMachines().map((m) => ({ name: m.name, role: m.role, now: [], queue: [], recent: [] })), games: [], error: (e as Error).message };
  }
}

/** The same as text, for `node src/main.ts devices`. */
export function devicesText(v: { machines: MachineView[]; games?: GameTest[]; error: string | null }): string {
  const out: string[] = [];
  if (v.error) out.push(`(couldn't read CI: ${v.error})`);
  for (const g of v.games ?? []) out.push(`game test${g.pr ? ` for #${g.pr}` : ""} on ${g.machine ?? "?"}: ${g.state === "waiting" ? "waiting for Start" : `running (${g.step ?? "?"})`}`);
  for (const m of v.machines) {
    out.push(`${m.name}  ${m.role}`);
    for (const j of m.now) {
      out.push(`  running  ${j.name} (${j.branch ?? "?"})`);
      for (const s of j.steps) out.push(`    ${s.status === "completed" ? (s.conclusion === "success" ? "✓" : s.conclusion === "skipped" ? "-" : "✗") : s.status === "in_progress" ? "▶" : "·"} ${s.name}${s.seconds != null ? ` ${s.seconds}s` : ""}`);
    }
    if (!m.now.length) out.push("  idle");
    for (const j of m.queue) out.push(`  queued   ${j.name} (${j.branch ?? "?"})`);
    for (const j of m.recent.slice(0, 3)) out.push(`  last     ${j.conclusion === "success" ? "✓" : "✗"} ${j.name} (${j.branch ?? "?"})`);
  }
  return out.join("\n");
}
