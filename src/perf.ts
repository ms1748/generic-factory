// The Performance view: how each build performed in the project's hardware tests (a test box, a build
// PC), kept in the database for as long as the owner wants (Settings › Performance; forever by default).
//
// A test run on a machine writes perf.json (version 1, from the served project's own collector) and its
// workflow uploads that file alone as an artifact named `perf-*`. The dispatcher
// lists the project's newest artifacts every 5 minutes, downloads each new `perf-*` one as the GitHub App,
// and stores it: one perf_runs row (the build, sha, PR, machine, game, timings, outcome and a summary) and
// its time series in perf_samples. Nothing on a test machine needs a factory token, so PR code never
// holds one. POST /ingest/perf (DEVICE_TOKEN, private network only) takes the same JSON for anything
// that reports by itself.
//
// Each run is compared with the previous run of the same kind, machine and game for another commit:
// startup or shutdown slower, frame rates lower, memory or CPU higher by more than the owner's limits
// are flagged. The dispatcher also sets a `factory/perf` commit status (always success, never blocking)
// that links the run's page.
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import type { Ctx } from "./dispatch.ts";
import { install } from "./install.ts";
import type { State } from "./state.ts";

// ----- perf.json --------------------------------------------------------------------------------

/** The machine-wide series perf.json may have, and their perf_samples columns. */
export const SYS: [key: string, column: string][] = [
  ["cpu", "cpu"], ["cpuClock", "cpu_clock"], ["cpuTemp", "cpu_temp"], ["cpuPower", "cpu_power"], ["acpiTemp", "acpi_temp"],
  ["mem", "mem"], ["gpu", "gpu"], ["gpuTemp", "gpu_temp"], ["gpuClock", "gpu_clock"], ["gpuMemClock", "gpu_mem_clock"],
  ["gpuPower", "gpu_power"], ["gpuFan", "gpu_fan"], ["vram", "vram"], ["diskRead", "disk_read"], ["diskWrite", "disk_write"],
  ["netRx", "net_rx"], ["netTx", "net_tx"], ["fan", "fan"],
];

export interface ProcSeries {
  cpu: (number | null)[];
  mem: (number | null)[];
  gpu: (number | null)[];
  vram: (number | null)[];
}

export interface PerfEvent {
  t: number;
  name: string;
  note?: string;
  clean?: boolean;
}

/** A perf.json, checked: known fields, sane sizes, short strings. */
export interface PerfFile {
  kind: string;
  pr: number | null;
  sha: string;
  build: string;
  version: string | null;
  runUrl: string;
  runner: string;
  host: string;
  game: string | null;
  started: string;
  finished: string;
  outcome: "pass" | "fail" | "stopped" | "broken";
  system: Record<string, string | number | null>;
  timings: { startup: number | null; shutdown: number | null; cleanExit: boolean | null; sessionWindows: number | null; crashes: number };
  crashes: { at: string; exe: string; kind: string; module: string; code: string }[];
  events: PerfEvent[];
  steps: { name: string; ok: boolean | null; ms: number }[];
  fpsNote: string | null;
  t: number[];
  sys: Record<string, (number | null)[]>;
  procs: Record<string, ProcSeries>;
  fps: Record<string, (number | null)[]>;
  fpsSummary: Record<string, { avg: number; low1: number; frames: number }>;
}

const MAX_POINTS = 6 * 3600; // six hours at one a second
/** A label from the network as an object key: never one that reaches the prototype. */
const key = (v: unknown, n: number): string => {
  const k = str(v, n);
  return ["__proto__", "constructor", "prototype"].includes(k) ? "" : k;
};
const str = (v: unknown, n = 120): string => (typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n) : "");
const num = (v: unknown, min = -1e15, max = 1e15): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : null);
const series = (v: unknown, n: number): (number | null)[] => {
  const a = Array.isArray(v) ? v : [];
  return Array.from({ length: n }, (_, i) => num(a[i]));
};
const isoOr = (v: unknown, fallback: string): string => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : fallback);

