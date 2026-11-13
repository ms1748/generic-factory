import assert from "node:assert/strict";
import { test } from "node:test";
import { deflateRawSync } from "node:zlib";
import { useExample } from "./example-install.ts";
import { appOf, cleanPerf, compare, DEFAULT_SETTINGS, downsample, machineFor, mainFps, Perf, perfSettings, previous, readZip, statusLine, summarize, type RunRow } from "../src/perf.ts";
import { cleanEvents } from "../src/systems.ts";

/** A perf.json like the project's collector writes. */
function perfJson(over: Record<string, unknown> = {}) {
  return {
    v: 1, kind: "box", pr: 12, sha: "abcdef1234567890", build: "app-pr12-v3", version: "0.9.1", runUrl: "https://github.com/owner/app/actions/runs/5",
    runner: "runner-test-box", host: "BOX", game: null, started: "2026-11-13T00:00:00.000Z", finished: "2026-11-13T00:01:40.000Z", outcome: "pass",
    system: { cpu: "i5-8500T", cores: 6, gpu: "UHD 630" },
    timings: { startup: 3000, shutdown: 900, cleanExit: true, sessionWindows: null, crashes: 0 },
    crashes: [], events: [{ t: 10, name: "app.start" }, { t: 3010, name: "window.up" }], steps: [{ name: "Smoke › Starts", ok: true, ms: 3100 }],
    fpsNote: null,
    t: [1000, 2000, 3000, 4000],
    sys: { cpu: [10, 50, 30, null], mem: [4e9, 4.2e9, 4.1e9, 4e9], gpuTemp: [60, 65, 70, 68], bogus: [1, 2, 3, 4] },
    procs: { App: { cpu: [5, 9, 7, 6], mem: [1e8, 1.4e8, 1.2e8, 1.1e8], gpu: [1, 2, 3, null], vram: [null, null, null, null] } },
    fps: { "App UI": [60, 58, 30, 61], "Game (1234)": [100, 100, 90, 110] },
    fpsSummary: { "Game (1234)": { avg: 101.5, low1: 72, frames: 400 } },
    ...over,
  };
}

test("a perf.json is checked: version, lengths, unknown series dropped, strings trimmed", () => {
  assert.throws(() => cleanPerf({ v: 2 }), /version 1/);
  const p = cleanPerf({ ...perfJson(), sha: "not a sha", runUrl: "https://evil.example.com/x", sys: { cpu: [1, 2] }, kind: "box<script>" });
  assert.equal(p.sha, "");
  assert.equal(p.runUrl, "");
  assert.equal(p.kind, "boxscript");
  assert.deepEqual(p.sys.cpu, [1, 2, null, null], "padded to t's length");
  assert.equal((p.sys as Record<string, unknown>).bogus, undefined);
  const ok = cleanPerf(perfJson());
  assert.equal(ok.sha, "abcdef1234567890");
  assert.equal(ok.outcome, "pass");
  assert.equal(cleanPerf({ ...perfJson(), outcome: "great" }).outcome, "broken");
  const evil = cleanPerf(JSON.parse('{"v":1,"t":[1],"procs":{"__proto__":{"cpu":[1]}},"fps":{"constructor":[1]}}'));
  assert.deepEqual(Object.keys(evil.procs), []);
  assert.deepEqual(Object.keys(evil.fps), []);
});

test("a summary: peaks and averages, fps per app (instances together), the measured fps winning", () => {
  const s = summarize(cleanPerf(perfJson()));
  assert.equal(s.startup, 3000);
  assert.deepEqual(s.sys.cpu, { avg: 30, peak: 50 });
  assert.deepEqual(s.sys.gpuTemp, { avg: 65.8, peak: 70 });
  assert.deepEqual(s.fps.Game, { avg: 101.5, low1: 72 }, "from PresentMon's frame times");
  assert.deepEqual(s.fps["App UI"], { avg: 52.3, low1: 30 }, "from the per-second series");
  assert.equal(s.procs.App.mem.peak, 1.4e8);
  assert.equal(s.seconds, 100);
  assert.equal(appOf("Game (1234)"), "Game");
  assert.equal(appOf("Game #2"), "Game");
});

