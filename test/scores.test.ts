import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { GitHub } from "../src/github.ts";
import { checkScores, factoryEmail, formula, groups, modelName, ownerCommit, prScores, recommend, revertTarget, RULES, score, trailerModel, type PrFacts, type Scored } from "../src/scores.ts";
import { State } from "../src/state.ts";
import { useExample } from "./example-install.ts";

useExample();

const facts = (over: Partial<PrFacts> = {}): PrFacts => ({
  pr: 12, card: 7, title: "A card", size: "M", lane: "builder", model: "Opus 5.5",
  reviewerRounds: 0, ownerRounds: 0, ownerCommits: 0, ownerLines: 0, ciFailures: 0,
  hours: 3, reverted: null, cost: null, merged: "2026-11-10T00:00:00Z", ...over,
});

test("a clean PR scores 100 with nothing taken off", () => {
  const s = score(facts());
  assert.equal(s.score, 100);
  assert.deepEqual(s.parts, []);
});

test("each rule takes its points off, capped, and says why", () => {
  assert.equal(score(facts({ reviewerRounds: 1, ownerRounds: 1 })).score, 100 - 2 * RULES.round.each);
  assert.equal(score(facts({ reviewerRounds: 9 })).score, 100 - RULES.round.max);
  // Any change by the owner costs 5, plus 1 per 10 lines.
  assert.equal(score(facts({ ownerCommits: 1, ownerLines: 3 })).score, 95);
  assert.equal(score(facts({ ownerCommits: 2, ownerLines: 47 })).score, 91);
  assert.equal(score(facts({ ownerCommits: 9, ownerLines: 5000 })).score, 100 - RULES.owner.max);
  assert.equal(score(facts({ ciFailures: 2 })).score, 90);
  // A day free, then 2 a day.
  assert.equal(score(facts({ hours: 24 })).score, 100);
  assert.equal(score(facts({ hours: 24 + 72 })).score, 94);
  assert.equal(score(facts({ hours: 24 * 100 })).score, 100 - RULES.wait.max);
  assert.equal(score(facts({ reverted: "#81" })).score, 100 - RULES.revert);
  assert.equal(score(facts({ cost: 12.4 })).score, 98);
  assert.equal(score(facts({ cost: 400 })).score, 100 - RULES.cost.max);
  const s = score(facts({ reviewerRounds: 1, ownerRounds: 0, ciFailures: 1, reverted: "abc1234" }));
  assert.deepEqual(s.parts.map((p) => p.why), ["1 review round (1 reviewer, 0 you)", "CI red on 1 commit", "reverted by abc1234"]);
});

test("the score never goes below 0", () => {
  assert.equal(score(facts({ reviewerRounds: 5, ownerCommits: 5, ownerLines: 900, ciFailures: 9, hours: 2000, reverted: "#9", cost: 500 })).score, 0);
});

test("the formula is written from the same rules", () => {
  const text = formula().join("\n");
  assert.match(text, new RegExp(`${RULES.round.each} per "needs work"`));
  assert.match(text, new RegExp(`Reverted: ${RULES.revert}\\.`));
  assert.match(text, /free for 24 hours/);
});

test("model names: the commit's co-author line, a model ID or a lane's alias", () => {
  assert.equal(trailerModel("Fix it\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"), "Opus 5.5");
  assert.equal(trailerModel("x\n\nco-authored-by: Claude Sonnet 5 <noreply@anthropic.com>"), "Sonnet 5");
  assert.equal(trailerModel("x\n\nCo-Authored-By: Claude <noreply@anthropic.com>"), "Claude");
  assert.equal(trailerModel("Owner's fix"), undefined);
  assert.equal(modelName("claude-opus-5-5"), "Opus 5.5");
  assert.equal(modelName("sonnet"), "Sonnet");
  assert.equal(modelName("Claude Haiku 5.5"), "Haiku 5.5");
});

test("owner commits: the factory's need the co-author line and the factory's email", () => {
  // The cases in this repo's history: agents commit under the owner's GitHub account, so the author can't
  // tell them apart, and the owner's own Claude sessions add the co-author line too.
  const T = "\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>";
  const bot = "1+owner@users.noreply.example";
  const own = (message: string, email: string, parents = 1) => ownerCommit({ message, email, parents }, bot);
  assert.equal(own("Build it" + T, bot), false, "a builder's commit");
  assert.equal(own("Build it" + T, "1+OWNER@users.noreply.example"), false, "emails match in any case");
  assert.equal(own("Tweak the wording", bot), true, "no co-author line: the owner's");
  assert.equal(own("Fix the markers" + T, "1+laptop@users.noreply.example"), true, "the owner's own Claude session");
  assert.equal(own("Merge main", "1+laptop@users.noreply.example", 2), false, "merges never count");
  assert.equal(factoryEmail({ FACTORY_GIT_EMAIL: bot }), bot);
  assert.equal(factoryEmail({}), "factory@users.noreply.github.com");
  assert.match(readFileSync("agent/run.sh", "utf8"), /FACTORY_GIT_EMAIL:-factory@users\.noreply\.github\.com\}/, "the same default as agent/run.sh");
});