/** A perf.json from a test machine (or anywhere), checked. Throws on something that isn't one. */
export function cleanPerf(raw: unknown, now = new Date()): PerfFile {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  if (r.v !== 1) throw new Error("not a perf.json version 1");
  const t = (Array.isArray(r.t) ? r.t : []).slice(0, MAX_POINTS).map((x: unknown) => num(x, 0, 1e9) ?? 0);
  const n = t.length;
  const started = isoOr(r.started, now.toISOString());
  const sys: Record<string, (number | null)[]> = {};
  for (const [k] of SYS) if (Array.isArray(r.sys?.[k])) sys[k] = series(r.sys[k], n);
  const procs: Record<string, ProcSeries> = {};
  for (const [label, p] of Object.entries((r.procs ?? {}) as Record<string, any>).slice(0, 24)) {
    const name = key(label, 60);
    if (name) procs[name] = { cpu: series(p?.cpu, n), mem: series(p?.mem, n), gpu: series(p?.gpu, n), vram: series(p?.vram, n) };
  }
  const fps: Record<string, (number | null)[]> = {};
  for (const [label, s] of Object.entries((r.fps ?? {}) as Record<string, unknown>).slice(0, 16)) if (key(label, 60)) fps[key(label, 60)] = series(s, n);
  const fpsSummary: PerfFile["fpsSummary"] = {};
  for (const [label, s] of Object.entries((r.fpsSummary ?? {}) as Record<string, any>).slice(0, 16)) {
    const avg = num(s?.avg, 0, 10_000);
    if (key(label, 60) && avg != null) fpsSummary[key(label, 60)] = { avg, low1: num(s?.low1, 0, 10_000) ?? 0, frames: num(s?.frames, 0) ?? 0 };
  }
  const tm = r.timings ?? {};
  const system: Record<string, string | number | null> = {};
  for (const [k, v] of Object.entries((r.system ?? {}) as Record<string, unknown>).slice(0, 12)) if (key(k, 30)) system[key(k, 30)] = typeof v === "number" ? num(v) : str(v, 120) || null;
  const outcome = ["pass", "fail", "stopped", "broken"].includes(r.outcome) ? r.outcome : "broken";
  return {
    kind: str(r.kind, 20).replace(/[^\w-]/g, "") || "test",
    pr: num(r.pr, 1, 1e9) ? Math.round(r.pr) : null,
    sha: /^[0-9a-f]{7,40}$/i.test(String(r.sha ?? "")) ? String(r.sha).toLowerCase() : "",
    build: str(r.build, 80),
    version: str(r.version, 40) || null,
    runUrl: /^https:\/\/github\.com\//.test(String(r.runUrl ?? "")) ? str(r.runUrl, 200) : "",
    runner: str(r.runner, 60),
    host: str(r.host, 60),
    game: str(r.game, 80) || null,
    started,
    finished: isoOr(r.finished, started),
    outcome,
    system,
    timings: {
      startup: num(tm.startup, 0, 1e8),
      shutdown: num(tm.shutdown, 0, 1e8),
      cleanExit: typeof tm.cleanExit === "boolean" ? tm.cleanExit : null,
      sessionWindows: num(tm.sessionWindows, 0, 1e8),
      crashes: num(tm.crashes, 0, 1000) ?? 0,
    },
    crashes: (Array.isArray(r.crashes) ? r.crashes : []).slice(0, 20).map((c: any) => ({ at: isoOr(c?.at, started), exe: str(c?.exe, 80), kind: str(c?.kind, 10), module: str(c?.module, 80), code: str(c?.code, 20) })),
    events: (Array.isArray(r.events) ? r.events : []).slice(0, 200).flatMap((e: any) => {
      const name = str(e?.name, 60);
      const at = num(e?.t, 0, 1e9);
      return name && at != null ? [{ t: at, name, ...(str(e.note, 200) ? { note: str(e.note, 200) } : {}), ...(typeof e.clean === "boolean" ? { clean: e.clean } : {}) }] : [];
    }),
    steps: (Array.isArray(r.steps) ? r.steps : []).slice(0, 200).map((s: any) => ({ name: str(s?.name, 160), ok: s?.ok === true ? true : s?.ok === false ? false : null, ms: num(s?.ms, 0, 1e9) ?? 0 })),
    fpsNote: str(r.fpsNote, 200) || null,
    t,
    sys,
    procs,
    fps,
    fpsSummary,
  };
}