test("changes: beyond the limits and the floors, worse or better", () => {
  const before = summarize(cleanPerf(perfJson()));
  const after = summarize(cleanPerf(perfJson({ timings: { startup: 4000, shutdown: 950, cleanExit: false, crashes: 1 }, fpsSummary: { "Game (99)": { avg: 80, low1: 70, frames: 300 } }, fps: { "Game (99)": [80, 80, 80, 80] } })));
  const c = compare(after, before);
  const by = Object.fromEntries(c.map((x) => [x.what, x]));
  assert.equal(by.Startup.bad, true);
  assert.equal(by.Startup.pct, 33.3);
  assert.equal(by.Shutdown, undefined, "+50 ms is under the 250 ms floor");
  assert.equal(by["Game fps"].bad, true);
  assert.equal(by["Game 1% low"], undefined, "72 → 70 is under 10%");
  assert.equal(by.Crashes.bad, true);
  assert.equal(by["Clean exit"].bad, true);
  const better = compare(before, after);
  assert.equal(better.find((x) => x.what === "Startup")?.bad, false);
  assert.equal(compare(before, before).length, 0);
  assert.equal(compare(after, before, { ...DEFAULT_SETTINGS, timePct: 50 }).some((x) => x.what === "Startup"), false);
});

test("the commit status line fits and says what got worse", () => {
  const before = summarize(cleanPerf(perfJson()));
  const after = summarize(cleanPerf(perfJson({ timings: { startup: 6000, shutdown: 900, cleanExit: true, crashes: 0 } })));
  assert.equal(statusLine(after, compare(after, before), "app-pr12-v2", "App UI"), "startup 6.0 s, 101.5 fps; 1 worse vs v2: Startup +100%");
  assert.equal(statusLine(before, [], null, "App UI"), "startup 3.0 s, 101.5 fps; first run here");
  assert.equal(statusLine(before, [], "app-pr12-v2", "App UI"), "startup 3.0 s, 101.5 fps; nothing worse vs v2");
  // The app's own window (Settings › Install › Performance) isn't the run's main frame rate; unset, the first line is.
  assert.equal(mainFps(before, "App UI")?.[0], "Game");
  assert.equal(mainFps(before)?.[0], "App UI");
  assert.equal(statusLine(before, [], null, ""), "startup 3.0 s, 52.3 fps; first run here");
});

test("settings: defaults, ranges", () => {
  assert.deepEqual(perfSettings(null), DEFAULT_SETTINGS);
  assert.equal(perfSettings({ keepDays: 30 }).keepDays, 30);
  assert.equal(perfSettings({ keepDays: -1 }).keepDays, 0);
  assert.equal(perfSettings({ fpsPct: 0 }).fpsPct, 10);
  assert.equal(perfSettings({ status: false }).status, false);
});

test("downsampling averages evenly and keeps short series as they are", () => {
  assert.deepEqual(downsample([0, 1], { a: [1, 2] }).cols.a, [1, 2]);
  const t = Array.from({ length: 10 }, (_, i) => i * 1000);
  const d = downsample(t, { a: t.map((x) => x / 1000), b: t.map(() => null) }, 5);
  assert.deepEqual(d.t, [0, 2000, 4000, 6000, 8000]);
  assert.deepEqual(d.cols.a, [0.5, 2.5, 4.5, 6.5, 8.5]);
  assert.deepEqual(d.cols.b, [null, null, null, null, null]);
});

