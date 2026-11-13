// What depends on what, for the board: each card's chain (what it waits on, what it unblocks, which
// feature it's part of) and one tree per feature (a parent issue whose parts say "Part of #n").
// Read from the issue texts the factory already writes ("Part of #12", "Blocked by #34"), plus GitHub's
// own blocked-by links on ready cards.
import { blockersIn } from "./queue.ts";

export type Stage = "done" | "building" | "review" | "queued" | "waiting" | "idea" | "hold" | "open";

export interface DepIssue {
  number: number;
  title: string;
  body: string;
  labels: string[];
  closed: boolean;
  /** GitHub's blocked-by links, when known. */
  blockedBy?: number[];
}

export interface Ref {
  number: number;
  title: string;
  stage: Stage;
}

export interface Chain {
  partOf: Ref | null;
  waitsOn: Ref[];
  unblocks: Ref[];
}

export interface Part extends Ref {
  /** Parts of the same feature this one waits on. */
  waitsOn: number[];
  /** 0 for parts that wait on nothing in the feature, then one more per step. */
  level: number;
}

export interface Feature extends Ref {
  parts: Part[];
  done: number;
}

/** "Part of #12" (the first one) in an issue's text. */
export function partOfIn(text: string): number | null {
  const m = text.match(/\bpart\s+of\s+#(\d+)/i);
  return m ? Number(m[1]) : null;
}

/** Where an issue stands, from its labels and whether a PR is open for it. */
export function stageOf(i: DepIssue, hasPr: boolean): Stage {
  if (i.closed) return "done";
  const l = new Set(i.labels);
  if (l.has("hold")) return "hold";
  if (l.has("review") || hasPr) return "review";
  if (l.has("building")) return "building";
  if (l.has("ready")) return "queued";
  if (l.has("idea")) return "idea";
  return "open";
}

/**
 * Chains for every issue that has one, and the features (parents with at least one part). `withPr` is
 * the set of issues an open PR works on. A part that waits on an unfinished part shows as "waiting".
 */
export function dependencies(issues: DepIssue[], withPr: Set<number>): { chains: Record<number, Chain>; features: Feature[] } {
  const byNumber = new Map(issues.map((i) => [i.number, i]));
  const waits = new Map<number, number[]>();
  const parent = new Map<number, number>();
  for (const i of issues) {
    const w = [...new Set([...(i.blockedBy ?? []), ...blockersIn(i.body)])].filter((n) => n !== i.number && byNumber.has(n));
    if (w.length) waits.set(i.number, w);
    const p = partOfIn(i.body);
    if (p && p !== i.number && byNumber.has(p)) parent.set(i.number, p);
  }
  const stage = (n: number): Stage => {
    const i = byNumber.get(n)!;
    const s = stageOf(i, withPr.has(n));
    // Queued or an idea, but something it waits on isn't done yet.
    if ((s === "queued" || s === "idea" || s === "open") && (waits.get(n) ?? []).some((w) => !byNumber.get(w)!.closed)) return "waiting";
    return s;
  };
  const ref = (n: number): Ref => ({ number: n, title: byNumber.get(n)!.title, stage: stage(n) });

  const unblocks = new Map<number, number[]>();
  for (const [n, ws] of waits) for (const w of ws) unblocks.set(w, [...(unblocks.get(w) ?? []), n]);

  const chains: Record<number, Chain> = {};
  for (const i of issues) {
    if (i.closed) continue;
    const c: Chain = {
      partOf: parent.has(i.number) ? ref(parent.get(i.number)!) : null,
      waitsOn: (waits.get(i.number) ?? []).map(ref),
      unblocks: (unblocks.get(i.number) ?? []).filter((n) => !byNumber.get(n)!.closed).map(ref),
    };
    if (c.partOf || c.waitsOn.length || c.unblocks.length) chains[i.number] = c;
  }

  const kids = new Map<number, number[]>();
  for (const [n, p] of parent) kids.set(p, [...(kids.get(p) ?? []), n]);
  const features: Feature[] = [];
  for (const [p, ns] of kids) {
    const inFeature = new Set(ns);
    const level = new Map<number, number>();
    const depth = (n: number, seen: Set<number>): number => {
      if (level.has(n)) return level.get(n)!;
      if (seen.has(n)) return 0; // a loop in the texts: stop rather than recurse forever
      seen.add(n);
      const ups = (waits.get(n) ?? []).filter((w) => inFeature.has(w));
      const d = ups.length ? 1 + Math.max(...ups.map((w) => depth(w, seen))) : 0;
      level.set(n, d);
      return d;
    };
    const parts = ns
      .map((n): Part => ({ ...ref(n), waitsOn: (waits.get(n) ?? []).filter((w) => inFeature.has(w)), level: depth(n, new Set()) }))
      .sort((a, b) => a.level - b.level || a.number - b.number);
    const parentIssue = byNumber.get(p)!;
    // Finished features (parent closed and every part done) leave the board.
    if (parentIssue.closed && parts.every((x) => x.stage === "done")) continue;
    features.push({ ...ref(p), parts, done: parts.filter((x) => x.stage === "done").length });
  }
  features.sort((a, b) => b.parts.length - b.done - (a.parts.length - a.done) || a.number - b.number);
  return { chains, features };
}
