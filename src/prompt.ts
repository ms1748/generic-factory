// The prompt a lane's Claude session starts with: the project's own prompt file plus the homelab notes
// that replace the cloud-only parts (GitHub MCP tools, PR subscriptions). The notes name this install's app,
// dashboard, previews and repo from Settings › Install, and leave out what isn't set.
import { DEFAULT_PROMPT_DIR, type Lane } from "./config.ts";
import { install, type Install } from "./install.ts";
import { MARKER, type Pick } from "./queue.ts";

export function lanePrompt(lane: Lane, repo: string, pick?: Pick, skills = false, promptDir = DEFAULT_PROMPT_DIR): string {
  const lines = [
    `You are the factory's "${lane.name}" lane (${lane.kind}), running headless on the owner's homelab for ${repo}.`,
    "The repo is cloned at /work/repo, on main.",
    "",
    `Follow \`${lane.prompt}\` in the repo, together with \`${promptDir}/common.md\`.`,
  ];
  if (lane.kind === "builder") {
    const sizes = lane.sizes.map((s) => (s === "none" ? "unsized" : `size:${s}`)).join(", ");
    lines.push(`Your lane builds ${sizes} cards${lane.splits.length ? ` and splits ${lane.splits.map((s) => "size:" + s).join(", ")} cards` : ""}.`);
    if (pick?.card) {
      const c = pick.card;
      const what = pick.action === "split" ? "split it (it's too big to build directly)" : pick.action === "continue" ? `continue it on its draft PR #${c.draftPr}` : "build it";
      lines.push(
        `The dispatcher already applied the queue rules: your card is #${c.number} ("${c.title}"); ${what}.`,
        "If it no longer qualifies when you look (labels changed, a PR appeared), stop and say why.",
      );
    }
  }
  lines.push("", ...homelabNotes(skills, install(), repo));
  return lines.join("\n");
}

const SKILLS_NOTE = "- This image has two skills on trial: use `ponytail` (full level) for all coding work, and `impeccable` for any UI or website work (design, review, polish).";
/** The notes for a run on `repo`. A run on the factory's own repo doesn't get the "factory is out of reach" note. */
export const homelabNotes = (skills = false, i: Install = install(), repo = "") =>
  notes(i).filter((l) => (skills || l !== SKILLS_NOTE) && !(repo && repo === i.factoryRepo && l.startsWith(FACTORY_NOTE)));

const FACTORY_NOTE = "- The factory itself";

const host = (url: string) => url.replace(/^https?:\/\//, "");

const notes = (i: Install) => [
  "Homelab notes (these override the prompt files where they differ):",
  `- \`gh\` and \`git\` are already signed in as ${i.apps[0] ? `the ${i.apps[0]} GitHub App` : "the factory's GitHub App"}, for this repo only, and the token refreshes itself. Don't run any GitHub token script the prompt files mention (a \`gh-app-token\` script or the like). Do every GitHub action with \`gh\`; there are no GitHub MCP tools here.`,
  "- Don't subscribe to PR activity and don't schedule anything. End the run once your work is pushed. When the owner comments on your PR, the dispatcher resumes this same session.",
  "- Never wait for CI: no loops or background tasks that poll checks, no `gh pr checks --watch` or `gh run watch`. Push, write the summary, and end. If CI goes red on your latest commit, the dispatcher resumes this same session with the failed checks and their error lines.",
  "- This image has two skills on trial: use `ponytail` (full level) for all coding work, and `impeccable` for any UI or website work (design, review, polish).",
  ...(i.previewHost
    ? [
        `- The website's previews (*.${i.previewHost}, linked on each PR) are behind Cloudflare Access. If CF_ACCESS_CLIENT_ID is set, open them with the headers \`CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID\` and \`CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET\` (curl -H, or extraHTTPHeaders in a browser) to check your change on the real deploy. Never print or commit those values.`,
      ]
    : []),
  `- The factory itself (this dispatcher, its dashboard${i.dashboardUrl ? ` at ${host(i.dashboardUrl)}` : ""}, the lanes, the stop switch, the reviewer) lives in ${i.factoryRepo ? `the \`${i.factoryRepo}\` repo` : "its own repo"}, which you can't see or change from here. The dashboard already has Pause/Resume, lane switches, Build now, Hold/Requeue and a paid-credits switch, and the dispatcher won't start runs while \`factory-stop\` is on. When a card asks for a factory-side change, do this repo's part, then put the factory part under the PR's Follow-ups as "Factory side${i.factoryRepo ? ` (${i.factoryRepo})` : ""}: ..." with a short spec; the owner's own Claude session builds it. Don't ask the owner where the factory code lives.`,
  "- Keep what the owner reads short. A PR reply or issue comment opens with at most ~5 short lines: what changed or what you need, in plain words. Anything longer (point-by-point detail, check output, file lists, reasoning) goes in a `<details><summary>Details</summary>` block after it. The PR body keeps its sections, but each gets a few lines; detail goes in its Details block.",
  "- Never ask the owner to run developer commands (cargo, npm, git, scripts). If a question needs their hardware, ask for one thing they can do in the app or a test build, in a sentence, or make it a card.",
  "- Commits use the git identity that's already set. End commit messages with `Co-Authored-By: Claude <your model name> <noreply@anthropic.com>`.",
  "- Finish with a short summary: what you did, any PR or issue links, and the check results.",
];

