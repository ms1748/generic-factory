// How many runs go at once (the dashboard's Settings › Parallel runs, 1 to MAX_PARALLEL, 1 by default)
// and which cards and PRs the runs in flight hold, so two runs never work on the same card or PR. Cards and
// PRs are per repo (app #5 and site #5 are different), so a hold is "repo#number".
// Each run is its own container on its own branch; this only decides when one may start.
import { primary } from "./install.ts";
import type { State } from "./state.ts";

export const MAX_PARALLEL = 3;

export type Kind = "build" | "lane" | "resume" | "review";

interface Flight {
  what: string;
  kind: Kind;
  cards: Set<string>;
  prs: Set<string>;
}

const at = (repo: string | undefined, n: number) => `${repo || primary()}#${n}`;

/** One run in flight. Claim the card or PR as soon as it is known, before any await. */
export class Ticket {
  readonly f: Flight;
  constructor(f: Flight) {
    this.f = f;
  }
  get kind(): Kind {
    return this.f.kind;
  }
  claim(card?: number | null, pr?: number | null, repo?: string): void {
    if (card) this.f.cards.add(at(repo, card));
    if (pr) this.f.prs.add(at(repo, pr));
  }
}

export class Slots {
  private flights = new Set<Flight>();
  private max: () => number;
  /** Runs the database says are going: also those a `run` command started outside the serve loop. */
  private recorded: () => { card: number | null; pr: number | null; repo?: string }[];
  /** Called when a run ends, so the serve loop fills the freed slot at once. */
  onDone: () => void = () => {};

  constructor(state?: Pick<State, "parallelRuns" | "runningRuns">) {
    this.max = () => state?.parallelRuns() ?? 1;
    this.recorded = () => state?.runningRuns() ?? [];
  }

  limit(): number {
    return Math.min(MAX_PARALLEL, Math.max(1, this.max()));
  }

  /** Runs going now: this loop's, or the database's count if a `run` command added more. */
  count(): number {
    return Math.max(this.flights.size, this.recorded().length);
  }

  free(): boolean {
    return this.count() < this.limit();
  }

  /** Whether a run in flight holds this card or PR of `repo` (the primary if left out). */
  holds(card?: number | null, pr?: number | null, repo?: string): boolean {
    const c = card ? at(repo, card) : "";
    const p = pr ? at(repo, pr) : "";
    for (const f of this.flights) if ((c && f.cards.has(c)) || (p && f.prs.has(p))) return true;
    return this.recorded().some((r) => (c && r.card && at(r.repo, r.card) === c) || (p && r.pr && at(r.repo, r.pr) === p));
  }

  /** Card numbers of `repo` that runs in flight hold, leaving out `except`'s own. */
  cards(except?: Ticket, repo?: string): Set<number> {
    const mine = new Set(except ? except.f.cards : []);
    const keys = [
      ...[...this.flights].filter((f) => f !== except?.f).flatMap((f) => [...f.cards]),
      ...this.recorded().flatMap((r) => (r.card ? [at(r.repo, r.card)] : [])),
    ].filter((k) => !mine.has(k));
    const prefix = `${repo || primary()}#`;
    return new Set(keys.filter((k) => k.startsWith(prefix)).map((k) => Number(k.slice(prefix.length))));
  }

  /** New builds in flight (they may open a PR the open-PR limit doesn't see yet). */
  building(): number {
    return [...this.flights].filter((f) => f.kind === "build").length;
  }

  /**
   * Starts `work` without waiting for it, if a slot is free and nothing in flight holds the card or PR.
   * Returns whether it started.
   */
  spawn(
    what: string,
    kind: Kind,
    log: (line: string) => void,
    work: (t: Ticket) => Promise<unknown>,
    hold: { card?: number | null; pr?: number | null; repo?: string } = {},
  ): boolean {
    if (!this.free() || this.holds(hold.card, hold.pr, hold.repo)) return false;
    const f: Flight = { what, kind, cards: new Set(), prs: new Set() };
    const t = new Ticket(f);
    t.claim(hold.card, hold.pr, hold.repo);
    this.flights.add(f);
    void (async () => {
      try {
        await work(t);
      } catch (e) {
        log(`${what} failed: ${(e as Error).message}`);
      } finally {
        this.flights.delete(f);
        this.onDone();
      }
    })();
    return true;
  }
}

/** Each run's share of the agent container limits, so runs at once fit the dispatcher's container. */
export function agentLimits(runs: number, env: { cpus?: string; memory?: string } = {}): { cpus: string; memory: string } {
  const n = Math.min(MAX_PARALLEL, Math.max(1, runs));
  return {
    cpus: env.cpus ?? String(Math.max(1, Math.floor((5 / n) * 10) / 10)),
    memory: env.memory ?? (n === 1 ? "8g" : `${Math.floor(8192 / n)}m`),
  };
}
