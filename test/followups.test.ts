import assert from "node:assert/strict";
import { test } from "node:test";
import { followupBody, followupTitle, MAX_PER_PR, planFollowups, sameIdea } from "../src/followups.ts";
import { parseVerdict, reviewerPrompt, verdictComment } from "../src/review.ts";

test("a later item's title is its first sentence, plain, capitalized, at most 80 characters", () => {
  assert.equal(followupTitle("a **settings** page for `lanes`. It would help the owner."), "A settings page for lanes");
  assert.equal(followupTitle("See [the docs](https://x.y): they are stale"), "See the docs");
  const long = followupTitle("x ".repeat(60));
  assert.ok(long.length <= 80 && long.endsWith("..."));
});

test("the same idea: equal once normalized, or one long title inside the other", () => {
  assert.ok(sameIdea("Add a settings page", "add a Settings page."));
  assert.ok(sameIdea("Retry failed uploads twice", "Retry failed uploads twice before giving up"));
  assert.ok(!sameIdea("Add tests", "Add tests for the queue")); // too short to count as contained
  assert.ok(!sameIdea("", "anything"));
});

const issue = (number: number, title: string, body = "", pr = false) => ({ number, title, body, ...(pr ? { pull_request: {} } : {}) });

test("open issues with the same idea are reused, PRs ignored, repeats in one list skipped", () => {
  const plan = planFollowups(["A settings page. Why.", "a settings page", "Cache the board"], [issue(3, "A settings page"), issue(4, "Cache the board", "", true)], 9);
  assert.deepEqual(
    plan.map((f) => [f.title, f.issue, f.existing]),
    [
      ["A settings page", 3, true],
      ["Cache the board", undefined, false], // #4 is a PR, not an issue
    ],
  );
});

test("an idea the owner closed isn't filed again, and still counts toward the cap", () => {
  const plan = planFollowups(["A settings page"], [{ ...issue(3, "A settings page", followupBody("x", 9, 1)), state: "closed" }], 9, 1);
  assert.deepEqual(plan.map((f) => [f.issue, f.existing, f.closed]), [[undefined, undefined, 3]]);
});

test("at most MAX_PER_PR per PR, counting the ones earlier rounds filed", () => {
  const earlier = Array.from({ length: MAX_PER_PR - 1 }, (_, i) => issue(10 + i, `Old idea number ${i}`, followupBody("x", 9, 1)));
  const plan = planFollowups(["New one", "Another new one"], earlier, 9);
  assert.deepEqual(plan.map((f) => f.existing), [false, undefined]);
  // Another PR's issues don't use up this PR's cap.
  assert.deepEqual(planFollowups(["New one"], earlier, 8).map((f) => f.existing), [false]);
});

test("the body links the PR and card and carries the marker", () => {
  const b = followupBody("Cache the board.", 12, 7);
  assert.match(b, /^Cache the board\./);
  assert.match(b, /#12 \(card #7\)/);
  assert.match(b, /<!-- factory-later pr=12 -->/);
});

test("the verdict comment links filed ideas and keeps the rest as text", () => {
  const v = parseVerdict('ok\n\n```json\n{"verdict":"ready","must_fix":[],"later":["a settings page","cache it","third"]}\n```')!;
  const c = verdictComment(v, 0, "owner", [
    { item: "a settings page", title: "A settings page", issue: 21, existing: false },
    { item: "cache it", title: "Cache it", issue: 5, existing: true },
    { item: "third", title: "Third" },
  ]);
  assert.match(c, /\*\*Later \(filed as ideas\)\*\*\n- #21\n- #5 \(already open\)\n- third/);
});

test("the reviewer's prompt has every numbered step, including the title rule", () => {
  const p = reviewerPrompt("o/r", 1, "t");
  assert.match(p, /^1\. Read the PR/m);
  assert.match(p, /start it with a short title sentence/);
  assert.doesNotMatch(p, /The dispatcher posts the verdict/);
});
