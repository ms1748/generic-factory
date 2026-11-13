// Runs one Claude Code session in a fresh agent container (agent/Dockerfile) and follows its
// stream-json output. The agent gets a token for the one repo, refreshed through a read-only file in a
// folder of its own (data/run/<run id>/), so runs going at once never overwrite or delete each other's;
// it never sees the app's private key, the Docker socket or anything else from the host.
import { spawn } from "node:child_process";
import { appendFileSync, chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { GitHub } from "./github.ts";
import { install } from "./install.ts";
import type { Shot, ShotSpec } from "./shots.ts";
import type { RateLimit } from "./state.ts";
import { agentLimits } from "./slots.ts";

export interface AgentRun {
  runId: number;
  repo: string;
  model: string;
  prompt: string;
  /** Continue this Claude session instead of starting a new one. */
  resume?: string;
  /** Check out this branch after cloning (a PR's branch, for resumes). */
  branch?: string;
  /** No clone, no GitHub token, no transcript: just ask Claude (the usage check). */
  bare?: boolean;
  /** Start a new branch (`branch`) from this commit instead of main (quality trials). */
  base?: string;
  /** Also fetch these branches into the clone (the trial judge compares them). */
  fetch?: string[];
  /** Another agent image (the trial's `factory-agent:plain`). */
  image?: string;
  /** The GlitchTip inbox (GLITCHTIP_*), for the maintainer's report triage only; no other run gets the token. */
  reports?: boolean;
}

/** The problem-report inbox settings a maintainer run gets (GlitchTip, from Settings › Install › Reports). */
export function reportsEnv(on: boolean | undefined, from = process.env, where = install().reports): Record<string, string> {
  if (!on || !from.GLITCHTIP_TOKEN || !where.url) return { GLITCHTIP_URL: "", GLITCHTIP_ORG: "", GLITCHTIP_TOKEN: "" };
  return { GLITCHTIP_URL: where.url, GLITCHTIP_ORG: where.org, GLITCHTIP_TOKEN: from.GLITCHTIP_TOKEN };
}

export interface AgentResult {
  ok: boolean;
  sessionId?: string;
  costUsd?: number;
  /** Claude's final message, or the error. */
  text: string;
  /** The run stopped on a Claude usage limit. */
  limited: boolean;
  /** Claude's last word on the plan's usage windows during this run. */
  rateLimit?: RateLimit;
  transcript: string;
}

export const env = {
  /** The data directory as this process sees it. */
  data: process.env.FACTORY_DATA ?? "data",
  /** The same directory as the Docker host sees it (bind mounts are host paths). */
  hostData: process.env.FACTORY_HOST_DATA ?? process.env.FACTORY_DATA ?? "data",
  image: process.env.FACTORY_AGENT_IMAGE ?? "factory-agent",
  /** Unset: 5 CPUs and 8 GB for one run, split evenly when Parallel runs is above 1 (slots.ts). */
  cpus: process.env.FACTORY_AGENT_CPUS,
  memory: process.env.FACTORY_AGENT_MEMORY,
};

/**
 * Set by the dispatcher from the owner's dashboard: whether runs may use paid extra-usage credits, how many
 * go at once, and the run time limit in minutes (Settings › Limits).
 */
export const policy = { allowCredits: () => false, parallelRuns: () => 1, timeoutMin: () => 180 };

/** Where one run's GitHub token lives: its own folder, since parallel runs (and runs for other repos) each need their own. */
export function runTokenDir(data: string, runId: number, bare?: boolean): string {
  return join(data, "run", bare ? "usage" : String(runId));
}

const LIMIT_RE = /usage limit|limit reached|rate[ _-]?limit|out of (?:extra )?usage|\b429\b/i;

export async function runAgent(gh: GitHub, run: AgentRun, log: (line: string) => void, onRateLimit?: (r: RateLimit) => void): Promise<AgentResult> {
  const name = run.bare ? `factory-usage-${Date.now()}` : `factory-run-${run.runId}`;
  const tokenDir = runTokenDir(env.data, run.runId, run.bare);
  if (run.bare) rmSync(join(env.data, "transcripts", "usage-check.jsonl"), { force: true });
  const transcript = run.bare ? join(env.data, "transcripts", "usage-check.jsonl") : join(env.data, "transcripts", `${run.runId}.jsonl`);
  mkdirSync(tokenDir, { recursive: true });
  mkdirSync(join(env.data, "transcripts"), { recursive: true });

  const writeToken = async () => {
    const file = join(tokenDir, "token");
    writeFileSync(file, await gh.repoToken(run.repo), { mode: 0o600 });
    chmodSync(file, 0o600);
  };
  if (!run.bare) await writeToken();
  const refresh = setInterval(() => run.bare || writeToken().catch((e) => log(`token refresh failed: ${e.message}`)), 30 * 60_000);

  const limits = agentLimits(run.bare ? 1 : policy.parallelRuns(), { cpus: env.cpus, memory: env.memory });
  const args = [
    "run", "--rm", "--name", name,
    "--cpus", limits.cpus, "--memory", limits.memory, "--pids-limit", "4096",
    "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
    "-v", `${runTokenDir(env.hostData, run.runId, run.bare)}:/run/factory:ro`,
    "-v", "factory-cargo-registry:/home/agent/.cargo/registry",
    "-v", "factory-cargo-git:/home/agent/.cargo/git",
    "-v", "factory-npm:/home/agent/.npm",
    // Only the sessions persist (resume needs them); the rest of ~/.claude, skills included, comes from the image.
    "-v", "factory-sessions:/home/agent/.claude/projects",
    // Values come from the child's environment below, so secrets never show in `ps`.
    "-e", "CLAUDE_CODE_OAUTH_TOKEN", "-e", "FACTORY_REPO", "-e", "FACTORY_MODEL", "-e", "FACTORY_PROMPT",
    "-e", "FACTORY_RESUME", "-e", "FACTORY_BRANCH", "-e", "CF_ACCESS_CLIENT_ID", "-e", "CF_ACCESS_CLIENT_SECRET", "-e", "FACTORY_BARE", "-e", "FACTORY_BASE", "-e", "FACTORY_FETCH", "-e", "FACTORY_GIT_NAME", "-e", "FACTORY_GIT_EMAIL",
    "-e", "GLITCHTIP_URL", "-e", "GLITCHTIP_ORG", "-e", "GLITCHTIP_TOKEN",
    run.image ?? env.image, "/home/agent/run.sh",
  ];
  let stderr = "";
  const child = spawn("docker", args, {
    env: {
      PATH: process.env.PATH,
      CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN,
      FACTORY_REPO: run.repo,
      FACTORY_MODEL: run.model,
      FACTORY_PROMPT: run.prompt,
      FACTORY_RESUME: run.resume ?? "",
      FACTORY_BRANCH: run.branch ?? "",
      FACTORY_BARE: run.bare ? "1" : "",
      CF_ACCESS_CLIENT_ID: run.bare ? "" : (process.env.CF_ACCESS_CLIENT_ID ?? ""),
      CF_ACCESS_CLIENT_SECRET: run.bare ? "" : (process.env.CF_ACCESS_CLIENT_SECRET ?? ""),
      FACTORY_BASE: run.base ?? "",
      FACTORY_FETCH: (run.fetch ?? []).join(" "),
      FACTORY_GIT_NAME: process.env.FACTORY_GIT_NAME ?? "",
      FACTORY_GIT_EMAIL: process.env.FACTORY_GIT_EMAIL ?? "",
      ...reportsEnv(run.reports && !run.bare),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  // Docker missing or not reachable: record a failed run instead of crashing the dispatcher.
  const closed: Promise<number> = new Promise((r) => {
    child.on("error", (e) => {
      stderr += `could not start docker: ${e.message}`;
      r(127);
    });
    child.on("close", (c) => r(c ?? 1));
  });
  const timeoutMin = policy.timeoutMin();
  const timeout = setTimeout(() => {
    log(`run ${run.runId} hit the ${timeoutMin}-minute limit; stopping it`);
    spawn("docker", ["kill", name], { stdio: "ignore" });
  }, timeoutMin * 60_000);

  let sessionId: string | undefined;
  let result: { is_error?: boolean; result?: string; total_cost_usd?: number; session_id?: string } | undefined;
  let rateLimit: RateLimit | undefined;
  let stoppedForCredits = false;
  child.stderr.on("data", (d: Buffer) => {
    stderr = (stderr + d.toString()).slice(-4000);
    appendFileSync(transcript, JSON.stringify({ type: "stderr", text: d.toString() }) + "\n");
  });
  for await (const line of createInterface({ input: child.stdout })) {
    if (!line.trim()) continue;
    appendFileSync(transcript, line + "\n");
    try {
      const ev = JSON.parse(line);
      if (ev.type === "system" && ev.subtype === "init" && !sessionId) {
        sessionId = ev.session_id;
        log(`run ${run.runId}: Claude session ${sessionId}`);
      } else if (ev.type === "result") {
        result = ev;
      } else if (ev.type === "rate_limit_event" && ev.rate_limit_info) {
        rateLimit = parseRateLimit(ev.rate_limit_info);
        onRateLimit?.(rateLimit);
        if (rateLimit.overage && !run.bare && !policy.allowCredits() && !stoppedForCredits) {
          // The plan ran out mid-run and Claude moved on to paid credits: stop rather than spend them.
          stoppedForCredits = true;
          log(`run ${run.runId}: the plan's window is used up and paid credits are off; stopping the run`);
          spawn("docker", ["kill", name], { stdio: "ignore" });
        }
      }
    } catch {
      // Not JSON (shouldn't happen on stdout); it's still in the transcript.
    }
  }
  const code = await closed;
  clearTimeout(timeout);
  clearInterval(refresh);
  rmSync(tokenDir, { recursive: true, force: true });

  const text = stoppedForCredits
    ? "Stopped: the plan's usage window ran out and paid credits are off (dashboard › Budget)."
    : (result?.result ?? (stderr.trim() || `agent exited with code ${code}`));
  const ok = !stoppedForCredits && code === 0 && result !== undefined && !result.is_error;
  return {
    ok,
    sessionId: result?.session_id ?? sessionId,
    costUsd: result?.total_cost_usd,
    text,
    limited: stoppedForCredits || (!ok && LIMIT_RE.test(text + "\n" + stderr)) || rateLimit?.status === "rejected",
    rateLimit,
    transcript,
  };
}

/** The screenshot script's time limit: it's meant to take well under a minute. */
const SHOTS_TIMEOUT_MS = 2 * 60_000;

/**
 * Runs agent/shots.mjs in a fresh agent container for a reviewer run (src/shots.ts): no clone, no GitHub
 * token, no Claude, no volumes; only the Access service token, which the script sends to the two preview
 * hosts and nowhere else. Returns its shots, or one shot with the error when it couldn't run.
 */
export async function runShots(runId: number, spec: ShotSpec, log: (line: string) => void): Promise<Shot[]> {
  const name = `factory-shots-${runId}`;
  const limits = agentLimits(policy.parallelRuns(), { cpus: env.cpus, memory: env.memory });
  const args = [
    "run", "--rm", "--name", name,
    "--cpus", limits.cpus, "--memory", limits.memory, "--pids-limit", "1024", "--shm-size", "256m",
    "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
    "-e", "FACTORY_SHOTS", "-e", "CF_ACCESS_CLIENT_ID", "-e", "CF_ACCESS_CLIENT_SECRET",
    env.image, "node", "/opt/shots/shots.mjs",
  ];
  const child = spawn("docker", args, {
    env: {
      PATH: process.env.PATH,
      FACTORY_SHOTS: JSON.stringify(spec),
      CF_ACCESS_CLIENT_ID: process.env.CF_ACCESS_CLIENT_ID ?? "",
      CF_ACCESS_CLIENT_SECRET: process.env.CF_ACCESS_CLIENT_SECRET ?? "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (d: Buffer) => (stderr = (stderr + d.toString()).slice(-2000)));
  const closed: Promise<number> = new Promise((r) => {
    child.on("error", (e) => {
      stderr += `could not start docker: ${e.message}`;
      r(127);
    });
    child.on("close", (c) => r(c ?? 1));
  });
  const timeout = setTimeout(() => {
    log(`run ${runId}: the screenshots took over ${SHOTS_TIMEOUT_MS / 60_000} minutes; stopping them`);
    spawn("docker", ["kill", name], { stdio: "ignore" });
  }, SHOTS_TIMEOUT_MS);
  const shots: Shot[] = [];
  for await (const line of createInterface({ input: child.stdout })) {
    try {
      const s = JSON.parse(line) as Shot;
      if (typeof s.page === "string" && typeof s.device === "string" && (s.side === "before" || s.side === "after")) shots.push(s);
    } catch {
      // Not a shot line; ignored.
    }
  }
  const code = await closed;
  clearTimeout(timeout);
  if (!shots.length) return [{ page: "/", device: "desktop", side: "after", error: (stderr.trim().split("\n").at(-1) || `exit code ${code}`).slice(0, 200) }];
  return shots;
}

/** Claude Code's rate_limit_event: the plan's 5-hour and 7-day windows (utilization 0-1, reset time). */
export function parseRateLimit(info: Record<string, any>): RateLimit {
  const win = (w: any) => (w ? { utilization: Number(w.utilization ?? 0), resetsAt: new Date(Number(w.resetsAt) * 1000).toISOString() } : undefined);
  return {
    status: String(info.status ?? "allowed"),
    resetsAt: info.resetsAt ? new Date(Number(info.resetsAt) * 1000).toISOString() : undefined,
    fiveHour: win(info.unifiedWindows?.five_hour),
    sevenDay: win(info.unifiedWindows?.seven_day),
    overage: Boolean(info.isUsingOverage || info.overageInUse),
    at: new Date().toISOString(),
  };
}
