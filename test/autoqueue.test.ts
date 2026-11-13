import assert from "node:assert/strict";
import { test } from "node:test";
import { conditions, DEFAULTS as ALERTS, queueConditions, settingsFrom as alertSettings, type QueueFact } from "../src/alerts.ts";
import {
  DEFAULTS,
  eligibleIdeas,
  emptySince,
  excerpt,
  isSomeday,
  parseSelection,
  queueComment,
  queueFact,
  recordFrom,
  refillDue,
  settingsFrom,
} from "../src/autoqueue.ts";
import type { DepIssue } from "../src/deps.ts";
import { autoQueuePrompt } from "../src/prompt.ts";

const now = Date.parse("2026-11-12T12:00:00Z");
const ago = (min: number) => new Date(now - min * 60_000).toISOString();
const H = 3600_000;

test("settings: off by default, threshold 3, up to 5 ideas, numbers kept in range", () => {
  assert.deepEqual(settingsFrom(null), { on: false, threshold: 3, max: 5 });
  assert.deepEqual(settingsFrom({ on: true, threshold: 0, max: 99 }), { on: true, threshold: 1, max: 10 });
  assert.deepEqual(settingsFrom({ on: "yes", threshold: "4" }), DEFAULTS);
});

test("refill: only when on, below the threshold, and not tried within the cooldown", () => {
  const on = { ...DEFAULTS, on: true };
  assert.equal(refillDue(DEFAULTS, 0, undefined, now, 3 * H), false, "off");
  assert.equal(refillDue(on, 3, undefined, now, 3 * H), false, "at the threshold is enough");
  assert.equal(refillDue(on, 2, undefined, now, 3 * H), true);
  assert.equal(refillDue(on, 0, ago(60), now, 3 * H), false, "tried an hour ago");
  assert.equal(refillDue(on, 0, ago(181), now, 3 * H), true);
});

test("empty since: set when the queue empties, kept while empty, cleared when a card is ready", () => {
  const t = new Date(now);
  assert.equal(emptySince(null, 0, t), t.toISOString());
  assert.equal(emptySince(ago(40), 0, t), ago(40));
  assert.equal(emptySince(ago(40), 2, t), null);
  assert.equal(emptySince(null, 1, t), null);
});

const issue = (number: number, labels: string[], over: Partial<DepIssue> = {}): DepIssue => ({ number, title: `Idea ${number}`, body: "", labels, closed: false, ...over });

test("eligible ideas: open ideas without hold, needs-owner, p3, ready or someday", () => {
  const issues = [
    issue(1, ["idea", "size:S"]),
    issue(2, ["idea", "hold"]),
    issue(3, ["idea", "needs-owner"]),
    issue(4, ["idea", "p3"]),
    issue(5, ["idea", "ready"]),
    issue(6, ["feature"]),
    issue(7, ["idea"], { closed: true }),
    issue(8, ["idea", "someday"]),
    issue(9, ["idea"], { title: "Someday: Linux and Steam Deck" }),
    issue(10, ["idea"], { body: "Nice to have.\n\n## Someday\nWhen there's a Deck." }),
    issue(11, ["idea", "p2"], { body: "Linux is someday, but this is Windows only." }),
    issue(12, ["idea", "size:XL"]),
  ];
  assert.deepEqual(eligibleIdeas(issues).map((i) => i.number), [1, 11]);
  assert.equal(isSomeday({ title: "[Someday] x", labels: [], body: "" }), true);
  assert.equal(isSomeday({ title: "Add a someday list", labels: [], body: "" }), false);
});

test("excerpt: no HTML comments, squeezed, cut on a word", () => {
  assert.equal(excerpt("Hello\n\n  world <!-- factory -->"), "Hello world");
  const long = excerpt("word ".repeat(200), 50);
  assert.ok(long.length <= 50 && long.endsWith("..."));
});

