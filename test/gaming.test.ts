import assert from "node:assert/strict";
import { test } from "node:test";
import { EXAMPLE, useExample } from "./example-install.ts";
import { devicesText, type ApiJob } from "../src/devices.ts";
import { autoHours, gameTests, isGameRun, prOf, statusFor, varsFrom, varsPatch, VARS, type ApiRun, type OpenPull } from "../src/gaming.ts";
import { parseInstall } from "../src/install.ts";

useExample();
const cfg = EXAMPLE.gamingTest;

const run = (over: Partial<ApiRun>): ApiRun => ({
  id: 50,
  path: ".github/workflows/game-test.yml",
  status: "in_progress",
  head_sha: "aaa111",
  html_url: "https://github.com/o/r/actions/runs/50",
  run_started_at: "2026-11-13T02:00:00Z",
  pull_requests: [{ number: 12 }],
  ...over,
});

const job = (over: Partial<ApiJob>): ApiJob => ({
  id: 500,
  run_id: 50,
  name: "Game test",
  status: "in_progress",
  conclusion: null,
  labels: ["self-hosted", "manual"],
  runner_name: "runner-build",
  html_url: "https://github.com/o/r/actions/runs/50/job/500",
  steps: [
    { name: "Set up job", status: "completed", conclusion: "success", number: 1 },
    { name: "Ask", status: "in_progress", conclusion: null, number: 2 },
    { name: "Play", status: "queued", conclusion: null, number: 3 },
  ],
  ...over,
});

const pulls: OpenPull[] = [
  { number: 12, title: "Faster loading", head: { sha: "aaa111" } },
  { number: 14, title: "New menu", head: { sha: "ccc333" } },
];

test("a game test is a run of the workflow named in Settings › Install", () => {
  assert.equal(isGameRun({ path: ".github/workflows/game-test.yml" }, "game-test.yml"), true);
  assert.equal(isGameRun({ path: ".github/workflows/game-test.yml@refs/heads/main" }, "game-test.yml"), true);
  assert.equal(isGameRun({ path: ".github/workflows/other-game-test.yml" }, "game-test.yml"), false);
  assert.equal(isGameRun({ path: ".github/workflows/game-test.yml" }, ""), false, "no workflow set: nothing is a game test");
});

test("its PR and commit: the run's own PR, else the PR at its commit, else the #n in its title", () => {
  assert.deepEqual(prOf(run({}), pulls), { pr: 12, title: "Faster loading", sha: "aaa111" });
  assert.deepEqual(prOf(run({ pull_requests: [], head_sha: "ccc333" }), pulls), { pr: 14, title: "New menu", sha: "ccc333" });
  // Dispatched from main for PR 14: the answer goes on the PR's head, not main's commit.
  assert.deepEqual(prOf(run({ pull_requests: [], head_sha: "main999", display_title: "Game test for #14" }), pulls), { pr: 14, title: "New menu", sha: "ccc333" });
  assert.deepEqual(prOf(run({ pull_requests: [], head_sha: "main999", display_title: "Game test for #99" }), pulls), { pr: 99, title: "Game test for #99", sha: null }, "a closed PR: nothing to answer on");
  assert.equal(prOf(run({ pull_requests: [], head_sha: "main999", display_title: "Nightly" }), pulls).pr, null);
});

test("waiting at the ask step: on its machine, with the answers that have a status name", () => {
  const [g] = gameTests([run({}), run({ id: 51, status: "completed" }), run({ id: 52, path: ".github/workflows/ci.yml" })], [job({})], pulls);
  assert.deepEqual(g, {
    run: 50,
    machine: "build-pc",
    state: "waiting",
    step: "Ask",
    pr: 12,
    title: "Faster loading",
    sha: "aaa111",
    url: "https://github.com/o/r/actions/runs/50",
    at: "2026-11-13T02:00:00Z",
    answers: ["start", "later"], // Skip has no status name in the example install
  });
  assert.equal(gameTests([run({}), run({})], [job({})], pulls).length, 1, "a run listed twice shows once");
});

