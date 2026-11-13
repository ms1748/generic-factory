import assert from "node:assert/strict";
import { test } from "node:test";
import { defaults, lastSlot } from "../src/config.ts";
import { resetTime } from "../src/dispatch.ts";
import { lanePrompt } from "../src/prompt.ts";
import { State } from "../src/state.ts";

test("lanes start dry and switch on and off", () => {
  const s = new State(":memory:");
  assert.equal(s.lane("builder").live, false);
  s.setSlot("builder", "2026-10-28T13:00:00.000Z");
  s.setLive("builder", true);
  assert.deepEqual(s.lane("builder"), { live: true, lastSlot: "2026-10-28T13:00:00.000Z", on: null });
  s.setOn("builder", false);
  assert.equal(s.lane("builder").on, false);
  assert.equal(s.lane("builder").live, true, "turning a lane off keeps its live/dry choice");
  s.setLive("builder", false);
  assert.equal(s.lane("builder").live, false);
});

test("runs, stale runs and the pause", () => {
  const s = new State(":memory:");
  const id = s.startRun({ lane: "builder", model: "opus", mode: "live", card: 5, action: "build", status: "running" });
  assert.equal(s.running()?.id, id);
  assert.equal(s.failStale(), 1);
  assert.equal(s.running(), undefined);
  s.updateRun(id, { status: "done", pr: 9, cost_usd: 1.5 }, true);
  const [r] = s.recentRuns();
  assert.equal(r.status, "done");
  assert.equal(r.pr, 9);
  assert.ok(r.ended_at);
  s.setPause(new Date(Date.now() + 60_000), "limit");
  assert.equal(s.pause()?.reason, "limit");
  s.setPause(new Date(Date.now() - 1), "old");
  assert.equal(s.pause(), undefined);
});

test("last slot", () => {
  const wed = new Date(2026, 9, 28, 10, 30);
  const t = lastSlot(["09:00", "14:00"], wed)!;
  assert.equal(t.getHours(), 9);
  assert.equal(lastSlot(["mon,thu 08:00"], wed)!.getDay(), 1);
});

test("usage-limit reset time", () => {
  const now = new Date(2026, 9, 28, 10, 0);
  assert.equal(resetTime("Claude usage limit reached. Your limit resets 3pm", now)?.getHours(), 15);
  const tomorrow = resetTime("limit resets at 9:30 AM", now)!;
  assert.equal(tomorrow.getDate(), 29);
  assert.equal(tomorrow.getMinutes(), 30);
  assert.equal(resetTime("something else", now), undefined);
});

test("builder prompt names the picked card and the homelab rules", () => {
  const lane = defaults("o/r").lanes[0];
  const card = { number: 7, title: "Thing", size: "M", priority: "p1", state: "queued" as const, blockers: [] };
  const p = lanePrompt(lane, "o/r", { card, action: "build" });
  assert.match(p, /your card is #7 \("Thing"\); build it/);
  assert.match(p, /docs\/factory\/prompts\/builder\.md/);
  assert.match(p, /Don't subscribe to PR activity/);
});

test("links: seeded once, added, removed", () => {
  const s = new State(":memory:");
  s.seedOnce("links-v1", () => s.addLink("Sites", "Home", "https://example.com/"));
  s.seedOnce("links-v1", () => s.addLink("Sites", "Again", "https://example.org/"));
  assert.deepEqual(s.links().map((l) => l.title), ["Home"]);
  const id = s.addLink("Mail", "Webmail", "https://mail.example.com/");
  s.removeLink(s.links().find((l) => l.title === "Home")!.id);
  assert.deepEqual(s.links().map((l) => [l.grp, l.title]), [["Mail", "Webmail"]]);
  s.removeLink(id);
  s.seedOnce("links-v1", () => s.addLink("Sites", "Back", "https://example.net/"));
  assert.deepEqual(s.links(), [], "the defaults never come back once removed");
});

test("a merge conflict is sent to a run once per commit", () => {
  const s = new State(":memory:");
  assert.equal(s.conflictTried(5), undefined);
  s.markConflictTried(5, "abc");
  assert.equal(s.conflictTried(5), "abc");
  s.markConflictTried(5, "def");
  assert.equal(s.conflictTried(5), "def");
});
