import assert from "node:assert/strict";
import { test } from "node:test";
import { bucket, CI_THREADS, ciThreadsFrom, cleanReport, fullest, r2Class, Systems } from "../src/systems.ts";
import { sameSecret } from "../src/server.ts";
import { State } from "../src/state.ts";
import { useExample } from "./example-install.ts";

useExample();

test("reports keep known fields in range and drop the rest", () => {
  const r = cleanReport({
    cpu: 1.7, memUsed: 4e9, memTotal: 8e9, temp: 999, os: " Windows 11 ", evil: "<script>",
    disks: [{ mount: "C:", used: 9e11, total: 5e11 }, { mount: "D:", total: 0 }],
    gpu: { name: "UHD 630", util: 0.2 },
    facts: { Controllers: 2, "": "x", bad: { a: 1 } },
    guests: [{ id: 110, name: "factory", status: "running", cpu: 0.1 }, { name: "no id" }],
  });
  assert.equal(r.cpu, 1);
  assert.equal(r.temp, 150);
  assert.equal(r.os, "Windows 11");
  assert.equal((r as Record<string, unknown>).evil, undefined);
  assert.deepEqual(r.disks, [{ mount: "C:", used: 5e11, total: 5e11 }]);
  assert.deepEqual(r.gpu, { name: "UHD 630", util: 0.2, temp: null, memUsed: null, memTotal: null, fan: null, power: null, clock: null });
  assert.deepEqual(r.facts, { Controllers: "2" });
  assert.equal(r.guests?.length, 1);
  assert.equal(r.guests?.[0].type, "lxc");
  assert.deepEqual(cleanReport("nonsense"), {});
});

test("the fullest disk and ten-minute history buckets", () => {
  assert.equal(fullest([{ mount: "a", used: 1, total: 4 }, { mount: "b", used: 3, total: 4 }]), 0.75);
  assert.equal(fullest([]), null);
  const rows = [
    { at: "2026-11-06T10:01:00.000Z", cpu: 0.2, mem: 0.5, disk: null, temp: 40 },
    { at: "2026-11-06T10:09:00.000Z", cpu: 0.4, mem: 0.5, disk: null, temp: null },
    { at: "2026-11-06T10:12:00.000Z", cpu: 1, mem: null, disk: 0.3, temp: 50 },
  ];
  const b = bucket(rows, 10);
  assert.equal(b.length, 2);
  assert.ok(Math.abs(b[0].cpu! - 0.3) < 1e-9);
  assert.equal(b[0].temp, 40);
  assert.equal(b[0].disk, null);
  assert.equal(b[1].at, "2026-11-06T10:10:00.000Z");
});

test("R2 operations sort into class A, class B and free", () => {
  assert.equal(r2Class("PutObject"), "A");
  assert.equal(r2Class("ListObjects"), "A");
  assert.equal(r2Class("GetObject"), "B");
  assert.equal(r2Class("DeleteObject"), "free");
});

test("a machine merges its push and Proxmox reports, goes offline, and can be forgotten", () => {
  const state = new State(":memory:");
  const sys = new Systems(state, () => {});
  const t = new Date("2026-11-06T12:00:00Z");
  sys.ingest("homelab", { cpu: 0.1, disks: [{ mount: "/", used: 1, total: 10 }] }, "pve", t);
  sys.ingest("homelab", { temp: 55, cpu: 0.9, disks: [{ mount: "/", used: 9, total: 10 }] }, "push", new Date(t.getTime() + 30_000));
  const v = sys.view(t.getTime() + 60_000);
  const d = v.devices.find((x) => x.name === "homelab")!;
  assert.equal(d.online, true);
  assert.equal(d.temp, 55);
  assert.equal(d.cpu, 0.1, "Proxmox wins where both report");
  assert.deepEqual(d.sources.sort(), ["push", "pve"]);
  assert.equal(d.history.length, 1);
  assert.deepEqual(v.devices.slice(0, 2).map((x) => x.name), ["homelab", "test-box"]);
  assert.ok(v.devices.some((x) => x.name === "test-box" && !x.online && x.lastSeen === null), "the test box shows before it reports");
  assert.equal(sys.view(t.getTime() + 10 * 60_000).devices.find((x) => x.name === "homelab")!.online, false);
  assert.throws(() => sys.ingest("Bad Name", {}, "push"));
  // A restart keeps the last report.
  assert.equal(new Systems(state, () => {}).view(t.getTime()).devices.find((x) => x.name === "homelab")!.temp, 55);
  sys.forget("homelab");
  assert.equal(sys.view().devices.find((x) => x.name === "homelab")?.lastSeen ?? null, null);
});

