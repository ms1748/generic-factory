// Each served repo's own .factory.yml lanes, and lane switches keyed by repo plus lane.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PRIMARY = "owner/app";
const SITE = "owner/site";
const OTHER = "owner/tools";
process.env.FACTORY_PROJECTS = `${PRIMARY},${SITE},${OTHER}`;
const { defaults, fromYaml } = await import("../src/config.ts");
const { loadConfig } = await import("../src/project.ts");
const { laneOn, tick } = await import("../src/dispatch.ts");
const { State } = await import("../src/state.ts");
type GitHub = import("../src/github.ts").GitHub;
type Ctx = import("../src/dispatch.ts").Ctx;

/** A GitHub that only serves each repo's .factory.yml (none for a repo left out). */
function fakeGh(files: Record<string, string>): GitHub {
  return {
    maybe: async (path: string) => {
      const repo = Object.keys(files).find((r) => path === `/repos/${r}/contents/.factory.yml`);
      return repo ? { content: Buffer.from(files[repo]).toString("base64") } : undefined;
    },
  } as unknown as GitHub;
}

const APP_YML = `
timezone: America/New_York
max_open_prs: 3
lanes:
  - { name: builder, kind: builder, schedule: ["10:00"] }
  - { name: maintainer, kind: maintainer, model: sonnet }
`;
const SITE_YML = `
prompt_dir: site/prompts/
lanes:
  - { name: builder, kind: builder, model: sonnet, sizes: [S, M] }
  - { name: reviewer, kind: reviewer, prompt: "factory:reviewer" }
`;

test("each repo reads its own .factory.yml; a repo without one gets the built-in lanes", async () => {
  const gh = fakeGh({ [PRIMARY]: APP_YML, [SITE]: SITE_YML });
  const [app, site, other] = await Promise.all([PRIMARY, SITE, OTHER].map((r) => loadConfig(gh, r)));

  assert.equal(app.repo, PRIMARY);
  assert.deepEqual(app.lanes.map((l) => l.name), ["builder", "maintainer"]);
  assert.equal(app.timezone, "America/New_York");
  assert.equal(app.maxOpenPrs, 3);
  const appBuilder = app.lanes[0];
  assert.deepEqual(appBuilder.schedule, ["10:00"], "the file's schedule wins");
  assert.equal(appBuilder.model, "opus", "a built-in lane's name fills in what the file leaves out");
  assert.deepEqual(appBuilder.sizes, ["M", "L", "none"]);
  assert.equal(app.lanes[1].model, "sonnet");

  assert.equal(site.repo, SITE);
  assert.deepEqual(site.lanes.map((l) => l.name), ["builder", "reviewer"], "the site's list replaces the built-in one");
  assert.equal(site.promptDir, "site/prompts");
  assert.equal(site.lanes[0].model, "sonnet");
  assert.deepEqual(site.lanes[0].sizes, ["S", "M"]);
  assert.deepEqual(site.lanes[0].schedule, ["09:00", "14:00", "19:00"], "the built-in schedule when the file sets none");
  assert.equal(site.maxOpenPrs, 0);

  assert.equal(other.source, "built-in defaults");
  assert.deepEqual(other.lanes, defaults(OTHER).lanes);
});

test("a file without lanes keeps the built-in list, with its prompt_dir", () => {
  const c = fromYaml(SITE, "prompt_dir: p\nmax_open_prs: 2\n");
  assert.deepEqual(c.lanes.map((l) => l.name), defaults(SITE).lanes.map((l) => l.name));
  assert.equal(c.lanes.find((l) => l.name === "maintainer")?.prompt, "p/maintainer.md");
  assert.equal(c.maxOpenPrs, 2);
});

test("lane switches are per repo plus lane", () => {
  const s = new State(":memory:");
  const site = s.for(SITE);
  s.setLive("builder", true);
  assert.equal(s.lane("builder").live, true);
  assert.equal(site.lane("builder").live, false, "a new database has no switch that spans repos");
  site.setOn("builder", false);
  site.setSlot("builder", "2026-11-12T14:00:00.000Z");
  assert.deepEqual(site.lane("builder"), { live: false, lastSlot: "2026-11-12T14:00:00.000Z", on: false });
  assert.deepEqual(s.lane("builder"), { live: true, lastSlot: null, on: null });
});

