// PR test builds, for a project whose CI makes them (optional; nothing happens for a project without them).
// Each push to a PR makes a numbered build, hosted by the project (for example on its site, behind
// Cloudflare Access) and as a 7-day GitHub artifact, all listed in one "Test builds" comment by
// github-actions[bot] with a JSON marker (docs/quickstart.md has the format).
//
// The factory reads that marker for the dashboard, and a while after a PR is merged or closed it
// dispatches the project's cleanup workflow, which deletes them and marks the comment. The factory
// deletes nothing itself: the hosting keys stay in the project's GitHub secrets. Both names are the
// project's own, from .factory.yml's `test_builds:` (src/config.ts), else `factory-test-builds` and
// `test-builds-cleanup.yml`.
import { DEFAULT_TEST_BUILDS, type TestBuildsConfig } from "./config.ts";
import type { Ctx } from "./dispatch.ts";

export const BUILDS_BOT = "github-actions[bot]";
export const DEFAULT_DELETE_HOURS = 24;
/** GitHub artifacts expire this long after they're made. */
const ARTIFACT_MS = 7 * 24 * 3600_000;
/** A dispatched run may take a moment to show in the runs list; until then it counts as pending. */
const APPEAR_MS = 10 * 60_000;
/** After a cleanup run finished without marking the comment, wait this long before trying again. */
const RETRY_MS = 6 * 3600_000;

export interface TestBuildVersion {
  v: number;
  sha: string;
  at: string;
  artifact: string | null;
  site: string | null;
}

export interface TestBuilds {
  pr: number;
  /** Newest first. */
  versions: TestBuildVersion[];
  /** Set (a time, or true) once the cleanup workflow has deleted them all. */
  deleted: string | boolean | null;
}

/** `<!-- <marker> {...} -->`. The marker is a plain name (config.ts checks it), so it's safe in a pattern. */
const markerPattern = (marker: string) => new RegExp(`<!--\\s*${marker}\\s+([\\s\\S]*?)\\s*-->`);

/**
 * The PR's test builds, from the github-actions[bot] comment carrying the project's marker. Undefined
 * when there's no such comment or its JSON is broken (so nothing is ever cleaned up on a misread).
 */
export function parseTestBuilds(comments: { author: string; body: string }[], marker = DEFAULT_TEST_BUILDS.marker): TestBuilds | undefined {
  const pattern = markerPattern(marker);
  for (const c of [...comments].reverse()) {
    if (c.author !== BUILDS_BOT) continue;
    const m = c.body.match(pattern);
    if (!m) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(m[1]);
    } catch {
      return undefined;
    }
    return validate(raw);
  }
  return undefined;
}

function validate(raw: unknown): TestBuilds | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.pr !== "number" || !Array.isArray(r.versions)) return undefined;
  const versions: TestBuildVersion[] = [];
  for (const x of r.versions as Record<string, unknown>[]) {
    if (!x || typeof x.v !== "number" || typeof x.at !== "string" || Number.isNaN(Date.parse(x.at))) return undefined;
    versions.push({
      v: x.v,
      sha: typeof x.sha === "string" ? x.sha : "",
      at: x.at,
      artifact: httpsUrl(x.artifact),
      site: httpsUrl(x.site),
    });
  }
  versions.sort((a, b) => b.v - a.v);
  const deleted = typeof r.deleted === "string" ? r.deleted : r.deleted ? true : null;
  return { pr: r.pr, versions, deleted };
}