test("selection: last json block, eligible issues only, once each, capped, one-line reasons", () => {
  const eligible = new Set([1, 2, 3, 4]);
  const text = 'Thinking...\n```json\n{"queue": [1]}\n```\nFinal:\n```json\n{"queue": [{"number": 2, "reason": "Small fix,\\n  clear scope"}, {"number": 9, "reason": "not an idea"}, {"number": 2, "reason": "dup"}, {"number": 3}, {"number": 4, "reason": "x"}]}\n```';
  assert.deepEqual(parseSelection(text, eligible, 2), [
    { number: 2, reason: "Small fix, clear scope" },
    { number: 3, reason: "picked from the ideas" },
  ]);
  assert.deepEqual(parseSelection('```json\n{"queue": []}\n```', eligible, 5), [], "none is a fine answer");
  assert.deepEqual(parseSelection('Done. {"queue": [{"number": 1, "reason": "ok"}]}', eligible, 5), [{ number: 1, reason: "ok" }], "a bare object at the end");
  assert.equal(parseSelection("no json here", eligible, 5), undefined);
  assert.equal(parseSelection('```json\n{"pick": [1]}\n```', eligible, 5), undefined);
  const long = parseSelection(`\`\`\`json\n{"queue": [{"number": 1, "reason": "${"a ".repeat(200)}"}]}\n\`\`\``, eligible, 5)!;
  assert.ok(long[0].reason.length <= 160);
});

test("the comment and the prompt", () => {
  assert.match(queueComment("small and clear"), /^🤖 Queued by auto-queue: small and clear\n<!-- factory-autoqueue -->$/);
  const p = autoQueuePrompt("acme/app", [{ number: 7, title: "Seven", labels: ["idea", "size:S"], excerpt: "Body" }], 5, ["#1 One"], ["#2 Two"]);
  assert.match(p, /up to 5 of the open ideas/);
  assert.match(p, /### #7 Seven\nLabels: idea, size:S\nBody/);
  assert.match(p, /#1 One/);
  assert.match(p, /#2 Two/);
  assert.match(p, /```json/);
});

test("queue fact: auto-queue found nothing only once its last finished attempt added nothing", () => {
  assert.equal(queueFact("r", recordFrom(null), true).autoQueueFoundNothing, false, "never tried");
  assert.equal(queueFact("r", { emptySince: ago(40), last: { at: ago(10), added: [], note: "running" } }, true).autoQueueFoundNothing, false, "still running");
  assert.equal(queueFact("r", { emptySince: ago(40), last: { at: ago(10), added: [], note: "found nothing to add" } }, true).autoQueueFoundNothing, true);
  assert.equal(queueFact("r", { emptySince: ago(40), last: { at: ago(100), added: [5], note: "queued 1" } }, true).autoQueueFoundNothing, false);
  assert.deepEqual(recordFrom({ emptySince: 5, last: { at: 1 } }), { emptySince: null, last: undefined });
});

const fact = (over: Partial<QueueFact> = {}): QueueFact => ({ repo: "acme/app", emptySince: ago(31), autoQueue: false, autoQueueFoundNothing: false, ...over });

test("nothing ready to build: after the grace period, and with auto-queue on only when it found nothing", () => {
  assert.deepEqual(queueConditions([fact()], ALERTS, now), [{ key: "queue:acme/app", text: "**acme/app**: nothing ready to build" }]);
  assert.deepEqual(queueConditions([fact({ emptySince: ago(29) })], ALERTS, now), [], "inside the 30 minutes");
  assert.deepEqual(queueConditions([fact({ emptySince: null })], ALERTS, now), [], "a card is ready: it clears");
  assert.deepEqual(queueConditions([fact({ autoQueue: true })], ALERTS, now), [], "auto-queue hasn't found nothing yet");
  const [c] = queueConditions([fact({ autoQueue: true, autoQueueFoundNothing: true })], ALERTS, now);
  assert.equal(c.text, "**acme/app**: nothing ready to build; auto-queue found nothing to add; queue an idea or file a card");
  assert.deepEqual(queueConditions([fact()], { ...ALERTS, queue: { on: false, min: 30 } }, now), [], "its own switch");
  assert.deepEqual(queueConditions([fact()], { ...ALERTS, enabled: false }, now), [], "alerts off");
  assert.deepEqual(queueConditions([fact({ emptySince: ago(50) })], { ...ALERTS, queue: { on: true, min: 60 } }, now), [], "a longer grace period");
});

test("the queue alert runs with the other rules and has its own settings", () => {
  const f = { devices: [], checks: [], functionsToday: null, r2Bytes: null, r2ClassA: null, free: { functionsPerDay: 1, r2Bytes: 1, r2ClassA: 1 }, queues: [fact()] };
  assert.deepEqual(conditions(f, new Map(), ALERTS, now).map((c) => c.key), ["queue:acme/app"]);
  assert.deepEqual(alertSettings(null).queue, { on: true, min: 30 });
  assert.deepEqual(alertSettings({ queue: { on: false, min: 1 } }).queue, { on: false, min: 5 });
});
