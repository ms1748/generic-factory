// Visual proof on website PRs (Settings › Budget › Before/after screenshots, off by default). When the
// reviewer hands a PR that touches the website or UI files to the owner, a short script in the agent image
// (agent/shots.mjs, Playwright's Chromium) shoots the pages the reviewer named on production (before) and
// on the PR's Pages preview (after), at desktop and phone width. It runs in its own container with no
// GitHub token and no model. The dispatcher uploads the images to one pre-release in the project repo
// (RELEASE_TAG: GitHub has no API for comment attachments; release assets stay out of git and out of every
// clone) and posts one comment with them side by side. Only while the reviewer lane is live.
import type { Ctx } from "./dispatch.ts";
import { install } from "./install.ts";
import { MARKER } from "./queue.ts";
import { runShots } from "./runner.ts";

/** The pre-release that holds every PR's screenshots. Never "latest", so an updater never sees it. */
export const RELEASE_TAG = "factory-screenshots";
/** At most this many pages per PR: 2 widths x 2 sides each, so 12 shots, well under a minute. */
export const MAX_PAGES = 3;

export interface Device {
  name: string;
  width: number;
  height: number;
  mobile: boolean;
}

export const DEVICES: Device[] = [
  { name: "desktop", width: 1280, height: 800, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
];

/** What agent/shots.mjs is given (as FACTORY_SHOTS). */
export interface ShotSpec {
  before: string;
  after: string;
  pages: string[];
  devices: Device[];
}

/** One line of agent/shots.mjs's output: a PNG (base64), or why there isn't one. */
export interface Shot {
  page: string;
  device: string;
  side: "before" | "after";
  png?: string;
  error?: string;
}

const UI_FILE = /\.(svelte|vue|tsx|jsx|html|css|scss)$/i;

/** Whether a PR's files change how a page looks: anything under `website/`, or UI files under `src/`. */
export function touchesUi(files: string[]): boolean {
  return files.some((f) => f.startsWith("website/") || (f.startsWith("src/") && UI_FILE.test(f)));
}

/** A branch's Cloudflare Pages preview alias: lower case, anything else than a-z and 0-9 as `-`, 28 characters. */
export function previewAlias(branch: string): string {
  return branch
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .slice(0, 28);
}

const PATH = /^\/[A-Za-z0-9._~\-/]*$/;

/** The site paths to shoot: the reviewer's, when they're plain paths (no host, query or `..`), else the home page. */
export function shotPages(named: string[]): string[] {
  const ok = named.map((p) => p.trim()).filter((p) => p.length <= 100 && PATH.test(p) && !p.startsWith("//") && !p.split("/").includes(".."));
  const pages = [...new Set(ok)].slice(0, MAX_PAGES);
  return pages.length ? pages : ["/"];
}

/** The spec for a PR on its branch, or undefined when the install has no previews. */
export function shotSpec(branch: string, pages: string[], previewHost = install().previewHost): ShotSpec | undefined {
  if (!previewHost) return undefined;
  return { before: `https://${previewHost}`, after: `https://${previewAlias(branch)}.${previewHost}`, pages, devices: DEVICES };
}

/** A shot's file name on the release: unique per run, readable in the release's asset list. */
export function assetName(pr: number, runId: number, s: Pick<Shot, "page" | "device" | "side">): string {
  const page = s.page.replace(/^\/+|\/+$/g, "").replace(/[^A-Za-z0-9]+/g, "-").slice(0, 40) || "home";
  return `pr${pr}-run${runId}-${page}-${s.device}-${s.side}.png`;
}

/** The PR comment: per page, a Before/After table with a row per width. `urls` holds each uploaded shot's image link. */
export function shotsComment(spec: ShotSpec, shots: Shot[], urls: Map<Shot, string>, seconds: number): string {
  const cell = (page: string, device: Device, side: Shot["side"]) => {
    const s = shots.find((x) => x.page === page && x.device === device.name && x.side === side);
    const url = s && urls.get(s);
    // Linked too: if GitHub can't show the image inline, the link still opens it.
    if (url) return `<a href="${url}"><img src="${url}" width="${device.mobile ? 200 : 400}" alt="${side}, ${device.name}"></a>`;
    return `_no image: ${(s?.error ?? "not taken").replace(/[|\n]/g, " ").slice(0, 120)}_`;
  };
  const lines = ["🤖 **Factory:** Before and after: production on the left, this PR's preview on the right.", ""];
  for (const page of spec.pages) {
    lines.push(`**\`${page}\`**`, "", "| | Before | After |", "| --- | --- | --- |");
    for (const d of spec.devices) lines.push(`| ${d.name === "phone" ? "Phone" : "Desktop"} | ${cell(page, d, "before")} | ${cell(page, d, "after")} |`);
    lines.push("");
  }
  lines.push(`<sub>${spec.devices.map((d) => `${d.name} ${d.width}px`).join(", ")}; taken in ${Math.round(seconds)} s.</sub>`, MARKER);
  return lines.join("\n");
}

interface Release {
  id: number;
  upload_url: string;
}

/** The screenshots release, created as a pre-release (never "latest") the first time. */
async function release(ctx: Ctx): Promise<Release> {
  const found = await ctx.gh.maybe<Release>(`/repos/${ctx.repo}/releases/tags/${RELEASE_TAG}`);
  if (found) return found;
  const r = await ctx.gh.request("POST", `/repos/${ctx.repo}/releases`, {
    tag_name: RELEASE_TAG,
    name: "Factory screenshots",
    body: "Before/after screenshots for the factory's website PRs, linked from each PR's comment. Not a release of the app.",
    prerelease: true,
    make_latest: "false",
  });
  if (!r.ok) throw new Error(`couldn't create the ${RELEASE_TAG} release: GitHub ${r.status} ${r.text.slice(0, 200)}`);
  return JSON.parse(r.text) as Release;
}

/**
 * Shoots, uploads and comments for one PR the reviewer just handed to the owner. Does nothing when the
 * switch is off, the PR doesn't touch UI files or the install has no previews. Never throws: a failure is
 * logged and the review goes on as before.
 */
export async function postShots(ctx: Ctx, pr: { number: number; ref: string }, named: string[], runId: number): Promise<void> {
  const { gh, state, log, repo } = ctx;
  if (!state.shotsOn()) return;
  try {
    const files = (await gh.all<{ filename: string }>(`/repos/${repo}/pulls/${pr.number}/files`)).map((f) => f.filename);
    if (!touchesUi(files)) return;
    const spec = shotSpec(pr.ref, shotPages(named));
    if (!spec) return log(`shots: PR #${pr.number} touches UI files, but Settings › Install has no preview host`);
    const t0 = Date.now();
    const shots = await runShots(runId, spec, log);
    const seconds = (Date.now() - t0) / 1000;
    if (!shots.some((s) => s.png)) return log(`shots: PR #${pr.number}: no screenshots (${shots[0]?.error ?? "the script gave nothing"})`);
    const rel = await release(ctx);
    const urls = new Map<Shot, string>();
    for (const s of shots) {
      if (!s.png) continue;
      const a = await gh.upload(rel.upload_url, assetName(pr.number, runId, s), Buffer.from(s.png, "base64"), "image/png");
      urls.set(s, a.browser_download_url);
    }
    await gh.send("POST", `/repos/${repo}/issues/${pr.number}/comments`, { body: shotsComment(spec, shots, urls, seconds) });
    log(`shots: PR #${pr.number}: ${urls.size} of ${shots.length} screenshots posted (${Math.round(seconds)} s)`);
  } catch (e) {
    log(`shots: PR #${pr.number}: ${(e as Error).message}`);
  }
}
