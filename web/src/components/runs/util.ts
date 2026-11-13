// Shared bits for the Runs page: what a run's status means, its card, the transcript's shape, and a
// "wide screen" check (side-by-side panel on desktop, a sheet on phones).
import { useSyncExternalStore } from "react";
import * as React from "react";
import { runLog, type State } from "@/lib/api";
import { openItem } from "@/lib/overlays";

export const WORD: Record<string, string> = { running: "Running", done: "Done", failed: "Failed", limited: "Hit the usage limit", dry: "Dry run", idle: "Nothing to do" };
export const failed = (r: State) => r.status === "failed" || r.status === "limited";
export const toneOf = (r: State): "ok" | "bad" | "brand" | "muted" => (r.status === "running" ? "brand" : r.status === "done" ? "ok" : failed(r) ? "bad" : "muted");

/** The board card a run worked on (and its column), if it's still on the board. */
export function cardOf(d: State, n: number | null | undefined, repo?: string | null): { card: State; column: string } | null {
  if (!n) return null;
  const r = repo ?? d.repo;
  for (const [column, list] of Object.entries(d.board ?? {})) {
    if (!Array.isArray(list)) continue;
    const card = list.find((c: State) => (c.number === n || c.issue === n) && (c.repo ?? d.repo) === r);
    if (card) return { card, column };
  }
  return null;
}

/** Opens a card in the details sheet (what's on the board, or just its number). */
export function openCard(d: State, n: number, repo?: string | null, isPr = false) {
  const hit = cardOf(d, n, repo);
  openItem(hit ? { ...hit.card, repo: hit.card.repo ?? d.repo, column: hit.column } : { number: n, title: `#${n}`, repo: repo ?? d.repo, isPr });
}

const wideQuery = typeof window !== "undefined" ? window.matchMedia("(min-width: 1024px)") : null;
export function useWide() {
  return useSyncExternalStore(
    (f) => (wideQuery?.addEventListener("change", f), () => wideQuery?.removeEventListener("change", f)),
    () => wideQuery?.matches ?? true,
  );
}

export type Entry = { kind: "text" | "tool" | "result" | "error" | "done" | "stderr"; text: string; name?: string };
export type Item = { type: "say"; text: string } | { type: "step"; name: string; text: string; result: string | null; error: boolean } | { type: "note"; text: string; error: boolean };

/** Pairs each tool call with the result after it; keeps the agent's words and the outcome. */
export function build(entries: Entry[]) {
  const list: Item[] = [];
  let outcome: string | null = null;
  for (const e of entries) {
    if (e.kind === "tool") list.push({ type: "step", name: e.name ?? "Tool", text: e.text, result: null, error: false });
    else if (e.kind === "result" || e.kind === "error") {
      const step = [...list].reverse().find((x) => x.type === "step" && x.result === null) as Extract<Item, { type: "step" }> | undefined;
      if (step) {
        step.result = e.text;
        step.error = e.kind === "error";
      } else list.push({ type: "note", text: e.text, error: e.kind === "error" });
    } else if (e.kind === "text") list.push({ type: "say", text: e.text });
    else if (e.kind === "done") outcome = e.text;
    else if (e.kind === "stderr") list.push({ type: "note", text: e.text, error: true });
  }
  return { list, outcome, steps: list.filter((x) => x.type === "step").length, errors: list.filter((x) => x.type !== "say" && x.error).length };
}

/** A run's transcript; refetched every few seconds while it's running. */
export function useRunLog(id: number | null | undefined, running: boolean, initial?: Entry[]) {
  const [entries, setEntries] = React.useState<Entry[] | null>(initial ?? null);
  React.useEffect(() => {
    if (!id) return;
    let stop = false;
    let timer = 0;
    setEntries(initial ?? null);
    const pull = async () => {
      const e = (await runLog(id)) as Entry[];
      if (stop) return;
      setEntries((old) => (old && old.length === e.length ? old : e));
      if (running && !document.hidden) timer = window.setTimeout(pull, 4000);
      else if (running) timer = window.setTimeout(pull, 15000);
    };
    pull();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, running]);
  return entries;
}