test("reverts: GitHub's Revert button, a Revert title, or a revert commit naming the merge commit", () => {
  const merged = [{ pr: 12, title: "Add the thing", sha: "abcdef1234567890" }];
  assert.equal(revertTarget({ title: 'Revert "Something"', body: "Reverts owner/app#12" }, "owner/app", merged), 12);
  assert.equal(revertTarget({ title: "x", body: "Reverts owner/other#12" }, "owner/app", merged), null);
  assert.equal(revertTarget({ title: 'Revert "Add the thing"', body: "" }, "owner/app", merged), 12);
  assert.equal(revertTarget({ title: 'Revert "Add the thing"', body: "This reverts commit abcdef1." }, "owner/app", merged), 12);
  assert.equal(revertTarget({ title: "Add more", body: "Builds on #12" }, "owner/app", merged), null);
});

const row = (model: string, size: string, sc: number, cost: number | null, lane = model.startsWith("Sonnet") ? "small-builder" : "builder"): Scored => ({ ...facts({ model, size, lane, cost }), score: sc, parts: [] });

test("groups: lane × model × size, averaged, in size order", () => {
  const g = groups([row("Opus 5.5", "L", 80, 30), row("Opus 5.5", "L", 90, null), row("Sonnet 5.5", "S", 70, 4)]);
  assert.deepEqual(g.map((x) => [x.lane, x.model, x.size, x.prs, x.score, x.cost]), [
    ["small-builder", "Sonnet 5.5", "S", 1, 70, 4],
    ["builder", "Opus 5.5", "L", 2, 85, 30],
  ]);
});

test("advice: a cheaper model that matches is suggested; too few PRs or a clear winner says so", () => {
  const n = (k: number, model: string, size: string, sc: number, cost: number) => Array.from({ length: k }, () => row(model, size, sc, cost));
  const [s] = recommend([...n(3, "Sonnet 5.5", "S", 84, 3), ...n(4, "Opus 5.5", "S", 86, 12)]);
  assert.match(s, /^size:S: Sonnet 5\.5 matches Opus 5\.5 \(84 over 3 PRs vs 86 over 4 PRs\) at 25% of the cost, so consider moving size:S cards to the small-builder lane\.$/);
  const [m] = recommend([...n(3, "Sonnet 5.5", "M", 60, 5), ...n(3, "Opus 5.5", "M", 85, 20)]);
  assert.match(m, /Opus 5\.5 does clearly better than Sonnet 5\.5 .* keep size:M cards on the builder lane/);
  const [few] = recommend([...n(2, "Sonnet 5.5", "L", 90, 5), ...n(3, "Opus 5.5", "L", 85, 20)]);
  assert.match(few, /not enough PRs to compare Sonnet 5\.5 \(2\) and Opus 5\.5 \(3\) yet; each needs 3/);
  const [one] = recommend(n(1, "Opus 5.5", "none", 77, 9));
  assert.match(one, /^unsized cards: only Opus 5\.5 has built these \(1 PR, average 77\)/);
});

test("scores are stored per repo, and the runs on a PR and its card are found", () => {
  const s = new State(":memory:");
  s.saveScoreFacts(facts({ pr: 1 }));
  s.saveScoreFacts(facts({ pr: 1, reverted: "#3" })); // updates
  s.for("owner/site").saveScoreFacts(facts({ pr: 1, title: "site" }));
  assert.deepEqual(s.scoreFacts().map((f) => f.reverted), ["#3"]);
  assert.deepEqual(s.allScoreFacts().map((f) => [f.repo, f.title]), [["owner/app", "A card"], ["owner/site", "site"]]);
  const run = (lane: string, card: number | null, pr: number | null, cost: number, mode: "live" | "dry" = "live") => {
    const id = s.startRun({ lane, model: "opus", mode, card, action: null, status: "running" });
    s.updateRun(id, { pr, cost_usd: cost, status: "done" }, true);
  };
  run("builder", 7, null, 3); // an earlier try on the card
  run("builder", 7, 12, 10);
  run("reviewer", null, 12, 1);
  run("trial", 7, null, 50); // a trial rebuild isn't this PR's
  run("builder", 8, 13, 9);
  run("builder", 7, 12, 0, "dry");
  assert.deepEqual(s.prRuns(12, 7).map((r) => r.cost_usd), [3, 10, 1]);
  assert.deepEqual(s.for("owner/site").prRuns(12, 7), []);
  const shown = prScores(s.allScoreFacts());
  assert.equal(shown.rows.length, 2);
  assert.equal(shown.rows[0].score, 60);
});

