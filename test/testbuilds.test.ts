import assert from "node:assert/strict";
import { test } from "node:test";
import { State } from "../src/state.ts";
import { checkTestBuilds, cleanupStep, dispatchProblem, parseTestBuilds, versionsForPage, type TestBuilds } from "../src/testbuilds.ts";
import type { Ctx } from "../src/dispatch.ts";
import { DEFAULT_TEST_BUILDS, fromYaml } from "../src/config.ts";

const BOT = "github-actions[bot]";
const marker = (json: unknown) => `## Test builds\n\n| v | ... |\n\n<!-- factory-test-builds ${JSON.stringify(json)} -->`;
const builds = {
  pr: 174,
  versions: [
    { v: 2, sha: "bbbbbbbbbbbb", at: "2026-11-04T12:00:00Z", artifact: "https://github.com/owner/app/actions/runs/2/artifacts/20", site: "https://app.example.com/test-builds/pr174/v2/" },
    { v: 1, sha: "aaaaaaaaaaaa", at: "2026-10-27T12:00:00Z", artifact: "https://github.com/owner/app/actions/runs/1/artifacts/10", site: null },
  ],
};

test("test builds: read from github-actions[bot]'s marker comment", () => {
  const b = parseTestBuilds([
    { author: "owner-login", body: "looks good" },
    { author: BOT, body: marker(builds) },
  ]);
  assert.equal(b?.pr, 174);
  assert.deepEqual(b?.versions.map((x) => x.v), [2, 1]);
  assert.equal(b?.versions[1].site, null);
  assert.equal(b?.deleted, null);
});

test("test builds: a missing or broken marker reads as none", () => {
  assert.equal(parseTestBuilds([]), undefined);
  assert.equal(parseTestBuilds([{ author: BOT, body: "## Test builds\nno marker here" }]), undefined);
  assert.equal(parseTestBuilds([{ author: BOT, body: "<!-- factory-test-builds {not json -->" }]), undefined);
  assert.equal(parseTestBuilds([{ author: BOT, body: marker({ pr: "174", versions: [] }) }]), undefined, "wrong types");
  assert.equal(parseTestBuilds([{ author: BOT, body: marker({ pr: 174, versions: [{ v: 1, at: "soon" }] }) }]), undefined, "bad time");
  // Someone else pasting the marker doesn't count.
  assert.equal(parseTestBuilds([{ author: "owner-login", body: marker(builds) }]), undefined);
});

test("test builds: non-https links are dropped", () => {
  const b = parseTestBuilds([{ author: BOT, body: marker({ pr: 1, versions: [{ v: 1, sha: "x", at: "2026-11-01T00:00:00Z", artifact: "javascript:alert(1)", site: "http://x" }] }) }]);
  assert.equal(b?.versions[0].artifact, null);
  assert.equal(b?.versions[0].site, null);
});

test("test builds: deleted ones show without links; artifacts expire after 7 days", () => {
  const now = Date.parse("2026-11-05T12:00:00Z");
  const live = parseTestBuilds([{ author: BOT, body: marker(builds) }])!;
  const page = versionsForPage(live, now);
  assert.equal(page[0].site, builds.versions[0].site);
  assert.equal(page[0].artifact, builds.versions[0].artifact, "v2 is a day old");
  assert.equal(page[1].artifact, null, "v1's artifact is 9 days old");
  assert.equal(page[0].sha, "bbbbbbb");

  const gone = parseTestBuilds([{ author: BOT, body: marker({ ...builds, deleted: "2026-11-05T10:00:00Z" }) }])!;
  assert.equal(gone.deleted, "2026-11-05T10:00:00Z");
  assert.deepEqual(versionsForPage(gone, now).map((x) => [x.site, x.artifact]), [[null, null], [null, null]]);
  assert.equal(parseTestBuilds([{ author: BOT, body: marker({ ...builds, deleted: true }) }])!.deleted, true);
});

