// Small formatting helpers shared by the views.

export const gh = (repo: string, kind: string, n: number | string) => `https://github.com/${repo}/${kind}/${n}`;
export const pct = (x: number | null | undefined) => Math.round((x ?? 0) * 100) + "%";
export const money = (x: number | null | undefined) => {
  const v = x ?? 0;
  return v > 0 && v < 0.01 ? "<$0.01" : "$" + v.toFixed(v >= 100 ? 0 : 2);
};
/** "app" for "owner/app". */
export const short = (repo: string | null | undefined) => (repo ?? "").split("/")[1] ?? repo ?? "";

export function time(iso: string | null | undefined, tz?: string, opts: Intl.DateTimeFormatOptions = {}) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-US", { timeZone: tz, weekday: "short", hour: "numeric", minute: "2-digit", ...opts });
}

export function rel(iso: string | number | null | undefined) {
  if (!iso) return "";
  const d = (new Date(iso).getTime() - Date.now()) / 1000;
  const a = Math.abs(d);
  if (a < 45) return "just now";
  const t = a < 3600 ? Math.round(a / 60) + " min" : a < 86400 ? Math.round(a / 3600) + " h" : Math.round(a / 86400) + " d";
  return d > 0 ? "in " + t : t + " ago";
}

export function dur(from: string, to?: string | null) {
  const s = Math.max(0, ((to ? new Date(to).getTime() : Date.now()) - new Date(from).getTime()) / 1000);
  return s < 60 ? Math.round(s) + " s" : s < 3600 ? Math.round(s / 60) + " min" : (s / 3600).toFixed(1) + " h";
}

export const bytes = (b: number | null | undefined, digits = 1) => {
  if (b == null) return "–";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (b >= 1000 && i < u.length - 1) (b /= 1000), i++;
  return `${b.toFixed(i && b < 100 ? digits : 0)} ${u[i]}`;
};

export const count = (n: number | null | undefined) =>
  n == null ? "–" : n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + "k" : String(Math.round(n));

export function uptime(s: number | null | undefined) {
  if (s == null) return "–";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  return d ? `${d}d ${h}h` : h ? `${h}h ${Math.floor((s % 3600) / 60)}m` : `${Math.floor(s / 60)}m`;
}

export type Tone = "ok" | "warn" | "bad" | "none";
/** A tone for a 0..1 load: calm, busy, hot. */
export const level = (v: number | null | undefined, warn = 0.75, bad = 0.9): Tone => (v == null ? "none" : v >= bad ? "bad" : v >= warn ? "warn" : "ok");
export const tempLevel = (t: number | null | undefined) => level(t == null ? null : t / 100, 0.75, 0.88);
/** Tailwind text and background classes for a tone. */
export const toneText: Record<Tone, string> = { ok: "text-ok", warn: "text-warn", bad: "text-bad", none: "text-muted-foreground" };
export const toneBg: Record<Tone, string> = { ok: "bg-ok", warn: "bg-warn", bad: "bg-bad", none: "bg-muted-foreground/30" };
