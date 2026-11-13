import assert from "node:assert/strict";
import { test } from "node:test";
import { parseIssues } from "../src/reports.ts";

test("GlitchTip issues become report rows, newest first, linked to the public address", () => {
  const rows = parseIssues(
    [
      { id: "1", shortId: "APP-1", title: "Test report", level: "info", status: "unresolved", count: "1", firstSeen: "2026-11-07T16:31:14Z", lastSeen: "2026-11-07T16:31:14Z", permalink: "http://glitchtip-web:8000/x" },
      { id: "2", shortId: "APP-2", title: "panicked at launch.rs", culprit: "launch::place", level: "fatal", status: "unresolved", count: 3, firstSeen: "2026-11-08T10:00:00Z", lastSeen: "2026-11-08T20:00:00Z" },
    ],
    "https://crash.example.com/",
    "example",
  );
  assert.deepEqual(rows.map((r) => [r.shortId, r.kind, r.count]), [["APP-2", "crash", 3], ["APP-1", "problem", 1]]);
  assert.equal(rows[1].link, "https://crash.example.com/example/issues/1", "never GlitchTip's internal address");
});

test("missing fields get safe defaults", () => {
  const [r] = parseIssues([{ id: "9" }]);
  assert.equal(r.title, "(no title)");
  assert.equal(r.kind, "crash");
  assert.equal(r.count, 0);
});
