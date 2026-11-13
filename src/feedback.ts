// What the owner has said on a factory PR since its session last ran. Pure: no I/O.
import { isAgent } from "./queue.ts";

export interface PrItem {
  /** "card comment": on the issue the PR is building, where the owner answers the agent's questions. */
  kind: "comment" | "line comment" | "review" | "card comment";
  author: string;
  body: string;
  at: string; // ISO time
  /** Line comments: where. Reviews: the state (CHANGES_REQUESTED, ...). */
  where?: string;
}

/**
 * The owner's items after `handledAt` that no agent item follows. Only the repo owner's account counts;
 * agent comments (marker, footer or a bot account) never do, and empty "Comment" reviews (the wrapper
 * around line comments) and bare approvals carry nothing to act on.
 */
export function newFeedback(items: PrItem[], owner: string, handledAt: string): PrItem[] {
  const sorted = [...items].sort((a, b) => a.at.localeCompare(b.at));
  const lastAgent = sorted.filter((i) => isAgent(i)).at(-1)?.at ?? "";
  return sorted.filter(
    (i) =>
      i.author === owner &&
      !isAgent(i) &&
      i.at > handledAt &&
      i.at > lastAgent &&
      (i.body.trim() !== "" || i.where === "CHANGES_REQUESTED"),
  );
}

export function describe(items: PrItem[]): string {
  return items
    .map((i) => {
      const label = i.kind === "review" ? `review (${(i.where ?? "").toLowerCase().replace("_", " ")})` : i.where ? `${i.kind} on ${i.where}` : i.kind;
      const body = i.body.length > 4000 ? i.body.slice(0, 4000) + " […]" : i.body;
      return `- [${label}, ${i.at}]\n${body.replace(/^/gm, "  > ")}`;
    })
    .join("\n");
}