// ----- Summaries and comparisons ----------------------------------------------------------------

export interface Stat {
  avg: number | null;
  peak: number | null;
}

export interface Summary {
  startup: number | null;
  shutdown: number | null;
  cleanExit: boolean | null;
  crashes: number;
  sessionWindows: number | null;
  seconds: number;
  sys: Record<string, Stat>;
  /** Per app (an exe's instances together; Settings › Install `perfApp.ui` names the app's own window): average fps and 1% low. */
  fps: Record<string, { avg: number; low1: number }>;
  /** Per process line: CPU %, memory, GPU %, video memory. */
  procs: Record<string, { cpu: Stat; mem: Stat; gpu: Stat; vram: Stat }>;
}

export function stat(xs: (number | null)[]): Stat {
  const v = xs.filter((x): x is number => x != null);
  if (!v.length) return { avg: null, peak: null };
  return { avg: round(v.reduce((a, b) => a + b, 0) / v.length, 1), peak: round(Math.max(...v), 1) };
}

const round = (v: number, d = 0) => Math.round(v * 10 ** d) / 10 ** d;

/** A run's main frame rate: the first app other than the app's own window (`appUi`), else the first. */
export const mainFps = (sum: Pick<Summary, "fps">, appUi = ""): [string, { avg: number; low1: number }] | undefined =>
  Object.entries(sum.fps).find(([k]) => k !== appUi) ?? Object.entries(sum.fps)[0];

/** "Game (1234)" → "Game". */
export const appOf = (label: string) => label.replace(/\s*\(\d+\)$/, "").replace(/\s+#\d+$/, "");

/** One run's numbers for the list and the comparison. */
export function summarize(p: PerfFile): Summary {
  const sys: Record<string, Stat> = {};
  for (const [k, s] of Object.entries(p.sys)) sys[k] = stat(s);
  const fps: Summary["fps"] = {};
  const groups = new Map<string, { avg: number; low1: number }[]>();
  for (const [label, s] of Object.entries(p.fps)) {
    const known = p.fpsSummary[label];
    const v = s.filter((x): x is number => x != null && x > 0).sort((a, b) => a - b);
    const one = known ? { avg: round(known.avg, 1), low1: round(known.low1, 1) } : v.length ? { avg: round(v.reduce((a, b) => a + b, 0) / v.length, 1), low1: v[Math.floor(v.length * 0.01)] } : null;
    if (one) groups.set(appOf(label), [...(groups.get(appOf(label)) ?? []), one]);
  }
  for (const [app, list] of groups) fps[app] = { avg: round(list.reduce((a, b) => a + b.avg, 0) / list.length, 1), low1: round(Math.min(...list.map((x) => x.low1)), 1) };
  const procs: Summary["procs"] = {};
  for (const [label, s] of Object.entries(p.procs)) procs[label] = { cpu: stat(s.cpu), mem: stat(s.mem), gpu: stat(s.gpu), vram: stat(s.vram) };
  return {
    startup: p.timings.startup,
    shutdown: p.timings.shutdown,
    cleanExit: p.timings.cleanExit,
    crashes: p.timings.crashes,
    sessionWindows: p.timings.sessionWindows,
    seconds: Math.round((Date.parse(p.finished) - Date.parse(p.started)) / 1000),
    sys,
    fps,
    procs,
  };
}

export interface PerfSettings {
  /** Days to keep each run's time series (0 = forever). Runs and their summaries are always kept. */
  keepDays: number;
  /** Flag startup or shutdown this much slower (percent). */
  timePct: number;
  /** Flag frame rates this much lower (percent). */
  fpsPct: number;
  /** Flag memory or CPU this much higher (percent). */
  usePct: number;
  /** Set the `factory/perf` commit status (success, linking the run). */
  status: boolean;
}

export const DEFAULT_SETTINGS: PerfSettings = { keepDays: 0, timePct: 20, fpsPct: 10, usePct: 20, status: true };

export function perfSettings(raw: unknown): PerfSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pick = (k: keyof PerfSettings, min: number, max: number) => {
    const v = Number(r[k]);
    return Number.isFinite(v) && v >= min && v <= max ? Math.round(v) : (DEFAULT_SETTINGS[k] as number);
  };
  return { keepDays: pick("keepDays", 0, 3650), timePct: pick("timePct", 1, 500), fpsPct: pick("fpsPct", 1, 100), usePct: pick("usePct", 1, 500), status: r.status === undefined ? DEFAULT_SETTINGS.status : r.status === true };
}

