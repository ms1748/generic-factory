// The Systems view: the owner's machines and the website, next to the factory. Which machines there are,
// their roles and the addresses checked come from Settings › Install (src/install.ts); every part is optional.
//
// Machines report in two ways, merged per machine name:
// - push: a reporter on the machine (machines/reporters/report-windows.ps1, machines/reporters/report-linux.sh) POSTs
//   /ingest/device/<name> every minute with DEVICE_TOKEN. The route is for the private network only
//   (Access guards the tunnel).
// - pull: the Proxmox API (PVE_URL + PVE_TOKEN, a read-only PVEAuditor token) gives the factory host's CPU,
//   memory, storage and every container and VM, under the install's host name.
// The website: Cloudflare's GraphQL Analytics API (CF_API_TOKEN with Account Analytics + Zone Analytics read,
// CF_ACCOUNT_ID, CF_ZONE_ID) for traffic, Functions requests against the free 100k/day, and R2 storage and
// operations against the free tier; plus plain HTTP checks of the install's uptime addresses (a latest.json
// among them also shows the version it offers).
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { request } from "node:https";
import { conditions, diff, discord, settingsFrom, WEBHOOK, type AlertSettings, type QueueFact } from "./alerts.ts";
import type { DeviceEvent, Sample, State } from "./state.ts";
import { install, type Machine } from "./install.ts";

export interface Disk {
  mount: string;
  used: number;
  total: number;
}

export interface Guest {
  id: number;
  name: string;
  type: "lxc" | "qemu";
  status: string;
  cpu: number | null;
  mem: number | null;
  memTotal: number | null;
  uptime: number | null;
}

export interface Gpu {
  name: string;
  util: number | null;
  temp: number | null;
  memUsed: number | null;
  memTotal: number | null;
  /** Fan %, power W, core clock MHz (nvidia-smi); null where the card doesn't say. */
  fan?: number | null;
  power?: number | null;
  clock?: number | null;
}

/** CPU and board sensors (LibreHardwareMonitor, where the machine has it: machines/reporters/setup-lhm.ps1). */
export interface Sensors {
  /** °C: the package (Tctl/Tdie on AMD, Package on Intel). */
  cpuTemp: number | null;
  /** °C per CCD (AMD). */
  ccdTemps: number[];
  /** W, the CPU package. */
  cpuPower: number | null;
  /** MHz, the cores' average. */
  cpuClock: number | null;
  fans: { name: string; rpm: number }[];
}

/** What a machine says about itself; every field optional, all checked by cleanReport. */
export interface Report {
  os?: string;
  model?: string;
  cpuModel?: string;
  cores?: number;
  /** 0..1 */
  cpu?: number;
  load?: number[];
  memUsed?: number;
  memTotal?: number;
  disks?: Disk[];
  /** seconds */
  uptime?: number;
  /** °C, the hottest sensor */
  temp?: number;
  gpu?: Gpu;
  /** bytes per second */
  net?: { rx: number; tx: number };
  guests?: Guest[];
  /** Short facts for the card (controllers connected, test builds present, ...). */
  facts?: Record<string, string>;
  /** Docker containers on the machine (the factory's host), from `docker stats`. */
  containers?: Container[];
  sensors?: Sensors;
}

export interface Container {
  name: string;
  /** cores' worth: 1 = one full core */
  cpu: number | null;
  mem: number | null;
  memLimit: number | null;
  /** total bytes in + out since the container started */
  net: number | null;
  /** total bytes read + written */
  block: number | null;
}

/** The machines the install knows (Settings › Install › Machines). Anything else that reports shows too. */
const known = (): Machine[] => install().machines;
const machine = (name: string) => known().find((m) => m.name === name);

/** A game guard's last check-in. */
export interface Guard {
  /** "running": CI jobs run; "paused": no new job starts (a running one goes at idle priority). */
  state: "running" | "paused";
  /** Why it's paused: "owner" (the dashboard), "game" (a game is running), or "" while running. */
  why: string;
  /** The game's process name, when that's why. */
  game: string | null;
  /** A job was running at the check. */
  busy: boolean;
  at: string;
}

/** A guard's report, trimmed to what the card shows. */
export function cleanGuard(raw: unknown, now: Date): Guard {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/[^\w .()-]/g, "").slice(0, n) : "");
  return {
    state: r.state === "paused" ? "paused" : "running",
    why: ["owner", "game"].includes(String(r.why)) ? String(r.why) : "",
    game: str(r.game, 64) || null,
    busy: r.busy === true,
    at: now.toISOString(),
  };
}

/**
 * How many threads CI builds may use on a machine (CARGO_BUILD_JOBS), set on its card. The guard hands it to
 * each job through a file next to its ci-paused flag (ci-jobs); the project's CI reads it at the build step.
 */
export interface CiThreads {
  /** Every build, unless a PR asks otherwise. */
  default: number;
  /** While the owner plays (the guard sees a game): null pauses CI (new jobs wait), a number lets builds go on with that many. */
  gaming: number | null;
  /** The most a PR may ask for (a `build-threads:N` label or a "Build threads: N" line in its body). */
  max: number;
}

