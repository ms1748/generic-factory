import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bindInstall, DEFAULTS, deviceCheck, fromEnv, install, needsSetup, parseInstall, resolve, saveInstall, setAppSlug } from "../src/install.ts";
import { defaults, fromYaml } from "../src/config.ts";
import { homelabNotes, lanePrompt } from "../src/prompt.ts";
import { doneLine } from "../src/done.ts";
import { byMachine, ciMachines, machineOf } from "../src/devices.ts";
import { State } from "../src/state.ts";
import { bannedIn } from "./banned-words.ts";
import { EXAMPLE } from "./example-install.ts";

test("with nothing set, every optional part is off and nothing names a deployment", () => {
  const i = resolve({}, {});
  assert.deepEqual(i, DEFAULTS);
  assert.deepEqual(i.projects, [], "no built-in repo: FACTORY_PROJECTS is required");
  assert.equal(deviceCheck(i.deviceChecks), null);
  const notes = homelabNotes(false, i).join("\n");
  assert.deepEqual(bannedIn(notes), []);
  assert.doesNotMatch(notes, /pages\.dev|closed source|private/i);
  assert.match(notes, /signed in as the factory's GitHub App/);
  assert.doesNotMatch(notes, /previews/, "no preview host: no preview note");
});

test("the env fills in what the dashboard hasn't saved; the dashboard wins", () => {
  const env = { FACTORY_PROJECTS: " a/app , a/site ", FACTORY_URL: "https://f.example.com/", PVE_NAME: "box", FACTORY_STOP_ISSUE: "12", FACTORY_APP_SLUG: "my-factory", GLITCHTIP_URL: "https://gt.example.com", GLITCHTIP_ORG: "acme" };
  assert.deepEqual(fromEnv({ FACTORY_PROJECT: "a/one" }).projects, ["a/one"], "the old single-repo key still works");
  const i = resolve({}, env);
  assert.deepEqual(i.projects, ["a/app", "a/site"]);
  assert.equal(i.dashboardUrl, "https://f.example.com");
  assert.equal(i.host, "box");
  assert.equal(i.stopIssue, 12);
  assert.deepEqual(i.apps, ["my-factory"]);
  assert.deepEqual(i.reports, { url: "https://gt.example.com", org: "acme" });
  assert.deepEqual(resolve({ projects: ["a/app"], stopIssue: 0 }, env).projects, ["a/app"]);
  assert.equal(resolve({ stopIssue: 0 }, env).stopIssue, 0, "a saved 0 turns the env's issue off");
});

test("the app's slug from GitHub leads the list; Settings and the env add former ones", () => {
  assert.deepEqual(resolve({}, {}, "my-factory").apps, ["my-factory"], "a new install needn't type it");
  assert.deepEqual(resolve({ apps: ["old-factory"] }, {}, "my-factory").apps, ["my-factory", "old-factory"]);
  assert.deepEqual(resolve({ apps: ["My-Factory", "old-factory"] }, {}, "my-factory").apps, ["my-factory", "old-factory"], "no repeat");
  assert.deepEqual(resolve({}, { FACTORY_APP_SLUG: "old-factory" }, "my-factory").apps, ["my-factory", "old-factory"]);
  assert.deepEqual(resolve({ apps: ["old-factory"] }, {}).apps, ["old-factory"], "GitHub didn't answer: Settings stands");
  assert.match(homelabNotes(false, resolve({ apps: ["old-factory"] }, {}, "my-factory")).join("\n"), /signed in as the my-factory GitHub App/);
  assert.throws(() => setAppSlug("not a slug"), /app's slug/);
});

test("saved settings are checked: bad values say what's wrong, unknown keys go", () => {
  assert.deepEqual(parseInstall({ nonsense: 1 }), {});
  assert.deepEqual(parseInstall({ projects: "a/b\nc/d, a/b" }).projects, ["a/b", "c/d"], "a textarea's lines, without repeats");
  assert.throws(() => parseInstall({ projects: "not a repo" }), /isn't owner\/name/);
  assert.throws(() => parseInstall({ projects: [] }), /at least one/);
  assert.throws(() => parseInstall({ dashboardUrl: "ftp://x" }), /only http/);
  assert.throws(() => parseInstall({ machines: [{ name: "Big Box" }] }), /isn't a machine name/);
  assert.throws(() => parseInstall({ machines: [{ name: "a" }, { name: "a" }] }), /twice/);
  assert.throws(() => parseInstall({ deviceChecks: "(" }), /valid pattern/);
  assert.throws(() => parseInstall({ uptime: [{ label: "x" }] }), /needs an address/);
  assert.throws(() => parseInstall({ stopIssue: -1 }), /issue number/);
  assert.throws(() => parseInstall({ riskyPaths: "ok.rs\n{a,b" }), /riskyPaths: "\{a,b" has an unmatched brace/);
  assert.throws(() => parseInstall({ riskyPaths: Array.from({ length: 51 }, (_, i) => `f${i}`) }), /at most 50/);
  assert.deepEqual(parseInstall({ riskyPaths: " sign*\n\n*.{pem,crt}\nsign*" }).riskyPaths, ["sign*", "*.{pem,crt}"], "one per line: a comma stays in its glob");
  assert.equal(parseInstall({ reviewerCi: "  Windows builds\n wait for you. " }).reviewerCi, "Windows builds wait for you.");
  const m = parseInstall({ machines: [{ name: "pc", labels: "Windows-Build, gpu", always: true }], previewHost: "*.p.pages.dev", apps: ["x-factory[bot]"] });
  assert.deepEqual(m.machines, [{ name: "pc", role: "", always: true, runner: "", labels: ["windows-build", "gpu"] }]);
  assert.equal(m.previewHost, "p.pages.dev");
  assert.deepEqual(m.apps, ["x-factory"]);
  assert.deepEqual(parseInstall({ uptime: [{ url: "https://site.example/" }] }).uptime, [{ label: "site.example", url: "https://site.example/" }]);
  assert.deepEqual(parseInstall({ legacyMarkers: "old-factory, older.factory, old-factory" }).legacyMarkers, ["old-factory", "older.factory"]);
  assert.throws(() => parseInstall({ legacyMarkers: "no spaces" }), /isn't a marker name/);
  assert.throws(() => parseInstall({ legacyMarkers: "x --><script>" }), /isn't a marker name/);
  assert.deepEqual(parseInstall({ perfApp: { ui: " App UI ", processes: "App, WebView2" } }).perfApp, { ui: "App UI", processes: ["App", "WebView2"] });
  assert.deepEqual(fromEnv({ FACTORY_LEGACY_MARKERS: "a-factory,b-factory" }).legacyMarkers, ["a-factory", "b-factory"]);
  assert.deepEqual(parseInstall(EXAMPLE), EXAMPLE, "a full install survives a round trip");
});

test("the dashboard adds and removes repos but never changes the primary", () => {
  const state = new State(":memory:");
  bindInstall(state);
  saveInstall({ projects: ["o/app"] });
  saveInstall({ projects: ["o/app", "o/site"] });
  assert.deepEqual(install().projects, ["o/app", "o/site"]);
  assert.throws(() => saveInstall({ projects: ["o/site", "o/app"] }), /first repo stays o\/app/);
  saveInstall({ machines: [{ name: "pc", role: "PC", runner: "r", labels: ["x"] }] });
  assert.deepEqual(install().projects, ["o/app", "o/site"], "saving one field keeps the others");
  assert.equal(state.for("o/app").scope, "", "the primary keeps the unscoped rows");
  assert.equal(state.for("o/site").scope, "o/site");
});

test("a database from before these settings says it needs them until something is saved", () => {
  const file = join(mkdtempSync(join(tmpdir(), "factory-")), "old.db");
  const old = new DatabaseSync(file);
  old.exec("CREATE TABLE runs (id INTEGER PRIMARY KEY, lane TEXT NOT NULL, model TEXT NOT NULL, mode TEXT NOT NULL, card INTEGER, action TEXT, status TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT, session_id TEXT, pr INTEGER, cost_usd REAL, summary TEXT)");
  old.close();
  const state = new State(file);
  bindInstall(state);
  assert.equal(needsSetup(), true);
  saveInstall({ dashboardUrl: "https://f.example.com" });
  assert.equal(needsSetup(), false);
  bindInstall(new State(":memory:"));
  assert.equal(needsSetup(), false, "a new database starts from the env and defaults");
});

test("the agents' notes follow the install", () => {
  const notes = homelabNotes(false, EXAMPLE).join("\n");
  assert.match(notes, /the example-factory GitHub App/);
  assert.match(notes, /\*\.app-previews\.pages\.dev/);
  assert.match(notes, /dashboard at factory\.example\.com/);
  assert.match(notes, /lives in the `owner\/factory` repo/);
  assert.match(notes, /Factory side \(owner\/factory\)/);
  const own = homelabNotes(false, EXAMPLE, "owner/factory").join("\n");
  assert.doesNotMatch(own, /The factory itself/, "a run on the factory's own repo can change it");
});

test(".factory.yml can move the prompt files; the default time zone is UTC", () => {
  const d = defaults("o/r");
  assert.equal(d.timezone, process.env.FACTORY_TIMEZONE || "UTC");
  assert.equal(d.lanes.find((l) => l.name === "builder")?.prompt, "docs/factory/prompts/builder.md");
  assert.equal(d.lanes.find((l) => l.name === "reviewer")?.prompt, "factory:reviewer");
  const y = fromYaml("o/r", "prompt_dir: agents/\nlanes:\n  - { name: builder, kind: builder }\n  - { name: mine, kind: maintainer, prompt: x.md }");
  assert.equal(y.promptDir, "agents");
  assert.equal(y.lanes[0].prompt, "agents/builder.md");
  assert.equal(y.lanes[1].prompt, "x.md");
  const lane = y.lanes[0];
  assert.match(lanePrompt(lane, "o/r", undefined, false, y.promptDir), /together with `agents\/common\.md`/);
});

test("no machines: the Devices view is empty and no check counts as a device test", () => {
  bindInstall(new State(":memory:"));
  assert.deepEqual(ciMachines(), []);
  assert.equal(machineOf({ runner_name: null, labels: ["self-hosted", "hardware"] }), null);
  assert.deepEqual(byMachine([], () => []), []);
  const r = doneLine({ pr: 1, card: 2, checks: [{ name: "Hardware tests (test box)", status: "completed", conclusion: "success" }], verdict: "ready", followups: [] });
  assert.equal(r.ok, true);
  assert.doesNotMatch(r.line, /[Dd]evice tests/);
  assert.deepEqual(ciMachines(EXAMPLE.machines).map((m) => m.name), ["test-box", "build-pc"], "only machines with a runner or labels run CI");
});