/** A database from before lanes were per repo: name-only rows. */
function oldDatabase(): string {
  const file = join(mkdtempSync(join(tmpdir(), "factory-")), "old.db");
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE lanes (name TEXT PRIMARY KEY, live INTEGER NOT NULL DEFAULT 0, last_slot TEXT, on_switch INTEGER);
    INSERT INTO lanes VALUES ('builder', 1, '2026-11-12T14:00:00.000Z', NULL);
    INSERT INTO lanes VALUES ('maintainer', 0, '2026-11-12T13:00:00.000Z', 0);
    INSERT INTO lanes VALUES ('ideas', 0, NULL, 1);
    INSERT INTO lanes VALUES ('reviewer', 1, NULL, 1);`);
  old.close();
  return file;
}

test("the migration keeps every switch as it was, in every repo that has the lane", () => {
  const file = oldDatabase();
  const s = new State(file);
  // The primary's rows are unchanged, last slots too.
  assert.deepEqual(s.lane("builder"), { live: true, lastSlot: "2026-11-12T14:00:00.000Z", on: null });
  assert.deepEqual(s.lane("maintainer"), { live: false, lastSlot: "2026-11-12T13:00:00.000Z", on: false });
  assert.deepEqual(s.lane("ideas"), { live: false, lastSlot: null, on: true });
  assert.deepEqual(s.lane("reviewer"), { live: true, lastSlot: null, on: true });
  assert.deepEqual(s.lane("security"), { live: false, lastSlot: null, on: null }, "a lane without a row stays dry and follows its config");

  // Another repo follows the same switches, but starts its own schedule (no last slot, so nothing fires on deploy).
  const site = s.for(SITE);
  assert.deepEqual(site.lane("builder"), { live: true, lastSlot: null, on: null });
  assert.deepEqual(site.lane("maintainer"), { live: false, lastSlot: null, on: false });
  assert.deepEqual(site.lane("ideas"), { live: false, lastSlot: null, on: true });
  assert.deepEqual(site.lane("reviewer"), { live: true, lastSlot: null, on: true });

  // Its own schedule bookkeeping doesn't change its switches.
  site.setSlot("builder", "2026-11-12T15:00:00.000Z");
  assert.deepEqual(site.lane("builder"), { live: true, lastSlot: "2026-11-12T15:00:00.000Z", on: null });

  // Switching one repo's lane leaves the others as they were.
  site.setLive("builder", false);
  site.setOn("reviewer", false);
  assert.equal(site.lane("builder").live, false);
  assert.equal(site.lane("reviewer").on, false);
  assert.equal(site.lane("reviewer").live, true, "turning a lane off keeps its live/dry choice");
  assert.equal(s.lane("builder").live, true);
  assert.equal(s.lane("reviewer").on, true);
  assert.equal(s.for(OTHER).lane("builder").live, true);
  s.setLive("reviewer", false);
  assert.equal(s.for(OTHER).lane("reviewer").live, true, "the primary's switch is its own now");

  // Opening the database again doesn't migrate twice.
  const again = new State(file);
  assert.equal(again.for(SITE).lane("builder").live, false);
  assert.equal(again.lane("builder").live, true);
});

test("laneOn follows a repo's switch, then its config", () => {
  const s = new State(oldDatabase());
  const ideas = defaults(SITE).lanes.find((l) => l.name === "ideas")!;
  assert.equal(ideas.enabled, false);
  assert.equal(laneOn(s.for(SITE), ideas), true, "the old switch turned ideas on for every repo");
  const security = defaults(SITE).lanes.find((l) => l.name === "security")!;
  assert.equal(laneOn(s.for(SITE), security), true);
  s.for(SITE).setOn("security", false);
  assert.equal(laneOn(s.for(SITE), security), false);
  assert.equal(laneOn(s, security), true);
});

test("each repo's tick follows its own lanes and keeps its own slots", async () => {
  const state = new State(":memory:");
  const gh = fakeGh({ [PRIMARY]: APP_YML, [SITE]: SITE_YML });
  const log = () => {};
  const app: Ctx = { gh, state, repo: PRIMARY, log };
  const site: Ctx = { gh, state: state.for(SITE), repo: SITE, log };
  app.all = site.all = [app, site];
  await tick(site);
  // First sight of each scheduled lane only records its slot (nothing runs on deploy).
  assert.ok(site.state.lane("builder").lastSlot, "the site's builder has its own slot");
  assert.equal(site.state.lane("maintainer").lastSlot, null, "the site has no maintainer lane");
  assert.equal(state.lane("builder").lastSlot, null, "the primary's lanes are untouched");
  await tick(app);
  assert.ok(state.lane("maintainer").lastSlot, "the app's maintainer takes the built-in schedule");
  assert.ok(state.lane("builder").lastSlot);
  assert.deepEqual(state.recentRuns(), [], "nothing ran");
});
