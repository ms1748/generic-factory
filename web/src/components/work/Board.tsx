// The kanban: Up next, Building, In review, Done, then Waiting on you, Blocked and On hold when they have
// cards. Columns snap side to side on phones and sit in a grid on wider screens; each scrolls inside.
// Every card opens the details sheet; the ⋯ menu has its actions.
import * as React from "react";
import { GitPullRequestIcon, PackageIcon, GitBranchIcon, LinkIcon, LockIcon, CheckIcon, XIcon } from "lucide-react";
import type { State } from "@/lib/api";
import { openItem } from "@/lib/overlays";
import { rel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { IssueRef } from "@/components/patterns";
import { Badge, Tip } from "@/components/ui/primitives";
import { BorderBeam, Dot, Shimmer } from "@/components/magic";
import { CardBadges, CardMenu, matches, type Filter } from "./shared";

type Tone = "ok" | "warn" | "bad" | "info" | "brand" | "muted";
type Col = { key: string; title: string; tone: Tone; items: State[]; empty: string; hint?: string };

/** A Done line without its Markdown. */
const plain = (md: string) => (md ?? "").replace(/\*\*/g, "").replace(/^[^A-Za-z#]+/, "");
const refs = (list: State[]) => list.map((r) => "#" + r.number).join(", ");

export function Board({ d, f }: { d: State; f: Filter }) {
  const primary: string = d.repo;
  const b = d.board;
  const keep = (list: State[] = []) => list.filter((c) => matches(f, c, primary));
  const main: Col[] = [
    { key: "next", title: "Up next", tone: "brand", items: keep(b.next), empty: "Nothing queued" },
    { key: "building", title: "Building", tone: "warn", items: keep(b.building), empty: "Nothing building" },
    { key: "review", title: "In review", tone: "info", items: keep(b.review), empty: "No open PRs" },
    { key: "done", title: "Done", tone: "ok", items: keep(b.done), empty: "Nothing merged this week", hint: "Merged factory PRs, last 7 days" },
  ];
  const side: Col[] = [
    { key: "needsYou", title: "Waiting on you", tone: "warn" as Tone, items: keep(b.needsYou), empty: "" },
    { key: "blocked", title: "Blocked", tone: "bad" as Tone, items: keep(b.blocked), empty: "", hint: "Ready, but waiting on another card" },
    { key: "hold", title: "On hold", tone: "muted" as Tone, items: keep(b.hold), empty: "" },
  ].filter((c) => c.items.length);
  const chainsOf = (repo: string) => (repo === primary ? d.deps?.chains : d.depsByRepo?.[repo]?.chains) ?? {};

  return (
    <div className="flex flex-col gap-4">
      <Lanes cols={main} grid="md:grid-cols-2 xl:grid-cols-4" primary={primary} chainsOf={chainsOf} />
      {side.length > 0 && <Lanes cols={side} grid={["", "md:grid-cols-1", "md:grid-cols-2", "md:grid-cols-2 xl:grid-cols-3"][side.length]} primary={primary} chainsOf={chainsOf} short />}
    </div>
  );
}

function Lanes({ cols, grid, primary, chainsOf, short }: { cols: Col[]; grid: string; primary: string; chainsOf: (repo: string) => Record<number, State>; short?: boolean }) {
  return (
    <div className={cn("flex min-w-0 snap-x snap-mandatory gap-3 overflow-x-auto pb-1 md:grid md:snap-none md:overflow-visible md:pb-0", grid)}>
      {cols.map((col) => (
        <section key={col.key} aria-label={col.title} className="flex w-[84%] max-w-[22rem] shrink-0 snap-start flex-col rounded-xl border bg-muted/30 md:w-auto md:max-w-none">
          <header className="flex items-center gap-2 px-3 pt-2.5 pb-2 text-[13px] font-medium">
            <Dot tone={col.tone} />
            <Tip content={col.hint}>
              <span>{col.title}</span>
            </Tip>
            <span className="ml-auto rounded-full bg-background px-1.5 text-[11px] tabular-nums text-muted-foreground">{col.items.length}</span>
          </header>
          <div className={cn("flex min-h-16 flex-col gap-1.5 overflow-y-auto px-2 pb-2", short ? "max-h-80" : "max-h-[62dvh]")}>
            {col.items.length ? (
              col.items.map((c, i) => <BoardCard key={`${c.repo ?? primary}#${c.number}`} c={c} col={col.key} order={i + 1} primary={primary} chains={chainsOf(c.repo ?? primary)} />)
            ) : (
              <div className="grid flex-1 place-items-center rounded-lg border border-dashed py-6 text-xs text-muted-foreground">{col.empty}</div>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

const VERDICT: Record<string, { label: string; tone: "ok" | "warn" | "bad" | "outline"; tip: string }> = {
  ready: { label: "Reviewed", tone: "ok", tip: "The reviewer lane passed it" },
  polish: { label: "Polishing", tone: "outline", tip: "Passed; the builder is doing the small extras first" },
  "needs-work": { label: "Needs work", tone: "bad", tip: "The reviewer lane asked for fixes" },
};

function BoardCard({ c, col, order, primary, chains }: { c: State; col: string; order: number; primary: string; chains: Record<number, State> }) {
  const repo: string = c.repo ?? primary;
  const column = c.answered ? "needsYou" : col;
  const isPr = col === "review";
  const open = () => openItem({ ...c, column, repo, isPr: isPr || undefined, ...(col === "done" ? { pr: c.pr } : {}) });
  const chain = !isPr && col !== "done" ? chains[c.number] : null;
  const v = isPr && c.verdict ? VERDICT[c.verdict] : null;
  const builds = c.testBuilds?.versions?.length ?? 0;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => e.key === "Enter" && open()}
      className={cn(
        "group relative cursor-pointer rounded-lg border bg-card p-2.5 shadow-xs transition hover:border-foreground/15 hover:bg-accent/30 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
        c.running && "border-ok/40",
        (c.answered || (col === "done" && !c.ok)) && "border-warn/40",
      )}
    >
      {c.running && <BorderBeam size={60} />}
      <div className="flex items-center gap-1.5">
        {c.running ? (
          <Tip content="Running now">
            <span className="inline-flex">
              <Dot tone="ok" live />
            </span>
          </Tip>
        ) : col === "next" && !c.answered ? (
          <span className="w-3.5 text-[11px] tabular-nums text-muted-foreground/70">{order}</span>
        ) : null}
        {isPr && <GitPullRequestIcon className="size-3.5 text-muted-foreground" />}
        <IssueRef repo={repo} n={c.number} pr={isPr} />
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          <CardBadges c={c} primary={primary} />
        </div>
        <CardMenu c={c} column={column} repo={repo} className="-my-1 -mr-1 opacity-70 transition group-hover:opacity-100" />
      </div>

      <div className="mt-1 line-clamp-2 text-[13px] leading-snug">{c.title}</div>

      <Meta c={c} col={col} v={v} builds={builds} chain={chain} />
    </div>
  );
}

/** The one small line under the title: state, chain, builds. Details live in tooltips and the sheet. */
function Meta({ c, col, v, builds, chain }: { c: State; col: string; v: (typeof VERDICT)[string] | null; builds: number; chain: State | null }) {
  const bits: React.ReactNode[] = [];
  if (c.running) bits.push(<Shimmer key="w" className="text-[11px]">Working</Shimmer>);
  else if (c.starting) bits.push(<Badge key="s" variant="ok">starting</Badge>);
  if (c.answered)
    bits.push(
      <Tip key="a" content="You answered. Requeue it, or the maintainer will.">
        <Badge variant="warn">answered</Badge>
      </Tip>,
    );
  if (col === "blocked" && c.reason)
    bits.push(
      <Badge key="r" variant="bad">
        <LockIcon /> {c.reason}
      </Badge>,
    );
  if (v)
    bits.push(
      <Tip key="v" content={v.tip}>
        <Badge variant={v.tone}>
          {v.tone === "ok" && <CheckIcon />}
          {v.label}
        </Badge>
      </Tip>,
    );
  if (col === "done")
    bits.push(
      <Tip key="d" content={plain(c.line) || undefined}>
        <Badge variant={c.ok ? "ok" : "warn"}>
          {c.ok ? <CheckIcon /> : <XIcon />}
          {c.ok ? "done" : "not done"}
        </Badge>
      </Tip>,
    );
  if (c.draftPr)
    bits.push(
      <Tip key="dp" content={`Continues draft PR #${c.draftPr}`}>
        <Badge variant="outline">
          <GitBranchIcon /> draft #{c.draftPr}
        </Badge>
      </Tip>,
    );
  if (col === "needsYou" && c.pr) bits.push(<Badge key="p" variant="outline">PR #{c.pr}</Badge>);
  if (chain?.waitsOn?.length) {
    const blocked = chain.waitsOn.some((r: State) => r.stage !== "done");
    bits.push(
      <Tip key="wo" content={chain.waitsOn.map((r: State) => `#${r.number} ${r.title} (${r.stage})`).join(" · ")}>
        <Badge variant={blocked ? "warn" : "outline"}>waits on {refs(chain.waitsOn)}</Badge>
      </Tip>,
    );
  }
  if (chain?.unblocks?.length)
    bits.push(
      <Tip key="ub" content={chain.unblocks.map((r: State) => `#${r.number} ${r.title}`).join(" · ")}>
        <Badge variant="outline">unblocks {refs(chain.unblocks)}</Badge>
      </Tip>,
    );
  if (chain?.partOf)
    bits.push(
      <Tip key="po" content={chain.partOf.title}>
        <Badge variant="outline">
          <LinkIcon /> #{chain.partOf.number}
        </Badge>
      </Tip>,
    );
  if (builds)
    bits.push(
      <Tip key="tb" content={c.testBuilds.deleted ? "Test builds deleted" : `${builds} test build${builds === 1 ? "" : "s"}; open the card for links`}>
        <Badge variant={c.testBuilds.deleted ? "outline" : "brand"}>
          <PackageIcon /> v{c.testBuilds.versions[0]?.v ?? builds}
        </Badge>
      </Tip>,
    );
  const when = col === "done" ? c.at : col === "review" ? c.updatedAt : null;
  if (!bits.length && !when) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1">
      {bits}
      {when && <span className="ml-auto text-[11px] text-muted-foreground">{rel(when)}</span>}
    </div>
  );
}
