// Auto-merge: the owner doesn't review or merge factory PRs. The dispatcher merges one,
// as the app, once all of these hold on its latest commit:
//   - the reviewer passed it ("ready", after any polish) and said it's safe to merge by itself;
//   - CI is green, device tests included, and nothing is still running;
//   - GitHub says it merges cleanly;
//   - nobody put needs-owner, hold or factory-stop on it or its card, and auto-merge is on (Settings).
//     needs-owner on an otherwise mergeable PR gets the owner's-call line below, so it never waits silently.
// Some changes are always the owner's call, whatever the reviewer says: workflows and secrets (RISKY), and
// the paths the install lists on Settings › Install (an app's updater, signing, permissions). Then the card
// gets `needs-owner` and one line saying why, once per commit. After a merge, done.ts posts the Done line and closes the card.
import type { Ctx } from "./dispatch.ts";
import { laneOn, stopSwitch } from "./dispatch.ts";
import { ciState, checksOf, type Check } from "./done.ts";
import { install, riskyPath } from "./install.ts";
import { loadConfig } from "./project.ts";
import type { MergeCall } from "./state.ts";

/** Files whose change is always the owner's call in every project: CI and release workflows (they run with
 *  the repo's secrets) and secrets or keys. Each project adds its own on Settings › Install (riskyPaths). */
