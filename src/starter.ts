// The starter kit for a new project (`init-project <owner/repo>`): the factory's labels on the repo, and a
// PR adding the template prompts and `.factory.yml` from templates/project/. Files the repo already has and
// labels it already has are left alone. The owner then fills in the `[FILL IN: ...]` placeholders.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_PROMPT_DIR } from "./config.ts";
import type { GitHub } from "./github.ts";
import { missingLabels, type Label } from "./labels.ts";
import { loadConfig } from "./project.ts";
import { MARKER } from "./activity.ts";

export const TEMPLATE_DIR = join(import.meta.dirname, "..", "templates", "project");
export const STARTER_BRANCH = "factory/starter-kit";
const PLACEHOLDER = /\[FILL IN:/g;

export interface StarterFile {
  /** Where it goes in the project repo. */
  path: string;
  content: string;
}

/** A template with the repo and prompt folder filled in. */
export const render = (text: string, repo: string, promptDir: string) => text.replaceAll("{{REPO}}", repo).replaceAll("{{PROMPT_DIR}}", promptDir);

/** Every file the kit adds, rendered for `repo`: the prompts under `promptDir`, and `.factory.yml`. */
export function starterFiles(repo: string, promptDir = DEFAULT_PROMPT_DIR, dir = TEMPLATE_DIR): StarterFile[] {
  const prompts = readdirSync(join(dir, "prompts"))
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => ({ path: `${promptDir}/${f}`, content: render(readFileSync(join(dir, "prompts", f), "utf8"), repo, promptDir) }));
  return [...prompts, { path: ".factory.yml", content: render(readFileSync(join(dir, ".factory.yml"), "utf8"), repo, promptDir) }];
}

/** How many `[FILL IN: ...]` placeholders a file has left. */
export const placeholders = (text: string) => text.match(PLACEHOLDER)?.length ?? 0;

