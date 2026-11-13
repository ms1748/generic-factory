// Small formatting helpers shared by the components.

export const gh = (repo, kind, n) => `https://github.com/${repo}/${kind}/${n}`;
export const pct = (x) => Math.round((x ?? 0) * 100) + "%";
export const money = (x) => (x > 0 && x < 0.01 ? "<$0.01" : "$" + (x ?? 0).toFixed(x >= 100 ? 0 : 2));

export function time(iso, tz, opts = {}) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-US", { timeZone: tz, weekday: "short", hour: "numeric", minute: "2-digit", ...opts });
}

export function rel(iso) {
  if (!iso) return "";
  const d = (new Date(iso) - Date.now()) / 1000;
  const a = Math.abs(d);
  if (a < 45) return "just now";
  const t = a < 3600 ? Math.round(a / 60) + " min" : a < 86400 ? Math.round(a / 3600) + " h" : Math.round(a / 86400) + " d";
  return d > 0 ? "in " + t : t + " ago";
}

export function dur(from, to) {
  const s = Math.max(0, ((to ? new Date(to) : Date.now()) - new Date(from)) / 1000);
  return s < 60 ? Math.round(s) + " s" : s < 3600 ? Math.round(s / 60) + " min" : (s / 3600).toFixed(1) + " h";
}
