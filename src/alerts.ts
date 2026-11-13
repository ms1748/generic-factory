// Alerts for the Systems view (the Beszel idea, built in): a machine goes quiet, stays hot or full for a
// while, the site goes down, the free tier gets close to its limit, or a project has nothing ready to build. Each condition opens one alert row
// and one Discord message when it starts, and one "cleared" message when it ends (DISCORD_WEBHOOK_URL).
// Pure rules here; Systems runs them every minute.
import type { Sample } from "./state.ts";

export interface AlertSettings {
  enabled: boolean;
  /** Minutes without a report before an always-on machine counts as offline. */
  offlineMin: number;
  cpu: { pct: number; min: number };
  mem: { pct: number; min: number };
  disk: { pct: number };
  temp: { c: number; min: number };
  /** Site down for two checks in a row (10 minutes). */
  site: boolean;
  /** Share of a free allowance (Functions per day, R2 storage, R2 class A per month). */
  freePct: number;
  /** A served project with no buildable `ready` card for `min` minutes (autoqueue.ts records it). */
  queue: { on: boolean; min: number };
}

export const DEFAULTS: AlertSettings = {
  enabled: true,
  offlineMin: 5,
  cpu: { pct: 90, min: 10 },
  mem: { pct: 90, min: 10 },
  disk: { pct: 90 },
  temp: { c: 85, min: 5 },
  site: true,
  freePct: 80,
  queue: { on: true, min: 30 },
};

const clamp = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d);

/** Saved settings over the defaults, every number in a sane range. */
export function settingsFrom(raw: unknown): AlertSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  return {
    enabled: typeof r.enabled === "boolean" ? r.enabled : DEFAULTS.enabled,
    offlineMin: clamp(r.offlineMin, 2, 1440, DEFAULTS.offlineMin),
    cpu: { pct: clamp(r.cpu?.pct, 10, 100, DEFAULTS.cpu.pct), min: clamp(r.cpu?.min, 1, 240, DEFAULTS.cpu.min) },
    mem: { pct: clamp(r.mem?.pct, 10, 100, DEFAULTS.mem.pct), min: clamp(r.mem?.min, 1, 240, DEFAULTS.mem.min) },
    disk: { pct: clamp(r.disk?.pct, 10, 100, DEFAULTS.disk.pct) },
    temp: { c: clamp(r.temp?.c, 40, 110, DEFAULTS.temp.c), min: clamp(r.temp?.min, 1, 240, DEFAULTS.temp.min) },
    site: typeof r.site === "boolean" ? r.site : DEFAULTS.site,
    freePct: clamp(r.freePct, 10, 100, DEFAULTS.freePct),
    queue: { on: typeof r.queue?.on === "boolean" ? r.queue.on : DEFAULTS.queue.on, min: clamp(r.queue?.min, 5, 1440, DEFAULTS.queue.min) },
  };
}

export interface Condition {
  key: string;
  text: string;
}

/** What the rules read: the Systems view's own data. */
export interface Facts {
  devices: { name: string; always: boolean; lastSeen: string | null; disks?: { mount: string; used: number; total: number }[] }[];
  checks: { label: string; url: string; points: { ok: boolean; status: number | null }[] }[];
  functionsToday: number | null;
  r2Bytes: number | null;
  r2ClassA: number | null;
  free: { functionsPerDay: number; r2Bytes: number; r2ClassA: number };
  /** Each served project's build queue, from the serve loop (autoqueue.ts queueFact). */
  queues?: QueueFact[];
}

export interface QueueFact {
  repo: string;
  /** Since when it has had no buildable `ready` card, or null while it has one. */
  emptySince: string | null;
  /** Auto-queue is on. */
  autoQueue: boolean;
  /** Auto-queue's last finished attempt added nothing. */
  autoQueueFoundNothing: boolean;
}

/** "Nothing ready to build": empty past the grace period and, with auto-queue on, auto-queue found nothing. */
export function queueConditions(queues: QueueFact[], s: AlertSettings, now = Date.now()): Condition[] {
  if (!s.enabled || !s.queue.on) return [];
  return queues
    .filter((q) => q.emptySince && now - Date.parse(q.emptySince) >= s.queue.min * 60_000 && (!q.autoQueue || q.autoQueueFoundNothing))
    .map((q) => ({
      key: `queue:${q.repo}`,
      text: `**${q.repo}**: nothing ready to build${q.autoQueue ? "; auto-queue found nothing to add; queue an idea or file a card" : ""}`,
    }));
}