test("the serve step scores a merged factory PR from GitHub and the runs table, and marks a revert", async () => {
  const s = new State(":memory:");
  const id = s.startRun({ lane: "builder", model: "opus", mode: "live", card: 7, action: null, status: "running" });
  s.updateRun(id, { pr: 12, cost_usd: 11.5, status: "done" }, true);
  const T = "\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>";
  const pulls = [
    { number: 12, title: "Add the thing", body: "Closes #7", created_at: "2026-11-01T00:00:00Z", merged_at: "2026-11-01T06:00:00Z", merge_commit_sha: "m12", head: { ref: "claude/issue-7-thing", sha: "c3" }, labels: [{ name: "factory" }] },
    { number: 13, title: "Owner's own", body: "", created_at: "2026-11-02T00:00:00Z", merged_at: "2026-11-02T01:00:00Z", merge_commit_sha: "m13", head: { ref: "owner-branch", sha: "d1" }, labels: [] },
    { number: 14, title: "Closed unmerged", body: "", created_at: "2026-11-02T00:00:00Z", merged_at: null, merge_commit_sha: null, head: { ref: "claude/issue-9-x", sha: "e1" }, labels: [{ name: "factory" }] },
  ];
  const routes: Record<string, unknown> = {
    "/repos/owner/app/pulls/12/commits": [
      { sha: "c1", commit: { message: "Build it" + T, author: { email: factoryEmail() } }, parents: [{ sha: "p" }] },
      { sha: "c2", commit: { message: "Merge main" }, parents: [{ sha: "a" }, { sha: "b" }] },
      { sha: "c3", commit: { message: "Tweak the wording" }, parents: [{ sha: "c2" }] },
    ],
    "/repos/owner/app/issues/12/comments": [
      { user: { login: "example-factory[bot]" }, body: "🤖 **Factory reviewer: needs work** 🔧\n<!-- old-factory -->" },
      { user: { login: "owner" }, body: "Please rename the button." },
      { user: { login: "owner" }, body: "🤖 **Factory:** done <!-- old-factory -->" },
    ],
    "/repos/owner/app/pulls/12/reviews": [{ user: { login: "owner" }, body: "", state: "APPROVED" }],
    "/repos/owner/app/issues/7": { labels: [{ name: "size:L" }, { name: "feature" }] },
    "/repos/owner/app/commits/c3": { stats: { additions: 12, deletions: 3 } },
    "/repos/owner/app/commits/c1/check-runs?per_page=100": { check_runs: [{ name: "Checks", status: "completed", conclusion: "failure" }] },
    "/repos/owner/app/commits/c2/check-runs?per_page=100": { check_runs: [{ name: "Checks", status: "completed", conclusion: "success" }] },
    "/repos/owner/app/commits/c3/check-runs?per_page=100": { check_runs: [{ name: "Checks", status: "completed", conclusion: "success" }] },
    "/repos/owner/app/commits?per_page=100": [],
  };
  const get = async (path: string) => {
    if (path.startsWith("/repos/owner/app/pulls?state=closed")) return pulls;
    if (/\/commits\/\w+\/status$/.test(path)) return { statuses: [{ context: "factory/review", state: "failure" }] };
    if (!(path in routes)) throw new Error(`unexpected ${path}`);
    return routes[path];
  };
  const gh = { get, all: get, maybe: async (p: string) => (p.includes(".factory.yml") ? undefined : get(p)) } as unknown as GitHub;
  const logs: string[] = [];
  await checkScores({ gh, state: s, repo: "owner/app", log: (l) => logs.push(l) }, Date.parse("2026-11-03T00:00:00Z"));
  const [f] = s.scoreFacts();
  assert.deepEqual(
    { ...f },
    { pr: 12, card: 7, title: "Add the thing", size: "L", lane: "builder", model: "Opus 5.5", reviewerRounds: 1, ownerRounds: 1, ownerCommits: 1, ownerLines: 15, ciFailures: 1, hours: 6, reverted: null, cost: 11.5, merged: "2026-11-01T06:00:00Z" },
  );
  assert.equal(s.scoreFacts().length, 1, "only merged factory PRs are scored");
  // 100 − 20 (two rounds) − 6 (owner: 5 + 1) − 5 (CI) − 2 (cost)
  assert.equal(score(f).score, 67);

  // Later the owner reverts it with GitHub's button: the score drops, and the revert PR isn't scored itself.
  pulls.unshift({ number: 15, title: 'Revert "Add the thing"', body: "Reverts owner/app#12", created_at: "2026-11-04T00:00:00Z", merged_at: "2026-11-04T00:10:00Z", merge_commit_sha: "m15", head: { ref: "revert-12", sha: "r1" }, labels: [{ name: "factory" }] });
  await checkScores({ gh, state: s, repo: "owner/app", log: (l) => logs.push(l) }, Date.parse("2026-11-04T01:00:00Z"));
  assert.deepEqual(s.scoreFacts().map((x) => [x.pr, x.reverted]), [[12, "#15"]]);
  assert.ok(logs.some((l) => /PR #12 was reverted by #15/.test(l)));
});