test("cleanup: never while open or before the delay, once after it, not again while pending", () => {
  const b = parseTestBuilds([{ author: BOT, body: marker(builds) }]) as TestBuilds;
  const closedAt = "2026-11-05T00:00:00Z";
  const at = (h: number) => Date.parse(closedAt) + h * 3600_000;
  assert.equal(cleanupStep({ closedAt: null, builds: b, delayHours: 24, now: at(100) }).do, "nothing");
  assert.equal(cleanupStep({ closedAt, builds: undefined, delayHours: 24, now: at(100) }).do, "nothing");
  assert.deepEqual(cleanupStep({ closedAt, builds: b, delayHours: 24, now: at(23.9) }), { do: "wait", until: "2026-11-06T00:00:00.000Z" });
  assert.deepEqual(cleanupStep({ closedAt, builds: b, delayHours: 24, now: at(24) }), { do: "dispatch", retry: false });
  assert.equal(cleanupStep({ closedAt, builds: b, delayHours: 48, now: at(30) }).do, "wait", "the owner's setting moves it");
  const dispatchedAt = new Date(at(24)).toISOString();
  assert.equal(cleanupStep({ closedAt, builds: b, delayHours: 24, now: at(24.05), dispatchedAt }).do, "pending", "just dispatched");
  assert.equal(cleanupStep({ closedAt, builds: b, delayHours: 24, now: at(25), dispatchedAt, runActive: true }).do, "pending");
  assert.equal(cleanupStep({ closedAt, builds: b, delayHours: 24, now: at(25), dispatchedAt }).do, "pending", "a finished run isn't retried at once");
  assert.deepEqual(cleanupStep({ closedAt, builds: b, delayHours: 24, now: at(31), dispatchedAt }), { do: "dispatch", retry: true });
  assert.equal(cleanupStep({ closedAt, builds: { ...b, deleted: true }, delayHours: 24, now: at(31), dispatchedAt }).do, "nothing");
});

test("delete-after setting: 24 hours by default, saved with the factory's state", () => {
  const s = new State(":memory:");
  assert.equal(s.testBuildDeleteHours(), 24);
  s.setTestBuildDeleteHours(72);
  assert.equal(s.testBuildDeleteHours(), 72);
});

test("dispatch problems name the missing permission", () => {
  assert.match(dispatchProblem(403, "Resource not accessible by integration", "x.yml"), /Actions: write/);
  assert.match(dispatchProblem(404, "", "x.yml"), /x\.yml isn't on the project's main branch/);
});

/** A fake GitHub with one merged PR, for the hourly check end to end. */
function fakeCtx(opts: { comment: string; perms?: Record<string, string>; dispatchStatus?: number; runs?: { status: string; created_at: string }[] }) {
  const dispatched: unknown[] = [];
  const lines: string[] = [];
  const gh = {
    get: async (path: string) => {
      assert.match(path, /pulls\?state=closed/);
      return [{ number: 174, title: "Test builds", closed_at: "2026-11-04T00:00:00Z", merged_at: "2026-11-04T00:00:00Z" }];
    },
    all: async () => [{ user: { login: BOT }, body: opts.comment }],
    maybe: async () => ({ workflow_runs: opts.runs ?? [] }),
    appPermissions: async () => opts.perms ?? { actions: "write" },
    request: async (method: string, path: string, body: unknown) => {
      dispatched.push({ method, path, body });
      return { ok: (opts.dispatchStatus ?? 204) < 300, status: opts.dispatchStatus ?? 204, text: "" };
    },
  };
  const state = new State(":memory:");
  const ctx = { gh, state, repo: "owner/app", log: (l: string) => lines.push(l) } as unknown as Ctx;
  return { ctx, state, dispatched, lines };
}

test("hourly check: dispatches the workflow once after the delay, then waits", async () => {
  const f = fakeCtx({ comment: marker(builds) });
  const closed = Date.parse("2026-11-04T00:00:00Z");
  let r = await checkTestBuilds(f.ctx, DEFAULT_TEST_BUILDS, closed + 23 * 3600_000);
  assert.equal(f.dispatched.length, 0);
  assert.equal(r.prs[0].step.do, "wait");
  r = await checkTestBuilds(f.ctx, DEFAULT_TEST_BUILDS, closed + 25 * 3600_000);
  assert.deepEqual(f.dispatched, [{ method: "POST", path: "/repos/owner/app/actions/workflows/test-builds-cleanup.yml/dispatches", body: { ref: "main", inputs: { pr: "174" } } }]);
  assert.equal(r.prs[0].step.do, "pending");
  await checkTestBuilds(f.ctx, DEFAULT_TEST_BUILDS, closed + 26 * 3600_000);
  assert.equal(f.dispatched.length, 1, "not again while that run is pending");
});