/** The message that resumes a PR's own session after the owner replied on it. */
export function resumePrompt(pr: number, branch: string, feedback: string, dispatcher = false): string {
  return [
    `${dispatcher ? "The dispatcher has news" : "The owner replied"} on your PR #${pr}. This is a fresh container: /work/repo is a new clone with your branch \`${branch}\` checked out.`,
    "",
    dispatcher ? "What happened since your last run (from the dispatcher, not the owner):" : "New from the owner since your last run:",
    feedback,
    "",
    "Act on it as the builder prompt's \"Keep going here\" says. Make the changes on the same branch (merge origin/main first if it conflicts), run the checks, and push.",
    "Then reply on the PR: a top-level reply with `gh pr comment`, and replies to line comments with",
    `\`gh api repos/{owner}/{repo}/pulls/${pr}/comments/<id>/replies -f body=...\`. Start each reply with "🤖 **Factory:**", end it with \`${MARKER}\`, and say what you changed: one short line per item, details folded in a \`<details>\` block.`,
    "If it's a question, answer it. If they ask for something big, do a coherent first part and say what's left. Never merge.",
    "",
    ...homelabNotes(),
  ].join("\n");
}

/** An idea as the auto-queue agent sees it (autoqueue.ts). */
export interface IdeaBrief {
  number: number;
  title: string;
  labels: string[];
  /** The start of the issue body. */
  excerpt: string;
}

/**
 * Auto-queue's selection prompt (autoqueue.ts): one short Sonnet run picks which open ideas the builders may
 * take. It only reads; the dispatcher adds `ready` and comments.
 */
export function autoQueuePrompt(repo: string, ideas: IdeaBrief[], max: number, queued: string[], closed: string[]): string {
  const list = (xs: string[]) => (xs.length ? xs.map((t) => `- ${t}`) : ["- (none)"]);
  return [
    `You are the factory's auto-queue for ${repo}. The build queue is nearly empty, so pick up to ${max} of the open ideas below for the builders to build next.`,
    "The builders are headless agents with a clone of the repo, `gh`, and the usual build and test tools, and nothing else: no real PC, controller, display or speakers, no accounts, and no say in product decisions.",
    "",
    "Skip an idea when any of these hold:",
    "- It needs the owner's hardware, accounts or judgement: checking something on a real PC, controller, monitor or test build by eye or hand; releases, signing, store pages, billing or payments; anything waiting on GitHub billing or another outside service; choices only the owner can make (naming, pricing, what to cut, design taste).",
    "- It's a \"someday\" item, or says it waits on something that isn't done yet.",
    "- It duplicates another idea in the list (keep the clearer one), or a card that's already queued or recently closed (both listed below).",
    "- It's too vague to build without asking, or too big for one PR (`size:XL`).",
    "Prefer small, self-contained, clearly worthwhile ideas (`size:S`, `size:M`); fixes and tests before polish. Picking fewer, or none, is fine.",
    "",
    "Change nothing on GitHub and don't edit files. The list below is all you need; read the repo or run `gh issue view <n>` only if an idea is unclear.",
    "End with a ```json block, last, and nothing after it:",
    '{"queue": [{"number": 123, "reason": "one short line: why it\'s worth building now"}]}',
    "",
    "Already queued or in progress (don't duplicate):",
    ...list(queued),
    "",
    "Recently closed (don't duplicate):",
    ...list(closed),
    "",
    `Open ideas (${ideas.length}):`,
    ...ideas.flatMap((i) => [`### #${i.number} ${i.title}`, `Labels: ${i.labels.join(", ") || "none"}`, i.excerpt || "(no description)", ""]),
  ].join("\n");
}
