// The dispatcher's own state in SQLite: which lanes are live, the last schedule slot each one fired,
// every run (dry or live), PR ↔ Claude session links for resuming, and the usage-limit pause.
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { primary } from "./install.ts";
import { SYS, type RunRow } from "./perf.ts";
import type { PrFacts } from "./scores.ts";

/** device_samples columns added for the GPU and CPU sensors, and their names in a Sample. */
const SAMPLE_KEY = { gpu_temp: "gpuTemp", gpu_power: "gpuPower", gpu_fan: "gpuFan", gpu_clock: "gpuClock", vram: "vram", cpu_power: "cpuPower", cpu_clock: "cpuClock", fan: "fan" } as const;
const EXTRA_SAMPLE_COLS = Object.keys(SAMPLE_KEY) as (keyof typeof SAMPLE_KEY)[];

/** A boot, shutdown or crash from a machine's event log. */
export interface DeviceEvent {
  at: string;
  /** The Windows event ID: 6005 started, 6006 shut down cleanly, 6008 and 41 stopped unexpectedly, 1074 a restart or shutdown was asked for. */
  id: number;
  kind: string;
  reason: string;
}

/** One second of a test run (perf.ts). */
export interface PerfSample {
  t: number;
  sys: Record<string, number | null>;
  procs: Record<string, { cpu: number | null; mem: number | null; gpu: number | null; vram: number | null }>;
  fps: Record<string, number>;
}

// The repos the factory works on are install().projects (src/install.ts). The first is the primary: its rows
// were stored before there were several, with an empty repo.

/** The `lanes` rows that stand for every repo: the name-only switches from before lanes were per repo. */
const ANY_REPO = "*";

/** The reviewer's merge call for one commit of a PR. */
export interface MergeCall {
  sha: string;
  ok: boolean;
  why: string;
}

/** A merged factory PR's Done line (done.ts), for the card and the board's Done column. */
export interface DoneRecord {
  pr: number;
  card: number | null;
  title: string;
  /** Everything checked out: the card was closed. False: it stays open with needs-owner. */
  ok: boolean;
  /** The line posted on the card, in Markdown. */
  line: string;
  at: string;
}

export type RunStatus ="running" | "done" | "dry" | "idle" | "failed" | "limited";

export interface Run {
  id: number;
  lane: string;
  model: string;
  mode: "dry" | "live";
  card: number | null;
  action: string | null;
  status: RunStatus;
  started_at: string;
  ended_at: string | null;
  session_id: string | null;
  pr: number | null;
  cost_usd: number | null;
  summary: string | null;
  /** The repo the run worked on ("" for the primary). */
  repo: string;
}

export interface Link {
  id: number;
  grp: string;
  title: string;
  url: string;
}

export interface Window {
  utilization: number;
  resetsAt: string;
}

/** The latest usage report from Claude Code (rate_limit_event). */
export interface RateLimit {
  status: string;
  resetsAt?: string;
  fiveHour?: Window;
  sevenDay?: Window;
  /** The plan's window is used up and this run is on paid extra-usage credits. */
  overage?: boolean;
  at: string;
}

