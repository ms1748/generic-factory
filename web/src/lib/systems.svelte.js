// The machines and the website (/api/systems), polled every 20 s while the page is visible and something
// on it shows them. Separate from /api/state so the GitHub side's minute cache isn't touched.

function savedRange() {
  try {
    return ["1h", "24h", "7d", "30d"].includes(localStorage.getItem("factory.range")) ? localStorage.getItem("factory.range") : "24h";
  } catch {
    return "24h";
  }
}

export const systems = $state({ data: null, error: "", range: savedRange() });

/** The charts' time range (1h, 24h, 7d, 30d), remembered on this browser. */
export function setRange(r) {
  systems.range = r;
  try {
    localStorage.setItem("factory.range", r);
  } catch {
    // private mode: not remembered
  }
  pull();
}

// Plain numbers, not state: watchSystems runs inside effects, which must not depend on what they write.
let timer = 0;
let watchers = 0;

/** Reload now (after a control). */
export async function pull() {
  clearTimeout(timer);
  try {
    const res = await fetch(`/api/systems?range=${encodeURIComponent(systems.range)}`, { cache: "no-store" });
    if (!res.ok) throw new Error(res.statusText);
    systems.data = await res.json();
    systems.error = "";
  } catch (e) {
    systems.error = e.message;
  }
  if (!document.hidden && watchers > 0) timer = setTimeout(pull, 20_000);
}

/** Call from a component's $effect: keeps the data fresh while it's on screen. */
export function watchSystems() {
  watchers++;
  if (watchers === 1) pull();
  return () => {
    watchers--;
    if (!watchers) clearTimeout(timer);
  };
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && watchers > 0) pull();
});

export const bytes = (b, digits = 1) => {
  if (b == null) return "–";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (b >= 1000 && i < u.length - 1) (b /= 1000), i++;
  return `${b.toFixed(i && b < 100 ? digits : 0)} ${u[i]}`;
};

export const count = (n) => (n == null ? "–" : n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + "k" : String(Math.round(n)));

export function uptime(s) {
  if (s == null) return "–";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  return d ? `${d}d ${h}h` : h ? `${h}h ${Math.floor((s % 3600) / 60)}m` : `${Math.floor(s / 60)}m`;
}

/** Colour for a 0..1 load: calm, busy, hot. */
export const level = (v, warn = 0.75, bad = 0.9) => (v == null ? "var(--line-2)" : v >= bad ? "var(--red)" : v >= warn ? "var(--amber)" : "var(--teal)");
export const tempLevel = (t) => level(t == null ? null : t / 100, 0.75, 0.88);
