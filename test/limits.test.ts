import assert from "node:assert/strict";
import { test } from "node:test";
import { budgetBlock, limits, usageStale } from "../src/dispatch.ts";
import { DEFAULTS, limitsFrom, mergeLimits } from "../src/limits.ts";
import { parseRateLimit } from "../src/runner.ts";
import { State } from "../src/state.ts";

test("limits: saved on the dashboard, else the env, else the defaults, each in range", () => {
  assert.deepEqual(limitsFrom(null), DEFAULTS);
  assert.deepEqual(limitsFrom(null, { FACTORY_MAX_FIVE_HOUR: "0.7", FACTORY_RUN_TIMEOUT_MIN: "90", FACTORY_USAGE_REFRESH_MIN: "0" }), { ...DEFAULTS, fiveHour: 0.7, runTimeoutMin: 90, usageRefreshMin: 0 });
  // The dashboard's value wins over the env's.
  assert.equal(limitsFrom({ fiveHour: 0.6 }, { FACTORY_MAX_FIVE_HOUR: "0.7" }).fiveHour, 0.6);
  // Junk falls through; out of range is clamped.
  assert.deepEqual(limitsFrom({ sevenDay: "lots", runTimeoutMin: 5000 }, { FACTORY_MAX_SEVEN_DAY: "", FACTORY_AUTOQUEUE_EVERY_H: "x" }), { ...DEFAULTS, runTimeoutMin: 600 });
  assert.equal(limitsFrom("not an object").fiveHour, 0.8);
});

test("limits: a change from the dashboard keeps the rest and refuses what's out of range", () => {
  assert.deepEqual(mergeLimits({ fiveHour: 0.7 }, { runTimeoutMin: 120 }), { fiveHour: 0.7, runTimeoutMin: 120 });
  assert.deepEqual(mergeLimits(null, { sevenDay: "0.854" }), { sevenDay: 0.85 });
  assert.throws(() => mergeLimits(null, { fiveHour: 80 }), /5-hour stop: pick 0.1 to 1/);
  assert.throws(() => mergeLimits(null, { runTimeoutMin: 1 }), /Run time limit/);
  assert.throws(() => mergeLimits(null, { autoQueueEveryH: null }), /Auto-queue interval/);
  assert.throws(() => mergeLimits(null, { cpus: 4 }), /unknown limit "cpus"/);
});

test("limits: the saved usage stops hold runs, and usage refresh 0 is off", () => {
  const now = Date.now();
  const s = new State(":memory:");
  s.saveUsage(parseRateLimit({ status: "allowed", resetsAt: now / 1000 + 3600, unifiedWindows: { five_hour: { utilization: 0.65, resetsAt: now / 1000 + 3600 } } }));
  assert.equal(budgetBlock(s, now), undefined, "under the default 80%");
  s.setLimitSettings(mergeLimits(s.limitSettings(), { fiveHour: 0.6 }));
  assert.match(budgetBlock(s, now) ?? "", /5-hour window at 65% \(limit 60%\)/);
  assert.equal(limits(s).fiveHour, 0.6);

  assert.equal(usageStale(s, 0), true);
  s.setLimitSettings(mergeLimits(s.limitSettings(), { usageRefreshMin: 0 }));
  assert.equal(usageStale(s, 0), false);
});
