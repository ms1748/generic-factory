import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { runTokenDir } from "../src/runner.ts";

// Runs at once (Parallel runs, or one per repo) must not share a token file: the first to finish used to
// delete the file the others were still reading, and a run for another repo overwrote it with its own token.
test("each run gets its own token folder", () => {
  assert.notEqual(runTokenDir("data", 12), runTokenDir("data", 13));
  assert.equal(runTokenDir("data", 12), join("data", "run", "12"));
  assert.equal(runTokenDir("/srv/data", 7, true), join("/srv/data", "run", "usage"));
});
