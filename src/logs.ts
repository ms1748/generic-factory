// The Logs view: every Docker container on the factory's LXC (the dispatcher, the tunnel, each agent run,
// GlitchTip, ...) and its log, read with the docker CLI the dispatcher already has. Read-only: it lists
// and reads, never starts, stops or execs anything.
import { execFile } from "node:child_process";

export interface ContainerInfo {
  name: string;
  image: string;
  state: string; // running | exited | created | ...
  status: string; // "Up 8 minutes", "Exited (0) 2 hours ago"
  project: string | null; // the compose project, if any
  created: string;
}

export interface LogLine {
  at: string; // ISO time from docker --timestamps
  text: string;
}

const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

function docker(args: string[], timeout = 15_000, max = 8 * 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile("docker", args, { timeout, maxBuffer: max }, (e, stdout, stderr) => (e ? reject(new Error((stderr || e.message).trim().slice(0, 300))) : resolve(stdout + stderr))),
  );
}

/** `docker ps -a --format json` lines, newest first, without the noise the page doesn't need. */
export function parseContainers(out: string): ContainerInfo[] {
  const list: ContainerInfo[] = [];
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    try {
      const j = JSON.parse(line) as Record<string, string>;
      const project = /(?:^|,)com\.docker\.compose\.project=([^,]+)/.exec(j.Labels ?? "")?.[1] ?? null;
      list.push({ name: j.Names, image: j.Image, state: j.State, status: j.Status, project, created: j.CreatedAt });
    } catch {
      // a line that isn't json: skip
    }
  }
  // Running first, then newest.
  return list.sort((a, b) => Number(b.state === "running") - Number(a.state === "running") || b.created.localeCompare(a.created));
}

/** `docker logs --timestamps` output as lines; the timestamp docker adds is split off. */
export function parseLogs(out: string): LogLine[] {
  return out
    .split("\n")
    .filter((l) => l.length)
    .map((l) => {
      const m = /^(\d{4}-\d\d-\d\dT[\d:.]+Z) ?(.*)$/.exec(l);
      return m ? { at: m[1], text: m[2].slice(0, 4000) } : { at: "", text: l.slice(0, 4000) };
    });
}

export async function containers(): Promise<ContainerInfo[]> {
  // Agent runs that finished long ago are removed by the runner; anything left is worth seeing.
  return parseContainers(await docker(["ps", "-a", "--no-trunc", "--format", "{{json .}}"]));
}

/** The last `tail` lines of a container's log, or only those after `since` (an ISO time, for following). */
export async function logs(name: string, tail = 500, since?: string): Promise<LogLine[]> {
  if (!NAME.test(name)) throw new Error("bad container name");
  const args = ["logs", "--timestamps", "--tail", String(Math.min(Math.max(tail, 1), 5000))];
  if (since && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(since)) args.push("--since", since);
  args.push(name);
  const lines = parseLogs(await docker(args));
  // --since is inclusive to the second: drop what the page already has.
  return since ? lines.filter((l) => l.at > since) : lines;
}
