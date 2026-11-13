import assert from "node:assert/strict";
import { test } from "node:test";
import { fromComment, fromEvent, fromIssue, MARKER, unseen } from "../src/activity.ts";
import { State } from "../src/state.ts";
import { useExample } from "./example-install.ts";

useExample();

const repo = "o/r";
const bot = { login: "example-factory[bot]" };
const at = "2026-10-29T12:00:00Z";

test("the bot's label, close and rename events undo as the opposite call; others' are skipped", () => {
  const labeled = fromEvent({ id: 1, event: "labeled", created_at: at, actor: bot, label: { name: "size:M" }, issue: { number: 5 } }, repo);
  assert.deepEqual(labeled?.undo, { method: "DELETE", path: "/repos/o/r/issues/5/labels/size%3AM" });
  assert.equal(labeled?.id, "event-1");
  const closed = fromEvent({ id: 2, event: "closed", created_at: at, actor: bot, issue: { number: 6, pull_request: {} } }, repo);
  assert.deepEqual(closed?.undo, { method: "PATCH", path: "/repos/o/r/issues/6", body: { state: "open" } });
  assert.equal(closed?.kind, "pr");
  const renamed = fromEvent({ id: 3, event: "renamed", created_at: at, actor: bot, rename: { from: "Old $(x)", to: "New" }, issue: { number: 7 } }, repo);
  assert.deepEqual(renamed?.undo?.body, { title: "Old $(x)" });
  assert.equal(fromEvent({ id: 4, event: "labeled", created_at: at, actor: { login: "o" }, label: { name: "p1" }, issue: { number: 5 } }, repo), null);
  assert.equal(fromEvent({ id: 5, event: "merged", created_at: at, actor: bot, issue: { number: 5 } }, repo), null);
});

test("comments: the bot's and marked cloud-run ones; cloud runs' issues are named to check by hand", () => {
  const mine = { id: 9, created_at: at, body: "hi", user: { login: "o" }, issue_url: "https://api.github.com/repos/o/r/issues/3" };
  const cloud = { ...mine, id: 10, body: `done ${MARKER}`, issue_url: "https://api.github.com/repos/o/r/issues/4" };
  const line = { id: 11, created_at: at, body: "fix", user: bot, pull_request_url: "https://api.github.com/repos/o/r/pulls/8" };
  assert.equal(fromComment(mine, repo), null);
  assert.deepEqual(fromComment(cloud, repo)?.undo, { method: "DELETE", path: "/repos/o/r/issues/comments/10" });
  assert.equal(fromComment(cloud, repo)?.what, "comment: done");
  assert.deepEqual(fromComment(line, repo, true)?.undo, { method: "DELETE", path: "/repos/o/r/pulls/comments/11" });
  assert.equal(fromComment(line, repo, true)?.n, 8);
  assert.deepEqual(unseen([mine, cloud, { ...cloud, id: 12 }]), [4]);
  const old = { ...cloud, id: 13, body: "earlier <!-- old-factory -->", issue_url: "https://api.github.com/repos/o/r/issues/5" };
  assert.equal(fromComment(old, repo)?.what, "comment: earlier");
  assert.deepEqual(unseen([cloud, old]), [4, 5]);
});

test("opened issues close as not planned, PRs just close; older ones aren't listed", () => {
  const from = new Date("2026-10-29T00:00:00Z");
  assert.deepEqual(fromIssue({ number: 20, title: "Idea", created_at: at, user: bot }, repo, from)?.undo, {
    method: "PATCH",
    path: "/repos/o/r/issues/20",
    body: { state: "closed", state_reason: "not_planned" },
  });
  assert.deepEqual(fromIssue({ number: 21, title: "PR", created_at: at, user: bot, pull_request: {} }, repo, from)?.undo, {
    method: "PATCH",
    path: "/repos/o/r/pulls/21",
    body: { state: "closed" },
  });
  assert.equal(fromIssue({ number: 22, title: "Old", created_at: "2026-10-01T00:00:00Z", user: bot }, repo, from), null);
});

test("undone actions are remembered once", () => {
  const s = new State(":memory:");
  s.markUndone("event-1");
  s.markUndone("event-1");
  assert.deepEqual([...s.undone()], ["event-1"]);
});
