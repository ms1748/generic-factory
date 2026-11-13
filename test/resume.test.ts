import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { describe as list, newFeedback, type PrItem } from "../src/feedback.ts";
import { resumePrompt } from "../src/prompt.ts";
import { prFromEvent, verifySignature } from "../src/server.ts";
import { State } from "../src/state.ts";

const item = (at: string, author: string, body: string, extra: Partial<PrItem> = {}): PrItem => ({ kind: "comment", author, body, at, ...extra });
const MARK = "\n<!-- factory -->";
const OLD_MARK = "\n<!-- old-factory -->"; // on comments posted before a rename
process.env.FACTORY_LEGACY_MARKERS = "old-factory";

test("only the owner's unanswered items after the handled time count", () => {
  const items = [
    item("2026-10-28T10:00:00Z", "owner-login", "before the run"),
    item("2026-10-28T12:00:00Z", "owner-login", "make it blue"),
    item("2026-10-28T12:05:00Z", "someone", "drive-by"),
    item("2026-10-28T12:06:00Z", "owner-login", "🤖 **Factory:** done" + MARK), // a cloud agent posting as the owner
    item("2026-10-28T12:07:00Z", "owner-login", "make it red"),
    item("2026-10-28T12:08:00Z", "owner-login", "🤖 **Factory:** done" + OLD_MARK),
    item("2026-10-28T12:10:00Z", "owner-login", "and bigger", { kind: "line comment", where: "src/a.ts:3" }),
    item("2026-10-28T12:11:00Z", "owner-login", "", { kind: "review", where: "COMMENTED" }), // wrapper of the line comment
    item("2026-10-28T12:12:00Z", "owner-login", "", { kind: "review", where: "CHANGES_REQUESTED" }),
  ];
  const got = newFeedback(items, "owner-login", "2026-10-28T11:00:00Z");
  assert.deepEqual(got.map((i) => i.body || i.where), ["and bigger", "CHANGES_REQUESTED"]);
});

test("an agent reply after the owner's comment means it's handled", () => {
  const items = [item("2026-10-28T12:00:00Z", "owner-login", "fix it"), item("2026-10-28T12:30:00Z", "example-factory[bot]", "on it")];
  assert.deepEqual(newFeedback(items, "owner-login", ""), []);
});

test("feedback list for the prompt", () => {
  const text = list([item("2026-10-28T12:10:00Z", "owner-login", "bigger\nplease", { kind: "line comment", where: "src/a.ts:3" })]);
  assert.match(text, /\[line comment on src\/a\.ts:3, 2026-10-28T12:10:00Z\]\n  > bigger\n  > please/);
  assert.match(resumePrompt(12, "claude/issue-5-x", text), /PR #12.*claude\/issue-5-x/s);
  assert.match(resumePrompt(12, "claude/issue-5-x", text), /end it with `<!-- factory -->`/);
});

test("webhook signatures", () => {
  const body = Buffer.from('{"a":1}');
  const sig = "sha256=" + createHmac("sha256", "s3cret").update(body).digest("hex");
  assert.equal(verifySignature("s3cret", body, sig), true);
  assert.equal(verifySignature("other", body, sig), false);
  assert.equal(verifySignature("s3cret", body, undefined), false);
  assert.equal(verifySignature("s3cret", body, "sha256=00"), false);
});

test("webhook events map to PRs on the project only", () => {
  const repository = { full_name: "o/r" };
  assert.equal(prFromEvent("issue_comment", { repository, issue: { number: 4, pull_request: {} } }, "o/r"), 4);
  assert.equal(prFromEvent("issue_comment", { repository, issue: { number: 4 } }, "o/r"), 4); // a card a session may be building
  assert.equal(prFromEvent("pull_request_review_comment", { repository, pull_request: { number: 9 } }, "o/r"), 9);
  assert.equal(prFromEvent("pull_request_review", { repository: { full_name: "x/y" }, pull_request: { number: 9 } }, "o/r"), undefined);
  assert.equal(prFromEvent("push", { repository }, "o/r"), undefined);
});

test("sessions: save, handle, close", () => {
  const s = new State(":memory:");
  s.saveSession({ pr: 12, card: 5, sessionId: "a", lane: "builder", runId: 1, branch: "claude/issue-5-x", handledAt: "t1" });
  s.markHandled(12, "t2", "b");
  assert.deepEqual(
    s.openSessions().map((x) => [x.pr, x.session_id, x.handled_at, x.branch]),
    [[12, "b", "t2", "claude/issue-5-x"]],
  );
  s.markHandled(12, "t3"); // a failed resume keeps the old session id
  assert.equal(s.openSessions()[0].session_id, "b");
  s.closeSession(12);
  assert.deepEqual(s.openSessions(), []);
});
