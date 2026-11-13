// A project's factory settings: which repo, which lanes (model, card sizes, schedule, prompt file).
// Read from `.factory.yml` on the project's default branch, else the built-in defaults below.
import { parse } from "yaml";

export type LaneKind = "builder" | "maintainer" | "ideas" | "security" | "reviewer";

export interface Lane {
  name: string;
  kind: LaneKind;
  model: string;
  /** Builder lanes: the `size:` labels they build; "none" means unsized cards. */
  sizes: string[];
  /** Builder lanes: sizes they split into smaller ideas instead of building. */
  splits: string[];
  /** Local times like "09:00", optionally with days: "mon,thu 08:00". */
  schedule: string[];
  /** Prompt file in the project repo, handed to `claude -p`. */
  prompt: string;
  enabled: boolean;
}

export interface ProjectConfig {
  repo: string;
  timezone: string;
  /** Builders stop when this many open PRs carry the `factory` label; 0 (the default) means no limit. */
  maxOpenPrs: number;
  lanes: Lane[];
  /** Where the lanes' prompt files live in the project repo (common.md sits next to them). */
  promptDir: string;
  /** PR test builds: the names the project's CI uses (src/testbuilds.ts). */
  testBuilds: TestBuildsConfig;
  /** Where the settings came from, for the report. */
  source: string;
}

export interface TestBuildsConfig {
  /** The JSON marker in the CI's Test builds comment: `<!-- <marker> {...} -->`. */
  marker: string;
  /** The workflow file on the project's main branch that deletes a PR's builds (dispatched with input `pr`). */
  cleanupWorkflow: string;
}

/** The default names; a project whose CI uses others sets `test_builds:` in .factory.yml. */
export const DEFAULT_TEST_BUILDS: TestBuildsConfig = { marker: "factory-test-builds", cleanupWorkflow: "test-builds-cleanup.yml" };

/** Prompt files' folder when .factory.yml doesn't set `prompt_dir`. */
export const DEFAULT_PROMPT_DIR = "docs/factory/prompts";
/** Schedules' time zone when .factory.yml doesn't set `timezone`: FACTORY_TIMEZONE, else UTC. */
export const DEFAULT_TIMEZONE = process.env.FACTORY_TIMEZONE || "UTC";

const DEFAULT_LANES: Lane[] = [
  lane("builder", "builder", "opus", ["M", "L", "none"], ["XL"], ["09:00", "14:00", "19:00"], "builder.md"),
  lane("small-builder", "builder", "sonnet", ["S"], [], ["11:00", "16:00"], "builder.md"),
  lane("maintainer", "maintainer", "opus", [], [], ["08:00", "17:00"], "maintainer.md"),
  // Off by default: it files new ideas on its own, which a new project may not want yet.
  { ...lane("ideas", "ideas", "opus", [], [], ["mon,thu 08:00"], "ideas.md"), enabled: false },
  lane("security", "security", "sonnet", [], [], ["thu 08:00"], "security.md"),
  // No schedule: it reviews each ready factory PR as it appears (src/review.ts). Its guide is built in.
  { ...lane("reviewer", "reviewer", "sonnet", [], [], [], ""), prompt: "factory:reviewer" },
];

function lane(name: string, kind: LaneKind, model: string, sizes: string[], splits: string[], schedule: string[], prompt: string): Lane {
  return { name, kind, model, sizes, splits, schedule, prompt, enabled: true };
}

/** The built-in lanes, with their prompt files in `dir`. */
function defaultLanes(dir: string): Lane[] {
  return DEFAULT_LANES.map((l) => (l.prompt && !l.prompt.startsWith("factory:") ? { ...l, prompt: `${dir}/${l.prompt}` } : l));
}

export function defaults(repo: string, promptDir = DEFAULT_PROMPT_DIR): ProjectConfig {
  return { repo, timezone: DEFAULT_TIMEZONE, maxOpenPrs: 0, lanes: defaultLanes(promptDir), promptDir, testBuilds: { ...DEFAULT_TEST_BUILDS }, source: "built-in defaults" };
}

