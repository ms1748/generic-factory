import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeDecision, riskyWhy, type MergeFacts } from "../src/automerge.ts";
import { riskyPath } from "../src/install.ts";
import { EXAMPLE } from "./example-install.ts";
import { latestChecks } from "../src/done.ts";
import { parseVerdict, verdictComment } from "../src/review.ts";
import { State } from "../src/state.ts";

const ok = (name: string) => ({ name, status: "completed", conclusion: "success" });
const facts = (over: Partial<MergeFacts> = {}): MergeFacts => ({
  on: true,
  draft: false,
  headSha: "abc",
  verdict: "ready",
  verdictSha: "abc",
  call: { sha: "abc", ok: true, why: "" },
  labels: ["factory", "reviewed"],
  cardLabels: ["building"],
  files: ["native/src/input.rs", "src/lib/api.ts"],
  riskyPaths: EXAMPLE.riskyPaths,
  checks: [ok("Frontend checks"), ok("Windows build and tests"), ok("Hardware tests (test box)")],
  mergeable: true,
  mergeableState: "clean",
  ...over,
});

test("a reviewed PR with green CI that merges cleanly is merged", () => {
  assert.deepEqual(mergeDecision(facts()), { action: "merge" });
});

test("it waits for the reviewer, CI, GitHub and the owner's labels", () => {
  const why = (f: Partial<MergeFacts>) => {
    const d = mergeDecision(facts(f));
    assert.equal(d.action, "wait", JSON.stringify(f));
    return (d as { why: string }).why;
  };
  assert.match(why({ on: false }), /off/);
  assert.match(why({ verdict: "needs-work" }), /reviewer/);
  assert.match(why({ verdictSha: "old" }), /reviewer/); // a newer push isn't reviewed yet
  assert.match(why({ labels: ["hold"] }), /hold/);
  assert.match(why({ cardLabels: ["factory-stop"] }), /factory-stop/);
  assert.match(why({ checks: [ok("Frontend checks"), { name: "Hardware tests (test box)", status: "completed", conclusion: "failure" }] }), /CI failed: Hardware tests/);
  assert.match(why({ checks: [ok("Frontend checks"), { name: "Windows build and tests", status: "in_progress", conclusion: null }] }), /still running/);
  assert.match(why({ checks: [] }), /no CI/);
  assert.match(why({ checks: [{ name: "x", status: "completed", conclusion: "skipped" }] }), /no CI/);
  assert.match(why({ mergeable: null }), /working out/);
  assert.match(why({ mergeable: false, mergeableState: "dirty" }), /conflicts/);
  assert.match(why({ mergeableState: "unstable" }), /unstable/);
  assert.match(why({ mergeableState: "blocked" }), /blocked/);
  assert.match(why({ call: undefined }), /no merge call/); // reviewed before merge calls existed
  assert.match(why({ call: { sha: "old", ok: true, why: "" } }), /no merge call/);
});

test("needs-owner on a ready PR is said once as the owner's call, not waited on silently", () => {
  // The builder put needs-owner on the card over an Actions billing stop; CI later ran green and the reviewer
  // passed the new head, but the stale label kept auto-merge waiting with no word to anyone.
  const card = mergeDecision(facts({ cardLabels: ["review", "needs-owner"] }));
  assert.equal(card.action, "owner");
  assert.match((card as { why: string }).why, /^its card still has needs-owner/);
  const pr = mergeDecision(facts({ labels: ["factory", "needs-owner"] }));
  assert.equal(pr.action, "owner");
  assert.match((pr as { why: string }).why, /^it still has needs-owner/);
  // Only once nothing else is pending: the reviewer, CI and GitHub come first.
  assert.equal(mergeDecision(facts({ cardLabels: ["needs-owner"], verdictSha: "old" })).action, "wait");
  assert.equal(mergeDecision(facts({ cardLabels: ["needs-owner"], checks: [{ name: "Frontend checks", status: "in_progress", conclusion: null }] })).action, "wait");
  assert.equal(mergeDecision(facts({ cardLabels: ["needs-owner"], mergeable: null })).action, "wait");
  // hold and factory-stop are the owner's switches, not questions: they still just wait.
  assert.equal(mergeDecision(facts({ cardLabels: ["needs-owner", "hold"] })).action, "wait");
});

