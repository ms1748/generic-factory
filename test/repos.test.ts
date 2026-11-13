import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { State } from "../src/state.ts";

const PRIMARY = "owner/app";
process.env.FACTORY_PROJECTS = `${PRIMARY},owner/site`;
import { Slots } from "../src/slots.ts";
import { prFromEvent } from "../src/server.ts";

const SITE = "owner/site";

test("each repo keeps its own PR sessions, reviews and retries; runs and settings are shared", () => {
  const root = new State(":memory:");
  const site = root.for(SITE);
  assert.equal(root.for(PRIMARY).scope, "", "the primary keeps the old rows");
  root.saveSession({ pr: 5, card: 1, sessionId: "app", lane: "builder", runId: 1, branch: "claude/issue-1-a", handledAt: "" });
  site.saveSession({ pr: 5, card: 2, sessionId: "site", lane: "builder", runId: 2, branch: "claude/issue-2-b", handledAt: "" });
  assert.deepEqual(root.openSessions().map((s) => s.session_id), ["app"]);
  assert.deepEqual(site.openSessions().map((s) => s.session_id), ["site"]);
  site.closeSession(5);
  assert.equal(root.openSessions().length, 1, "closing the site's #5 leaves the app's #5 open");

  site.saveReview({ pr: 7, sha: "abc", verdict: "ready", runId: 3, posted: true });
  assert.equal(site.reviewed(7, "abc"), true);
  assert.equal(root.reviewed(7, "abc"), false);
  site.markCiTried(7, "abc");
  assert.equal(root.ciTried(7).count, 0);
  assert.equal(site.ciTried(7).count, 1);

  const id = site.startRun({ lane: "builder", model: "opus", mode: "live", card: 2, action: "build", status: "running" });
  assert.equal(root.run(id)?.repo, SITE, "runs record their repo");
  assert.equal(root.runningRuns().length, 1, "and count against one shared limit");
  root.setParallelRuns(2);
  assert.equal(site.parallelRuns(), 2);
});

test("an existing database moves its sessions to repo-keyed rows without losing any", () => {
  const dir = mkdtempSync(join(tmpdir(), "factory-"));
  const file = join(dir, "old.db");
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE sessions (pr INTEGER PRIMARY KEY, card INTEGER, session_id TEXT NOT NULL, lane TEXT NOT NULL, run_id INTEGER NOT NULL, updated_at TEXT NOT NULL,
    branch TEXT NOT NULL DEFAULT '', handled_at TEXT NOT NULL DEFAULT '', closed INTEGER NOT NULL DEFAULT 0);
    INSERT INTO sessions VALUES (216, 181, 'sess', 'builder', 208, '2026-11-08', 'claude/issue-181-x', '2026-11-08', 0);`);
  old.close();
  const s = new State(file);
  assert.deepEqual(s.openSessions().map((x) => [x.pr, x.session_id, x.repo]), [[216, "sess", ""]]);
  s.for(SITE).saveSession({ pr: 216, card: 3, sessionId: "other", lane: "builder", runId: 9, branch: "b", handledAt: "" });
  assert.equal(s.openSessions().length, 1, "the same PR number in another repo is its own row");
});

test("run slots hold cards per repo", async () => {
  const s = new State(":memory:");
  s.setParallelRuns(3);
  const slots = new Slots(s);
  let done = () => {};
  const work = () => new Promise<void>((r) => (done = r));
  assert.equal(slots.spawn("build app #5", "build", () => {}, work, { card: 5 }), true);
  assert.equal(slots.holds(5), true);
  assert.equal(slots.holds(5, null, SITE), false, "the site's #5 is a different card");
  assert.equal(slots.spawn("build site #5", "build", () => {}, async () => {}, { card: 5, repo: SITE }), true);
  assert.deepEqual([...slots.cards(undefined, PRIMARY)], [5]);
  s.for(SITE).startRun({ lane: "builder", model: "opus", mode: "live", card: 9, action: "build", status: "running" });
  assert.equal(slots.holds(9, null, SITE), true, "a recorded run in the site holds its card");
  assert.equal(slots.holds(9), false);
  done();
});

test("webhooks from any of the factory's repos are taken; others are ignored", () => {
  const payload = (repo: string) => ({ repository: { full_name: repo }, issue: { number: 12 } });
  assert.equal(prFromEvent("issue_comment", payload(SITE), [PRIMARY, SITE]), 12);
  assert.equal(prFromEvent("issue_comment", payload("someone/else"), [PRIMARY, SITE]), undefined);
  assert.equal(prFromEvent("issue_comment", payload(PRIMARY), PRIMARY), 12, "a single repo still works");
});
