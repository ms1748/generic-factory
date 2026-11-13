import assert from "node:assert/strict";
import { test } from "node:test";
import { dependencies, partOfIn, stageOf, type DepIssue } from "../src/deps.ts";

const issue = (number: number, body: string, labels: string[] = [], closed = false): DepIssue => ({ number, title: `Card ${number}`, body, labels, closed });

// A feature: #181 first, then #182-#184, all part of #135.
const editor = [
  issue(135, "Tracker for the parts", ["feature"]),
  issue(181, "Part of #135\n\nDo this first.", ["feature", "review"]),
  issue(182, "Part of #135\nBlocked by #181", ["feature", "idea"]),
  issue(183, "Part of #135\nBlocked by #181", ["feature", "ready"]),
  issue(184, "Part of #135\nBlocked by #181", ["feature", "idea"]),
];

test("Part of #n is read from the text", () => {
  assert.equal(partOfIn("Part of #135\nBlocked by #181"), 135);
  assert.equal(partOfIn("no parent here"), null);
});

test("a feature lists its parts in build order, with where each stands", () => {
  const { features } = dependencies(editor, new Set([181]));
  assert.equal(features.length, 1);
  const f = features[0];
  assert.equal(f.number, 135);
  assert.deepEqual(f.parts.map((p) => [p.number, p.level, p.stage]), [
    [181, 0, "review"],
    [182, 1, "waiting"],
    [183, 1, "waiting"],
    [184, 1, "waiting"],
  ]);
  assert.equal(f.done, 0);
});

test("each card's chain: what it waits on, what it unblocks, its feature", () => {
  const { chains } = dependencies(editor, new Set());
  assert.deepEqual(chains[181].unblocks.map((r) => r.number), [182, 183, 184]);
  assert.equal(chains[181].partOf?.number, 135);
  assert.deepEqual(chains[183].waitsOn.map((r) => r.number), [181]);
  assert.equal(chains[135], undefined, "the tracker itself has no chain");
});

test("once the first part is closed, the rest can start and the feature counts it", () => {
  const done = editor.map((i) => (i.number === 181 ? { ...i, closed: true } : i));
  const { features, chains } = dependencies(done, new Set());
  assert.equal(features[0].done, 1);
  assert.equal(features[0].parts.find((p) => p.number === 183)?.stage, "queued");
  assert.equal(features[0].parts.find((p) => p.number === 182)?.stage, "idea");
  assert.equal(chains[181], undefined, "closed cards get no chain");
});

test("a finished feature leaves the board; a loop in the texts doesn't hang", () => {
  const finished = [issue(1, "", [], true), issue(2, "Part of #1", [], true)];
  assert.equal(dependencies(finished, new Set()).features.length, 0);
  const loop = [issue(10, ""), issue(11, "Part of #10\nBlocked by #12"), issue(12, "Part of #10\nBlocked by #11")];
  assert.equal(dependencies(loop, new Set()).features[0].parts.length, 2);
});

test("stages come from labels, an open PR and being closed", () => {
  assert.equal(stageOf(issue(1, "", ["building"]), false), "building");
  assert.equal(stageOf(issue(1, "", ["ready"]), true), "review");
  assert.equal(stageOf(issue(1, "", ["hold", "ready"]), false), "hold");
  assert.equal(stageOf(issue(1, "", [], true), false), "done");
});