/** Until the owner saves some: 6 threads and paused while gaming (the behaviour before the card); PRs may ask for up to 12. */
export const CI_THREADS: CiThreads = { default: 6, gaming: null, max: 12 };
const MAX_THREADS = 64;

/** Saved or posted thread settings, kept to whole numbers from 1 to 64; anything missing or bad keeps the default. */
export function ciThreadsFrom(raw: unknown): CiThreads {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const n = (v: unknown): number | undefined => {
    const x = typeof v === "string" && v.trim() ? Number(v) : v;
    return typeof x === "number" && Number.isInteger(x) && x >= 1 && x <= MAX_THREADS ? x : undefined;
  };
  return {
    default: n(r.default) ?? CI_THREADS.default,
    gaming: r.gaming === null || r.gaming === "pause" || r.gaming === "" ? null : (n(r.gaming) ?? CI_THREADS.gaming),
    max: n(r.max) ?? CI_THREADS.max,
  };
}

/** What the card shows for CI on a machine, or null when it has no guard and was never paused. */
export function ciView(g: Guard | undefined, owner: boolean, now: number, threads: CiThreads = CI_THREADS) {
  if (!g && !owner) return null;
  const fresh = Boolean(g && now - Date.parse(g.at) < OFFLINE_MS);
  return { owner, guard: fresh ? g : null, lastCheck: g?.at ?? null, threads };
}

const OFFLINE_MS = 3 * 60_000;
const num = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : undefined;
const str = (v: unknown, n = 120): string | undefined => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : undefined);
const nul = (v: number | undefined) => (v === undefined ? null : v);

/** A report from the network, kept to known fields, sane ranges and short strings. */
export function cleanReport(raw: unknown): Report {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const out: Report = {};
  const set = <K extends keyof Report>(k: K, v: Report[K] | undefined) => {
    if (v !== undefined) out[k] = v;
  };
  set("os", str(r.os));
  set("model", str(r.model));
  set("cpuModel", str(r.cpuModel));
  set("cores", num(r.cores, 1, 1024));
  set("cpu", num(r.cpu, 0, 1));
  if (Array.isArray(r.load)) set("load", r.load.slice(0, 3).map((x: unknown) => num(x, 0, 10_000) ?? 0));
  set("memUsed", num(r.memUsed));
  set("memTotal", num(r.memTotal));
  if (Array.isArray(r.disks)) {
    set("disks", r.disks.slice(0, 16).flatMap((d: any) => {
      const total = num(d?.total);
      return total ? [{ mount: str(d.mount, 40) ?? "?", used: num(d.used, 0, total) ?? 0, total }] : [];
    }));
  }
  set("uptime", num(r.uptime));
  set("temp", num(r.temp, -40, 150));
  if (r.gpu && typeof r.gpu === "object" && str(r.gpu.name)) {
    set("gpu", {
      name: str(r.gpu.name)!, util: nul(num(r.gpu.util, 0, 1)), temp: nul(num(r.gpu.temp, -40, 150)), memUsed: nul(num(r.gpu.memUsed)), memTotal: nul(num(r.gpu.memTotal)),
      fan: nul(num(r.gpu.fan, 0, 100)), power: nul(num(r.gpu.power, 0, 2000)), clock: nul(num(r.gpu.clock, 0, 10_000)),
    });
  }
  if (r.net && typeof r.net === "object") set("net", { rx: num(r.net.rx) ?? 0, tx: num(r.net.tx) ?? 0 });
  if (Array.isArray(r.guests)) {
    set("guests", r.guests.slice(0, 64).flatMap((g: any) => {
      const id = num(g?.id, 0, 1e9);
      return id === undefined ? [] : [{
        id, name: str(g.name, 60) ?? String(id), type: g.type === "qemu" ? "qemu" : "lxc", status: str(g.status, 20) ?? "unknown",
        cpu: nul(num(g.cpu, 0, 1)), mem: nul(num(g.mem)), memTotal: nul(num(g.memTotal)), uptime: nul(num(g.uptime)),
      } as Guest];
    }));
  }
  if (Array.isArray(r.containers)) {
    set("containers", r.containers.slice(0, 64).flatMap((c: any) => {
      const name = str(c?.name, 80);
      return name ? [{ name, cpu: nul(num(c.cpu, 0, 64)), mem: nul(num(c.mem)), memLimit: nul(num(c.memLimit)), net: nul(num(c.net)), block: nul(num(c.block)) } as Container] : [];
    }));
  }
  if (r.sensors && typeof r.sensors === "object") {
    const x = r.sensors;
    set("sensors", {
      cpuTemp: nul(num(x.cpuTemp, -40, 150)),
      ccdTemps: (Array.isArray(x.ccdTemps) ? x.ccdTemps : []).slice(0, 16).map((v: unknown) => num(v, -40, 150)).filter((v: number | undefined): v is number => v !== undefined),
      cpuPower: nul(num(x.cpuPower, 0, 2000)),
      cpuClock: nul(num(x.cpuClock, 0, 10_000)),
      fans: (Array.isArray(x.fans) ? x.fans : []).slice(0, 16).flatMap((f: any) => {
        const rpm = num(f?.rpm, 0, 50_000);
        return rpm === undefined ? [] : [{ name: str(f.name, 40) ?? "Fan", rpm }];
      }),
    });
  }
  if (r.facts && typeof r.facts === "object") {
    const facts: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.facts).slice(0, 12)) {
      const key = str(k, 40);
      const val = typeof v === "number" ? String(v) : str(v, 80);
      if (key && val) facts[key] = val;
    }
    set("facts", facts);
  }
  return out;
}

