import assert from "node:assert/strict";
import { test } from "node:test";
import { agentLimits, MAX_PARALLEL, Slots } from "../src/slots.ts";
import { State } from "../src/state.ts";

const tick = () => new Promise((r) => setImmediate(r));
/** A run that ends when its `done()` is called. */
function gate() {
  let done = () => {};
  const finished = new Promise<void>((r) => (done = r));
  return { done, work: () => finished };
}

test("Parallel runs defaults to one and is capped", () => {
  const s = new State(":memory:");
  assert.equal(s.parallelRuns(), 1);
  s.setParallelRuns(2);
  assert.equal(new Slots(s).limit(), 2);
  s.setParallelRuns(9);
  assert.equal(new Slots(s).limit(), MAX_PARALLEL);
  assert.equal(new Slots().limit(), 1, "without a state (the CLI): one at a time");
});

test("runs start up to the limit and a finished one frees its slot", async () => {
  const s = new State(":memory:");
  s.setParallelRuns(2);
  const slots = new Slots(s);
  let freed = 0;
  slots.onDone = () => freed++;
  const a = gate();
  const b = gate();
  assert.equal(slots.spawn("a", "build", () => {}, a.work), true);
  assert.equal(slots.spawn("b", "review", () => {}, b.work), true);
  assert.equal(slots.spawn("c", "lane", () => {}, async () => {}), false, "no third slot");
  assert.equal(slots.count(), 2);
  assert.equal(slots.building(), 1);
  a.done();
  await tick();
  assert.equal(freed, 1);
  assert.equal(slots.free(), true);
  b.done();
  await tick();
  assert.equal(slots.count(), 0);
});

test("two runs never hold the same card or PR", async () => {
  const s = new State(":memory:");
  s.setParallelRuns(3);
  const slots = new Slots(s);
  const a = gate();
  assert.equal(slots.spawn("resume PR #20", "resume", () => {}, a.work, { card: 5, pr: 20 }), true);
  assert.equal(slots.spawn("review PR #20", "review", () => {}, async () => {}, { pr: 20 }), false);
  assert.equal(slots.spawn("build #5", "build", () => {}, async () => {}, { card: 5 }), false);
  assert.equal(slots.holds(5), true);
  assert.equal(slots.holds(null, 20), true);
  assert.equal(slots.holds(6, 21), false);
  // A build claims its card once it has picked one; others then skip it.
  const b = gate();
  slots.spawn("builder run", "build", () => {}, (t) => (t.claim(7), b.work()));
  assert.deepEqual([...slots.cards()].sort(), [5, 7]);
  a.done();
  b.done();
  await tick();
  assert.equal(slots.holds(5), false);
});

test("a run that throws is logged and still frees its slot", async () => {
  const slots = new Slots();
  const lines: string[] = [];
  slots.spawn("broken", "lane", (l) => lines.push(l), async () => {
    throw new Error("boom");
  });
  await tick();
  await tick();
  assert.equal(slots.count(), 0);
  assert.match(lines[0], /broken failed: boom/);
});

test("runs a `run` command started count too, and keep their card", () => {
  const s = new State(":memory:");
  s.setParallelRuns(2);
  const slots = new Slots(s);
  s.startRun({ lane: "builder", model: "opus", mode: "live", card: 218, action: "build", status: "running" });
  assert.equal(slots.count(), 1);
  assert.equal(slots.holds(218), true);
  assert.equal(slots.spawn("build #218", "build", () => {}, async () => {}, { card: 218 }), false);
  s.startRun({ lane: "small-builder", model: "sonnet", mode: "live", card: 189, action: "build", status: "running" });
  assert.equal(slots.free(), false, "two recorded runs fill two slots");
});

test("each run gets its share of the agent limits", () => {
  assert.deepEqual(agentLimits(1), { cpus: "5", memory: "8g" });
  assert.deepEqual(agentLimits(2), { cpus: "2.5", memory: "4096m" });
  assert.deepEqual(agentLimits(3), { cpus: "1.6", memory: "2730m" });
  assert.deepEqual(agentLimits(2, { cpus: "4", memory: "6g" }), { cpus: "4", memory: "6g" }, "FACTORY_AGENT_* still win");
});