export const RISKY: { re: RegExp; why: string }[] = [
  { re: /^\.github\/workflows\//, why: "it changes a GitHub workflow (they run with the repo's secrets)" },
  { re: /secret|\.env($|\.)|\.(pfx|p12|pem|key|snk)$/i, why: "it touches secrets or keys" },
];

/** Why a change to these files is the owner's call, or undefined when it isn't. Built-ins first. Pure. */
export function riskyWhy(files: string[], globs: string[]): string | undefined {
  const builtIn = RISKY.find((r) => files.some((file) => r.re.test(file)));
  if (builtIn) return builtIn.why;
  for (const g of globs) {
    let re: RegExp;
    try {
      re = riskyPath(g);
    } catch {
      return `Settings › Install's risky path "${g}" can't be read, so nothing merges by itself until it's fixed`; // fail closed
    }
    const file = files.find((f) => re.test(f));
    if (file) return `it changes ${file}, which Settings › Install lists as the owner's call (${g})`;
  }
  return undefined;
}

const BLOCKING = ["needs-owner", "hold", "factory-stop"];

export interface MergeFacts {
  on: boolean;
  draft: boolean;
  headSha: string;
  /** The reviewer's last posted verdict, and the commit it was for. */
  verdict?: string;
  verdictSha?: string;
  call?: MergeCall;
  labels: string[];
  cardLabels: string[];
  files: string[];
  /** Settings › Install's risky-path globs, on top of RISKY. */
  riskyPaths: string[];
  checks: Check[];
  mergeable: boolean | null;
  mergeableState: string;
}

export type Decision = { action: "merge" } | { action: "wait"; why: string } | { action: "owner"; why: string };

/** What to do with a factory PR now. Pure. */
export function mergeDecision(f: MergeFacts): Decision {
  if (!f.on) return { action: "wait", why: "auto-merge is off" };
  if (f.draft) return { action: "wait", why: "it's a draft" };
  const blocked = [...f.labels, ...f.cardLabels].find((l) => BLOCKING.includes(l) && l !== "needs-owner");
  if (blocked) return { action: "wait", why: `it has ${blocked}` };
  // needs-owner is a question to the owner, often an older one (a question from a few commits back could
  // otherwise keep a ready PR waiting for days, silently). It still never merges by itself, but says so once.
  const asked = f.labels.includes("needs-owner") ? "it" : f.cardLabels.includes("needs-owner") ? "its card" : "";
  if (f.verdict !== "ready" || f.verdictSha !== f.headSha) return { action: "wait", why: "the reviewer hasn't passed this commit" };
  const risky = riskyWhy(f.files, f.riskyPaths);
  if (risky) return { action: "owner", why: risky };
  // Reviewed before the reviewer made merge calls (or the call is for an older commit): wait for a review that does.
  if (!f.call || f.call.sha !== f.headSha) return { action: "wait", why: "the review has no merge call for this commit" };
  if (!f.call.ok) return { action: "owner", why: f.call.why };
  const ci = ciState(f.checks);
  if (ci.failed.length) return { action: "wait", why: `CI failed: ${ci.failed.join(", ")}` }; // ci.ts sends the builder
  if (ci.going.length) return { action: "wait", why: `CI is still running: ${ci.going.join(", ")}` };
  if (!ci.green) return { action: "wait", why: "no CI has run on it yet" };
  if (f.mergeable === null) return { action: "wait", why: "GitHub is still working out if it merges" };
  if (!f.mergeable || f.mergeableState === "dirty") return { action: "wait", why: "it has merge conflicts" }; // resume.ts fixes those
  if (!["clean", "has_hooks"].includes(f.mergeableState)) return { action: "wait", why: `GitHub says it's ${f.mergeableState}` };
  if (asked) return { action: "owner", why: `${asked} still has needs-owner, from an earlier question to you (take the label off once that's settled)` };
  return { action: "merge" };
}

interface ApiPull {
  number: number;
  title: string;
  draft: boolean;
  head: { ref: string; sha: string };
  labels: { name: string }[];
  mergeable: boolean | null;
  mergeable_state: string;
}

const cardOf = (ref: string) => Number(ref.match(/^claude\/issue-(\d+)-/)?.[1]) || null;
const isFactory = (p: { head: { ref: string }; labels: { name: string }[] }) => /^claude\/issue-\d+-/.test(p.head.ref) || p.labels.some((l) => l.name === "factory");

/** The serve loop's step: merges each factory PR that's ready, or tells the owner why it can't. */
export async function checkAutoMerge(ctx: Ctx): Promise<void> {
  const { gh, state, log, repo } = ctx;
  if (!state.autoMerge() || state.pause()) return;
  // Merges go with the reviewer: a dry reviewer lane means a dry factory, so nothing merges either.
  const reviewer = (await loadConfig(gh, repo)).lanes.find((l) => l.kind === "reviewer");
  if (!reviewer || !laneOn(state, reviewer) || !state.lane(reviewer.name).live) return;
  const open = (await gh.all<{ number: number; draft: boolean; head: { ref: string; sha: string }; labels: { name: string }[] }>(`/repos/${repo}/pulls?state=open`)).filter(
    (p) => !p.draft && isFactory(p) && state.lastVerdict(p.number) === "ready" && state.heldFor(p.number) !== p.head.sha,
  );
  if (!open.length) return;
  if (await stopSwitch(ctx)) return;
  for (const o of open) {
    if (ctx.slots?.holds(cardOf(o.head.ref), o.number, repo)) continue; // a run is still changing it
    try {
      const p = await gh.get<ApiPull>(`/repos/${repo}/pulls/${o.number}`); // mergeable is only on the single PR
      const card = cardOf(p.head.ref);
      const cardLabels = card ? (await gh.get<{ labels: { name: string }[] }>(`/repos/${repo}/issues/${card}`)).labels.map((l) => l.name) : [];
      const files = (await gh.all<{ filename: string }>(`/repos/${repo}/pulls/${p.number}/files`)).map((f) => f.filename);
      const review = state.lastReview(p.number);
      const d = mergeDecision({
        on: true,
        draft: p.draft,
        headSha: p.head.sha,
        verdict: review?.verdict,
        verdictSha: review?.sha,
        call: state.mergeCall(p.number),
        labels: p.labels.map((l) => l.name),
        cardLabels,
        files,
        riskyPaths: install().riskyPaths,
        checks: await checksOf(ctx, p.head.sha),
        mergeable: p.mergeable,
        mergeableState: p.mergeable_state,
      });
      if (d.action === "wait") continue;
      if (d.action === "owner") {
        state.markHeld(p.number, p.head.sha);
        await gh.send("POST", `/repos/${repo}/issues/${p.number}/comments`, { body: `🤖 **Not merging this one by myself:** ${d.why}. It's ready otherwise; merge it if that's fine.` });
        if (card) await gh.send("POST", `/repos/${repo}/issues/${card}/labels`, { labels: ["needs-owner"] });
        log(`automerge: PR #${p.number} is the owner's call (${d.why})`);
        continue;
      }
      const res = await gh.request("PUT", `/repos/${repo}/pulls/${p.number}/merge`, { merge_method: "merge", sha: p.head.sha, commit_title: `Merge pull request #${p.number} from ${p.head.ref}` });
      if (!res.ok) {
        log(`automerge: GitHub refused to merge PR #${p.number} (${res.status} ${res.text.slice(0, 160)})`);
        continue;
      }
      log(`automerge: merged PR #${p.number} ${p.title}`);
      await gh.send("DELETE", `/repos/${repo}/git/refs/heads/${p.head.ref.split("/").map(encodeURIComponent).join("/")}`).catch(() => {});
    } catch (e) {
      log(`automerge: couldn't check PR #${o.number} (${(e as Error).message})`);
    }
  }
}