/** Windows event IDs the reporters send, and what each means. */
export const BOOT_EVENTS: Record<number, string> = { 6005: "started", 6006: "shut down", 6008: "stopped unexpectedly", 41: "lost power or crashed", 1074: "restart or shutdown asked for" };

/** A report's boot and shutdown events (machines/reporters/report-windows.ps1), checked; at most 50. */
export function cleanEvents(raw: unknown): DeviceEvent[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 50).flatMap((e: any) => {
    const id = Number(e?.id);
    const at = typeof e?.at === "string" && !Number.isNaN(Date.parse(e.at)) ? new Date(e.at).toISOString() : null;
    if (!at || !BOOT_EVENTS[id]) return [];
    return [{ at, id, kind: BOOT_EVENTS[id], reason: (str(e.reason, 300) ?? "").replace(/\s+/g, " ") }];
  });
}

/** The fraction of the fullest disk, or null. */
export function fullest(disks: Disk[] | undefined): number | null {
  if (!disks?.length) return null;
  return Math.max(...disks.map((d) => (d.total ? d.used / d.total : 0)));
}

/** History points averaged into buckets of `minutes`, oldest first. */
const FIELDS = ["cpu", "mem", "disk", "temp", "net", "gpu", "gpuTemp", "gpuPower", "cpuPower", "fan"] as const;
export function bucket(rows: Omit<Sample, "name">[], minutes: number) {
  const out = new Map<number, { at: string; n: Record<string, number>; s: Record<string, number> }>();
  const size = minutes * 60_000;
  for (const r of rows) {
    const k = Math.floor(Date.parse(r.at) / size) * size;
    const b = out.get(k) ?? { at: new Date(k).toISOString(), n: {}, s: {} };
    for (const f of FIELDS) {
      const v = r[f];
      if (v == null) continue;
      b.n[f] = (b.n[f] ?? 0) + 1;
      b.s[f] = (b.s[f] ?? 0) + v;
    }
    out.set(k, b);
  }
  const avg = (b: { n: Record<string, number>; s: Record<string, number> }, f: string) => (b.n[f] ? b.s[f] / b.n[f] : null);
  return [...out.values()].map((b) => ({ at: b.at, ...Object.fromEntries(FIELDS.map((f) => [f, avg(b, f)])) }) as { at: string } & Record<(typeof FIELDS)[number], number | null>);
}

/** The chart ranges and how finely each is bucketed (about 60-180 points each). */
export const RANGES: Record<string, { hours: number; minutes: number }> = {
  "1h": { hours: 1, minutes: 1 },
  "24h": { hours: 24, minutes: 10 },
  "7d": { hours: 168, minutes: 60 },
  "30d": { hours: 720, minutes: 240 },
};

/** `docker stats --format json` sizes ("62.76MiB", "1.2GB", "900kB") in bytes. */
export function size(s: string): number | null {
  const m = /^([\d.]+)\s*([KMGT]?i?B|B)$/i.exec(s.trim());
  if (!m) return null;
  const unit = m[2].toUpperCase();
  const pow = { B: 0, KB: 1, KIB: 1, MB: 2, MIB: 2, GB: 3, GIB: 3, TB: 4, TIB: 4 }[unit] ?? 0;
  return Number(m[1]) * (unit.includes("I") ? 1024 : 1000) ** pow;
}

/** One `docker stats` JSON line as a Container. */
export function dockerLine(line: string): Container | null {
  try {
    const j = JSON.parse(line) as Record<string, string>;
    const pair = (v: string) => (v ?? "").split("/").map((x) => size(x));
    const [mem, memLimit] = pair(j.MemUsage);
    const [rx, tx] = pair(j.NetIO);
    const [rd, wr] = pair(j.BlockIO);
    return {
      name: j.Name,
      cpu: Number.parseFloat(j.CPUPerc) / 100 || 0,
      mem: mem ?? null,
      memLimit: memLimit ?? null,
      net: rx == null && tx == null ? null : (rx ?? 0) + (tx ?? 0),
      block: rd == null && wr == null ? null : (rd ?? 0) + (wr ?? 0),
    };
  } catch {
    return null;
  }
}