export interface Change {
  /** What changed, in words ("Startup", "Game fps", "App memory"). */
  what: string;
  now: number;
  before: number;
  /** Percent, signed (+ is more). */
  pct: number;
  /** A regression (worse), else an improvement. */
  bad: boolean;
  unit: "ms" | "fps" | "bytes" | "%" | "count";
}

/**
 * What changed from `prev` to `cur` beyond the owner's limits (and a floor, so noise on tiny numbers isn't
 * flagged): startup and shutdown time, each app's frame rate and 1% low, the app's memory and CPU, crashes
 * and a clean exit.
 */
export function compare(cur: Summary, prev: Summary, s: PerfSettings = DEFAULT_SETTINGS): Change[] {
  const out: Change[] = [];
  const check = (what: string, now: number | null | undefined, before: number | null | undefined, limit: number, floor: number, higherIsBad: boolean, unit: Change["unit"]) => {
    if (now == null || before == null || before <= 0) return;
    const pct = ((now - before) / before) * 100;
    if (Math.abs(pct) < limit || Math.abs(now - before) < floor) return;
    out.push({ what, now, before, pct: round(pct, 1), bad: higherIsBad ? now > before : now < before, unit });
  };
  check("Startup", cur.startup, prev.startup, s.timePct, 250, true, "ms");
  check("Shutdown", cur.shutdown, prev.shutdown, s.timePct, 250, true, "ms");
  check("Game windows up", cur.sessionWindows, prev.sessionWindows, s.timePct, 1000, true, "ms");
  for (const [app, f] of Object.entries(cur.fps)) {
    const b = prev.fps[app];
    if (!b) continue;
    check(`${app} fps`, f.avg, b.avg, s.fpsPct, 2, false, "fps");
    check(`${app} 1% low`, f.low1, b.low1, s.fpsPct, 2, false, "fps");
  }
  for (const [label, p] of Object.entries(cur.procs)) {
    const b = prev.procs[label];
    if (!b || /#\d+$/.test(label)) continue;
    check(`${label} memory`, p.mem.peak, b.mem.peak, s.usePct, 50 * 1024 * 1024, true, "bytes");
    check(`${label} CPU`, p.cpu.avg, b.cpu.avg, s.usePct, 2, true, "%");
  }
  if (cur.crashes > prev.crashes) out.push({ what: "Crashes", now: cur.crashes, before: prev.crashes, pct: 100, bad: true, unit: "count" });
  if (cur.cleanExit === false && prev.cleanExit === true) out.push({ what: "Clean exit", now: 0, before: 1, pct: -100, bad: true, unit: "count" });
  return out;
}

/** One line for the commit status (at most 140 characters). */
export function statusLine(sum: Summary, changes: Change[], prevBuild: string | null, appUi = install().perfApp.ui): string {
  const parts: string[] = [];
  if (sum.startup != null) parts.push(`startup ${(sum.startup / 1000).toFixed(1)} s`);
  const fps = mainFps(sum, appUi);
  if (fps) parts.push(`${fps[1].avg} fps`);
  const bad = changes.filter((c) => c.bad);
  const vs = prevBuild ? ` vs ${prevBuild.replace(/^.*-(v\d+)$/, "$1")}` : "";
  const tail = !prevBuild ? "first run here" : bad.length ? `${bad.length} worse${vs}: ${bad.map((c) => `${c.what} ${c.pct > 0 ? "+" : ""}${Math.round(c.pct)}%`).join(", ")}` : `nothing worse${vs}`;
  const line = `${parts.join(", ")}${parts.length ? "; " : ""}${tail}`;
  return line.length > 140 ? `${line.slice(0, 137)}...` : line;
}

/** Evenly averaged down to at most `max` points (for the page's charts). Pure. */
export function downsample(t: number[], cols: Record<string, (number | null)[]>, max = 600): { t: number[]; cols: Record<string, (number | null)[]> } {
  if (t.length <= max) return { t, cols };
  const size = Math.ceil(t.length / max);
  const nt: number[] = [];
  const out: Record<string, (number | null)[]> = Object.fromEntries(Object.keys(cols).map((k) => [k, []]));
  for (let i = 0; i < t.length; i += size) {
    nt.push(t[i]);
    for (const [k, s] of Object.entries(cols)) {
      const v = s.slice(i, i + size).filter((x): x is number => x != null);
      out[k].push(v.length ? round(v.reduce((a, b) => a + b, 0) / v.length, 1) : null);
    }
  }
  return { t: nt, cols: out };
}

// ----- Artifacts --------------------------------------------------------------------------------

/** A file from a zip (stored or deflated), by its name anywhere in the zip; undefined if it isn't there. Pure. */
export function readZip(zip: Buffer, name: string): Buffer | undefined {
  // The end of central directory record: the last "PK\x05\x06" (a comment may follow it).
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65_535); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip");
  const count = zip.readUInt16LE(eocd + 10);
  let at = zip.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error("broken zip directory");
    const method = zip.readUInt16LE(at + 10);
    const size = zip.readUInt32LE(at + 20);
    const nameLen = zip.readUInt16LE(at + 28);
    const extra = zip.readUInt16LE(at + 30);
    const comment = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const file = zip.subarray(at + 46, at + 46 + nameLen).toString("utf8");
    at += 46 + nameLen + extra + comment;
    if (file !== name && !file.endsWith(`/${name}`)) continue;
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(start, start + size);
    if (method === 0) return Buffer.from(data);
    if (method === 8) return inflateRawSync(data, { maxOutputLength: 200 * 1024 * 1024 });
    throw new Error(`zip method ${method} isn't supported`);
  }
  return undefined;
}