test("risky files and the reviewer's own doubts go to the owner, whatever CI says", () => {
  const owner = (f: Partial<MergeFacts>) => {
    const d = mergeDecision(facts(f));
    assert.equal(d.action, "owner", JSON.stringify(f));
    return (d as { why: string }).why;
  };
  // Built in, in every project:
  assert.match(owner({ files: [".github/workflows/ci.yml"], riskyPaths: [] }), /workflow/);
  assert.match(owner({ files: [".factory.yml"], riskyPaths: [] }), /\.factory\.yml/);
  assert.match(owner({ files: ["scripts/secrets.mjs"], riskyPaths: [] }), /secrets/);
  assert.match(owner({ files: [".env.example"], riskyPaths: [] }), /secrets/);
  assert.match(owner({ files: ["certs/release.pfx"], riskyPaths: [] }), /keys/);
  // The install's own (Settings › Install), here the example's app rules:
  assert.match(owner({ files: ["native/src/updater.rs"] }), /updater\.rs, which Settings › Install lists .*\(updater\.rs\)/);
  assert.match(owner({ files: ["native/app.conf.json"] }), /app.conf\.json/);
  assert.match(owner({ files: ["native/app.windows.conf.json"] }), /app.\*\.conf\.json/);
  assert.match(owner({ files: ["native/capabilities/default.json"] }), /capabilities\//);
  assert.match(owner({ files: ["scripts/Sign-Release.ps1"] }), /sign\*/);
  assert.match(owner({ call: { sha: "abc", ok: false, why: "it deletes old save backups" } }), /save backups/);
  // Ordinary app and frontend files are fine, and without the install's globs so is the updater.
  assert.equal(mergeDecision(facts({ files: ["src/components/Library.svelte", "native/src/launch.rs", "docs/ref/x.md"] })).action, "merge");
  assert.equal(mergeDecision(facts({ files: ["native/src/updater.rs", "native/app.conf.json"], riskyPaths: [] })).action, "merge");
  assert.match(riskyWhy(["a.ts"], ["{broken"]) ?? "", /can't be read/, "a bad glob (which can't be saved) stops merges rather than matching nothing");
  assert.equal(riskyWhy(["a.ts"], []), undefined);
});

test("risky-path globs: names at any depth, paths from the root, folders, ** and braces", () => {
  const m = (glob: string, path: string) => riskyPath(glob).test(path);
  assert.ok(m("updater.rs", "updater.rs") && m("updater.rs", "native/src/updater.rs"));
  assert.ok(!m("updater.rs", "src/updater.rs.bak") && !m("updater.rs", "src/my-updater.rs"));
  assert.ok(m("sign*", "scripts/signing.ps1") && m("SIGN*", "scripts/sign.sh") && !m("sign*", "scripts/design.ts"));
  assert.ok(m("capabilities/", "native/capabilities/default.json") && !m("capabilities/", "src/capabilities.ts"));
  assert.ok(m("docs/release", "docs/release/notes.md") && m("/docs/release", "docs/release") && !m("docs/release", "x/docs/release/a.md"));
  assert.ok(m("src/*.rs", "src/main.rs") && !m("src/*.rs", "src/a/main.rs"));
  assert.ok(m("src/**/*.rs", "src/main.rs") && m("src/**/*.rs", "src/a/b/main.rs") && !m("src/**/*.rs", "lib/main.rs"));
  assert.ok(m("migrations/**", "migrations/001.sql") && m("*.{pem,crt}", "a/b.crt") && m("app.{conf,*.conf}.json", "app.linux.conf.json"));
  assert.ok(m("a?.txt", "a1.txt") && !m("a?.txt", "a/.txt") && !m("a.b", "axb"), "? is one character and . is literal");
  assert.throws(() => riskyPath("{a,b"), /unmatched brace/);
  assert.throws(() => riskyPath("a}"), /unmatched brace/);
  assert.throws(() => riskyPath("{a,{b}}"), /unmatched brace/);
  assert.throws(() => riskyPath("/"), /names no path/);
});

test("the reviewer's merge call: only an explicit ok on a ready verdict", () => {
  const reply = (json: string) => `Fine.\n\n\`\`\`json\n${json}\n\`\`\``;
  const yes = parseVerdict(reply(`{"verdict":"ready","must_fix":[],"merge":"ok"}`))!;
  assert.deepEqual([yes.mergeOk, yes.mergeWhy], [true, ""]);
  const no = parseVerdict(reply(`{"verdict":"ready","must_fix":[],"merge":"owner","merge_why":"it removes the old importer"}`))!;
  assert.deepEqual([no.mergeOk, no.mergeWhy], [false, "it removes the old importer"]);
  assert.equal(parseVerdict(reply(`{"verdict":"ready","must_fix":[]}`))!.mergeOk, false); // silent = owner
  assert.equal(parseVerdict(reply(`{"verdict":"needs-work","must_fix":["x"],"merge":"ok"}`))!.mergeOk, false);
  assert.match(verdictComment(yes, 0, "owner"), /merge it by myself/);
  assert.match(verdictComment(no, 0, "owner"), /Over to you to merge: it removes the old importer/);
});

test("a check that ran again counts by its latest run", () => {
  const cs = latestChecks([
    { name: "Windows build and tests", status: "completed", conclusion: "skipped", started_at: "2026-11-12T01:00:00Z" },
    { name: "Windows build and tests", status: "completed", conclusion: "success", started_at: "2026-11-12T02:00:00Z" },
    { name: "Frontend checks", status: "completed", conclusion: "success", started_at: "2026-11-12T01:00:00Z" },
  ]);
  assert.deepEqual(cs.find((c) => c.name === "Windows build and tests")?.conclusion, "success");
  assert.equal(cs.length, 2);
});

test("auto-merge state: on by default, merge calls and holds per PR and repo", () => {
  const s = new State(":memory:");
  assert.equal(s.autoMerge(), true);
  s.setAutoMerge(false);
  assert.equal(s.autoMerge(), false);
  s.saveMergeCall(7, { sha: "a", ok: false, why: "w" });
  assert.equal(s.mergeCall(7)?.why, "w");
  assert.equal(s.for("owner/site").mergeCall(7), undefined);
  s.markHeld(7, "a");
  assert.equal(s.heldFor(7), "a");
  s.saveReview({ pr: 7, sha: "a", verdict: "polish", runId: 1, posted: true });
  s.saveReview({ pr: 7, sha: "b", verdict: "ready", runId: 2, posted: true });
  assert.deepEqual({ ...s.lastReview(7) }, { verdict: "ready", sha: "b" });
});