/** Cloudflare R2 operation classes (r2/pricing): A writes and lists, B reads; deletes are free. */
const CLASS_A = new Set([
  "ListBuckets", "PutBucket", "ListObjects", "PutObject", "CopyObject", "CompleteMultipartUpload", "CreateMultipartUpload",
  "LifecycleStorageTierTransition", "ListMultipartUploads", "UploadPart", "UploadPartCopy", "ListParts", "PutBucketEncryption",
  "PutBucketCors", "PutBucketLifecycleConfiguration",
]);
const CLASS_B = new Set(["HeadBucket", "HeadObject", "GetObject", "UsageSummary", "GetBucketEncryption", "GetBucketLocation", "GetBucketCors", "GetBucketLifecycleConfiguration"]);
export function r2Class(action: string): "A" | "B" | "free" {
  return CLASS_A.has(action) ? "A" : CLASS_B.has(action) ? "B" : "free";
}

/** The free allowances the page measures against. */
export const FREE = { functionsPerDay: 100_000, r2Bytes: 10 * 1e9, r2ClassA: 1_000_000, r2ClassB: 10_000_000 };

interface Check {
  url: string;
  label: string;
  points: { at: string; ok: boolean; ms: number | null; status: number | null }[];
  detail: string | null;
}

interface Site {
  at: string | null;
  error: string | null;
  traffic: { date: string; requests: number; pageViews: number; visitors: number; bytes: number; cachedBytes: number; threats: number }[];
  functions: { date: string; requests: number; errors: number }[];
  r2: { buckets: { name: string; bytes: number; objects: number }[]; month: { a: number; b: number; free: number }; errors: string[] } | null;
  problems: string[];
}

export class Systems {
  private state: State;
  private log: (line: string) => void;
  /** Each machine's reports by source ("push", "pve"), newest wins per field. */
  private sources = new Map<string, Map<string, { at: string; r: Report }>>();
  private site: Site = { at: null, error: null, traffic: [], functions: [], r2: null, problems: [] };
  private checks: Check[] = [];
  private timers: NodeJS.Timeout[] = [];
  /** Each CI machine's game guard: what it did at its last check (machines/windows-runner/setup-game-guard.ps1). */
  private guards = new Map<string, Guard>();
  /** Each served project's build queue, for the "nothing ready to build" alert (set by the serve loop). */
  queues: () => QueueFact[] = () => [];

  constructor(state: State, log: (line: string) => void) {
    this.state = state;
    this.log = log;
    for (const d of state.devices()) {
      try {
        this.sources.set(d.name, new Map([["saved", { at: d.at, r: JSON.parse(d.json) as Report }]]));
      } catch {
        // a bad row: the next report replaces it
      }
    }
  }

  start(): void {
    const every = (ms: number, f: () => Promise<void>) => {
      const run = () => f().catch((e: Error) => this.log(`systems: ${e.message}`));
      run();
      this.timers.push(setInterval(run, ms));
    };
    if (process.env.PVE_URL && process.env.PVE_TOKEN) every(60_000, () => this.pollPve());
    if (process.env.CF_API_TOKEN && process.env.CF_ACCOUNT_ID) every(10 * 60_000, () => this.pollSite());
    every(5 * 60_000, () => this.pollChecks());
    if (process.env.FACTORY_DOCKER_STATS !== "0") every(60_000, () => this.pollDocker());
    // After the first polls have had a moment, so a restart doesn't count every machine as offline.
    setTimeout(() => every(60_000, () => this.tickAlerts()), 90_000).unref?.();
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
  }

  /** A machine's report arrives (push or pull). */
  ingest(name: string, raw: unknown, source: string, now = new Date()): void {
    if (!/^[a-z0-9][a-z0-9-]{0,30}$/.test(name)) throw new Error("machine names are a-z, 0-9 and -, up to 31 characters");
    const r = cleanReport(raw);
    const events = cleanEvents((raw as Record<string, unknown> | null)?.events);
    if (events.length && this.state.addDeviceEvents(name, events)) this.log(`systems: ${name}: ${events.length} boot/shutdown event(s) seen`);
    const at = now.toISOString();
    const by = this.sources.get(name) ?? new Map();
    by.delete("saved");
    by.set(source, { at, r });
    this.sources.set(name, by);
    const merged = this.merged(name)!;
    this.state.saveDevice(name, JSON.stringify(merged.r), at);
    const minute = new Date(Math.floor(now.getTime() / 60_000) * 60_000).toISOString();
    this.state.addDeviceSample(name, minute, {
      cpu: merged.r.cpu ?? null,
      mem: merged.r.memTotal ? (merged.r.memUsed ?? 0) / merged.r.memTotal : null,
      disk: fullest(merged.r.disks),
      temp: merged.r.sensors?.cpuTemp ?? merged.r.temp ?? null,
      net: merged.r.net ? merged.r.net.rx + merged.r.net.tx : null,
      gpu: merged.r.gpu?.util ?? null,
      gpuTemp: merged.r.gpu?.temp ?? null,
      gpuPower: merged.r.gpu?.power ?? null,
      gpuFan: merged.r.gpu?.fan ?? null,
      gpuClock: merged.r.gpu?.clock ?? null,
      vram: merged.r.gpu?.memUsed ?? null,
      cpuPower: merged.r.sensors?.cpuPower ?? null,
      cpuClock: merged.r.sensors?.cpuClock ?? null,
      fan: merged.r.sensors?.fans.length ? Math.max(...merged.r.sensors.fans.map((f) => f.rpm)) : null,
    });
  }

