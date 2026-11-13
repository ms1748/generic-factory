import assert from "node:assert/strict";
import { test } from "node:test";
import { defaults, fromYaml, nextRun } from "../src/config.ts";
import { blockersIn, buildQueue, hasMarker, isAgent, issueOfPull, MARKER, pickFor, stripMarker, type Card, type Issue, type Pull } from "../src/queue.ts";

const issue = (number: number, labels: string[], extra: Partial<Issue> = {}): Issue => ({
  number, title: `card ${number}`, labels, body: "", comments: [], blockedBy: [], ...extra,
});
const pull = (number: number, branch: string, draft = false, body = ""): Pull => ({
  number, title: `pr ${number}`, draft, branch, body, labels: ["factory"],
});
const lanes = defaults("o/r").lanes;
const big = lanes.find((l) => l.name === "builder")!;
const small = lanes.find((l) => l.name === "small-builder")!;

test("orders p1 > p2 > p3 > none, then lowest number", () => {
  const q = buildQueue([issue(5, ["ready"]), issue(9, ["ready", "p2"]), issue(7, ["ready", "p1"]), issue(3, ["ready", "p2"])], [], new Set());
  assert.deepEqual(q.map((c) => c.number), [7, 3, 9, 5]);
});

test("skips excluded labels, open blockers and cards with an open PR", () => {
  const ready = [
    issue(1, ["ready", "hold"]),
    issue(2, ["ready"], { body: "Blocked by #40" }),
    issue(3, ["ready"], { body: "Blocked by #41" }), // #41 is closed
    issue(4, ["ready"]),
    issue(6, ["ready"], { blockedBy: [40] }),
  ];
  const q = buildQueue(ready, [pull(50, "claude/issue-4-thing")], new Set([40]));
  const by = Object.fromEntries(q.map((c) => [c.number, c.reason ?? "queued"]));
  assert.deepEqual(by, { 1: "hold", 2: "blocked by #40", 3: "queued", 4: "PR #50 is open", 6: "blocked by #40" });
});

test("only the owner's comments can block a card", () => {
  const agent = { author: "owner-login", body: "Waits on #40\n<!-- factory -->" };
  const owner = { author: "owner-login", body: "Depends on #42 and #43" };
  const q = buildQueue([issue(1, ["ready"], { comments: [agent, owner] })], [], new Set([40, 42, 43]));
  assert.deepEqual(q[0].blockers, [42, 43]);
});

test("the agents' marker: the new one and the install's older names all count, other HTML comments don't", () => {
  assert.equal(MARKER, "<!-- factory -->");
  const legacy = ["old-factory", "older.factory"];
  for (const m of [MARKER, "<!-- old-factory -->", "<!-- older.factory -->"]) {
    assert.ok(hasMarker(`done\n${m}`, legacy), m);
    assert.equal(stripMarker(`done ${m}`, legacy), "done ");
  }
  assert.ok(isAgent({ author: "owner-login", body: `done\n${MARKER}` }));
  assert.ok(!hasMarker("done <!-- old-factory -->"), "no older names by default");
  assert.ok(!hasMarker("done <!-- olderXfactory -->", legacy), "a name's dot is literal");
  process.env.FACTORY_LEGACY_MARKERS = "old-factory";
  try {
    assert.ok(isAgent({ author: "owner-login", body: "done <!-- old-factory -->" }), "the env names them too");
  } finally {
    delete process.env.FACTORY_LEGACY_MARKERS;
  }
  for (const other of ["<!-- factory-review -->", "<!-- factory-autoqueue -->", "<!-- my-factory -->", "factory"]) {
    assert.ok(!hasMarker(other), other);
    assert.ok(!isAgent({ author: "owner-login", body: other }), other);
  }
  assert.ok(hasMarker("a <!-- factory --> b") && hasMarker("a <!-- factory --> b"), "the check has no leftover state");
  assert.equal(stripMarker("a <!-- factory --> b <!-- old-factory -->", legacy), "a  b ");
});

test("blocker phrases", () => {
  assert.deepEqual(blockersIn("Blocked on #1, #2\nwaits on: #3\nblocked by #4 & #5"), [1, 2, 3, 4, 5]);
  assert.deepEqual(blockersIn("see #9, not blocking"), []);
});

test("PR ↔ issue", () => {
  assert.equal(issueOfPull(pull(1, "claude/issue-12-x")), 12);
  assert.equal(issueOfPull(pull(1, "feature", false, "Closes #33")), 33);
  assert.equal(issueOfPull(pull(1, "feature")), undefined);
});

test("lanes pick by size; XL is split; drafts continue; PR limit stops builders", () => {
  const q = buildQueue(
    [issue(1, ["ready", "p1", "size:XL"]), issue(2, ["ready", "p1", "size:S"]), issue(3, ["ready", "p2"])],
    [pull(60, "claude/issue-3-wip", true)],
    new Set(),
  );
  assert.deepEqual(pickFor(big, q, 0, 8), { card: q[0], action: "split" });
  assert.equal(pickFor(small, q, 0, 8).card?.number, 2);
  const unsized = pickFor({ ...big, splits: [] }, q, 0, 8);
  assert.equal(unsized.card?.number, 3);
  assert.equal(unsized.action, "continue");
  assert.match(pickFor(big, q, 8, 8).idle ?? "", /8 factory PRs/);
});

test(".factory.yml overrides defaults", () => {
  const c = fromYaml("o/r", "max_open_prs: 4\nlanes:\n  - name: builder\n    kind: builder\n    model: sonnet\n");
  assert.equal(c.maxOpenPrs, 4);
  assert.equal(c.lanes.length, 1);
  assert.deepEqual(c.lanes[0].sizes, ["M", "L", "none"]);
  assert.equal(c.lanes[0].model, "sonnet");
});

test("next run", () => {
  const wed = new Date(2026, 9, 28, 10, 0); // Wed 10:00 local
  assert.equal(nextRun(["09:00", "14:00"], wed)?.getHours(), 14);
  const t = nextRun(["mon,thu 08:00"], wed)!;
  assert.equal(t.getDay(), 4);
  assert.equal(t.getHours(), 8);
});

test("max_open_prs 0 (the default) means no open-PR limit", () => {
  const lane = fromYaml("o/r", "lanes:\n  - name: builder\n    kind: builder\n    model: sonnet\n").lanes[0];
  assert.equal(fromYaml("o/r", "lanes:\n  - name: builder\n    kind: builder\n    model: sonnet\n").maxOpenPrs, 0);
  const card = { number: 1, title: "x", state: "queued", priority: "p1", size: "M" } as unknown as Card;
  assert.equal(pickFor(lane, [card], 40, 0).card?.number, 1);
  assert.match(pickFor(lane, [card], 4, 4).idle ?? "", /limit 4/);
});