/** The starter PR's body: what it adds and what the owner fills in. */
export function prBody(added: StarterFile[], skipped: string[]): string {
  return [
    "Adds the factory's starter kit: the agents' prompt files and `.factory.yml`.",
    "",
    "**Before merging:** search these files for `[FILL IN:` and replace each with this project's details (what it is, the checks that must pass, its conventions), then delete the `<!-- Starter kit ... -->` comments. Keep the parts marked \"(the dispatcher relies on this)\": the factory's queue reads them.",
    "",
    ...added.map((f) => `- \`${f.path}\`: ${placeholders(f.content) || "no"} placeholder${placeholders(f.content) === 1 ? "" : "s"}`),
    ...(skipped.length ? ["", `Already here, left alone: ${skipped.map((p) => `\`${p}\``).join(", ")}.`] : []),
    "",
    "Every lane stays dry until it's switched on from the factory's dashboard.",
    "",
    MARKER,
  ].join("\n");
}

const REPO = /^[\w.-]+\/[\w.-]+$/;
const urlPath = (p: string) => p.split("/").map(encodeURIComponent).join("/");

/** Creates the missing labels and opens the starter PR on `repo`; with `print`, only says what it would do. */
export async function initProject(gh: GitHub, repo: string, print: boolean, out: (line: string) => void): Promise<void> {
  if (!REPO.test(repo)) throw new Error(`"${repo}" isn't owner/name.`);
  const info = await gh.maybe<{ default_branch: string }>(`/repos/${repo}`);
  if (!info) throw new Error(`Can't see ${repo}: install the factory's GitHub App on it first.`);
  const base = info.default_branch;

  const labels = missingLabels((await gh.all<{ name: string }>(`/repos/${repo}/labels`)).map((l) => l.name));
  if (!labels.length) out("Labels: all there.");
  for (const l of labels) {
    if (!print) await createLabel(gh, repo, l);
    out(`Label ${l.name}: ${print ? "would create" : "created"}`);
  }

  // 409 for an empty repo, 404 for a default branch with no commits.
  const ref = await gh.request("GET", `/repos/${repo}/git/ref/heads/${urlPath(base)}`);
  if (ref.status !== 404 && ref.status !== 409 && !ref.ok) throw new Error(`GitHub ${ref.status} reading ${base}: ${ref.text.slice(0, 200)}`);
  if (!ref.ok) throw new Error(`${repo} has no commits on ${base} yet: push a first commit (a README is enough) and run this again.`);
  // A repo with its own .factory.yml keeps its prompt folder.
  const { promptDir } = await loadConfig(gh, repo);
  const files = starterFiles(repo, promptDir);
  const added: StarterFile[] = [];
  const skipped: string[] = [];
  for (const f of files) {
    if (await gh.maybe(`/repos/${repo}/contents/${urlPath(f.path)}?ref=${encodeURIComponent(base)}`)) skipped.push(f.path);
    else added.push(f);
  }
  for (const p of skipped) out(`${p}: already there, left alone`);
  if (!added.length) return out("Files: all there, no PR needed.");
  if (print) {
    for (const f of added) out(`\n----- ${f.path} (${placeholders(f.content)} to fill in) -----\n${f.content}`);
    return out(`\nWould open a PR from ${STARTER_BRANCH} adding ${added.length} file${added.length === 1 ? "" : "s"}.`);
  }

  if (await gh.maybe(`/repos/${repo}/git/ref/heads/${STARTER_BRANCH}`)) {
    throw new Error(`${repo} already has a ${STARTER_BRANCH} branch (an earlier starter PR?): merge or close that PR and delete the branch, then run this again.`);
  }
  await must(gh.request("POST", `/repos/${repo}/git/refs`, { ref: `refs/heads/${STARTER_BRANCH}`, sha: (JSON.parse(ref.text) as { object: { sha: string } }).object.sha }), "creating the branch");
  let pr: { number: number; html_url: string };
  try {
    for (const f of added) {
      const body = { message: `Factory starter kit: ${f.path}`, content: Buffer.from(f.content).toString("base64"), branch: STARTER_BRANCH };
      await must(gh.request("PUT", `/repos/${repo}/contents/${urlPath(f.path)}`, body), `adding ${f.path}`);
    }
    pr = JSON.parse(
      await must(gh.request("POST", `/repos/${repo}/pulls`, { title: "Factory starter kit: prompts and .factory.yml", head: STARTER_BRANCH, base, body: prBody(added, skipped) }), "opening the PR"),
    ) as { number: number; html_url: string };
  } catch (e) {
    // No PR yet: remove the branch this run just made, so running it again starts clean.
    const gone = await gh.request("DELETE", `/repos/${repo}/git/refs/heads/${STARTER_BRANCH}`).catch(() => ({ ok: false }));
    const next = gone.ok ? "Nothing was left behind; run this again." : `Delete the ${STARTER_BRANCH} branch on ${repo}, then run this again.`;
    throw new Error(`${(e as Error).message}\n${next}`);
  }
  await must(gh.request("POST", `/repos/${repo}/issues/${pr.number}/labels`, { labels: ["factory"] }), "labelling the PR");
  out(`Opened ${pr.html_url}: fill in its [FILL IN: ...] placeholders, then merge it.`);
}

async function must(p: Promise<{ ok: boolean; status: number; text: string }>, what: string): Promise<string> {
  const res = await p;
  if (!res.ok) throw new Error(`GitHub ${res.status} ${what}: ${res.text.slice(0, 200)}`);
  return res.text;
}

async function createLabel(gh: GitHub, repo: string, l: Label): Promise<void> {
  const res = await gh.request("POST", `/repos/${repo}/labels`, l);
  // 422: it was made in the meantime (or differs only in case). Either way it's there.
  if (!res.ok && res.status !== 422) throw new Error(`Label ${l.name}: GitHub ${res.status} ${res.text.slice(0, 200)}`);
}