  /**
   * A CI machine's game guard checks in (every minute): it says whether CI is running or paused there and
   * why, and gets back whether the owner paused it from the dashboard and how many threads builds may use.
   */
  guard(name: string, raw: unknown, now = new Date()): { paused: boolean; jobs: CiThreads } {
    if (!/^[a-z0-9][a-z0-9-]{0,30}$/.test(name)) throw new Error("machine names are a-z, 0-9 and -, up to 31 characters");
    this.guards.set(name, cleanGuard(raw, now));
    return { paused: this.state.ciPaused(name), jobs: this.ciThreads(name) };
  }

  /** A machine's CI build threads (its card): the defaults until the owner saves some. */
  ciThreads(name: string): CiThreads {
    return ciThreadsFrom(this.state.ciThreads(name));
  }

  /** The owner's CI build threads on a machine's card; its guard hands them on within a minute. */
  setCiThreads(name: string, raw: unknown): string {
    if (!/^[a-z0-9][a-z0-9-]{0,30}$/.test(name)) throw new Error("machine names are a-z, 0-9 and -, up to 31 characters");
    const t = ciThreadsFrom(raw);
    this.state.setCiThreads(name, t);
    const gaming = t.gaming === null ? "paused while you play" : `${t.gaming} while you play`;
    this.log(`systems: CI build threads on ${name}: ${t.default}, PRs up to ${t.max}, ${gaming}`);
    return `CI builds on ${name}: ${t.default} threads, PRs may ask for up to ${t.max}, ${gaming} (from its next job)`;
  }

  /** The owner's Pause CI / Resume CI on a machine's card. */
  setCiPaused(name: string, paused: boolean): string {
    if (!/^[a-z0-9][a-z0-9-]{0,30}$/.test(name)) throw new Error("machine names are a-z, 0-9 and -, up to 31 characters");
    this.state.setCiPaused(name, paused);
    this.log(`systems: CI ${paused ? "paused" : "resumed"} on ${name} from the dashboard`);
    return paused ? `CI paused on ${name}: no new job starts there (a running one finishes slowly)` : `CI resumed on ${name}`;
  }

  /** The factory's own Docker containers (the dispatcher has the socket), added to its host's report. */
  async pollDocker(): Promise<void> {
    const out = await new Promise<string>((resolve, reject) =>
      execFile("docker", ["stats", "--no-stream", "--format", "{{json .}}"], { timeout: 20_000 }, (e, stdout) => (e ? reject(e) : resolve(stdout))),
    );
    const containers = out.split("\n").filter(Boolean).map(dockerLine).filter((c): c is Container => Boolean(c));
    this.ingest(install().host, { containers }, "docker");
  }

  /** Alert limits, saved from the Settings view. */
  alertSettings(): AlertSettings {
    return settingsFrom(this.state.alertSettings());
  }

  setAlertSettings(raw: unknown): AlertSettings {
    const s = settingsFrom(raw);
    this.state.setAlertSettings(s);
    return s;
  }

  /** Runs the alert rules: opens and clears alerts, and tells Discord about each change. */
  async tickAlerts(now = Date.now()): Promise<void> {
    const v = this.view(now);
    const since = new Date(now - 4 * 3600_000).toISOString();
    const samples = new Map<string, Sample[]>();
    for (const r of this.state.deviceSamples(since)) samples.set(r.name, [...(samples.get(r.name) ?? []), r]);
    const facts = {
      devices: v.devices.map((d) => ({ name: d.name, always: machine(d.name)?.always ?? false, lastSeen: d.lastSeen, disks: d.disks })),
      checks: v.checks,
      functionsToday: v.site.functions.find((f) => f.date === new Date(now).toISOString().slice(0, 10))?.requests ?? null,
      r2Bytes: v.site.r2 ? v.site.r2.buckets.reduce((a, b) => a + b.bytes, 0) : null,
      r2ClassA: v.site.r2?.month.a ?? null,
      free: FREE,
      queues: this.queues(),
    };
    const { start, clear } = diff(conditions(facts, samples, this.alertSettings(), now), this.state.openAlerts());
    const at = new Date(now).toISOString();
    for (const c of start) {
      this.state.openAlert(c.key, c.text, at);
      this.log(`alert: ${c.text.replace(/\*/g, "")}`);
      await discord(this.webhook(), `🔴 ${c.text}`);
    }
    for (const o of clear) {
      this.state.clearAlert(o.id, at);
      const row = this.state.alerts(200).find((a) => a.id === o.id);
      const mins = row ? Math.round((now - Date.parse(row.at)) / 60_000) : 0;
      await discord(this.webhook(), `✅ Cleared after ${mins < 90 ? `${mins} min` : `${Math.round(mins / 60)} h`}: ${row?.text ?? o.key}`);
    }
  }