test("hourly check: a still-running cleanup isn't dispatched again, even after the retry wait", async () => {
  const f = fakeCtx({ comment: marker(builds), runs: [{ status: "in_progress", created_at: "2026-11-05T01:00:00Z" }] });
  const closed = Date.parse("2026-11-04T00:00:00Z");
  f.state.markCleanupDispatched(174, "2026-11-05T01:00:00.000Z");
  const r = await checkTestBuilds(f.ctx, DEFAULT_TEST_BUILDS, closed + 40 * 3600_000);
  assert.equal(f.dispatched.length, 0);
  assert.equal(r.prs[0].step.do, "pending");
});

test("hourly check: deleted builds are done; a missing permission is reported, not dispatched", async () => {
  const done = fakeCtx({ comment: marker({ ...builds, deleted: "2026-11-05T00:00:00Z" }) });
  const r = await checkTestBuilds(done.ctx, DEFAULT_TEST_BUILDS, Date.parse("2026-11-06T00:00:00Z"));
  assert.equal(r.prs.length, 0);
  assert.equal(done.state.cleanupDone(174), true);

  const noPerm = fakeCtx({ comment: marker(builds), perms: { actions: "read" } });
  const r2 = await checkTestBuilds(noPerm.ctx, DEFAULT_TEST_BUILDS, Date.parse("2026-11-06T00:00:00Z"));
  assert.equal(noPerm.dispatched.length, 0);
  assert.match(r2.problem ?? "", /Actions: write/);

  const refused = fakeCtx({ comment: marker(builds), dispatchStatus: 404 });
  const r3 = await checkTestBuilds(refused.ctx, DEFAULT_TEST_BUILDS, Date.parse("2026-11-06T00:00:00Z"));
  assert.match(r3.problem ?? "", /main branch/);
  assert.equal(refused.state.cleanupDispatched(174), undefined, "a refused dispatch isn't counted as pending");
});

test("test builds names: defaults, .factory.yml keys, and bad names refused", () => {
  assert.deepEqual(fromYaml("o/r", "timezone: UTC").testBuilds, { marker: "factory-test-builds", cleanupWorkflow: "test-builds-cleanup.yml" });
  assert.deepEqual(fromYaml("o/r", "test_builds:\n  marker: app-builds\n").testBuilds, { marker: "app-builds", cleanupWorkflow: "test-builds-cleanup.yml" });
  assert.deepEqual(fromYaml("o/r", "test_builds: { marker: app_builds, cleanup_workflow: clean.yaml }").testBuilds, { marker: "app_builds", cleanupWorkflow: "clean.yaml" });
  assert.throws(() => fromYaml("o/r", "test_builds: yes"), /must be a map/);
  assert.throws(() => fromYaml("o/r", "test_builds: { marker: 'a.*' }"), /test_builds.marker/);
  assert.throws(() => fromYaml("o/r", "test_builds: { marker: '' }"), /test_builds.marker/);
  assert.throws(() => fromYaml("o/r", "test_builds: { cleanup_workflow: ../x.yml }"), /cleanup_workflow/);
  assert.throws(() => fromYaml("o/r", "test_builds: { cleanup_workflow: clean.sh }"), /cleanup_workflow/);
});

test("test builds: a project's own marker is read, and the default one isn't then", () => {
  const own = `<!-- app-builds ${JSON.stringify(builds)} -->`;
  assert.equal(parseTestBuilds([{ author: BOT, body: own }], "app-builds")?.pr, 174);
  assert.equal(parseTestBuilds([{ author: BOT, body: own }]), undefined, "default marker");
  assert.equal(parseTestBuilds([{ author: BOT, body: marker(builds) }], "app-builds"), undefined);
  // A marker that only starts the same doesn't count.
  assert.equal(parseTestBuilds([{ author: BOT, body: `<!-- app-builds-old ${JSON.stringify(builds)} -->` }], "app-builds"), undefined);
});

test("hourly check: dispatches the project's own cleanup workflow", async () => {
  const f = fakeCtx({ comment: `<!-- app-builds ${JSON.stringify(builds)} -->` });
  await checkTestBuilds(f.ctx, { marker: "app-builds", cleanupWorkflow: "clean.yml" }, Date.parse("2026-11-06T00:00:00Z"));
  assert.deepEqual(f.dispatched, [{ method: "POST", path: "/repos/owner/app/actions/workflows/clean.yml/dispatches", body: { ref: "main", inputs: { pr: "174" } } }]);
  assert.match(f.lines[0], /dispatched clean\.yml for PR #174/);
});
