// The page-wide overlays any view can open: the details sheet (a card or PR, a lane's prompt, a trial
// report) and a confirmation. One of each at a time.
import { useSyncExternalStore } from "react";
import { control } from "./api";
import type { State } from "./api";

export type Item = {
  number: number;
  title: string;
  repo?: string;
  /** Where it sits: next, building, review, needsYou, hold, ideas, blocked, done. */
  column?: string;
  pr?: number | null;
  issue?: number | null;
  run?: number | null;
  running?: boolean;
  priority?: string | null;
  size?: string | null;
  labels?: string[];
  reason?: string;
  blockers?: number[];
  verdict?: string | null;
  testBuilds?: State;
  isPr?: boolean;
};

export type Detail = { type: "item"; item: Item } | { type: "prompt"; path: string; repo?: string } | { type: "trial"; trial: { name: string; title: string; wins: string } };

export type Ask = { title: string; body?: string; yes: string; danger?: boolean; action: () => unknown };

type O = { detail: Detail | null; ask: Ask | null; palette: boolean };
let o: O = { detail: null, ask: null, palette: false };
const subs = new Set<() => void>();
const set = (n: Partial<O>) => {
  o = { ...o, ...n };
  subs.forEach((f) => f());
};

export function useOverlays(): O {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => void subs.delete(f)),
    () => o,
  );
}

export const openItem = (item: Item) => set({ detail: { type: "item", item } });
export const openPrompt = (path: string, repo?: string) => set({ detail: { type: "prompt", path, repo } });
export const openTrial = (trial: { name: string; title: string; wins: string }) => set({ detail: { type: "trial", trial } });
export const closeDetail = () => set({ detail: null });
export const confirm = (ask: Ask) => set({ ask });
export const closeAsk = () => set({ ask: null });
export const setPalette = (palette: boolean) => set({ palette });

/** Build a card now (asks first). */
export function buildNow(card: { number: number; title: string; repo?: string }) {
  confirm({
    title: `Build #${card.number} now?`,
    body: `"${card.title}" starts right away with the builder lane for its size, live, even if that lane is dry. It uses your Claude plan.`,
    yes: "Build now",
    action: () => control(`cards/${card.number}/build`, { repo: card.repo }),
  });
}