  /** The Discord webhook: the one pasted on the Settings view, else DISCORD_WEBHOOK_URL. Never sent to the page. */
  webhook(): string | undefined {
    return this.state.discordWebhook() || process.env.DISCORD_WEBHOOK_URL || undefined;
  }

  /** Saves (after Discord confirms it) or removes the pasted webhook. */
  async setWebhook(raw: unknown): Promise<string> {
    const url = typeof raw === "string" ? raw.trim() : "";
    if (!url) {
      this.state.setDiscordWebhook("");
      return process.env.DISCORD_WEBHOOK_URL ? "Removed; the one in the factory's env is used again" : "Removed: alerts show on the Systems view only";
    }
    if (!WEBHOOK.test(url)) throw new Error("That isn't a Discord webhook URL (https://discord.com/api/webhooks/...)");
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
    if (!res?.ok) throw new Error(`Discord says that webhook doesn't work (${res?.status ?? "no answer"}); nothing saved`);
    this.state.setDiscordWebhook(url);
    return "Saved. Use Send a test to check the channel";
  }

  /** A test message, from the Settings view. */
  async testAlert(): Promise<string> {
    if (!this.webhook()) return "No Discord webhook yet: paste one above";
    return (await discord(this.webhook(), "👋 Test from the factory dashboard: alerts reach this channel.")) ? "Sent a test message to Discord" : "Discord refused the message (check the webhook URL)";
  }

  forget(name: string): void {
    this.sources.delete(name);
    this.state.removeDevice(name);
  }

  private merged(name: string): { at: string; r: Report; sources: string[] } | undefined {
    const by = this.sources.get(name);
    if (!by?.size) return undefined;
    // The Proxmox API wins where both say something (its storage list beats df); the push adds the rest.
    const rank = (s: string) => ({ saved: 0, push: 1, docker: 1, pve: 2 })[s] ?? 1;
    const list = [...by.entries()].sort((a, b) => rank(a[0]) - rank(b[0]));
    const r: Report = {};
    for (const [, v] of list) Object.assign(r, v.r);
    const at = list.map(([, v]) => v.at).sort().at(-1)!;
    return { at, r, sources: list.map(([s]) => s).filter((s) => s !== "saved") };
  }

  /** Everything the Systems view shows. */
  view(now = Date.now(), range = "24h") {
    const r = RANGES[range] ?? RANGES["24h"];
    const since = new Date(now - r.hours * 3600_000).toISOString();
    const history = new Map<string, ReturnType<typeof bucket>>();
    const rows = this.state.deviceSamples(since);
    for (const name of new Set(rows.map((x) => x.name))) history.set(name, bucket(rows.filter((x) => x.name === name), r.minutes));
    const names = new Set([...known().filter((m) => m.always).map((m) => m.name), ...this.sources.keys(), ...this.guards.keys()]);
    const devices = [...names].map((name) => {
      const m = this.merged(name);
      return {
        name,
        role: machine(name)?.role || null,
        lastSeen: m?.at ?? null,
        online: Boolean(m && now - Date.parse(m.at) < OFFLINE_MS),
        sources: m?.sources ?? [],
        ...(m?.r ?? {}),
        history: history.get(name) ?? [],
        events: this.state.deviceEvents(name, 10),
        ci: ciView(this.guards.get(name), this.state.ciPaused(name), now, this.ciThreads(name)),
      };
    });
    // Settings' order first, then the rest by name.
    const order = known().map((m) => m.name);
    devices.sort((a, b) => (order.indexOf(a.name) + 1 || 99) - (order.indexOf(b.name) + 1 || 99) || a.name.localeCompare(b.name));
    return {
      devices,
      /** The machine the dispatcher runs on (its card explains the Proxmox setup). */
      host: install().host,
      site: this.site,
      checks: this.syncChecks().map((c) => {
        const last = c.points.at(-1) ?? null;
        const ok = c.points.filter((p) => p.ok).length;
        return { url: c.url, label: c.label, last, detail: c.detail, uptime: c.points.length ? ok / c.points.length : null, points: c.points };
      }),
      free: FREE,
      range: RANGES[range] ? range : "24h",
      alerts: { open: this.state.openAlerts(), recent: this.state.alerts(30), settings: this.alertSettings(), discord: Boolean(this.webhook()), discordFrom: this.state.discordWebhook() ? "page" : process.env.DISCORD_WEBHOOK_URL ? "env" : null },
      configured: {
        push: Boolean(process.env.DEVICE_TOKEN),
        pve: Boolean(process.env.PVE_URL && process.env.PVE_TOKEN),
        cloudflare: Boolean(process.env.CF_API_TOKEN && process.env.CF_ACCOUNT_ID),
      },
    };
  }