/**
 * Whether a metric stayed at or above `limit` for the last `minutes`: every sample in the window is over,
 * and the window has at least half its minutes reported (so one stray sample never fires).
 */
export function sustained(samples: Sample[], field: "cpu" | "mem" | "temp", limit: number, minutes: number, now: number): boolean {
  const since = now - minutes * 60_000;
  const vals = samples.filter((s) => Date.parse(s.at) >= since && s[field] != null).map((s) => s[field] as number);
  return vals.length >= Math.max(1, Math.ceil(minutes / 2)) && vals.every((v) => v >= limit);
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** The conditions that are true right now. */
export function conditions(f: Facts, samples: Map<string, Sample[]>, s: AlertSettings, now = Date.now()): Condition[] {
  if (!s.enabled) return [];
  const out: Condition[] = [];
  for (const d of f.devices) {
    if (d.always && (!d.lastSeen || now - Date.parse(d.lastSeen) > s.offlineMin * 60_000)) {
      out.push({ key: `offline:${d.name}`, text: `**${d.name}** stopped reporting${d.lastSeen ? ` (last report ${new Date(d.lastSeen).toLocaleString("en-US")})` : ""}` });
      continue; // stale numbers say nothing more
    }
    const h = samples.get(d.name) ?? [];
    if (sustained(h, "cpu", s.cpu.pct / 100, s.cpu.min, now)) out.push({ key: `cpu:${d.name}`, text: `**${d.name}** CPU has been at ${s.cpu.pct}% or more for ${s.cpu.min} min` });
    if (sustained(h, "mem", s.mem.pct / 100, s.mem.min, now)) out.push({ key: `mem:${d.name}`, text: `**${d.name}** memory has been at ${s.mem.pct}% or more for ${s.mem.min} min` });
    if (sustained(h, "temp", s.temp.c, s.temp.min, now)) out.push({ key: `temp:${d.name}`, text: `**${d.name}** has been at ${s.temp.c} °C or hotter for ${s.temp.min} min` });
    for (const disk of d.disks ?? []) {
      const used = disk.total ? disk.used / disk.total : 0;
      if (used >= s.disk.pct / 100) out.push({ key: `disk:${d.name}:${disk.mount}`, text: `**${d.name}** ${disk.mount} is ${pct(used)} full` });
    }
  }
  if (s.site) {
    for (const c of f.checks) {
      const last = c.points.slice(-2);
      // The updater's latest.json is 404 until the first release: only a server error or no answer counts.
      const bad = (p: { ok: boolean; status: number | null }) => (c.url.endsWith("latest.json") ? p.status == null || p.status >= 500 : !p.ok);
      if (last.length === 2 && last.every(bad)) out.push({ key: `site:${c.url}`, text: `**${c.label}** is down (${last[1].status ?? "no answer"})` });
    }
  }
  const share = s.freePct / 100;
  if (f.functionsToday != null && f.functionsToday >= share * f.free.functionsPerDay) out.push({ key: "free:functions", text: `Functions requests today: ${f.functionsToday.toLocaleString("en-US")} of the free 100,000` });
  if (f.r2Bytes != null && f.r2Bytes >= share * f.free.r2Bytes) out.push({ key: "free:r2", text: `R2 storage is at ${(f.r2Bytes / 1e9).toFixed(1)} GB of the free 10 GB` });
  if (f.r2ClassA != null && f.r2ClassA >= share * f.free.r2ClassA) out.push({ key: "free:r2a", text: `R2 writes this month: ${f.r2ClassA.toLocaleString("en-US")} of the free 1,000,000` });
  out.push(...queueConditions(f.queues ?? [], s, now));
  return out;
}

/** Which alerts to open and which to clear, given the open ones. */
export function diff(now: Condition[], open: { id: number; key: string }[]): { start: Condition[]; clear: { id: number; key: string }[] } {
  const keys = new Set(now.map((c) => c.key));
  const openKeys = new Set(open.map((o) => o.key));
  return { start: now.filter((c) => !openKeys.has(c.key)), clear: open.filter((o) => !keys.has(o.key)) };
}

/** A Discord channel webhook URL, and nothing else (so the factory never posts anywhere but Discord). */
export const WEBHOOK = /^https:\/\/(discord|discordapp)\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/;

/** Posts to a Discord webhook; false when there's none or Discord refused. */
export async function discord(url: string | undefined, text: string): Promise<boolean> {
  if (!url || !WEBHOOK.test(url)) return false;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "Factory", content: text.slice(0, 1900), allowed_mentions: { parse: [] } }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);
  return Boolean(res?.ok);
}
