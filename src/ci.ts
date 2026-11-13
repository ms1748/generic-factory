// CI results come back to the agent instead of the agent waiting for them. A builder ends its run once it
// has pushed; when CI on the PR's latest commit finishes red, the dispatcher resumes that PR's session with
// the failed checks and their error lines (resume.ts). Found by a check_suite / workflow_run webhook (at
// once) or by the 5-minute poll. Once per commit, and at most MAX_CI_RESUMES times per PR; after that the
// builder prompt has it label the card needs-owner.
import type { GitHub } from "./github.ts";
import type { PrItem } from "./feedback.ts";

export const MAX_CI_RESUMES = 2;

export interface CheckRun {
  id: number;
  name: string;
  status: string; // queued | in_progress | completed
  conclusion: string | null; // success | failure | timed_out | cancelled | skipped | neutral | ...
  html_url?: string;
  completed_at?: string | null;
  app?: { slug?: string } | null;
}

/** Whether CI finished after the session last ran, so old red PRs don't all resume at once. */
export function finishedSince(runs: CheckRun[], since: string): boolean {
  return runs.some((r) => (r.completed_at ?? "") > since);
}

export type Verdict = { state: "none" | "pending" | "green" } | { state: "red"; failed: CheckRun[] };

const RED = new Set(["failure", "timed_out", "startup_failure", "action_required"]);

/**
 * What CI says about a commit. Red only once every check has finished, so the agent sees the whole
 * picture in one resume. Cancelled runs don't count: a newer push cancels the older run on purpose.
 */
export function verdict(runs: CheckRun[]): Verdict {
  const real = runs.filter((r) => r.conclusion !== "cancelled" && r.conclusion !== "skipped");
  if (!real.length) return { state: "none" };
  if (real.some((r) => r.status !== "completed")) return { state: "pending" };
  const failed = real.filter((r) => RED.has(r.conclusion ?? ""));
  return failed.length ? { state: "red", failed } : { state: "green" };
}

/** GitHub refused to start the job (Actions minutes or spending limit used up, a failed payment): no code ran. */
export const NOT_STARTED = /job was not started because/i;

/**
 * The failed checks GitHub never started (its annotation says why). They aren't the PR's fault, so the
 * builder isn't sent to "fix" them; CI runs again when minutes are back and something is pushed or rerun.
 */
export async function notStarted(gh: GitHub, repo: string, failed: CheckRun[]): Promise<Set<number>> {
  const out = new Set<number>();
  for (const f of failed) {
    const notes = await gh.maybe<{ message: string }[]>(`/repos/${repo}/check-runs/${f.id}/annotations`);
    if ((notes ?? []).some((n) => NOT_STARTED.test(n.message))) out.add(f.id);
  }
  return out;
}

/**
 * The lines of a job log worth reading: errors, failures, panics and their next line, without the
 * runner's timestamps. At most `max` lines, the last ones (where a failure usually ends up).
 */
export function errorLines(log: string, max = 60): string[] {
  const lines = log.split(/\r?\n/).map((l) => l.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z\s?/, "").replace(/\x1b\[[0-9;]*m/g, ""));
  const hit = /\b(error|errors|failed|failure|panicked|FAIL|assert|exception|cannot|not found)\b|##\[error\]/i;
  const noise = /^(\s*$|##\[group\]|##\[endgroup\]|shell: |env:|\s+[A-Z_]+: )/;
  const keep = new Set<number>();
  lines.forEach((l, i) => {
    if (hit.test(l) && !noise.test(l)) {
      keep.add(i);
      if (lines[i + 1] && !noise.test(lines[i + 1])) keep.add(i + 1);
    }
  });
  return [...keep].sort((a, b) => a - b).map((i) => lines[i].slice(0, 300)).slice(-max);
}

/** The message the session resumes with: which checks failed, links, and what their logs say. */
export async function ciFeedback(gh: GitHub, repo: string, sha: string, failed: CheckRun[]): Promise<PrItem> {
  const parts = [
    `CI failed on your latest commit ${sha.slice(0, 7)}: ${failed.map((f) => f.name).join(", ")}.`,
    "Read the errors below (and the full log with `gh run view --log-failed` if you need more), fix the cause on this branch, run the checks you can, and push.",
    "If a check can't pass in this CI at all (it needs hardware or drivers the runner doesn't have), don't keep trying: say so on the PR in one line, mark those tests so CI skips them with a clear reason, and put \"run on a hardware test machine\" under Follow-ups.",
    "If this is the same failure your last fix was meant to solve, follow the builder prompt: comment the failure, label the card needs-owner, and stop.",
  ];
  for (const f of failed.slice(0, 3)) {
    const lines = await jobErrors(gh, repo, f);
    parts.push("", `${f.name} (${f.html_url ?? "no link"}):`, ...(lines.length ? ["```", ...lines, "```"] : ["(no error lines found; open the log)"]));
  }
  return { kind: "comment", author: "factory dispatcher", at: new Date(0).toISOString(), body: parts.join("\n") };
}

/** Error lines from an Actions job's log; the check's annotations when the app can't read logs. */
async function jobErrors(gh: GitHub, repo: string, run: CheckRun): Promise<string[]> {
  if (run.app?.slug === "github-actions" || !run.app) {
    const log = await gh.text(`/repos/${repo}/actions/jobs/${run.id}/logs`);
    if (log) return errorLines(log);
  }
  const notes = await gh.maybe<{ path: string; start_line: number; message: string; annotation_level: string }[]>(`/repos/${repo}/check-runs/${run.id}/annotations`);
  return (notes ?? []).slice(0, 30).map((a) => `${a.annotation_level}: ${a.path}:${a.start_line}: ${a.message}`.slice(0, 300));
}