/** The machine a run was on: the install's machine whose runner it was, else its PC name. */
export function machineFor(runner: string, host: string, machines = install().machines): string {
  const m = machines.find((x) => x.runner && x.runner === runner);
  if (m) return m.name;
  return (host || runner || "unknown").toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 31);
}

// ----- The store and the pull -------------------------------------------------------------------

export interface RunRow {
  id: number;
  repo: string;
  kind: string;
  machine: string;
  pr: number | null;
  sha: string;
  build: string;
  version: string | null;
  game: string | null;
  started_at: string;
  finished_at: string;
  outcome: string;
  startup_ms: number | null;
  shutdown_ms: number | null;
  clean_exit: number | null;
  crashes: number;
  summary: string;
  meta: string;
  source: string;
  run_url: string;
  at: string;
}

/** The run before `r` to compare with: same repo, kind, machine and game, another commit, not broken. */
export function previous(r: Pick<RunRow, "id" | "repo" | "kind" | "machine" | "game" | "sha" | "started_at">, all: RunRow[]): RunRow | undefined {
  return all
    .filter((x) => x.id !== r.id && x.repo === r.repo && x.kind === r.kind && x.machine === r.machine && (x.game ?? "") === (r.game ?? "") && x.started_at < r.started_at && x.outcome !== "broken" && (!r.sha || x.sha !== r.sha))
    .sort((a, b) => b.started_at.localeCompare(a.started_at))[0];
}

export class Perf {
  private state: State;
  private log: (line: string) => void;
  /** The last pull, for the page. */
  last: { at: string; added: number; error: string | null } | null = null;
  /** Set by the serve loop: pulls every served project now. */
  pullAll: () => Promise<string> = async () => "no projects";