export interface Session {
  /** "" for the primary repo. */
  repo: string;
  pr: number;
  card: number | null;
  session_id: string;
  lane: string;
  run_id: number;
  branch: string;
  handled_at: string;
  closed: number;
}

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
CREATE TABLE IF NOT EXISTS lanes (
  repo TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  live INTEGER,
  last_slot TEXT,
  on_switch INTEGER,
  PRIMARY KEY (repo, name)
);
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY,
  lane TEXT NOT NULL,
  model TEXT NOT NULL,
  mode TEXT NOT NULL,
  card INTEGER,
  action TEXT,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  session_id TEXT,
  pr INTEGER,
  cost_usd REAL,
  summary TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  pr INTEGER PRIMARY KEY,
  card INTEGER,
  session_id TEXT NOT NULL,
  lane TEXT NOT NULL,
  run_id INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS links (
  id INTEGER PRIMARY KEY,
  grp TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS seeded (
  what TEXT PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS usage_samples (
  at TEXT PRIMARY KEY,
  five REAL,
  week REAL
);
CREATE TABLE IF NOT EXISTS usage (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reviews (
  pr INTEGER NOT NULL,
  sha TEXT NOT NULL,
  verdict TEXT NOT NULL,
  run_id INTEGER NOT NULL,
  posted INTEGER NOT NULL,
  at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS undone (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS devices (
  name TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS device_samples (
  name TEXT NOT NULL,
  at TEXT NOT NULL,
  cpu REAL,
  mem REAL,
  disk REAL,
  temp REAL,
  PRIMARY KEY (name, at)
);
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL,
  text TEXT NOT NULL,
  at TEXT NOT NULL,
  cleared_at TEXT
);
CREATE TABLE IF NOT EXISTS perf_runs (
  id INTEGER PRIMARY KEY,
  repo TEXT NOT NULL,
  kind TEXT NOT NULL,
  machine TEXT NOT NULL,
  pr INTEGER,
  sha TEXT NOT NULL,
  build TEXT NOT NULL,
  version TEXT,
  game TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  outcome TEXT NOT NULL,
  startup_ms REAL,
  shutdown_ms REAL,
  clean_exit INTEGER,
  crashes INTEGER NOT NULL DEFAULT 0,
  summary TEXT NOT NULL,
  meta TEXT NOT NULL,
  source TEXT NOT NULL UNIQUE,
  run_url TEXT NOT NULL DEFAULT '',
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS perf_runs_started ON perf_runs (started_at);
CREATE TABLE IF NOT EXISTS perf_samples (
  run_id INTEGER NOT NULL,
  t INTEGER NOT NULL,
  cpu REAL, cpu_clock REAL, cpu_temp REAL, cpu_power REAL, acpi_temp REAL, mem REAL,
  gpu REAL, gpu_temp REAL, gpu_clock REAL, gpu_mem_clock REAL, gpu_power REAL, gpu_fan REAL, vram REAL,
  disk_read REAL, disk_write REAL, net_rx REAL, net_tx REAL, fan REAL,
  procs TEXT,
  fps TEXT,
  PRIMARY KEY (run_id, t)
);
CREATE TABLE IF NOT EXISTS perf_sources (
  source TEXT PRIMARY KEY,
  run_id INTEGER,
  error TEXT,
  at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS device_events (
  name TEXT NOT NULL,
  at TEXT NOT NULL,
  id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  reason TEXT NOT NULL,
  PRIMARY KEY (name, at, id)
);
CREATE TABLE IF NOT EXISTS pr_scores (
  repo TEXT NOT NULL,
  pr INTEGER NOT NULL,
  facts TEXT NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY (repo, pr)
);
CREATE TABLE IF NOT EXISTS pause (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  until TEXT NOT NULL,
  reason TEXT NOT NULL
);
`;

export class State {
  private db: DatabaseSync;
  /** The repo this view's per-repo rows belong to: "" for the primary, else "owner/name". */
  readonly scope: string;

  constructor(file: string | DatabaseSync, scope = "") {
    this.scope = scope;
    if (file instanceof DatabaseSync) {
      this.db = file;
      return;
    }
    if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    // A database from before src/install.ts: its deployment had settings built in that it now enters once.
    const existed = Boolean(this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'runs'").get());
    this.db.exec(SCHEMA);
    this.db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('install_base', ?)").run(existed ? "predates" : "new");
    // Columns added after the first deploy.
    const cols = (this.db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[]).map((c) => c.name);
    if (!cols.includes("branch")) this.db.exec("ALTER TABLE sessions ADD COLUMN branch TEXT NOT NULL DEFAULT ''");
    if (!cols.includes("handled_at")) this.db.exec("ALTER TABLE sessions ADD COLUMN handled_at TEXT NOT NULL DEFAULT ''");
    if (!cols.includes("closed")) this.db.exec("ALTER TABLE sessions ADD COLUMN closed INTEGER NOT NULL DEFAULT 0");
    const sampleCols = (this.db.prepare("PRAGMA table_info(device_samples)").all() as { name: string }[]).map((c) => c.name);
    if (!sampleCols.includes("net")) this.db.exec("ALTER TABLE device_samples ADD COLUMN net REAL");
    if (!sampleCols.includes("gpu")) this.db.exec("ALTER TABLE device_samples ADD COLUMN gpu REAL");
    for (const c of EXTRA_SAMPLE_COLS) if (!sampleCols.includes(c)) this.db.exec(`ALTER TABLE device_samples ADD COLUMN ${c} REAL`);
    this.db.exec("CREATE INDEX IF NOT EXISTS device_samples_at ON device_samples (at)");
    const laneCols = (this.db.prepare("PRAGMA table_info(lanes)").all() as { name: string }[]).map((c) => c.name);
    if (!laneCols.includes("on_switch")) this.db.exec("ALTER TABLE lanes ADD COLUMN on_switch INTEGER");
    this.migrateRepos();
  }

  /** The same database, with sessions, reviews, retries and new runs belonging to `repo`. */
  for(repo: string): State {
    return new State(this.db, repo === primary() ? "" : repo);
  }

  /** The repo name of this view, for logs and links. */
  get repo(): string {
    return this.scope || primary();
  }

  /** Per-repo settings keys: the primary keeps the old `name:pr` keys. */
  private key(name: string, pr: number): string {
    return this.scope ? `${name}:${this.scope}#${pr}` : `${name}:${pr}`;
  }

  /** Adds a repo to sessions (keyed by repo and PR now), reviews and runs; old rows are the primary's. */
  private migrateRepos(): void {
    const cols = (t: string) => (this.db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
    if (!cols("sessions").includes("repo")) {
      this.db.exec(`BEGIN;
        CREATE TABLE sessions_by_repo (
          repo TEXT NOT NULL DEFAULT '', pr INTEGER NOT NULL, card INTEGER, session_id TEXT NOT NULL, lane TEXT NOT NULL,
          run_id INTEGER NOT NULL, updated_at TEXT NOT NULL, branch TEXT NOT NULL DEFAULT '', handled_at TEXT NOT NULL DEFAULT '',
          closed INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (repo, pr));
        INSERT INTO sessions_by_repo (repo, pr, card, session_id, lane, run_id, updated_at, branch, handled_at, closed)
          SELECT '', pr, card, session_id, lane, run_id, updated_at, branch, handled_at, closed FROM sessions;
        DROP TABLE sessions;
        ALTER TABLE sessions_by_repo RENAME TO sessions;
        COMMIT;`);
    }
    if (!cols("reviews").includes("repo")) this.db.exec("ALTER TABLE reviews ADD COLUMN repo TEXT NOT NULL DEFAULT ''");
    if (!cols("runs").includes("repo")) this.db.exec("ALTER TABLE runs ADD COLUMN repo TEXT NOT NULL DEFAULT ''");
    if (!cols("lanes").includes("repo")) {
      // Lane switches were by name only and applied to every repo. The primary keeps its rows as they were
      // (switches and last slots), and a copy of each switch under ANY_REPO stands for every other repo until
      // the owner sets that repo's own (lane()). So nothing turns on or off by itself.
      this.db.exec(`BEGIN;
        CREATE TABLE lanes_by_repo (
          repo TEXT NOT NULL DEFAULT '', name TEXT NOT NULL, live INTEGER, last_slot TEXT, on_switch INTEGER, PRIMARY KEY (repo, name));
        INSERT INTO lanes_by_repo (repo, name, live, last_slot, on_switch) SELECT '', name, live, last_slot, on_switch FROM lanes;
        INSERT INTO lanes_by_repo (repo, name, live, last_slot, on_switch) SELECT '${ANY_REPO}', name, live, NULL, on_switch FROM lanes;
        DROP TABLE lanes;
        ALTER TABLE lanes_by_repo RENAME TO lanes;
        COMMIT;`);
    }
  }

  /**
   * This repo's lane `name`. `on`: the owner's on/off switch, or null to follow the repo's config. A switch
   * this repo hasn't set itself follows the name-only one from before lanes were per repo, if there was one.
   */
  lane(name: string): { live: boolean; lastSlot: string | null; on: boolean | null } {
    const get = (repo: string) =>
      this.db.prepare("SELECT live, last_slot, on_switch FROM lanes WHERE repo = ? AND name = ?").get(repo, name) as
        | { live: number | null; last_slot: string | null; on_switch: number | null }
        | undefined;
    const own = get(this.scope);
    const old = get(ANY_REPO);
    const live = own?.live ?? old?.live;
    const on = own?.on_switch ?? old?.on_switch;
    return { live: live === 1, lastSlot: own?.last_slot ?? null, on: on == null ? null : on === 1 };
  }

  setOn(name: string, on: boolean): void {
    this.setLane(name, "on_switch", on ? 1 : 0);
  }

  setLive(name: string, live: boolean): void {
    this.setLane(name, "live", live ? 1 : 0);
  }

  setSlot(name: string, slot: string): void {
    this.setLane(name, "last_slot", slot);
  }

  private setLane(name: string, col: "live" | "on_switch" | "last_slot", value: number | string): void {
    this.db.prepare(`INSERT INTO lanes (repo, name, ${col}) VALUES (?, ?, ?) ON CONFLICT(repo, name) DO UPDATE SET ${col} = excluded.${col}`).run(this.scope, name, value);
  }

  startRun(r: Pick<Run, "lane" | "model" | "mode" | "card" | "action" | "status">): number {
    const res = this.db
      .prepare("INSERT INTO runs (lane, model, mode, card, action, status, started_at, repo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(r.lane, r.model, r.mode, r.card, r.action, r.status, new Date().toISOString(), this.scope);
    return Number(res.lastInsertRowid);
  }

  updateRun(id: number, r: Partial<Pick<Run, "status" | "session_id" | "pr" | "cost_usd" | "summary">>, end = false): void {
    const keys = Object.keys(r) as (keyof typeof r)[];
    const sets = keys.map((k) => `${k} = ?`);
    if (end) sets.push("ended_at = ?");
    const values = keys.map((k) => r[k] ?? null);
    if (end) values.push(new Date().toISOString());
    if (sets.length) this.db.prepare(`UPDATE runs SET ${sets.join(", ")} WHERE id = ?`).run(...values, id);
  }

  running(): Run | undefined {
    return this.db.prepare("SELECT * FROM runs WHERE status = 'running' ORDER BY id DESC LIMIT 1").get() as Run | undefined;
  }

  /** Every run going now, newest first (more than one when Parallel runs is above 1). */
  runningRuns(): Run[] {
    return this.db.prepare("SELECT * FROM runs WHERE status = 'running' ORDER BY id DESC").all() as unknown as Run[];
  }

  /** Runs left 'running' by a dispatcher that stopped mid-run. */
  failStale(): number {
    const res = this.db
      .prepare("UPDATE runs SET status = 'failed', summary = 'dispatcher restarted mid-run', ended_at = ? WHERE status = 'running'")
      .run(new Date().toISOString());
    return Number(res.changes);
  }

  recentRuns(limit = 10): Run[] {
    return this.db.prepare("SELECT * FROM runs ORDER BY id DESC LIMIT ?").all(limit) as unknown as Run[];
  }

  /** Links a PR to the Claude session that made it. Owner comments after `handledAt` will resume it. */
  saveSession(s: { pr: number; card: number | null; sessionId: string; lane: string; runId: number; branch: string; handledAt: string }): void {
    this.db
      .prepare(
        `INSERT INTO sessions (repo, pr, card, session_id, lane, run_id, branch, handled_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(repo, pr) DO UPDATE SET session_id = excluded.session_id, run_id = excluded.run_id, branch = excluded.branch,
           handled_at = excluded.handled_at, updated_at = excluded.updated_at, closed = 0`,
      )
      .run(this.scope, s.pr, s.card, s.sessionId, s.lane, s.runId, s.branch, s.handledAt, new Date().toISOString());
  }

  openSessions(): Session[] {
    return this.db.prepare("SELECT * FROM sessions WHERE closed = 0 AND repo = ? ORDER BY pr").all(this.scope) as unknown as Session[];
  }

  /** After a resume (or a dry note): feedback up to `handledAt` is dealt with. */
  markHandled(pr: number, handledAt: string, sessionId?: string): void {
    this.db
      .prepare("UPDATE sessions SET handled_at = ?, session_id = COALESCE(?, session_id), updated_at = ? WHERE pr = ? AND repo = ?")
      .run(handledAt, sessionId ?? null, new Date().toISOString(), pr, this.scope);
  }

  /** A reviewer verdict ("ready", "needs-work", or "dry" for a dry lane's note). Trial reviews aren't posted. */
  saveReview(r: { pr: number; sha: string; verdict: string; runId: number; posted: boolean }): void {
    this.db.prepare("INSERT INTO reviews (pr, sha, verdict, run_id, posted, at, repo) VALUES (?, ?, ?, ?, ?, ?, ?)").run(r.pr, r.sha, r.verdict, r.runId, r.posted ? 1 : 0, new Date().toISOString(), this.scope);
  }

  /** Whether this commit of the PR already has a posted review (or a dry note). */
  reviewed(pr: number, sha: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM reviews WHERE pr = ? AND repo = ? AND sha = ? AND (posted = 1 OR verdict = 'dry')").get(pr, this.scope, sha);
  }

  /** Posted "needs work" reviews on the PR so far. */
  reviewRounds(pr: number): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM reviews WHERE pr = ? AND repo = ? AND posted = 1 AND verdict = 'needs-work'").get(pr, this.scope) as { n: number }).n;
  }

  /** Whether this PR already had its one polish round. */
  polished(pr: number): boolean {
    return !!this.db.prepare("SELECT 1 FROM reviews WHERE pr = ? AND repo = ? AND posted = 1 AND verdict = 'polish'").get(pr, this.scope);
  }

  /**
   * The PR's latest verdict was "polish" and its builder session has since handled it. If the builder
   * pushed, the new commit gets reviewed anyway; this catches the case where it changed nothing.
   */
  polishSettled(pr: number): boolean {
    const last = this.db.prepare("SELECT verdict, at FROM reviews WHERE pr = ? AND repo = ? AND posted = 1 ORDER BY at DESC, rowid DESC LIMIT 1").get(pr, this.scope) as { verdict: string; at: string } | undefined;
    if (last?.verdict !== "polish") return false;
    const s = this.db.prepare("SELECT handled_at FROM sessions WHERE pr = ? AND repo = ?").get(pr, this.scope) as { handled_at: string | null } | undefined;
    return Boolean(s?.handled_at && s.handled_at > last.at);
  }

  /** The latest posted verdict on a PR and the commit it was for. */
  lastReview(pr: number): { verdict: string; sha: string } | undefined {
    return this.db.prepare("SELECT verdict, sha FROM reviews WHERE pr = ? AND repo = ? AND posted = 1 ORDER BY at DESC, rowid DESC LIMIT 1").get(pr, this.scope) as { verdict: string; sha: string } | undefined;
  }

  lastVerdict(pr: number): string | undefined {
    return (this.db.prepare("SELECT verdict FROM reviews WHERE pr = ? AND repo = ? AND posted = 1 ORDER BY at DESC LIMIT 1").get(pr, this.scope) as { verdict: string } | undefined)?.verdict;
  }

  /** The latest posted verdict per PR, for the dashboard. */
  verdicts(): Map<number, { verdict: string; runId: number }> {
    const rows = this.db.prepare("SELECT pr, verdict, run_id FROM reviews WHERE posted = 1 AND repo = ? ORDER BY at").all(this.scope) as { pr: number; verdict: string; run_id: number }[];
    return new Map(rows.map((r) => [r.pr, { verdict: r.verdict, runId: r.run_id }]));
  }

  /** Agent actions the owner undid from the dashboard (activity ids), so the page marks them. */
  undone(): Set<string> {
    return new Set((this.db.prepare("SELECT id FROM undone").all() as { id: string }[]).map((r) => r.id));
  }

  markUndone(id: string): void {
    this.db.prepare("INSERT OR IGNORE INTO undone (id, at) VALUES (?, ?)").run(id, new Date().toISOString());
  }

  /** The PR's head commit whose red CI a run was already sent to fix, and how many CI resumes it has had. */
  ciTried(pr: number): { sha: string; count: number } {
    const [sha = "", count = "0"] = (this.setting(this.key("ci", pr)) ?? "").split(" ");
    return { sha, count: Number(count) || 0 };
  }

  markCiTried(pr: number, sha: string): void {
    this.setSetting(this.key("ci", pr), `${sha} ${this.ciTried(pr).count + 1}`);
  }

  /** The PR's head commit whose merge conflict a run was already sent to fix (once per commit). */
  conflictTried(pr: number): string | undefined {
    return (this.db.prepare("SELECT value FROM settings WHERE key = ?").get(this.key("conflict", pr)) as { value: string } | undefined)?.value;
  }

  markConflictTried(pr: number, sha: string): void {
    this.db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(this.key("conflict", pr), sha);
  }

  /** Whether runs may go on into paid extra-usage credits once the plan's window is used up (off by default). */
  allowCredits(): boolean {
    return (this.db.prepare("SELECT value FROM settings WHERE key = 'allow_credits'").get() as { value: string } | undefined)?.value === "1";
  }

  setAllowCredits(on: boolean): void {
    this.db.prepare("INSERT INTO settings (key, value) VALUES ('allow_credits', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(on ? "1" : "0");
  }

  private setting(key: string): string | undefined {
    return (this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined)?.value;
  }

  private setSetting(key: string, value: string): void {
    this.db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  }

  /** "Parallel runs": how many runs may go at once (1 by default; slots.ts caps it). */
  parallelRuns(): number {
    const v = Number(this.setting("parallel_runs"));
    return Number.isInteger(v) && v > 0 ? v : 1;
  }

  setParallelRuns(n: number): void {
    this.setSetting("parallel_runs", String(n));
  }

  /** "Delete test builds after": hours after a PR is merged or closed (24 by default). */
  testBuildDeleteHours(): number {
    const v = Number(this.setting("test_builds_delete_hours"));
    return Number.isFinite(v) && v > 0 ? v : 24;
  }

  setTestBuildDeleteHours(hours: number): void {
    this.setSetting("test_builds_delete_hours", String(hours));
  }

  /** The reviewer's last merge call on a PR (automerge.ts): for which commit, and why not, if not. */
  mergeCall(pr: number): MergeCall | undefined {
    const v = this.setting(this.key("merge_call", pr));
    return v ? (JSON.parse(v) as MergeCall) : undefined;
  }

  saveMergeCall(pr: number, c: MergeCall): void {
    this.setSetting(this.key("merge_call", pr), JSON.stringify(c));
  }

  /** The commit auto-merge last handed to the owner for (so it says so once per commit). */
  heldFor(pr: number): string | undefined {
    return this.setting(this.key("merge_held", pr));
  }

  markHeld(pr: number, sha: string): void {
    this.setSetting(this.key("merge_held", pr), sha);
  }

  /** Settings › Auto-merge: on unless the owner turned it off. */
  autoMerge(): boolean {
    return this.setting("auto_merge") !== "0";
  }

  setAutoMerge(on: boolean): void {
    this.setSetting("auto_merge", on ? "1" : "0");
  }

  /** When done.ts started watching this repo's merges: PRs merged before then get no Done line. Set once. */
  doneSince(now = new Date()): string {
    const k = this.scope ? `done_since:${this.scope}` : "done_since";
    const v = this.setting(k);
    if (v) return v;
    this.setSetting(k, now.toISOString());
    return now.toISOString();
  }

  /** The Done line posted for a merged PR (done.ts), if any. */
  doneRecord(pr: number): DoneRecord | undefined {
    const v = this.setting(this.key("done", pr));
    return v ? (JSON.parse(v) as DoneRecord) : undefined;
  }

  saveDone(r: DoneRecord): void {
    this.setSetting(this.key("done", r.pr), JSON.stringify(r));
  }

  /** This repo's Done lines since `since` (ISO), newest first: the board's Done column. */
  dones(since: string): DoneRecord[] {
    const like = this.scope ? `done:${this.scope}#%` : "done:%";
    const rows = this.db.prepare("SELECT key, value FROM settings WHERE key LIKE ?").all(like) as { key: string; value: string }[];
    return rows
      .filter((r) => this.scope || !r.key.includes("#")) // the primary's keys have no repo in them
      .map((r) => JSON.parse(r.value) as DoneRecord)
      .filter((r) => r.at >= since)
      .sort((a, b) => b.at.localeCompare(a.at));
  }

  /** This repo's live runs on a PR or its card (builds, resumes, reviews; not trials or checks), oldest first. */
  prRuns(pr: number, card: number | null): Run[] {
    return this.db
      .prepare("SELECT * FROM runs WHERE repo = ? AND mode = 'live' AND lane NOT IN ('trial', 'doctor') AND (pr = ? OR (card IS NOT NULL AND card = ?)) AND COALESCE(action, '') <> 'review (trial)' ORDER BY id")
      .all(this.scope, pr, card ?? -1) as unknown as Run[];
  }

  /** The stored facts of this repo's scored PRs (scores.ts). */
  scoreFacts(): PrFacts[] {
    return (this.db.prepare("SELECT facts FROM pr_scores WHERE repo = ? ORDER BY pr").all(this.scope) as { facts: string }[]).map((r) => JSON.parse(r.facts) as PrFacts);
  }

  saveScoreFacts(f: PrFacts): void {
    this.db
      .prepare("INSERT INTO pr_scores (repo, pr, facts, at) VALUES (?, ?, ?, ?) ON CONFLICT(repo, pr) DO UPDATE SET facts = excluded.facts, at = excluded.at")
      .run(this.scope, f.pr, JSON.stringify(f), new Date().toISOString());
  }

  /** Every repo's scored PRs, with the repo's name ("" for the primary is filled in). */
  allScoreFacts(): (PrFacts & { repo: string })[] {
    return (this.db.prepare("SELECT repo, facts FROM pr_scores ORDER BY repo, pr").all() as { repo: string; facts: string }[]).map((r) => ({ ...(JSON.parse(r.facts) as PrFacts), repo: r.repo || primary() }));
  }

  /** When the factory last dispatched the test-build cleanup for a PR. */
  cleanupDispatched(pr: number): string | undefined {
    return this.setting(this.key("cleanup", pr));
  }

  markCleanupDispatched(pr: number, at: string): void {
    this.setSetting(this.key("cleanup", pr), at);
  }

  /** The PR's Test builds comment says they're deleted: nothing more to check. */
  cleanupDone(pr: number): boolean {
    return this.setting(this.key("cleanup-done", pr)) === "1";
  }

  markCleanupDone(pr: number): void {
    this.setSetting(this.key("cleanup-done", pr), "1");
  }

  closeSession(pr: number): void {
    this.db.prepare("UPDATE sessions SET closed = 1, updated_at = ? WHERE pr = ? AND repo = ?").run(new Date().toISOString(), pr, this.scope);
  }

  /** The active pause, if it hasn't run out. */
  pause(): { until: string; reason: string } | undefined {
    const row = this.db.prepare("SELECT until, reason FROM pause WHERE id = 1").get() as { until: string; reason: string } | undefined;
    return row && Date.parse(row.until) > Date.now() ? row : undefined;
  }

  setPause(until: Date, reason: string): void {
    this.db
      .prepare("INSERT INTO pause (id, until, reason) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET until = excluded.until, reason = excluded.reason")
      .run(until.toISOString(), reason);
  }

  /** The owner's bookmarks, grouped; the defaults go in once, then the owner edits them. */
  links(): Link[] {
    return this.db.prepare("SELECT id, grp, title, url FROM links ORDER BY grp, position, id").all() as unknown as Link[];
  }

  addLink(grp: string, title: string, url: string): number {
    const res = this.db.prepare("INSERT INTO links (grp, title, url, position) VALUES (?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM links WHERE grp = ?))").run(grp, title, url, grp);
    return Number(res.lastInsertRowid);
  }

  removeLink(id: number): void {
    this.db.prepare("DELETE FROM links WHERE id = ?").run(id);
  }

  /** Runs `fill` once ever per name (default bookmarks), even if the owner later deletes everything. */
  seedOnce(what: string, fill: () => void): void {
    if (this.db.prepare("SELECT 1 FROM seeded WHERE what = ?").get(what)) return;
    fill();
    this.db.prepare("INSERT INTO seeded (what) VALUES (?)").run(what);
  }

  saveUsage(r: RateLimit): void {
    this.db.prepare("INSERT INTO usage (id, json) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json").run(JSON.stringify(r));
    this.db.prepare("INSERT OR REPLACE INTO usage_samples (at, five, week) VALUES (?, ?, ?)").run(r.at, r.fiveHour?.utilization ?? null, r.sevenDay?.utilization ?? null);
  }

  usageSamples(sinceIso: string): { at: string; five: number | null; week: number | null }[] {
    return this.db.prepare("SELECT at, five, week FROM usage_samples WHERE at >= ? ORDER BY at").all(sinceIso) as unknown as { at: string; five: number | null; week: number | null }[];
  }

  allRuns(sinceIso: string): Run[] {
    return this.db.prepare("SELECT * FROM runs WHERE started_at >= ? ORDER BY id").all(sinceIso) as unknown as Run[];
  }

  /** The latest usage report, with windows that have since reset shown as empty. */
  usage(now = Date.now()): RateLimit | undefined {
    const row = this.db.prepare("SELECT json FROM usage WHERE id = 1").get() as { json: string } | undefined;
    if (!row) return undefined;
    const r = JSON.parse(row.json) as RateLimit;
    const fresh = (w?: Window) => (w && Date.parse(w.resetsAt) <= now ? { ...w, utilization: 0 } : w);
    // A "rejected" (used up) status ends when its window resets, even if no run has reported since.
    const resets = r.resetsAt ?? r.fiveHour?.resetsAt;
    const status = r.status === "rejected" && resets && Date.parse(resets) <= now ? "allowed" : r.status;
    return { ...r, status, fiveHour: fresh(r.fiveHour), sevenDay: fresh(r.sevenDay) };
  }

  /** API-equivalent cost and run counts since a time (live runs only). */
  spend(sinceIso: string): { runs: number; costUsd: number } {
    const row = this.db
      .prepare("SELECT COUNT(*) AS runs, COALESCE(SUM(cost_usd), 0) AS cost FROM runs WHERE mode = 'live' AND started_at >= ?")
      .get(sinceIso) as { runs: number; cost: number };
    return { runs: row.runs, costUsd: row.cost };
  }

  run(id: number): Run | undefined {
    return this.db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as Run | undefined;
  }

  clearPause(): void {
    this.db.exec("DELETE FROM pause");
  }

  /** A machine's latest report (systems.ts), merged from every source that reports it. */
  saveDevice(name: string, json: string, at: string): void {
    this.db.prepare("INSERT INTO devices (name, json, at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET json = excluded.json, at = excluded.at").run(name, json, at);
  }

  devices(): { name: string; json: string; at: string }[] {
    return this.db.prepare("SELECT name, json, at FROM devices ORDER BY name").all() as unknown as { name: string; json: string; at: string }[];
  }

  removeDevice(name: string): void {
    this.db.prepare("DELETE FROM devices WHERE name = ?").run(name);
    this.db.prepare("DELETE FROM device_samples WHERE name = ?").run(name);
    this.db.prepare("DELETE FROM device_events WHERE name = ?").run(name);
  }

  /** Boots, shutdowns and crashes from a machine's event log (systems.ts); kept forever, one row each. */
  addDeviceEvents(name: string, events: DeviceEvent[]): number {
    const ins = this.db.prepare("INSERT OR IGNORE INTO device_events (name, at, id, kind, reason) VALUES (?, ?, ?, ?, ?)");
    let n = 0;
    for (const e of events) n += Number(ins.run(name, e.at, e.id, e.kind, e.reason).changes);
    return n;
  }

  deviceEvents(name: string, limit = 20): DeviceEvent[] {
    return this.db.prepare("SELECT at, id, kind, reason FROM device_events WHERE name = ? ORDER BY at DESC LIMIT ?").all(name, limit) as unknown as DeviceEvent[];
  }

  /** Settings › Performance, raw (perf.ts fills in the defaults). */
  perfSettings(): unknown {
    try {
      return JSON.parse(this.setting("perf") ?? "null");
    } catch {
      return null;
    }
  }

  setPerfSettings(v: unknown): void {
    this.setSetting("perf", JSON.stringify(v));
  }

  /** Whether a perf.json source (an artifact, a push) was read before, and what came of it. */
  perfSource(source: string): { run_id: number | null; error: string | null } | undefined {
    return this.db.prepare("SELECT run_id, error FROM perf_sources WHERE source = ?").get(source) as { run_id: number | null; error: string | null } | undefined;
  }

  markPerfSource(source: string, runId: number | null, error: string | null): void {
    this.db.prepare("INSERT OR REPLACE INTO perf_sources (source, run_id, error, at) VALUES (?, ?, ?, ?)").run(source, runId, error, new Date().toISOString());
  }

  /** A test run's performance record (perf.ts): the run, then its time series, in one transaction. */
  addPerfRun(r: Omit<RunRow, "id">, p: { t: number[]; sys: Record<string, (number | null)[]>; procs: Record<string, { cpu: (number | null)[]; mem: (number | null)[]; gpu: (number | null)[]; vram: (number | null)[] }>; fps: Record<string, (number | null)[]> }): number {
    this.db.exec("BEGIN");
    try {
      const keys = Object.keys(r) as (keyof typeof r)[];
      const id = Number(this.db.prepare(`INSERT INTO perf_runs (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`).run(...keys.map((k) => r[k])).lastInsertRowid);
      const cols = SYS.map(([, c]) => c);
      const ins = this.db.prepare(`INSERT OR REPLACE INTO perf_samples (run_id, t, ${cols.join(", ")}, procs, fps) VALUES (?, ?, ${cols.map(() => "?").join(", ")}, ?, ?)`);
      p.t.forEach((t, i) => {
        const procs: Record<string, (number | null)[]> = {};
        for (const [label, s] of Object.entries(p.procs)) {
          const row = [s.cpu[i], s.mem[i], s.gpu[i], s.vram[i]].map((v) => v ?? null);
          if (row.some((v) => v != null)) procs[label] = row;
        }
        const fps: Record<string, number> = {};
        for (const [label, s] of Object.entries(p.fps)) if (s[i] != null) fps[label] = s[i]!;
        ins.run(id, t, ...SYS.map(([k]) => p.sys[k]?.[i] ?? null), JSON.stringify(procs), JSON.stringify(fps));
      });
      this.db.exec("COMMIT");
      return id;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  /** Every stored run, newest first (summaries only; the samples stay in perf_samples). */
  perfRuns(): RunRow[] {
    return this.db.prepare("SELECT * FROM perf_runs ORDER BY started_at DESC").all() as unknown as RunRow[];
  }

  /** One run's time series, oldest first. */
  perfSamples(runId: number): PerfSample[] {
    const rows = this.db.prepare("SELECT * FROM perf_samples WHERE run_id = ? ORDER BY t").all(runId) as Record<string, any>[];
    return rows.map((x) => {
      const raw = JSON.parse(x.procs || "{}") as Record<string, (number | null)[]>;
      return {
        t: x.t,
        sys: Object.fromEntries(SYS.map(([k, c]) => [k, x[c] ?? null])),
        procs: Object.fromEntries(Object.entries(raw).map(([l, [cpu, mem, gpu, vram]]) => [l, { cpu, mem, gpu, vram }])),
        fps: JSON.parse(x.fps || "{}"),
      };
    });
  }

  /** Deletes the time series of runs that started before `beforeIso` (the runs and their summaries stay). */
  prunePerfSamples(beforeIso: string): number {
    return Number(this.db.prepare("DELETE FROM perf_samples WHERE run_id IN (SELECT id FROM perf_runs WHERE started_at < ?)").run(beforeIso).changes);
  }

  /** One point of a machine's history (a minute apart at most); older than 31 days is dropped. */
  addDeviceSample(name: string, at: string, v: Omit<Sample, "name" | "at">): void {
    const extra = EXTRA_SAMPLE_COLS.map((c) => v[SAMPLE_KEY[c]] ?? null);
    this.db
      .prepare(`INSERT OR REPLACE INTO device_samples (name, at, cpu, mem, disk, temp, net, gpu, ${EXTRA_SAMPLE_COLS.join(", ")}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${EXTRA_SAMPLE_COLS.map(() => "?").join(", ")})`)
      .run(name, at, v.cpu, v.mem, v.disk, v.temp, v.net ?? null, v.gpu ?? null, ...extra);
    this.db.prepare("DELETE FROM device_samples WHERE at < ?").run(new Date(Date.parse(at) - 31 * 86400_000).toISOString());
  }

  deviceSamples(sinceIso: string, name?: string): Sample[] {
    const cols = `name, at, cpu, mem, disk, temp, net, gpu, ${EXTRA_SAMPLE_COLS.map((c) => `${c} AS ${SAMPLE_KEY[c]}`).join(", ")}`;
    return (name
      ? this.db.prepare(`SELECT ${cols} FROM device_samples WHERE at >= ? AND name = ? ORDER BY at`).all(sinceIso, name)
      : this.db.prepare(`SELECT ${cols} FROM device_samples WHERE at >= ? ORDER BY at`).all(sinceIso)) as unknown as Sample[];
  }

  /** Alerts that fired (systems alerts), newest first; one row each, closed when it clears. */
  alerts(limit = 50): AlertRow[] {
    return this.db.prepare("SELECT * FROM alerts ORDER BY id DESC LIMIT ?").all(limit) as unknown as AlertRow[];
  }

  openAlerts(): AlertRow[] {
    return this.db.prepare("SELECT * FROM alerts WHERE cleared_at IS NULL ORDER BY id").all() as unknown as AlertRow[];
  }

  openAlert(key: string, text: string, at: string): number {
    return Number(this.db.prepare("INSERT INTO alerts (key, text, at) VALUES (?, ?, ?)").run(key, text, at).lastInsertRowid);
  }

  clearAlert(id: number, at: string): void {
    this.db.prepare("UPDATE alerts SET cleared_at = ? WHERE id = ?").run(at, id);
  }

  /** The owner paused CI on this machine from the dashboard (its game guard reads it every minute). */
  ciPaused(device: string): boolean {
    return this.setting(`ci_paused:${device}`) === "1";
  }

  setCiPaused(device: string, on: boolean): void {
    this.setSetting(`ci_paused:${device}`, on ? "1" : "0");
  }

  /** CI build threads on this machine as saved from its card (systems.ts checks them and fills in defaults). */
  ciThreads(device: string): unknown {
    try {
      return JSON.parse(this.setting(`ci_threads:${device}`) ?? "null");
    } catch {
      return null;
    }
  }

  setCiThreads(device: string, v: unknown): void {
    this.setSetting(`ci_threads:${device}`, JSON.stringify(v));
  }

  /** The Discord webhook pasted on the Settings view ("" when none). */
  discordWebhook(): string {
    return this.setting("discord_webhook") ?? "";
  }

  setDiscordWebhook(url: string): void {
    this.setSetting("discord_webhook", url);
  }

  /** Settings › Install as saved from the dashboard (src/install.ts checks and fills it in). */
  installSaved(): unknown {
    try {
      return JSON.parse(this.setting("install") ?? "{}");
    } catch {
      return {};
    }
  }

  setInstallSaved(v: unknown): void {
    this.setSetting("install", JSON.stringify(v));
  }

  /** Whether this database predates src/install.ts. */
  installPredates(): boolean {
    return this.setting("install_base") === "predates";
  }

  /** The alert limits, as saved from the Settings view (alerts.ts fills in the defaults). */
  alertSettings(): unknown {
    try {
      return JSON.parse(this.setting("alerts") ?? "null");
    } catch {
      return null;
    }
  }

  setAlertSettings(v: unknown): void {
    this.setSetting("alerts", JSON.stringify(v));
  }

  /** Settings › Limits as saved from the dashboard, raw: limits.ts fills in the env and defaults. */
  limitSettings(): unknown {
    try {
      return JSON.parse(this.setting("limits") ?? "null");
    } catch {
      return null;
    }
  }

  setLimitSettings(v: unknown): void {
    this.setSetting("limits", JSON.stringify(v));
  }

  /** Settings › Auto-queue ideas (autoqueue.ts), raw: autoqueue.ts reads it with its defaults (off). */
  autoQueueSettings(): unknown {
    try {
      return JSON.parse(this.setting("auto_queue") ?? "null");
    } catch {
      return null;
    }
  }

  setAutoQueueSettings(v: unknown): void {
    this.setSetting("auto_queue", JSON.stringify(v));
  }

  /** This repo's auto-queue bookkeeping (autoqueue.ts): when its queue went empty, the last attempt. */
  autoQueueState(): unknown {
    try {
      return JSON.parse(this.setting(this.scope ? `auto_queue_state:${this.scope}` : "auto_queue_state") ?? "null");
    } catch {
      return null;
    }
  }

  setAutoQueueState(v: unknown): void {
    this.setSetting(this.scope ? `auto_queue_state:${this.scope}` : "auto_queue_state", JSON.stringify(v));
  }
}

export interface Sample {
  name: string;
  at: string;
  cpu: number | null;
  mem: number | null;
  disk: number | null;
  temp: number | null;
  /** bytes per second, in plus out */
  net?: number | null;
  /** 0..1 */
  gpu?: number | null;
  /** The GPU's temperature (°C), power (W), fan (%), clock (MHz) and video memory used (bytes). */
  gpuTemp?: number | null;
  gpuPower?: number | null;
  gpuFan?: number | null;
  gpuClock?: number | null;
  vram?: number | null;
  /** The CPU's package power (W) and average core clock (MHz), and the fastest fan (RPM). */
  cpuPower?: number | null;
  cpuClock?: number | null;
  fan?: number | null;
}

export interface AlertRow {
  id: number;
  key: string;
  text: string;
  at: string;
  cleared_at: string | null;
}
