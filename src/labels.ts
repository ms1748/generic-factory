// The labels the factory reads and writes on a project's issues and PRs: the build queue (src/queue.ts),
// the stop switch, the reviewer, auto-merge and the agents' prompts. `init-project` creates them on a new
// repo (src/starter.ts); test/starter.test.ts checks the queue's own labels are all here.

export interface Label {
  name: string;
  /** Hex colour without the `#`, as GitHub takes it. */
  color: string;
  description: string;
}

export const LABELS: Label[] = [
  { name: "ready", color: "0e8a16", description: "Queued for the factory builder" },
  { name: "p1", color: "d73a4a", description: "Build first" },
  { name: "p2", color: "fbca04", description: "Build after p1" },
  { name: "p3", color: "c5def5", description: "Build after p2" },
  { name: "size:S", color: "c2e0c6", description: "Small: the small builder" },
  { name: "size:M", color: "bfd4f2", description: "Medium: the builder" },
  { name: "size:L", color: "d4c5f9", description: "Large: the builder, may ship in slices" },
  { name: "size:XL", color: "f9d0c4", description: "Too big: split into smaller issues first" },
  { name: "building", color: "5319e7", description: "The builder is working on it" },
  { name: "review", color: "1d76db", description: "PR open, waiting for review" },
  { name: "reviewed", color: "0e8a16", description: "The factory's reviewer passed this PR" },
  { name: "needs-owner", color: "e99695", description: "The factory has a question" },
  { name: "hold", color: "bfdadc", description: "Don't build this yet" },
  { name: "idea", color: "c5def5", description: "Idea, not decided yet" },
  { name: "feature", color: "1d76db", description: "New feature" },
  { name: "fix", color: "d73a4a", description: "Something to fix" },
  { name: "chore", color: "fbca04", description: "Housekeeping" },
  { name: "security", color: "b60205", description: "Security" },
  { name: "needs-hardware-test", color: "0e8a16", description: "Built; needs a real run on the owner's machines" },
  { name: "factory", color: "c5def5", description: "Made by the factory" },
  { name: "factory-stop", color: "000000", description: "On any open issue: every factory agent stops" },
];

/** The labels a repo with these label names still lacks. GitHub matches label names without case. */
export function missingLabels(existing: string[]): Label[] {
  const have = new Set(existing.map((n) => n.toLowerCase()));
  return LABELS.filter((l) => !have.has(l.name.toLowerCase()));
}