test("secrets compare exactly", () => {
  assert.equal(sameSecret("Bearer abc", "Bearer abc"), true);
  assert.equal(sameSecret("Bearer abd", "Bearer abc"), false);
  assert.equal(sameSecret("", "Bearer abc"), false);
});

test("docker stats lines become containers, sizes in bytes", async () => {
  const { dockerLine, size } = await import("../src/systems.ts");
  assert.equal(size("62.76MiB"), 62.76 * 1024 ** 2);
  assert.equal(size("900kB"), 900_000);
  assert.equal(size("0B"), 0);
  assert.equal(size("nope"), null);
  const c = dockerLine('{"BlockIO":"9.04MB / 1.16MB","CPUPerc":"12.5%","MemUsage":"62.76MiB / 10GiB","Name":"factory-dispatcher-1","NetIO":"900kB / 232kB"}')!;
  assert.equal(c.name, "factory-dispatcher-1");
  assert.equal(c.cpu, 0.125);
  assert.equal(c.memLimit, 10 * 1024 ** 3);
  assert.equal(c.net, 1_132_000);
  assert.equal(dockerLine("not json"), null);
});

test("history comes in four ranges, with network and GPU", () => {
  const state = new State(":memory:");
  const sys = new Systems(state, () => {});
  const t = Date.parse("2026-11-06T12:00:00Z");
  for (let i = 0; i < 120; i++) sys.ingest("test-box", { cpu: 0.5, memUsed: 1, memTotal: 2, net: { rx: 100, tx: 50 }, gpu: { name: "x", util: 0.25 } }, "push", new Date(t - i * 60_000));
  const hour = sys.view(t, "1h").devices.find((d) => d.name === "test-box")!.history;
  const day = sys.view(t, "24h").devices.find((d) => d.name === "test-box")!.history;
  assert.ok(hour.length >= 59 && hour.length <= 61, `1h: ${hour.length}`);
  assert.ok(day.length >= 12 && day.length <= 13, `24h: ${day.length}`);
  assert.equal(day[0].net, 150);
  assert.equal(day[0].gpu, 0.25);
  assert.equal(sys.view(t, "nonsense").range, "24h");
});

test("alerts open once, clear once, and are kept", async () => {
  const state = new State(":memory:");
  const sys = new Systems(state, () => {});
  const t = Date.parse("2026-11-07T12:00:00Z");
  await sys.tickAlerts(t); // the homelab and the test box have never reported
  assert.deepEqual(state.openAlerts().map((a) => a.key).sort(), ["offline:homelab", "offline:test-box"]);
  await sys.tickAlerts(t + 60_000);
  assert.equal(state.alerts().length, 2, "still the same two, not new ones each minute");
  sys.ingest("test-box", { cpu: 0.1 }, "push", new Date(t + 120_000));
  await sys.tickAlerts(t + 150_000);
  assert.deepEqual(state.openAlerts().map((a) => a.key), ["offline:homelab"]);
  assert.ok(state.alerts().find((a) => a.key === "offline:test-box")?.cleared_at);
  sys.setAlertSettings({ enabled: false });
  await sys.tickAlerts(t + 200_000);
  assert.equal(state.openAlerts().length, 0, "switching alerts off clears them");
});