test("running past the ask step: no answers, just Stop; no ask step set means never waiting", () => {
  const playing = job({ steps: [{ name: "Ask", status: "completed", conclusion: "success", number: 2 }, { name: "Play", status: "in_progress", conclusion: null, number: 3 }] });
  const [g] = gameTests([run({})], [playing], pulls);
  assert.equal(g.state, "running");
  assert.equal(g.step, "Play");
  assert.deepEqual(g.answers, []);
  assert.equal(gameTests([run({})], [job({})], pulls, { ...cfg, askStep: "" })[0].state, "running");
  assert.deepEqual(gameTests([run({ pull_requests: [], head_sha: "zzz" })], [job({})], pulls)[0].answers, [], "no commit to answer on: no buttons");
  assert.equal(gameTests([run({})], [job({ runner_name: "someone-else", labels: ["self-hosted", "gpu"] })], pulls)[0].machine, null);
  assert.match(devicesText({ machines: [], games: [gameTests([run({})], [job({})], pulls)[0], g], error: null }), /game test for #12 on build-pc: waiting for Start\ngame test for #12 on build-pc: running \(Play\)/);
});

test("each answer is a success status under its own name", () => {
  assert.deepEqual(statusFor("start", cfg, "https://factory.example.com"), {
    state: "success",
    context: "factory/game-test/start",
    description: "Start: from the factory dashboard",
    target_url: "https://factory.example.com",
  });
  assert.equal(statusFor("later", cfg).context, "factory/game-test/later");
  assert.equal(statusFor("later", cfg).target_url, undefined);
  assert.throws(() => statusFor("skip", cfg), /No status name for Skip/);
});

test("the workflow's variables: read with defaults, written checked, emptied ones deleted", () => {
  assert.deepEqual(varsFrom({}), { on: false, autoHours: "", limitMin: 60, games: "" });
  assert.deepEqual(varsFrom({ on: "TRUE", autoHours: "1-7", limitMin: "45", games: "A, B" }), { on: true, autoHours: "1-7", limitMin: 45, games: "A, B" });
  assert.equal(varsFrom({ limitMin: "lots" }).limitMin, 60);
  assert.deepEqual(varsPatch({ on: true, autoHours: " 22 - 6 ", limitMin: 90, games: " A, B " }), [
    { name: VARS.on, value: "true" },
    { name: VARS.autoHours, value: "22-6" },
    { name: VARS.limitMin, value: "90" },
    { name: VARS.games, value: "A, B" },
  ]);
  assert.deepEqual(varsPatch({ autoHours: "", games: "" }), [{ name: VARS.autoHours, value: null }, { name: VARS.games, value: null }]);
  assert.deepEqual(varsPatch({ on: false }), [{ name: VARS.on, value: "false" }], "only the fields given change");
  assert.throws(() => varsPatch({ on: "yes" }), /true or false/);
  assert.throws(() => varsPatch({ limitMin: 0 }), /1 to 600/);
  assert.throws(() => varsPatch({ limitMin: 1.5 }), /whole minutes/);
  assert.equal(autoHours("0-24"), "0-24");
  for (const bad of ["7", "1-1", "25-3", "1-7-9", "a-b", "-3"]) assert.throws(() => autoHours(bad), /range like 1-7/, bad);
});

test("Settings › Install › Game tests: names checked, off by default", () => {
  assert.deepEqual(parseInstall({ gamingTest: { workflow: " game-test.yml ", askStep: " Ask  the owner ", start: "factory/game-test/start" } }).gamingTest, {
    workflow: "game-test.yml",
    askStep: "Ask the owner",
    start: "factory/game-test/start",
    later: "",
    skip: "",
  });
  assert.throws(() => parseInstall({ gamingTest: { workflow: "../x.yml" } }), /workflow file name/);
  assert.throws(() => parseInstall({ gamingTest: { workflow: "x.yml", start: "has space" } }), /status name/);
});