  constructor(state: State, log: (line: string) => void) {
    this.state = state;
    this.log = log;
  }

  settings(): PerfSettings {
    return perfSettings(this.state.perfSettings());
  }

  setSettings(raw: unknown): PerfSettings {
    const s = perfSettings({ ...this.settings(), ...(raw && typeof raw === "object" ? raw : {}) });
    this.state.setPerfSettings(s);
    this.prune();
    return s;
  }

  /** Stores one perf.json; returns the new run's id, or the existing one for a source seen before. */
  ingest(raw: unknown, o: { repo: string; source?: string; runUrl?: string }): { id: number; fresh: boolean } {
    const p = cleanPerf(raw);
    const source = o.source ?? `push:${createHash("sha256").update(JSON.stringify(raw)).digest("hex").slice(0, 32)}`;
    const seen = this.state.perfSource(source);
    if (seen?.run_id) return { id: seen.run_id, fresh: false };
    const sum = summarize(p);
    const id = this.state.addPerfRun({
      repo: o.repo,
      kind: p.kind,
      machine: machineFor(p.runner, p.host),
      pr: p.pr,
      sha: p.sha,
      build: p.build,
      version: p.version,
      game: p.game,
      started_at: p.started,
      finished_at: p.finished,
      outcome: p.outcome,
      startup_ms: p.timings.startup,
      shutdown_ms: p.timings.shutdown,
      clean_exit: p.timings.cleanExit == null ? null : p.timings.cleanExit ? 1 : 0,
      crashes: p.timings.crashes,
      summary: JSON.stringify(sum),
      meta: JSON.stringify({ system: p.system, events: p.events, steps: p.steps, crashes: p.crashes, fpsNote: p.fpsNote, runner: p.runner, host: p.host, sessionWindows: p.timings.sessionWindows }),
      source,
      run_url: p.runUrl || o.runUrl || "",
      at: new Date().toISOString(),
    }, p);
    this.state.markPerfSource(source, id, null);
    return { id, fresh: true };
  }

  /** Drops time series older than Settings › Performance keeps (runs stay). */
  prune(now = Date.now()): number {
    const days = this.settings().keepDays;
    return days ? this.state.prunePerfSamples(new Date(now - days * 86400_000).toISOString()) : 0;
  }

  /** Reads the project's new `perf-*` artifacts into the database. Returns how many runs were added. */
  async pull(ctx: Ctx): Promise<number> {
    const { gh, repo } = ctx;
    type A = { id: number; name: string; size_in_bytes: number; expired: boolean; workflow_run?: { id: number } | null };
    const list = (await gh.get<{ artifacts: A[] }>(`/repos/${repo}/actions/artifacts?per_page=100`)).artifacts;
    let added = 0;
    for (const a of list) {
      if (!a.name.startsWith("perf-") || a.expired) continue;
      const source = `artifact:${repo}:${a.id}`;
      if (this.state.perfSource(source)) continue;
      const runUrl = a.workflow_run?.id ? `https://github.com/${repo}/actions/runs/${a.workflow_run.id}` : "";
      try {
        if (a.size_in_bytes > 50 * 1024 * 1024) throw new Error(`too big (${a.size_in_bytes} bytes)`);
        const zip = await gh.bytes(`/repos/${repo}/actions/artifacts/${a.id}/zip`);
        if (!zip) throw new Error("GitHub didn't hand over the artifact (does the app have Actions: read?)");
        const file = readZip(zip, "perf.json");
        if (!file) throw new Error("no perf.json in it");
        const { id, fresh } = this.ingest(JSON.parse(file.toString("utf8")), { repo, source, runUrl });
        if (fresh) {
          added++;
          this.log(`perf: ${a.name} stored as run ${id}`);
          await this.postStatus(ctx, id).catch((e: Error) => this.log(`perf: status for run ${id}: ${e.message}`));
        }
      } catch (e) {
        this.state.markPerfSource(source, null, (e as Error).message.slice(0, 200));
        this.log(`perf: ${a.name}: ${(e as Error).message}`);
      }
    }
    this.prune();
    return added;
  }