  /** The factory's host from the Proxmox API: the node, its storage, and each container and VM. */
  async pollPve(): Promise<void> {
    const nodes = await pveGet<{ node: string }[]>("/nodes");
    const node = process.env.PVE_NODE ?? nodes[0]?.node;
    if (!node) throw new Error("Proxmox lists no nodes");
    const [st, lxc, qemu, storage] = await Promise.all([
      pveGet<any>(`/nodes/${node}/status`),
      pveGet<any[]>(`/nodes/${node}/lxc`),
      pveGet<any[]>(`/nodes/${node}/qemu`).catch(() => []),
      pveGet<any[]>(`/nodes/${node}/storage`).catch(() => []),
    ]);
    const guests = [...lxc.map((g) => ({ ...g, type: "lxc" })), ...qemu.map((g) => ({ ...g, type: "qemu" }))]
      .map((g) => ({ id: Number(g.vmid), name: g.name, type: g.type, status: g.status, cpu: g.cpu, mem: g.mem, memTotal: g.maxmem, uptime: g.uptime }))
      .sort((a, b) => a.id - b.id);
    const disks = storage
      .filter((s) => s.active && s.total)
      .map((s) => ({ mount: String(s.storage), used: Number(s.used), total: Number(s.total) }));
    if (!disks.length && st.rootfs) disks.push({ mount: "/", used: st.rootfs.used, total: st.rootfs.total });
    // Each running container's own disk too: the factory's (GlitchTip, transcripts) can fill up long before
    // the storage pool it sits on does, and the disk alert reads this list.
    for (const g of lxc) {
      if (g.status === "running" && Number(g.maxdisk) > 0) disks.push({ mount: `ct${g.vmid} ${g.name}`, used: Number(g.disk), total: Number(g.maxdisk) });
    }
    this.ingest(install().host, {
      os: st.pveversion ? `Proxmox ${String(st.pveversion).split("/")[1] ?? ""}`.trim() : "Proxmox",
      cpuModel: st.cpuinfo?.model,
      cores: st.cpuinfo?.cpus,
      cpu: st.cpu,
      load: (st.loadavg ?? []).map(Number),
      memUsed: st.memory?.used,
      memTotal: st.memory?.total,
      uptime: st.uptime,
      disks,
      guests,
    }, "pve");
  }

