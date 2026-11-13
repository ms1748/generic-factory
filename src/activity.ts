// What the agents did on GitHub lately, and undoing one action from the dashboard. It reads GitHub's own
// records (issue events, comments, issues and PRs opened). Only the GitHub App's bot counts (Settings ›
// Install › GitHub App), plus comments carrying the factory marker
// (cloud runs that posted as the owner); a cloud run's label changes and closes can't be told from the
// owner's, so `unseen` names the issues to check by hand. Undo never takes a request from the page: the
// page sends an action's id, and the dispatcher looks the action up again and reverses it itself.
import type { GitHub } from "./github.ts";
import { install } from "./install.ts";
import { hasMarker, stripMarker } from "./queue.ts";

export { MARKER } from "./queue.ts";
const byBot = (login?: string | null) => install().apps.some((a) => `${a}[bot]` === login);

/** A GitHub call that reverses an action. */
export interface Undo {
  method: "POST" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
}

export interface Action {
  /** Stable across fetches: what the page sends back to undo it. */
  id: string;
  at: string;
  n: number;
  kind: "issue" | "pr";
  what: string;
  /** How to reverse it, or null when it can't be (a merge, a push). */
  undo: Undo | null;
}

export interface Activity {
  since: string;
  actions: Action[];
  unseen: number[];
}

interface ApiEvent {
  id: number;
  event: string;
  created_at: string;
  actor?: { login: string } | null;
  label?: { name: string };
  rename?: { from: string; to: string };
  issue?: { number: number; pull_request?: unknown };
}
interface ApiComment {
  id: number;
  created_at: string;
  body?: string | null;
  user?: { login: string } | null;
  issue_url?: string;
  pull_request_url?: string;
}
interface ApiIssue {
  number: number;
  title: string;
  created_at: string;
  body?: string | null;
  user?: { login: string } | null;
  pull_request?: unknown;
}

const label = (name: string) => encodeURIComponent(name);

/** One issue event (labelled, closed...) as an action, or null when it isn't an agent's or can't be undone. */
export function fromEvent(e: ApiEvent, repo: string): Action | null {
  if (!byBot(e.actor?.login) || !e.issue) return null;
  const n = e.issue.number;
  const base = `/repos/${repo}/issues/${n}`;
  const undo: Undo | undefined = {
    labeled: e.label && { method: "DELETE" as const, path: `${base}/labels/${label(e.label.name)}` },
    unlabeled: e.label && { method: "POST" as const, path: `${base}/labels`, body: { labels: [e.label.name] } },
    closed: { method: "PATCH" as const, path: base, body: { state: "open" } },
    reopened: { method: "PATCH" as const, path: base, body: { state: "closed" } },
    renamed: e.rename && { method: "PATCH" as const, path: base, body: { title: e.rename.from } },
  }[e.event];
  if (!undo) return null;
  const what = e.label ? `${e.event} ${e.label.name}` : e.rename ? `renamed from "${e.rename.from}"` : e.event;
  return { id: `event-${e.id}`, at: e.created_at, n, kind: e.issue.pull_request ? "pr" : "issue", what, undo };
}

/** An issue/PR comment or a PR line comment as an action, or null when it isn't an agent's. */
export function fromComment(c: ApiComment, repo: string, line = false): Action | null {
  if (!byBot(c.user?.login) && !hasMarker(c.body ?? "")) return null;
  const n = Number((line ? c.pull_request_url : c.issue_url)?.split("/").pop());
  const first = stripMarker(c.body ?? "").replace(/\s+/g, " ").trim().slice(0, 90);
  const api = line ? "pulls/comments" : "issues/comments";
  return {
    id: `${line ? "line" : "comment"}-${c.id}`,
    at: c.created_at,
    n,
    kind: line ? "pr" : "issue",
    what: `${line ? "line comment" : "comment"}: ${first}`,
    undo: { method: "DELETE", path: `/repos/${repo}/${api}/${c.id}` },
  };
}

/** An issue or PR the agents opened, or null. Undo closes it (an issue as "not planned"). */
export function fromIssue(i: ApiIssue, repo: string, from: Date): Action | null {
  if (!byBot(i.user?.login) && !hasMarker(i.body ?? "")) return null;
  if (new Date(i.created_at) < from) return null;
  const pr = Boolean(i.pull_request);
  return {
    id: `opened-${i.number}`,
    at: i.created_at,
    n: i.number,
    kind: pr ? "pr" : "issue",
    what: `opened ${pr ? "PR" : "issue"}: ${i.title}`,
    undo: pr
      ? { method: "PATCH", path: `/repos/${repo}/pulls/${i.number}`, body: { state: "closed" } }
      : { method: "PATCH", path: `/repos/${repo}/issues/${i.number}`, body: { state: "closed", state_reason: "not_planned" } },
  };
}

/** Issues where a cloud run (posting as the owner, with the marker) commented: check those by hand. */
export function unseen(comments: ApiComment[]): number[] {
  const ns = comments.filter((c) => !byBot(c.user?.login) && hasMarker(c.body ?? "")).map((c) => Number(c.issue_url?.split("/").pop()));
  return [...new Set(ns)].sort((a, b) => a - b);
}

/** The agents' actions since `from`, newest first. */
export async function activity(gh: GitHub, repo: string, from: Date): Promise<Activity> {
  const iso = from.toISOString();
  // Issue events come newest first: stop at the first page that reaches back past `from` (at most 10 pages).
  const events: ApiEvent[] = [];
  for (let page = 1; page <= 10; page++) {
    const got = await gh.get<ApiEvent[]>(`/repos/${repo}/issues/events?per_page=100&page=${page}`);
    events.push(...got);
    if (got.length < 100 || new Date(got[got.length - 1].created_at) < from) break;
  }
  const [comments, lines, issues] = await Promise.all([
    gh.all<ApiComment>(`/repos/${repo}/issues/comments?since=${iso}`),
    gh.all<ApiComment>(`/repos/${repo}/pulls/comments?since=${iso}`),
    gh.all<ApiIssue>(`/repos/${repo}/issues?state=all&since=${iso}`),
  ]);
  const recent = comments.filter((c) => new Date(c.created_at) >= from);
  const actions = [
    ...events.map((e) => fromEvent(e, repo)),
    ...recent.map((c) => fromComment(c, repo)),
    ...lines.filter((c) => new Date(c.created_at) >= from).map((c) => fromComment(c, repo, true)),
    ...issues.map((i) => fromIssue(i, repo, from)),
  ]
    .filter((a): a is Action => a !== null && new Date(a.at) >= from)
    .sort((a, b) => b.at.localeCompare(a.at));
  return { since: iso, actions, unseen: unseen(recent) };
}
