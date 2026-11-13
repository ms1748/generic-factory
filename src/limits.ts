// Settings › Limits: the owner's knobs that used to live only in the env. Saved from the dashboard; until
// then each falls back to its env var (an existing install keeps what it set) and then to the default.
// Pure, so it's testable without a database.

export interface Limits {
  /** No new run once the plan's 5-hour window is at this share (0-1). */
  fiveHour: number;
  /** No new run once the week is at this share (0-1). */
  sevenDay: number;
  /** A run is stopped after this many minutes. */
  runTimeoutMin: number;
  /** While nothing reports usage, a tiny Haiku call refreshes the meters this often (minutes, 0 is off). */
  usageRefreshMin: number;
  /** Auto-queue tries at most once per project this often (hours). */
  autoQueueEveryH: number;
}

export const DEFAULTS: Limits = { fiveHour: 0.8, sevenDay: 0.9, runTimeoutMin: 180, usageRefreshMin: 30, autoQueueEveryH: 3 };

/** Each setting's range; a value outside it is clamped. */
export const RANGE: Record<keyof Limits, [number, number]> = {
  fiveHour: [0.1, 1],
  sevenDay: [0.1, 1],
  runTimeoutMin: [10, 600],
  usageRefreshMin: [0, 240],
  autoQueueEveryH: [1, 48],
};

/** The env var each one fell back to before it was on the dashboard. */
export const ENV: Record<keyof Limits, string> = {
  fiveHour: "FACTORY_MAX_FIVE_HOUR",
  sevenDay: "FACTORY_MAX_SEVEN_DAY",
  runTimeoutMin: "FACTORY_RUN_TIMEOUT_MIN",
  usageRefreshMin: "FACTORY_USAGE_REFRESH_MIN",
  autoQueueEveryH: "FACTORY_AUTOQUEUE_EVERY_H",
};

const KEYS = Object.keys(DEFAULTS) as (keyof Limits)[];
const num = (v: unknown): number | undefined => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
};
const fit = (k: keyof Limits, n: number) => {
  const [lo, hi] = RANGE[k];
  // Shares keep two decimals (whole percents); minutes and hours are whole.
  const r = k === "fiveHour" || k === "sevenDay" ? Math.round(n * 100) / 100 : Math.round(n);
  return Math.min(hi, Math.max(lo, r));
};

/** The limits in force: saved on the dashboard, else the env, else the default, each in range. */
export function limitsFrom(saved: unknown, env: Record<string, string | undefined> = {}): Limits {
  const s = (saved && typeof saved === "object" ? saved : {}) as Record<string, unknown>;
  return Object.fromEntries(KEYS.map((k) => [k, fit(k, num(s[k]) ?? num(env[ENV[k]]) ?? DEFAULTS[k])])) as unknown as Limits;
}

/**
 * A change from the dashboard over what's saved: only known keys, each a number in range. Throws with a
 * message for the owner when a value is out of range, rather than quietly clamping it.
 */
export function mergeLimits(saved: unknown, change: Record<string, unknown>): Partial<Limits> {
  const out = { ...((saved && typeof saved === "object" ? saved : {}) as Partial<Limits>) };
  for (const [k, v] of Object.entries(change)) {
    if (!KEYS.includes(k as keyof Limits)) throw new Error(`unknown limit "${k}"`);
    const key = k as keyof Limits;
    const n = num(v);
    const [lo, hi] = RANGE[key];
    if (n === undefined || n < lo || n > hi) throw new Error(`${LABEL[key]}: pick ${lo} to ${hi}${key === "fiveHour" || key === "sevenDay" ? " (a share, 1 is 100%)" : ""}`);
    out[key] = fit(key, n);
  }
  return out;
}

const LABEL: Record<keyof Limits, string> = {
  fiveHour: "5-hour stop",
  sevenDay: "Weekly stop",
  runTimeoutMin: "Run time limit",
  usageRefreshMin: "Usage refresh",
  autoQueueEveryH: "Auto-queue interval",
};
