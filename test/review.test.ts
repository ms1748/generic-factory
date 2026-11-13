import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_ROUNDS, labelsReviewed, parseVerdict, reviewerGuide, verdictComment } from "../src/review.ts";
import { State } from "../src/state.ts";

const reply = (json: string) => `Looks good overall.\n\n- checked the diff\n\n\`\`\`json\n${json}\n\`\`\``;

test("the verdict comes from the last json block, with the review before it", () => {
  const v = parseVerdict(`draft \`\`\`json\n{"verdict":"needs-work","must_fix":["x"]}\n\`\`\`\n` + reply(`{"verdict":"ready","must_fix":[],"nice_to_have":["rename y"]}`));
  assert.equal(v?.verdict, "ready");
  assert.deepEqual(v?.later, ["rename y"]); // the old field still reads, as "later"
  assert.ok(v?.review.endsWith("- checked the diff"));
});

test("ready with must-fix items counts as needs work; junk gives no verdict", () => {
  assert.equal(parseVerdict(reply(`{"verdict":"ready","must_fix":["missing test"]}`))?.verdict, "needs-work");
  assert.equal(parseVerdict(reply(`{"verdict":"maybe"}`)), undefined);
  assert.equal(parseVerdict(reply(`{not json`)), undefined);
  assert.equal(parseVerdict("no block at all"), undefined);
});

test("the last round's comment hands the PR to the owner", () => {
  const v = parseVerdict(reply(`{"verdict":"needs-work","must_fix":["a"]}`))!;
  assert.match(verdictComment(v, 1, "fix"), /Round 1 of 2/);
  assert.match(verdictComment(v, MAX_ROUNDS, "owner"), /over to you/);
  assert.match(verdictComment(v, 1, "fix"), /<!-- factory-review -->/);
});

test("a ready verdict with polish: a short comment, the full review folded, polish and later split", () => {
  const v = parseVerdict(reply(`{"verdict":"ready","must_fix":[],"polish":["test the empty list"],"later":["a settings page"]}`))!;
  assert.deepEqual([v.verdict, v.polish, v.later], ["ready", ["test the empty list"], ["a settings page"]]);
  const c = verdictComment(v, 0, "polish");
  assert.match(c, /ready, polishing first/);
  assert.match(c, /^Looks good overall\.$/m);
  assert.match(c, /\*\*Polish \(being done now\)\*\*\n- test the empty list/);
  assert.match(c, /\*\*Later \(follow-up ideas\)\*\*\n- a settings page/);
  assert.match(c, /<details><summary>Full review<\/summary>\n\n- checked the diff/);
  assert.match(verdictComment(v, 0, "owner"), /ready for you/);
});

test("a PR gets one polish round", () => {
  const s = new State(":memory:");
  assert.equal(s.polished(7), false);
  s.saveReview({ pr: 7, sha: "a", verdict: "polish", runId: 1, posted: true });
  assert.equal(s.polished(7), true);
  assert.equal(s.reviewRounds(7), 0);
  // The builder handled it without pushing: the same commit is reviewed again, once.
  s.saveSession({ pr: 7, card: 1, sessionId: "x", lane: "builder", runId: 1, branch: "b", handledAt: "2000-01-01T00:00:00Z" });
  assert.equal(s.polishSettled(7), false);
  s.markHandled(7, "2999-01-01T00:00:00Z");
  assert.equal(s.polishSettled(7), true);
  s.saveReview({ pr: 7, sha: "a", verdict: "ready", runId: 2, posted: true });
  assert.equal(s.polishSettled(7), false);
});

test("trial reviews don't count; posted ones and dry notes do", () => {
  const s = new State(":memory:");
  s.saveReview({ pr: 5, sha: "a", verdict: "needs-work", runId: 1, posted: false });
  assert.equal(s.reviewed(5, "a"), false);
  assert.equal(s.reviewRounds(5), 0);
  s.saveReview({ pr: 5, sha: "a", verdict: "needs-work", runId: 2, posted: true });
  s.saveReview({ pr: 5, sha: "b", verdict: "dry", runId: 3, posted: false });
  assert.equal(s.reviewed(5, "a"), true);
  assert.equal(s.reviewed(5, "b"), true);
  assert.equal(s.reviewRounds(5), 1);
  assert.equal(s.lastVerdict(5), "needs-work");
  assert.equal(s.verdicts().get(5)?.runId, 2);
});

// A project's CI may hold its costly builds for factory PRs until this label is on.
test("only a final ready adds the reviewed label; polish and needs work don't", () => {
  assert.equal(labelsReviewed("ready", "owner"), true);
  assert.equal(labelsReviewed("ready", "polish"), false);
  assert.equal(labelsReviewed("needs-work", "fix"), false);
  assert.equal(labelsReviewed("needs-work", "owner"), false);
});

test("the reviewer's guide names no project's CI; the install's CI note goes in step 3", () => {
  const plain = reviewerGuide({ reviewerCi: "" });
  assert.doesNotMatch(plain, /Windows/);
  assert.match(plain, /3\. Look at CI \(the check runs on the PR's head commit\)\.\n {3}If CI didn't cover/);
  const noted = reviewerGuide({ reviewerCi: "The Windows build waits for your pass." });
  assert.match(noted.split("\n\n")[1], /head commit\)\. The Windows build waits for your pass\.\n/);
});
