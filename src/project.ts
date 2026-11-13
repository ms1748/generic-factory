// Loads a project's live state from GitHub: its config, open issues, ready cards and open PRs.
import { defaults, fromYaml, type ProjectConfig } from "./config.ts";
import type { GitHub } from "./github.ts";
import type { DepIssue } from "./deps.ts";
import { isAgent, type Issue, type Pull } from "./queue.ts";

interface ApiIssue {
  number: number;
  title: string;
  body: string | null;
  labels: { name: string }[];
  comments: number;
  pull_request?: unknown;
}
interface ApiComment {
  user: { login: string } | null;
  body: string | null;
}
interface ApiPull {
  number: number;
  title: string;
  draft: boolean;
  body: string | null;
  head: { ref: string };
  labels: { name: string }[];
  updated_at: string;
}

/** Every open issue, briefly (for the dashboard's "waiting on you"). */
export interface OpenIssue {
  number: number;
  title: string;
  labels: string[];
}

export interface Snapshot {
  config: ProjectConfig;
  open: OpenIssue[];
  ready: Issue[];
  pulls: Pull[];
  openIssues: Set<number>;
  /** Open issues and the 100 most recently closed, with their texts: the board's dependency chains (deps.ts). */
  issues: DepIssue[];
  /** needs-owner cards whose newest comment is the owner's: answered, waiting to be requeued. */
  answered: Set<number>;
  takenAt: Date;
}

export async function loadConfig(gh: GitHub, repo: string): Promise<ProjectConfig> {
  const file = await gh.maybe<{ content: string }>(`/repos/${repo}/contents/.factory.yml`);
  return file ? fromYaml(repo, Buffer.from(file.content, "base64").toString("utf8")) : defaults(repo);
}

export async function snapshot(gh: GitHub, repo: string): Promise<Snapshot> {
  const [config, issues, apiPulls, recentlyClosed] = await Promise.all([
    loadConfig(gh, repo),
    gh.all<ApiIssue>(`/repos/${repo}/issues?state=open`),
    gh.all<ApiPull>(`/repos/${repo}/pulls?state=open`),
    // One page is enough: a feature's finished parts closed recently.
    gh.get<ApiIssue[]>(`/repos/${repo}/issues?state=closed&sort=updated&direction=desc&per_page=100`),
  ]);
  const open = issues.filter((i) => !i.pull_request);
  const ready = await Promise.all(
    open
      .filter((i) => i.labels.some((l) => l.name === "ready"))
      .map(async (i): Promise<Issue> => {
        const [comments, blockedBy] = await Promise.all([
          i.comments ? gh.all<ApiComment>(`/repos/${repo}/issues/${i.number}/comments`) : Promise.resolve([]),
          gh.maybe<{ number: number }[]>(`/repos/${repo}/issues/${i.number}/dependencies/blocked_by`),
        ]);
        return {
          number: i.number,
          title: i.title,
          labels: i.labels.map((l) => l.name),
          body: i.body ?? "",
          comments: comments.map((c) => ({ author: c.user?.login ?? "", body: c.body ?? "" })),
          blockedBy: (blockedBy ?? []).map((b) => b.number),
        };
      }),
  );
  const owner = repo.split("/")[0];
  const answered = new Set<number>();
  await Promise.all(
    open
      .filter((i) => i.labels.some((l) => l.name === "needs-owner") && i.comments > 0)
      .map(async (i) => {
        const comments = await gh.all<ApiComment>(`/repos/${repo}/issues/${i.number}/comments`);
        const last = comments.at(-1);
        if (last && last.user?.login === owner && !isAgent({ author: owner, body: last.body ?? "" })) answered.add(i.number);
      }),
  );
  const pulls = apiPulls.map((p): Pull => ({
    number: p.number,
    title: p.title,
    draft: p.draft,
    branch: p.head.ref,
    body: p.body ?? "",
    labels: p.labels.map((l) => l.name),
    updatedAt: p.updated_at,
  }));
  return {
    config,
    open: open.map((i) => ({ number: i.number, title: i.title, labels: i.labels.map((l) => l.name) })),
    ready,
    pulls,
    openIssues: new Set(open.map((i) => i.number)),
    issues: [
      ...open.map((i): DepIssue => ({ number: i.number, title: i.title, body: i.body ?? "", labels: i.labels.map((l) => l.name), closed: false, blockedBy: ready.find((r) => r.number === i.number)?.blockedBy })),
      ...recentlyClosed.filter((i) => !i.pull_request).map((i): DepIssue => ({ number: i.number, title: i.title, body: i.body ?? "", labels: i.labels.map((l) => l.name), closed: true })),
    ],
    answered,
    takenAt: new Date(),
  };
}