  /** The website from Cloudflare: last 7 days of traffic and Functions requests, R2 now and this month. */
  async pollSite(): Promise<void> {
    const account = process.env.CF_ACCOUNT_ID!;
    const zone = process.env.CF_ZONE_ID;
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86400_000);
    const problems: string[] = [];
    const ask = async (what: string, query: string, variables: Record<string, unknown>) => {
      try {
        return await cfGraphql(query, variables);
      } catch (e) {
        problems.push(`${what}: ${(e as Error).message}`);
        return null;
      }
    };
    const [z, fn, store, ops] = await Promise.all([
      zone
        ? ask("traffic", `query($zone: string!, $since: Date!) { viewer { zones(filter: { zoneTag: $zone }) {
            httpRequests1dGroups(limit: 8, filter: { date_geq: $since }, orderBy: [date_ASC]) {
              dimensions { date } sum { requests pageViews bytes cachedBytes threats } uniq { uniques } } } } }`,
            { zone, since: weekAgo.toISOString().slice(0, 10) })
        : Promise.resolve(null),
      ask("functions", `query($account: string!, $since: Time!, $until: Time!) { viewer { accounts(filter: { accountTag: $account }) {
          pagesFunctionsInvocationsAdaptiveGroups(limit: 1000, filter: { datetime_geq: $since, datetime_leq: $until }) {
            dimensions { date } sum { requests errors } } } } }`,
        { account, since: weekAgo.toISOString(), until: now.toISOString() }),
      ask("R2 storage", `query($account: string!, $since: Time!, $until: Time!) { viewer { accounts(filter: { accountTag: $account }) {
          r2StorageAdaptiveGroups(limit: 1000, filter: { datetime_geq: $since, datetime_leq: $until }, orderBy: [datetime_DESC]) {
            dimensions { bucketName datetime } max { objectCount payloadSize metadataSize } } } } }`,
        { account, since: new Date(now.getTime() - 2 * 86400_000).toISOString(), until: now.toISOString() }),
      ask("R2 operations", `query($account: string!, $since: Time!, $until: Time!) { viewer { accounts(filter: { accountTag: $account }) {
          r2OperationsAdaptiveGroups(limit: 10000, filter: { datetime_geq: $since, datetime_leq: $until }) {
            dimensions { actionType } sum { requests } } } } }`,
        { account, since: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString(), until: now.toISOString() }),
    ]);
    const traffic = (z?.viewer?.zones?.[0]?.httpRequests1dGroups ?? []).map((g: any) => ({
      date: g.dimensions.date, requests: g.sum.requests, pageViews: g.sum.pageViews, visitors: g.uniq.uniques,
      bytes: g.sum.bytes, cachedBytes: g.sum.cachedBytes, threats: g.sum.threats,
    }));
    const byDay = new Map<string, { requests: number; errors: number }>();
    for (const g of fn?.viewer?.accounts?.[0]?.pagesFunctionsInvocationsAdaptiveGroups ?? []) {
      const d = byDay.get(g.dimensions.date) ?? { requests: 0, errors: 0 };
      d.requests += g.sum.requests;
      d.errors += g.sum.errors;
      byDay.set(g.dimensions.date, d);
    }
    const latest = new Map<string, { name: string; bytes: number; objects: number }>();
    for (const g of store?.viewer?.accounts?.[0]?.r2StorageAdaptiveGroups ?? []) {
      if (!latest.has(g.dimensions.bucketName)) latest.set(g.dimensions.bucketName, { name: g.dimensions.bucketName, bytes: g.max.payloadSize + g.max.metadataSize, objects: g.max.objectCount });
    }
    const month = { a: 0, b: 0, free: 0 };
    for (const g of ops?.viewer?.accounts?.[0]?.r2OperationsAdaptiveGroups ?? []) {
      const c = r2Class(g.dimensions.actionType);
      month[c === "A" ? "a" : c === "B" ? "b" : "free"] += g.sum.requests;
    }
    this.site = {
      at: now.toISOString(),
      error: problems.length === 4 ? problems[0] : null,
      traffic,
      functions: [...byDay.entries()].sort().map(([date, v]) => ({ date, ...v })),
      r2: store || ops ? { buckets: [...latest.values()].sort((a, b) => b.bytes - a.bytes), month, errors: [] } : null,
      problems,
    };
  }

  /** The checks Settings asks for now, keeping the history of any that stayed. */
  private syncChecks(): Check[] {
    const want = install().uptime;
    if (want.length !== this.checks.length || want.some((w, i) => w.url !== this.checks[i].url || w.label !== this.checks[i].label)) {
      this.checks = want.map((w) => this.checks.find((c) => c.url === w.url) ?? { url: w.url, label: w.label, points: [], detail: null }).map((c, i) => ({ ...c, label: want[i].label }));
    }
    return this.checks;
  }

  /** Is the site up, and which version does the updater offer? Kept for 24 hours. */
  async pollChecks(): Promise<void> {
    await Promise.all(this.syncChecks().map(async (c) => {
      const t = Date.now();
      let point: Check["points"][number];
      try {
        const res = await fetch(c.url, { redirect: "manual", signal: AbortSignal.timeout(10_000), headers: { "user-agent": "factory-uptime" } });
        // The factory's own health check sits behind Access, so a redirect to sign-in means the tunnel is up.
        const ok = res.status < 400;
        point = { at: new Date().toISOString(), ok, ms: Date.now() - t, status: res.status };
        if (c.url.endsWith("latest.json") && res.status === 404) c.detail = "no release published yet";
        else if (c.url.endsWith("latest.json") && res.ok) {
          const j = (await res.json().catch(() => null)) as { version?: string; pub_date?: string } | null;
          c.detail = j?.version ? `v${j.version}${j.pub_date ? ` · ${j.pub_date.slice(0, 10)}` : ""}` : null;
        } else await res.body?.cancel();
      } catch (e) {
        point = { at: new Date().toISOString(), ok: false, ms: null, status: null };
        c.detail = (e as Error).name === "TimeoutError" ? "timed out" : (e as Error).message.slice(0, 80);
      }
      c.points.push(point);
      if (c.points.length > 288) c.points.splice(0, c.points.length - 288);
    }));
  }
}

/** GET from the Proxmox API with the read-only token, trusting PVE_CA_FILE (the host's pve-root-ca.pem). */
function pveGet<T>(path: string): Promise<T> {
  const base = new URL(process.env.PVE_URL!);
  const ca = process.env.PVE_CA_FILE ? readFileSync(process.env.PVE_CA_FILE) : undefined;
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: base.hostname, port: base.port || 8006, path: `/api2/json${path}`, method: "GET",
        headers: { authorization: `PVEAPIToken=${process.env.PVE_TOKEN}` },
        ca, rejectUnauthorized: process.env.PVE_INSECURE !== "1", timeout: 10_000,
        // The certificate names the host, not the address the container reaches it by.
        checkServerIdentity: ca ? () => undefined : undefined,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          if ((res.statusCode ?? 500) >= 400) return reject(new Error(`Proxmox ${path}: ${res.statusCode}`));
          try {
            resolve((JSON.parse(Buffer.concat(chunks).toString("utf8")) as { data: T }).data);
          } catch {
            reject(new Error(`Proxmox ${path}: bad json`));
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error(`Proxmox ${path}: timed out`)));
    req.on("error", reject);
    req.end();
  });
}

async function cfGraphql(query: string, variables: Record<string, unknown>): Promise<any> {
  const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.CF_API_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(20_000),
  });
  const j = (await res.json().catch(() => ({}))) as { data?: unknown; errors?: { message: string }[] | null };
  if (!res.ok || j.errors?.length) throw new Error(j.errors?.[0]?.message ?? `HTTP ${res.status}`);
  return j.data;
}
