import assert from "node:assert/strict";
import { test } from "node:test";
import { conditions, DEFAULTS, diff, settingsFrom, sustained, type Facts } from "../src/alerts.ts";
import type { Sample } from "../src/state.ts";

const now = Date.parse("2026-11-07T12:00:00Z");
const ago = (min: number) => new Date(now - min * 60_000).toISOString();
const samples = (n: number, v: Partial<Sample>): Sample[] => Array.from({ length: n }, (_, i) => ({ name: "host", at: ago(i), cpu: null, mem: null, disk: null, temp: null, ...v }));
const facts = (over: Partial<Facts> = {}): Facts => ({
  devices: [{ name: "host", always: true, lastSeen: ago(0.5) }, { name: "laptop", always: false, lastSeen: ago(600) }],
  checks: [],
  functionsToday: 10,
  r2Bytes: 1e6,
  r2ClassA: 50,
  free: { functionsPerDay: 100_000, r2Bytes: 10e9, r2ClassA: 1_000_000 },
  ...over,
});

test("settings fall back to defaults and stay in range", () => {
  assert.deepEqual(settingsFrom(null), DEFAULTS);
  const s = settingsFrom({ cpu: { pct: 500, min: 0 }, offlineMin: 1, enabled: false, temp: { c: "hot" } });
  assert.equal(s.cpu.pct, 100);
  assert.equal(s.cpu.min, 1);
  assert.equal(s.offlineMin, 2);
  assert.equal(s.enabled, false);
  assert.equal(s.temp.c, DEFAULTS.temp.c);
});

test("a limit counts only when every sample in the window is over it, and enough reported", () => {
  assert.equal(sustained(samples(10, { cpu: 0.95 }), "cpu", 0.9, 10, now), true);
  assert.equal(sustained([...samples(10, { cpu: 0.95 }), { name: "host", at: ago(3), cpu: 0.2, mem: null, disk: null, temp: null }], "cpu", 0.9, 10, now), false);
  assert.equal(sustained(samples(2, { cpu: 0.99 }), "cpu", 0.9, 10, now), false, "two samples aren't ten minutes");
});

test("rules: offline always-on machines, hot, full, site down, free tier", () => {
  assert.deepEqual(conditions(facts(), new Map(), DEFAULTS, now), [], "a quiet laptop is fine: it isn't always on");
  const off = conditions(facts({ devices: [{ name: "test-box", always: true, lastSeen: ago(30) }] }), new Map(), DEFAULTS, now);
  assert.deepEqual(off.map((c) => c.key), ["offline:test-box"]);
  const hot = conditions(facts({ devices: [{ name: "host", always: true, lastSeen: ago(0.5), disks: [{ mount: "local", used: 95, total: 100 }] }] }), new Map([["host", samples(10, { cpu: 0.97, temp: 90 })]]), DEFAULTS, now);
  assert.deepEqual(hot.map((c) => c.key).sort(), ["cpu:host", "disk:host:local", "temp:host"]);
  const site = conditions(
    facts({
      checks: [
        { label: "app.example.com", url: "https://app.example.com/", points: [{ ok: false, status: 502 }, { ok: false, status: null }] },
        { label: "Updater", url: "https://app.example.com/releases/latest.json", points: [{ ok: false, status: 404 }, { ok: false, status: 404 }] },
        { label: "Tunnel", url: "https://factory.app.example.com/healthz", points: [{ ok: false, status: null }, { ok: true, status: 302 }] },
      ],
    }),
    new Map(),
    DEFAULTS,
    now,
  );
  assert.deepEqual(site.map((c) => c.key), ["site:https://app.example.com/"], "404 on latest.json means no release yet; one miss isn't down");
  const free = conditions(facts({ functionsToday: 85_000, r2Bytes: 9e9, r2ClassA: 900_000 }), new Map(), DEFAULTS, now);
  assert.deepEqual(free.map((c) => c.key), ["free:functions", "free:r2", "free:r2a"]);
  assert.deepEqual(conditions(facts({ functionsToday: 99_999 }), new Map(), { ...DEFAULTS, enabled: false }, now), []);
});

test("diff opens new conditions once and clears the ones that ended", () => {
  const d = diff([{ key: "a", text: "A" }, { key: "b", text: "B" }], [{ id: 1, key: "b" }, { id: 2, key: "c" }]);
  assert.deepEqual(d.start.map((c) => c.key), ["a"]);
  assert.deepEqual(d.clear.map((c) => c.id), [2]);
});

test("the pasted webhook must be a Discord one; it wins over the env and can be removed", async () => {
  const { Systems } = await import("../src/systems.ts");
  const { State } = await import("../src/state.ts");
  const { WEBHOOK } = await import("../src/alerts.ts");
  assert.ok(WEBHOOK.test("https://discord.com/api/webhooks/123/abc_DEF-9"));
  assert.ok(!WEBHOOK.test("https://evil.example/api/webhooks/123/abc"));
  assert.ok(!WEBHOOK.test("https://discord.com/api/webhooks/123/abc?wait=1"));
  const state = new State(":memory:");
  const sys = new Systems(state, () => {});
  await assert.rejects(sys.setWebhook("https://example.com/hook"), /isn't a Discord webhook/);
  const env = process.env.DISCORD_WEBHOOK_URL;
  process.env.DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/1/env";
  state.setDiscordWebhook("https://discord.com/api/webhooks/2/page");
  assert.equal(sys.webhook(), "https://discord.com/api/webhooks/2/page");
  assert.equal(sys.view().alerts.discordFrom, "page");
  assert.match(await sys.setWebhook(""), /env is used again/);
  assert.equal(sys.webhook(), "https://discord.com/api/webhooks/1/env");
  if (env === undefined) delete process.env.DISCORD_WEBHOOK_URL;
  else process.env.DISCORD_WEBHOOK_URL = env;
  assert.ok(!JSON.stringify(sys.view()).includes("webhooks/"), "the URL never goes to the page");
});