  /** The `factory/perf` commit status for a run: success always, with the numbers and what got worse. */
  async postStatus(ctx: Ctx, id: number): Promise<void> {
    const base = install().dashboardUrl;
    const v = this.run(id);
    if (!v || !this.settings().status || !base || !v.run.sha || !v.run.pr) return;
    await ctx.gh.send("POST", `/repos/${ctx.repo}/statuses/${v.run.sha}`, {
      state: "success",
      context: "factory/perf",
      description: statusLine(v.summary, v.changes, v.prev?.build ?? null),
      target_url: `${base}/#/perf/${v.run.id}`,
    });
  }

  private rows(): RunRow[] {
    return this.state.perfRuns();
  }

  /** The list for the Performance view: newest first, each with its changes since the run before. */
  view(filter: { kind?: string; machine?: string; build?: string } = {}) {
    const all = this.rows();
    const rows = all
      .filter((r) => (!filter.kind || r.kind === filter.kind) && (!filter.machine || r.machine === filter.machine) && (!filter.build || r.build === filter.build || String(r.pr) === filter.build))
      .slice(0, 300);
    const s = this.settings();
    return {
      runs: rows.map((r) => {
        const sum = JSON.parse(r.summary) as Summary;
        const prev = previous(r, all);
        return { ...brief(r), summary: sum, prev: prev ? { id: prev.id, build: prev.build, sha: prev.sha } : null, changes: prev ? compare(sum, JSON.parse(prev.summary) as Summary, s) : [] };
      }),
      kinds: [...new Set(all.map((r) => r.kind))].sort(),
      machines: [...new Set(all.map((r) => r.machine))].sort(),
      settings: s,
      app: install().perfApp,
      last: this.last,
      total: all.length,
    };
  }

  /** One run's page: its summary, changes, events and (downsampled) charts. */
  run(id: number) {
    const all = this.rows();
    const r = all.find((x) => x.id === id);
    if (!r) return undefined;
    const summary = JSON.parse(r.summary) as Summary;
    const prev = previous(r, all);
    const prevSummary = prev ? (JSON.parse(prev.summary) as Summary) : null;
    const samples = this.state.perfSamples(id);
    const cols: Record<string, (number | null)[]> = {};
    for (const [k] of SYS) {
      const s = samples.map((x) => x.sys[k] ?? null);
      if (s.some((v) => v != null)) cols[`sys.${k}`] = s;
    }
    for (const x of samples.flatMap((s) => Object.keys(s.procs))) {
      if (cols[`proc.${x}.cpu`]) continue;
      for (const m of ["cpu", "mem", "gpu", "vram"] as const) cols[`proc.${x}.${m}`] = samples.map((s) => s.procs[x]?.[m] ?? null);
    }
    for (const x of samples.flatMap((s) => Object.keys(s.fps))) cols[`fps.${x}`] ??= samples.map((s) => s.fps[x] ?? null);
    const ds = downsample(samples.map((s) => s.t), cols);
    return {
      run: brief(r),
      meta: JSON.parse(r.meta),
      summary,
      prev: prev ? { ...brief(prev), summary: prevSummary } : null,
      changes: prevSummary ? compare(summary, prevSummary, this.settings()) : [],
      chart: { t: ds.t, ...ds.cols } as Record<string, (number | null)[]>,
      samples: samples.length,
      app: install().perfApp,
    };
  }
}

function brief(r: RunRow) {
  return {
    id: r.id, repo: r.repo, kind: r.kind, machine: r.machine, pr: r.pr, sha: r.sha, build: r.build, version: r.version, game: r.game,
    started: r.started_at, finished: r.finished_at, outcome: r.outcome, startup: r.startup_ms, shutdown: r.shutdown_ms,
    cleanExit: r.clean_exit == null ? null : r.clean_exit === 1, crashes: r.crashes, runUrl: r.run_url,
  };
}
