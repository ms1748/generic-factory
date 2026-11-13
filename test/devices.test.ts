import assert from "node:assert/strict";
import { test } from "node:test";
import { useExample } from "./example-install.ts";
import { byMachine, devicesText, machineOf, type ApiJob } from "../src/devices.ts";

useExample();

const job = (over: Partial<ApiJob>): ApiJob => ({
  id: 1,
  run_id: 10,
  name: "Windows build and tests",
  status: "completed",
  conclusion: "success",
  labels: ["self-hosted", "windows-build"],
  runner_name: null,
  html_url: "https://github.com/o/r/actions/runs/10/job/1",
  head_branch: "main",
  created_at: "2026-11-12T03:00:00Z",
  started_at: "2026-11-12T03:01:00Z",
  completed_at: "2026-11-12T03:10:00Z",
  steps: [],
  ...over,
});

test("a job belongs to the machine it ran on, or the one its labels pick", () => {
  assert.equal(machineOf({ runner_name: "runner-test-box", labels: ["self-hosted", "windows", "hardware"] }), "test-box");
  assert.equal(machineOf({ runner_name: null, labels: ["self-hosted", "windows-build"] }), "build-pc");
  assert.equal(machineOf({ runner_name: null, labels: ["self-hosted", "Windows", "hardware"] }), "test-box");
  assert.equal(machineOf({ runner_name: null, labels: ["windows-latest"] }), null); // GitHub's machines
  assert.equal(machineOf({ runner_name: "GitHub Actions 12", labels: ["ubuntu-latest"] }), null);
  assert.equal(machineOf({ runner_name: null, labels: ["self-hosted"] }), null); // no machine label
});

test("per machine: running now with live steps, the queue in order, the last results with artifacts", () => {
  const jobs = [
    job({ id: 1, status: "in_progress", conclusion: null, runner_name: "runner-build", steps: [
      { name: "Set up job", status: "completed", conclusion: "success", number: 1 },
      { name: "Wait while the build PC is paused", status: "completed", conclusion: "success", number: 2, started_at: "2026-11-12T03:01:00Z", completed_at: "2026-11-12T03:01:05Z" },
      { name: "Tests", status: "in_progress", conclusion: null, number: 3, started_at: "2026-11-12T03:02:00Z" },
    ] }),
    job({ id: 2, status: "queued", conclusion: null, name: "Frontend checks", created_at: "2026-11-12T03:05:00Z" }),
    job({ id: 3, status: "queued", conclusion: null, name: "Older one", created_at: "2026-11-12T03:04:00Z" }),
    job({ id: 4, runner_name: "runner-test-box", labels: ["self-hosted", "hardware"], name: "Hardware tests (test box)", conclusion: "failure", run_id: 20, steps: [{ name: "Hardware tests", status: "completed", conclusion: "failure", number: 2 }] }),
    job({ id: 5, runner_name: "runner-test-box", labels: ["self-hosted", "hardware"], conclusion: "skipped" }), // skipped jobs aren't results
  ];
  const [testBox, buildPc] = byMachine(jobs, (run) => (run === 20 ? [{ name: "test-logs", size: 2048, url: "u", expired: false }] : []));
  assert.equal(buildPc.now.length, 1);
  assert.deepEqual(buildPc.now[0].steps.map((s) => [s.name, s.status]), [
    ["Wait while the build PC is paused", "completed"],
    ["Tests", "in_progress"],
  ]);
  assert.equal(buildPc.now[0].steps[0].seconds, 5);
  assert.deepEqual(buildPc.queue.map((j) => j.name), ["Older one", "Frontend checks"]);
  assert.deepEqual(testBox.recent.map((j) => [j.name, j.conclusion, j.artifacts.length]), [["Hardware tests (test box)", "failure", 1]]);
  const text = devicesText({ machines: [testBox, buildPc], error: null });
  assert.match(text, /build-pc[\s\S]*running  Windows build and tests[\s\S]*▶ Tests/);
  assert.match(text, /test-box[\s\S]*idle[\s\S]*last     ✗ Hardware tests/);
});
