// The page's one source of truth: /api/state, polled (faster while a run is going, never while hidden),
// plus the controls (POSTs with the x-factory header the server requires). React reads it with useStore().
import { useSyncExternalStore } from "react";
import { toast } from "sonner";

/** The dispatcher's state (src/dashboard.ts state()); typed loosely on purpose, the server owns the shape. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type State = any;

type Store = { data: State | null; error: string; loadedAt: number };

function cached(): State | null {
  try {
    return JSON.parse(localStorage.getItem("factory.state") ?? "null");
  } catch {
    return null;
  }
}

let store: Store = { data: cached(), error: "", loadedAt: 0 };
const subs = new Set<() => void>();
const set = (next: Partial<Store>) => {
  store = { ...store, ...next };
  subs.forEach((f) => f());
};

export function useStore(): Store {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => void subs.delete(f)),
    () => store,
  );
}

let timer = 0;

export async function load() {
  clearTimeout(timer);
  try {
    const res = await fetch("/api/state", { cache: "no-store" });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
    const data = await res.json();
    try {
      localStorage.setItem("factory.state", JSON.stringify(data));
    } catch {
      // full or private: no cache, just a slower first paint
    }
    set({ data, error: "", loadedAt: Date.now() });
  } catch (e) {
    set({ error: (e as Error).message });
  }
  if (!document.hidden) timer = window.setTimeout(load, store.data?.running ? 4000 : 15000);
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) load();
  else clearTimeout(timer);
});

export function say(text: string, bad = false) {
  if (bad) toast.error(text);
  else toast.success(text);
}

/** POSTs a control; says how it went. Returns whether it worked. */
export async function control(path: string, body: Record<string, unknown> = {}, ok?: string): Promise<boolean> {
  let worked = false;
  try {
    const res = await fetch("/api/" + path, {
      method: "POST",
      headers: { "content-type": "application/json", "x-factory": "1" },
      body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || res.statusText);
    say(ok || j.message || "Done");
    worked = true;
  } catch (e) {
    say((e as Error).message, true);
  }
  load();
  setTimeout(load, 2500); // queued runs land a moment later
  return worked;
}

/** GET JSON from the dispatcher (null on failure). */
export async function getJson<T = State>(path: string): Promise<T | null> {
  try {
    const res = await fetch(path, { cache: "no-store" });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/** POST JSON to a non-control endpoint (alerts settings, Discord hook); returns the parsed answer and ok. */
export async function postJson(path: string, body?: unknown): Promise<{ ok: boolean; json: State }> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-factory": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { ok: res.ok, json: await res.json().catch(() => ({})) };
}

export async function runLog(id: number) {
  return (await getJson(`/api/runs/${id}/log`)) ?? [];
}
