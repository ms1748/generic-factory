// The reviewer's "later" items as `idea` issues, so follow-up ideas land on the board
// instead of being lost in a PR comment. The dispatcher files them, never the agent: one issue per item,
// skipping any whose title an open issue or a closed idea already has (or nearly has), at most MAX_PER_PR per PR across
// every review round. Each body carries a marker naming its PR, which is how later rounds find them again.
// The issues come from the app's bot, so Activity lists them with Undo (close).
import type { GitHub } from "./github.ts";

export const IDEA_LABEL = "idea";
/** Follow-up issues one PR may file, across all its review rounds. */
export const MAX_PER_PR = 5;

const marker = (pr: number) => `<!-- factory-later pr=${pr} -->`;
const MARKER_RE = /<!-- factory-later pr=(\d+) -->/;

/** A short issue title from a "later" item: its first sentence, without Markdown, at most 80 characters. */
export function followupTitle(item: string): string {
  const plain = item.replace(/[`*_]/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\s+/g, " ").trim();
  const first = plain.match(/^(.+?[.!?:])(\s|$)/)?.[1].replace(/[.:]$/, "") ?? plain;
  const t = first.length > 80 ? `${first.slice(0, 77).replace(/\s+\S*$/, "")}...` : first;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Lower case, letters and digits only: what two titles are compared by. */
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Whether two titles name the same idea: equal once normalized, or one contains the other (if long enough). */
export function sameIdea(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length < y.length ? [x, y] : [y, x];
  return short.length >= 20 && long.includes(short);
}

export interface OpenIssue {
  number: number;
  title: string;
  body?: string | null;
  /** "closed" for an idea the owner already closed: never filed again. */
  state?: string;
  pull_request?: unknown;
}

export interface Followup {
  item: string;
  title: string;
  /** The issue it's filed as (new, or the one already open), or undefined when over the cap or failed. */
  issue?: number;
  /** True when it already existed: filed by an earlier round, or an open issue with the same idea. */
  existing?: boolean;
  /** An idea issue with this idea was closed: it stays text and isn't filed again. */
  closed?: number;
}

/**
 * What to do with each "later" item: point it at an open issue with the same idea, or mark it to file
 * (issue undefined, existing false), up to the cap left for this PR. Pure; fileFollowups does the calls.
 */
export function planFollowups(items: string[], open: OpenIssue[], pr: number, cap = MAX_PER_PR): Followup[] {
  const issues = open.filter((i) => !i.pull_request);
  let left = cap - issues.filter((i) => Number(i.body?.match(MARKER_RE)?.[1]) === pr).length;
  const seen: string[] = [];
  const out: Followup[] = [];
  for (const item of items) {
    const title = followupTitle(item);
    if (!title || seen.some((s) => sameIdea(s, title))) continue; // the same idea twice in one list
    seen.push(title);
    const match = issues.find((i) => sameIdea(i.title, title));
    if (match?.state === "closed") out.push({ item, title, closed: match.number });
    else if (match) out.push({ item, title, issue: match.number, existing: true });
    else if (left > 0) {
      left--;
      out.push({ item, title, existing: false });
    } else out.push({ item, title });
  }
  return out;
}

/** The new issue's body: the idea, where it came from, and the marker. */
export function followupBody(item: string, pr: number, card: number | null): string {
  return [
    item.trim(),
    "",
    `_A follow-up idea from the factory reviewer on #${pr}${card ? ` (card #${card})` : ""}. It's on the board's Ideas column; label it \`ready\` (with a size) to build it, or close it._`,
    "",
    marker(pr),
  ].join("\n");
}

/** Files the PR's "later" items as idea issues. Never throws: an item that fails is left as text. */
export async function fileFollowups(
  gh: GitHub,
  repo: string,
  pr: number,
  card: number | null,
  items: string[],
  log: (m: string) => void,
): Promise<Followup[]> {
  if (!items.length) return [];
  let open: OpenIssue[];
  try {
    // Open issues to match against, plus closed ideas so a rejected one isn't filed again.
    const closed = await gh.all<OpenIssue>(`/repos/${repo}/issues?state=closed&labels=${IDEA_LABEL}`);
    open = [...(await gh.all<OpenIssue>(`/repos/${repo}/issues?state=open`)), ...closed.map((i) => ({ ...i, state: "closed" }))];
  } catch (e) {
    log(`followups: couldn't list issues on ${repo} (${(e as Error).message}); listing PR #${pr}'s ideas as text`);
    return items.map((item) => ({ item, title: followupTitle(item) }));
  }
  const plan = planFollowups(items, open, pr);
  for (const f of plan) {
    if (f.existing !== false) continue;
    try {
      const res = await gh.request("POST", `/repos/${repo}/issues`, { title: f.title, body: followupBody(f.item, pr, card), labels: [IDEA_LABEL] });
      if (!res.ok) throw new Error(`GitHub ${res.status}: ${res.text.slice(0, 200)}`);
      f.issue = (JSON.parse(res.text) as { number: number }).number;
      log(`followups: filed #${f.issue} "${f.title}" from PR #${pr}`);
    } catch (e) {
      log(`followups: couldn't file "${f.title}" from PR #${pr} (${(e as Error).message})`);
    }
  }
  return plan;
}
