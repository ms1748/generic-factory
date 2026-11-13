import assert from "node:assert/strict";
import { test } from "node:test";
import { logs, parseContainers, parseLogs } from "../src/logs.ts";

test("containers: running first, with their compose project", () => {
  const out = [
    JSON.stringify({ Names: "factory-run-182", Image: "factory-agent", State: "exited", Status: "Exited (0) 1 hour ago", CreatedAt: "2026-11-07 09:33:40 -0500 EST", Labels: "" }),
    JSON.stringify({ Names: "factory-dispatcher-1", Image: "factory-dispatcher", State: "running", Status: "Up 8 minutes", CreatedAt: "2026-11-07 10:40:19 -0500 EST", Labels: "a=b,com.docker.compose.project=factory,c=d" }),
    "not json",
  ].join("\n");
  const list = parseContainers(out);
  assert.deepEqual(list.map((c) => c.name), ["factory-dispatcher-1", "factory-run-182"]);
  assert.equal(list[0].project, "factory");
  assert.equal(list[1].project, null);
});

test("log lines keep docker's timestamp apart from the text", () => {
  const lines = parseLogs("2026-11-07T15:18:18.476886134Z 2026-11-07T15:18:18Z ERR boom\nno timestamp here\n\n");
  assert.deepEqual(lines, [
    { at: "2026-11-07T15:18:18.476886134Z", text: "2026-11-07T15:18:18Z ERR boom" },
    { at: "", text: "no timestamp here" },
  ]);
});

test("container names are checked before docker sees them", async () => {
  await assert.rejects(logs("--help"), /bad container name/);
  await assert.rejects(logs("a b"), /bad container name/);
});
