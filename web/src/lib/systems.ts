// The machines and the website (/api/systems), polled every 20 s while the page is visible and a view that
// shows them is mounted (useSystems). Separate from /api/state so the GitHub side's minute cache isn't touched.
import { useEffect, useSyncExternalStore } from "react";
import type { State } from "./api";

export type Range = "1h" | "24h" | "7d" | "30d";
export const RANGES: Range[] = ["1h", "24h", "7d", "30d"];

function savedRange(): Range {
  try {
    const r = localStorage.getItem("factory.range") as Range;
    return RANGES.includes(r) ? r : "24h";
  } catch {
    return "24h";
  }
}

type Sys = { data: State | null; error: string; range: Range };
let sys: Sys = { data: null, error: "", range: savedRange() };
const subs = new Set<() => void>();
const set = (n: Partial<Sys>) => {
  sys = { ...sys, ...n };
  subs.forEach((f) => f());
};

let timer = 0;
let watchers = 0;

/** Reload now (after a control). */
export async function pull() {
  clearTimeout(timer);
  try {
    const res = await fetch(`/api/systems?range=${encodeURIComponent(sys.range)}`, { cache: "no-store" });
    if (!res.ok) throw new Error(res.statusText);
    set({ data: await res.json(), error: "" });
  } catch (e) {
    set({ error: (e as Error).message });
  }
  if (!document.hidden && watchers > 0) timer = window.setTimeout(pull, 20_000);
}

/** The charts' time range, remembered on this browser. */
export function setRange(r: Range) {
  set({ range: r });
  try {
    localStorage.setItem("factory.range", r);
  } catch {
    // private mode: not remembered
  }
  pull();
}

/** The systems data, kept fresh while the calling component is mounted. */
export function useSystems(): Sys {
  useEffect(() => {
    watchers++;
    if (watchers === 1) pull();
    return () => {
      watchers--;
      if (!watchers) clearTimeout(timer);
    };
  }, []);
  return useSyncExternalStore(
    (f) => (subs.add(f), () => void subs.delete(f)),
    () => sys,
  );
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && watchers > 0) pull();
});