/** Only https links reach the page. */
const httpsUrl = (v: unknown): string | null => (typeof v === "string" && /^https:\/\//.test(v) ? v : null);

/** What the dashboard shows for each version: links only while they still work. */
export function versionsForPage(b: TestBuilds, now: number) {
  return b.versions.map((x) => {
    const expired = Date.parse(x.at) + ARTIFACT_MS <= now;
    return {
      v: x.v,
      sha: x.sha.slice(0, 7),
      at: x.at,
      site: b.deleted ? null : x.site,
      artifact: b.deleted || expired ? null : x.artifact,
      artifactExpires: new Date(Date.parse(x.at) + ARTIFACT_MS).toISOString(),
    };
  });
}

export type CleanupStep =
  | { do: "nothing"; why: string }
  | { do: "wait"; until: string }
  | { do: "pending"; since: string }
  | { do: "dispatch"; retry: boolean };

/**
 * What to do about one closed PR's test builds. `dispatchedAt` is when the factory last dispatched the
 * cleanup for it; `runActive` whether a cleanup run created since then is still queued or running.
 */
export function cleanupStep(p: {
  closedAt: string | null;
  builds: TestBuilds | undefined;
  delayHours: number;
  now: number;
  dispatchedAt?: string;
  runActive?: boolean;
}): CleanupStep {
  if (!p.closedAt) return { do: "nothing", why: "open" };
  if (!p.builds) return { do: "nothing", why: "no test builds" };
  if (p.builds.deleted) return { do: "nothing", why: "deleted" };
  const due = Date.parse(p.closedAt) + p.delayHours * 3600_000;
  if (p.now < due) return { do: "wait", until: new Date(due).toISOString() };
  if (p.dispatchedAt) {
    const since = Date.parse(p.dispatchedAt);
    if (p.runActive || p.now - since < APPEAR_MS) return { do: "pending", since: p.dispatchedAt };
    // That run finished without marking the comment: it failed. Try again, but not every hour.
    if (p.now - since < RETRY_MS) return { do: "pending", since: p.dispatchedAt };
    return { do: "dispatch", retry: true };
  }
  return { do: "dispatch", retry: false };
}

/** The owner's "Delete test builds after" setting, as hours; the page shows it in hours or days. */
export const MIN_DELETE_HOURS = 1;
export const MAX_DELETE_HOURS = 90 * 24;

export interface CleanupReport {
  checkedAt: string;
  /** Closed PRs whose builds are still up, and what happens next. */
  prs: { pr: number; title: string; closedAt: string; merged: boolean; step: CleanupStep }[];
  /** Why dispatching can't work, if it can't (missing permission, workflow not on main yet). */
  problem: string | null;
}

interface ApiClosedPull {
  number: number;
  title: string;
  closed_at: string | null;
  merged_at: string | null;
}

/** The last hourly check, for the dashboard. */
export let lastCleanup: CleanupReport | undefined;

/**
 * The periodic check: for each recently merged or closed PR with test builds still up, dispatch the
 * cleanup workflow once its delay has passed. Never twice while a run is pending.
 */
export async function checkTestBuilds(ctx: Ctx, names: TestBuildsConfig, now = Date.now()): Promise<CleanupReport> {
  const { gh, state, repo, log } = ctx;
  const workflow = names.cleanupWorkflow;
  const delayHours = state.testBuildDeleteHours();
  // Look back far enough to cover the delay plus a week of missed checks (dispatcher down, failures).
  const since = now - (delayHours + 7 * 24) * 3600_000;
  const closed = (await gh.get<ApiClosedPull[]>(`/repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=100`)).filter(
    (p) => p.closed_at && Date.parse(p.closed_at) >= since && !state.cleanupDone(p.number),
  );
  let runs: { status: string; created_at: string }[] | undefined;
  const activeSince = async (iso: string) => {
    runs ??= (
      (await gh.maybe<{ workflow_runs: { status: string; created_at: string }[] }>(`/repos/${repo}/actions/workflows/${workflow}/runs?event=workflow_dispatch&per_page=50`))
        ?.workflow_runs ?? []
    );
    const from = new Date(Date.parse(iso) - 2 * 60_000).toISOString().slice(0, 19); // clock drift
    return runs.some((r) => r.status !== "completed" && r.created_at >= from);
  };
  const report: CleanupReport = { checkedAt: new Date(now).toISOString(), prs: [], problem: null };
  // Say so up front when the app can't dispatch workflows at all.
  const perms = await gh.appPermissions();
  if (perms && perms.actions !== "write") report.problem = dispatchProblem(403, "", workflow);
  for (const p of closed) {
    const comments = await gh.all<{ user: { login: string } | null; body: string | null }>(`/repos/${repo}/issues/${p.number}/comments`);
    const builds = parseTestBuilds(comments.map((c) => ({ author: c.user?.login ?? "", body: c.body ?? "" })), names.marker);
    if (builds?.deleted) {
      state.markCleanupDone(p.number);
      continue;
    }
    if (!builds) continue;
    const dispatchedAt = state.cleanupDispatched(p.number);
    let step = cleanupStep({ closedAt: p.closed_at, builds, delayHours, now, dispatchedAt });
    if (step.do === "dispatch" && dispatchedAt && (await activeSince(dispatchedAt))) step = { do: "pending", since: dispatchedAt };
    if (step.do === "dispatch" && !report.problem) {
      const res = await gh.request("POST", `/repos/${repo}/actions/workflows/${workflow}/dispatches`, { ref: "main", inputs: { pr: String(p.number) } });
      if (res.ok) {
        state.markCleanupDispatched(p.number, new Date(now).toISOString());
        log(`test builds: dispatched ${workflow} for PR #${p.number}${step.retry ? " again (the last run didn't finish the job)" : ""}`);
        step = { do: "pending", since: new Date(now).toISOString() };
      } else {
        report.problem = dispatchProblem(res.status, res.text, workflow);
        log(`test builds: can't dispatch ${workflow} for PR #${p.number}: ${report.problem}`);
      }
    }
    report.prs.push({ pr: p.number, title: p.title, closedAt: p.closed_at!, merged: Boolean(p.merged_at), step });
  }
  lastCleanup = report;
  return report;
}

/** A failed dispatch in words the owner can act on. */
export function dispatchProblem(status: number, text: string, workflow: string): string {
  if (status === 403) return "the factory's GitHub App needs Actions: write on the project (GitHub App settings → Permissions → Actions → Read and write, then accept it on the installation)";
  if (status === 404) return `${workflow} isn't on the project's main branch, or the app can't see Actions`;
  if (status === 422) return `GitHub refused the dispatch: ${text.slice(0, 160)}`;
  return `GitHub ${status}: ${text.slice(0, 160)}`;
}