test("CI guard: the dashboard's pause goes back to the machine, and the card shows what the guard did", () => {
  const s = new State(":memory:");
  const sys = new Systems(s, () => {});
  const now = new Date("2026-11-11T22:00:00Z");
  assert.deepEqual(sys.guard("build-pc", { state: "running", busy: true }, now), { paused: false, jobs: CI_THREADS });
  sys.setCiPaused("build-pc", true);
  assert.deepEqual(sys.guard("build-pc", { state: "paused", why: "owner" }, now).paused, true);
  const card = sys.view(now.getTime() + 30_000).devices.find((d) => d.name === "build-pc")!;
  assert.equal(card.ci?.owner, true);
  assert.equal(card.ci?.guard?.why, "owner");
  // A guard that stopped checking in shows no current state, only when it last did.
  const later = sys.view(now.getTime() + 10 * 60_000).devices.find((d) => d.name === "build-pc")!;
  assert.equal(later.ci?.guard, null);
  assert.equal(later.ci?.lastCheck, now.toISOString());
  sys.setCiPaused("build-pc", false);
  assert.equal(s.ciPaused("build-pc"), false);
  // Machines with no guard have no CI line.
  assert.equal(sys.view(now.getTime()).devices.find((d) => d.name === "test-box")?.ci, null);
});

test("CI guard reports are trimmed: known states only, a plain game name", () => {
  const sys = new Systems(new State(":memory:"), () => {});
  const now = new Date("2026-11-11T22:00:00Z");
  sys.guard("build-pc", { state: "weird", why: "<b>", game: "Game<script>.exe" }, now);
  const g = sys.view(now.getTime()).devices.find((d) => d.name === "build-pc")!.ci!.guard!;
  assert.deepEqual([g.state, g.why, g.game], ["running", "", "Gamescript.exe"]);
  assert.throws(() => sys.guard("Bad Name", {}, now));
});

test("CI build threads: defaults until saved, then the guard hands the card's numbers to the machine", () => {
  const s = new State(":memory:");
  const sys = new Systems(s, () => {});
  const now = new Date("2026-11-12T20:00:00Z");
  assert.deepEqual(sys.guard("build-pc", { state: "running" }, now).jobs, { default: 6, gaming: null, max: 12 });
  assert.match(sys.setCiThreads("build-pc", { default: 8, gaming: 4, max: 14 }), /8 threads.*up to 14.*4 while you play/);
  assert.deepEqual(sys.guard("build-pc", { state: "running" }, now).jobs, { default: 8, gaming: 4, max: 14 });
  assert.deepEqual(sys.view(now.getTime()).devices.find((d) => d.name === "build-pc")!.ci!.threads, { default: 8, gaming: 4, max: 14 });
  // Back to pausing while gaming; other machines keep their own.
  sys.setCiThreads("build-pc", { default: 8, gaming: "pause", max: 14 });
  assert.equal(sys.ciThreads("build-pc").gaming, null);
  assert.deepEqual(sys.ciThreads("other-pc"), CI_THREADS);
  assert.throws(() => sys.setCiThreads("Bad Name", {}));
});

test("CI build threads are whole numbers from 1 to 64; anything else keeps the default", () => {
  assert.deepEqual(ciThreadsFrom(null), CI_THREADS);
  assert.deepEqual(ciThreadsFrom({ default: "10", gaming: "3", max: 16 }), { default: 10, gaming: 3, max: 16 });
  assert.deepEqual(ciThreadsFrom({ default: 0, gaming: 2.5, max: 65 }), CI_THREADS);
  assert.deepEqual(ciThreadsFrom({ default: -4, gaming: "", max: "lots" }), CI_THREADS);
  assert.equal(ciThreadsFrom({ gaming: null }).gaming, null);
});
