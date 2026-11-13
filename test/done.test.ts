import assert from "node:assert/strict";
import { test } from "node:test";
import { cardOf, doneLine, type Check } from "../src/done.ts";
import { State } from "../src/state.ts";
import { useExample } from "./example-install.ts";

useExample();

const ok = (name: string): Check => ({ name, status: "completed", conclusion: "success" });
const facts = (checks: Check[], extra = {}) => ({ pr: 12, card: 7, checks, verdict: "ready", followups: [] as number[], ...extra });

test("everything green and reviewed: done, with the device tests and follow-ups named", () => {
  const r = doneLine(facts([ok("Frontend checks"), ok("Hardware tests (test box)")], { followups: [30, 31] }));
  assert.equal(r.ok, true);
  assert.match(r.line, /^✅ \*\*Done\.\*\* Merged #12\. CI green \(2 checks\)\. Device tests passed: Hardware tests \(test box\)\. Follow-ups filed: #30, #31\. Nothing waiting on you\.$/);
});

test("no device check ran: still done, and the line says none were needed", () => {
  const r = doneLine(facts([ok("Frontend checks"), { name: "Rust checks (Linux)", status: "completed", conclusion: "skipped" }]));
  assert.equal(r.ok, true);
  assert.match(r.line, /No device tests ran/);
  assert.match(r.line, /No follow-ups\./);
});

test("anything missing makes it not done, and says exactly what", () => {
  const failed = doneLine(facts([ok("Frontend checks"), { name: "Hardware tests (test box)", status: "completed", conclusion: "failure" }]));
  assert.equal(failed.ok, false);
  assert.match(failed.line, /^⚠️ \*\*Not done yet\.\*\* #12 merged, but failed: Hardware tests \(test box\); device tests didn't pass: Hardware tests \(test box\)\./);

  const none = doneLine(facts([]));
  assert.equal(none.ok, false);
  assert.match(none.line, /no CI ran on it/);

  const going = doneLine(facts([{ name: "Windows build and tests", status: "in_progress", conclusion: null }]));
  assert.match(going.line, /still running at merge: Windows build and tests/);

  assert.match(doneLine(facts([ok("a")], { verdict: undefined })).line, /the reviewer never passed it/);
  assert.match(doneLine(facts([ok("a")], { verdict: "needs-work" })).line, /last verdict was "needs-work"/);
});

test("the card: the builder's branch first, else a closing keyword in the body", () => {
  assert.equal(cardOf("claude/issue-45-done-line", "Closes #9"), 45);
  assert.equal(cardOf("feature/x", "Some text.\n\nCloses #44."), 44);
  assert.equal(cardOf("feature/x", "fixes #3"), 3);
  assert.equal(cardOf("feature/x", "See #3"), null);
  assert.equal(cardOf("feature/x", null), null);
});

test("Done lines: set once per PR, listed newest first since a date, kept apart per repo", () => {
  const s = new State(":memory:");
  const first = s.doneSince(new Date("2026-11-11T00:00:00Z"));
  assert.equal(s.doneSince(new Date("2027-01-01T00:00:00Z")), first); // set once
  s.saveDone({ pr: 1, card: 5, title: "a", ok: true, line: "x", at: "2026-11-01T00:00:00Z" });
  s.saveDone({ pr: 2, card: 6, title: "b", ok: false, line: "y", at: "2026-11-10T00:00:00Z" });
  assert.deepEqual(s.dones("2026-10-01T00:00:00Z").map((r) => r.pr), [2, 1]);
  assert.deepEqual(s.dones("2026-11-05T00:00:00Z").map((r) => r.pr), [2]);
  assert.equal(s.doneRecord(1)?.card, 5);
  const site = s.for("owner/site");
  assert.equal(site.doneRecord(1), undefined);
  site.saveDone({ pr: 1, card: 9, title: "c", ok: true, line: "z", at: "2026-11-10T00:00:00Z" });
  assert.deepEqual(s.dones("2026-10-01T00:00:00Z").map((r) => r.card), [6, 5]);
  assert.deepEqual(site.dones("2026-10-01T00:00:00Z").map((r) => r.card), [9]);
});

test("a skipped device job counts as not run, not as failed", () => {
  const r = doneLine({ pr: 277, card: 191, checks: [ok("Frontend checks"), ok("Windows build and tests"), { name: "Hardware tests (test box)", status: "completed", conclusion: "skipped" }], verdict: "ready", followups: [290] });
  assert.equal(r.ok, true);
  assert.match(r.line, /No device tests ran/);
});
