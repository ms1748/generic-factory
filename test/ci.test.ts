import assert from "node:assert/strict";
import { test } from "node:test";
import { errorLines, finishedSince, NOT_STARTED, notStarted, verdict, type CheckRun } from "../src/ci.ts";
import type { GitHub } from "../src/github.ts";
import { resumePrompt } from "../src/prompt.ts";
import { prFromEvent } from "../src/server.ts";
import { State } from "../src/state.ts";

const run = (name: string, status: string, conclusion: string | null, completed_at: string | null = null): CheckRun => ({ id: 1, name, status, conclusion, completed_at });

test("CI is red only once every check has finished; cancelled and skipped don't count", () => {
  assert.equal(verdict([]).state, "none");
  assert.equal(verdict([run("a", "completed", "skipped")]).state, "none");
  assert.equal(verdict([run("a", "completed", "success"), run("b", "in_progress", null)]).state, "pending");
  assert.equal(verdict([run("a", "completed", "failure"), run("b", "queued", null)]).state, "pending");
  assert.equal(verdict([run("a", "completed", "success"), run("b", "completed", "cancelled")]).state, "green");
  const v = verdict([run("Frontend", "completed", "success"), run("Windows", "completed", "failure"), run("Old", "completed", "cancelled")]);
  assert.equal(v.state, "red");
  assert.deepEqual(v.state === "red" ? v.failed.map((f) => f.name) : [], ["Windows"]);
});

test("only CI that finished after the session last ran counts", () => {
  const runs = [run("a", "completed", "failure", "2026-11-07T14:21:00Z")];
  assert.equal(finishedSince(runs, "2026-11-07T14:00:19Z"), true);
  assert.equal(finishedSince(runs, "2026-11-07T15:00:00Z"), false);
  assert.equal(finishedSince([run("a", "completed", "failure")], ""), false);
});

test("job logs boil down to the error lines, without timestamps or colour codes", () => {
  const log = [
    "2026-11-07T14:20:06.5341321Z   CACHE_ON_FAILURE: false",
    "2026-11-07T14:21:11.8974908Z test hardware::two_devices ... FAILED",
    "2026-11-07T14:21:14.9296340Z thread 'hardware::two_devices' panicked at src\\hardware.rs:26:22:",
    "2026-11-07T14:21:14.9296340Z virtual controller ready: WinError(483)",
    "2026-11-07T14:21:15.0000000Z \x1b[31m##[error]Process completed with exit code 101.\x1b[0m",
    "2026-11-07T14:21:15.0000000Z all good here",
  ].join("\n");
  assert.deepEqual(errorLines(log), [
    "test hardware::two_devices ... FAILED",
    "thread 'hardware::two_devices' panicked at src\\hardware.rs:26:22:",
    "virtual controller ready: WinError(483)",
    "##[error]Process completed with exit code 101.",
    "all good here",
  ]);
  assert.equal(errorLines(Array(200).fill("error: x").join("\n"), 10).length, 10);
});

test("a finished check suite or workflow run wakes its PR; others don't", () => {
  const repo = "owner/app";
  const base = { repository: { full_name: repo } };
  assert.equal(prFromEvent("check_suite", { ...base, action: "completed", check_suite: { pull_requests: [{ number: 196 }] } }, repo), 196);
  assert.equal(prFromEvent("workflow_run", { ...base, action: "completed", workflow_run: { pull_requests: [{ number: 7 }] } }, repo), 7);
  assert.equal(prFromEvent("workflow_run", { ...base, action: "requested", workflow_run: { pull_requests: [{ number: 7 }] } }, repo), undefined);
  assert.equal(prFromEvent("check_suite", { ...base, action: "completed", check_suite: { pull_requests: [] } }, repo), undefined);
  assert.equal(prFromEvent("check_suite", { repository: { full_name: "x/y" }, action: "completed", check_suite: { pull_requests: [{ number: 1 }] } }, repo), undefined);
  assert.equal(prFromEvent("issue_comment", { ...base, issue: { number: 5 } }, repo), 5);
});

test("CI resumes are counted per PR and remembered per commit", () => {
  const s = new State(":memory:");
  assert.deepEqual(s.ciTried(196), { sha: "", count: 0 });
  s.markCiTried(196, "abc");
  s.markCiTried(196, "def");
  assert.deepEqual(s.ciTried(196), { sha: "def", count: 2 });
  assert.deepEqual(s.ciTried(5), { sha: "", count: 0 });
});

test("the resume prompt says when the news is the dispatcher's, not the owner's", () => {
  assert.match(resumePrompt(196, "claude/issue-165-x", "- [comment]", true), /^The dispatcher has news on your PR #196[\s\S]*not the owner/);
  assert.match(resumePrompt(196, "b", "- [comment]"), /^The owner replied on your PR #196/);
  assert.match(resumePrompt(196, "b", "x"), /Never wait for CI/);
});

// GitHub's own wording when Actions minutes or the spending limit are used up (seen 2026-11-10).
test("checks GitHub never started aren't sent back to the builder", async () => {
  const notes: Record<number, { message: string }[]> = {
    1: [{ message: "The job was not started because recent account payments have failed or your spending limit needs to be increased. Please check the 'Billing & plans' section in your settings" }],
    2: [{ message: "src/lib/x.ts:3: Type 'string' is not assignable to type 'number'." }],
  };
  const gh = { maybe: async (path: string) => notes[Number(path.match(/check-runs\/(\d+)\//)?.[1])] ?? null } as unknown as GitHub;
  const failed = [1, 2, 3].map((id) => ({ id, name: `c${id}`, status: "completed", conclusion: "failure" }) as CheckRun);
  assert.deepEqual([...(await notStarted(gh, "o/r", failed))], [1]);
  assert.ok(NOT_STARTED.test(notes[1][0].message));
});