/** A zip with one deflated file, as GitHub hands out artifacts. */
function zip(name: string, data: Buffer): Buffer {
  const body = deflateRawSync(data);
  const n = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(n.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(body.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(n.length, 28);
  central.writeUInt32LE(0, 42);
  const dirAt = 30 + n.length + body.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(46 + n.length, 12);
  end.writeUInt32LE(dirAt, 16);
  return Buffer.concat([local, n, body, central, n, end]);
}

test("perf.json comes out of an artifact's zip", () => {
  const z = zip("perf.json", Buffer.from('{"v":1}'));
  assert.equal(readZip(z, "perf.json")?.toString(), '{"v":1}');
  assert.equal(readZip(z, "other.json"), undefined);
  assert.throws(() => readZip(Buffer.from("not a zip at all, honestly"), "perf.json"), /not a zip/);
});

test("the machine: the install's machine for the runner, else the PC's name", () => {
  useExample();
  assert.equal(machineFor("runner-test-box", "BOX"), "test-box");
  assert.equal(machineFor("someone-else", "DESKTOP-AB1"), "desktop-ab1");
});

test("stored runs: one per source, compared with the previous build, samples kept or pruned", () => {
  const state = useExample();
  const perf = new Perf(state, () => {});
  const a = perf.ingest(perfJson({ sha: "1111111", build: "app-pr12-v2", started: "2026-11-12T00:00:00.000Z", finished: "2026-11-12T00:01:00.000Z" }), { repo: "owner/app", source: "artifact:1" });
  assert.equal(a.fresh, true);
  assert.equal(perf.ingest(perfJson(), { repo: "owner/app", source: "artifact:1" }).fresh, false, "the same artifact twice is stored once");
  const b = perf.ingest(perfJson({ sha: "2222222", timings: { startup: 9000, shutdown: 900, cleanExit: true, crashes: 0 } }), { repo: "owner/app", source: "artifact:2" });
  const v = perf.view();
  assert.equal(v.runs.length, 2);
  assert.equal(v.runs[0].id, b.id, "newest first");
  assert.equal(v.runs[0].machine, "test-box");
  assert.equal(v.runs[0].prev?.build, "app-pr12-v2");
  assert.equal(v.runs[0].changes.find((c) => c.what === "Startup")?.bad, true);
  const page = perf.run(b.id)!;
  assert.equal(page.samples, 4);
  assert.deepEqual(page.chart.t, [1000, 2000, 3000, 4000]);
  assert.deepEqual(page.chart["sys.cpu"], [10, 50, 30, null]);
  assert.deepEqual(page.chart["proc.App.mem"], [1e8, 1.4e8, 1.2e8, 1.1e8]);
  assert.deepEqual(page.chart["fps.Game (1234)"], [100, 100, 90, 110]);
  assert.equal(page.meta.events.length, 2);
  // Keep 1 day: the older run's samples go, both runs stay.
  perf.setSettings({ keepDays: 1 });
  assert.equal(perf.run(a.id)!.samples, 0);
  assert.equal(perf.view().runs.length, 2);
});

test("the previous run is the same kind, machine and game, for another commit", () => {
  const row = (id: number, o: Partial<RunRow>) => ({ id, repo: "r", kind: "box", machine: "m", game: null, sha: `s${id}`, started_at: `2026-11-1${id}`, outcome: "pass", ...o }) as RunRow;
  const all = [row(1, {}), row(2, { kind: "gaming" }), row(3, { sha: "s5" }), row(4, { outcome: "broken" }), row(5, {})];
  assert.equal(previous(all[4], all)?.id, 1, "skips other kinds, the same commit and broken runs");
  assert.equal(previous(all[0], all), undefined);
});

test("boot events: known IDs only, times checked", () => {
  const e = cleanEvents([
    { at: "2026-11-12T08:00:00Z", id: 6005, reason: "" },
    { at: "2026-11-12T07:59:00Z", id: 1074, reason: "The process C:\\Windows\\system32\\svchost.exe has initiated the restart\r\nfor Windows Update" },
    { at: "nope", id: 41 },
    { at: "2026-11-12T07:00:00Z", id: 4624 },
  ]);
  assert.equal(e.length, 2);
  assert.equal(e[0].kind, "started");
  assert.equal(e[1].reason.includes("\n"), false);
  assert.deepEqual(cleanEvents("x"), []);
});