/** Merges a `.factory.yml` over the defaults. Unknown keys are ignored; a bad file throws. */
export function fromYaml(repo: string, text: string): ProjectConfig {
  const raw = (parse(text) ?? {}) as Record<string, unknown>;
  const promptDir = (str(raw.prompt_dir) ?? DEFAULT_PROMPT_DIR).replace(/\/+$/, "");
  const base = defaults(repo, promptDir);
  const lanes = Array.isArray(raw.lanes)
    ? raw.lanes.map((l: Record<string, unknown>) => {
        if (typeof l.name !== "string" || typeof l.kind !== "string") throw new Error(".factory.yml: every lane needs a name and a kind");
        const known = base.lanes.find((d) => d.name === l.name);
        return {
          name: l.name,
          kind: l.kind as LaneKind,
          model: str(l.model) ?? known?.model ?? "sonnet",
          sizes: strs(l.sizes) ?? known?.sizes ?? [],
          splits: strs(l.splits) ?? known?.splits ?? [],
          schedule: strs(l.schedule) ?? known?.schedule ?? [],
          prompt: str(l.prompt) ?? known?.prompt ?? "",
          enabled: l.enabled !== false,
        };
      })
    : base.lanes;
  return {
    repo,
    timezone: str(raw.timezone) ?? base.timezone,
    maxOpenPrs: typeof raw.max_open_prs === "number" ? raw.max_open_prs : base.maxOpenPrs,
    lanes,
    promptDir,
    testBuilds: testBuilds(raw.test_builds),
    source: ".factory.yml",
  };
}

/** `test_builds: { marker, cleanup_workflow }`, each falling back to the default. A bad name throws. */
function testBuilds(v: unknown): TestBuildsConfig {
  if (v == null) return { ...DEFAULT_TEST_BUILDS };
  if (typeof v !== "object" || Array.isArray(v)) throw new Error(".factory.yml: test_builds must be a map (marker, cleanup_workflow)");
  const t = v as Record<string, unknown>;
  const marker = t.marker ?? DEFAULT_TEST_BUILDS.marker;
  const cleanupWorkflow = t.cleanup_workflow ?? DEFAULT_TEST_BUILDS.cleanupWorkflow;
  // The marker goes into a pattern and the workflow into an API path: plain names only.
  if (typeof marker !== "string" || !/^[A-Za-z0-9][\w-]{0,59}$/.test(marker))
    throw new Error(`.factory.yml: test_builds.marker must be a name of letters, digits, - and _ (got ${JSON.stringify(marker)})`);
  if (typeof cleanupWorkflow !== "string" || !/^[\w.-]{1,100}\.ya?ml$/.test(cleanupWorkflow) || cleanupWorkflow.startsWith("."))
    throw new Error(`.factory.yml: test_builds.cleanup_workflow must be a workflow file name like test-builds-cleanup.yml (got ${JSON.stringify(cleanupWorkflow)})`);
  return { marker, cleanupWorkflow };
}

const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const strs = (v: unknown) => (Array.isArray(v) ? v.map(String) : undefined);

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** Every scheduled time within 8 days of `from` (both directions), in the process's time zone. */
function slots(schedule: string[], from: Date): Date[] {
  const out: Date[] = [];
  for (const entry of schedule) {
    const m = entry.trim().toLowerCase().match(/^(?:([a-z,]+)\s+)?(\d{1,2}):(\d{2})$/);
    if (!m) continue;
    const days = m[1] ? m[1].split(",").map((d) => DAYS.indexOf(d.slice(0, 3))) : [0, 1, 2, 3, 4, 5, 6];
    for (let add = -8; add <= 8; add++) {
      const t = new Date(from);
      t.setDate(t.getDate() + add);
      t.setHours(Number(m[2]), Number(m[3]), 0, 0);
      if (days.includes(t.getDay())) out.push(t);
    }
  }
  return out.sort((a, b) => a.getTime() - b.getTime());
}

/** The next time a lane runs after `from` (set TZ to the project's time zone first). */
export function nextRun(schedule: string[], from: Date): Date | undefined {
  return slots(schedule, from).find((t) => t > from);
}

/** Every scheduled time in the next `hours` hours. */
export function upcoming(schedule: string[], from: Date, hours: number): Date[] {
  const end = from.getTime() + hours * 3600_000;
  return slots(schedule, from).filter((t) => t > from && t.getTime() <= end);
}

/** The most recent scheduled time at or before `now`. */
export function lastSlot(schedule: string[], now: Date): Date | undefined {
  return slots(schedule, now).filter((t) => t <= now).at(-1);
}
