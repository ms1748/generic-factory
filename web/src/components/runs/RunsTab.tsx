// The Runs tab: what's running now pinned on top with a live peek, then every recent run as a compact
// list by day. A run opens beside the list on wide screens and in a sheet on phones (#/runs/run/42).
import * as React from "react";
import { ChevronRightIcon, PlayCircleIcon, MousePointerClickIcon } from "lucide-react";
import type { State } from "@/lib/api";
import { go } from "@/lib/router";
import { dur, money, short, time } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Empty, IssueRef, Section, Segmented } from "@/components/patterns";
import { Badge, Card } from "@/components/ui/primitives";
import { Sheet, SheetContent } from "@/components/ui/overlays";
import { Button } from "@/components/ui/button";
import { BorderBeam, Dot, Shimmer } from "@/components/magic";
import { laneColor } from "@/components/charts";
import { RunDetail, runTitle } from "./RunDetail";
import { Tail } from "./Transcript";
import { WORD, failed, toneOf, useRunLog, useWide } from "./util";

type Filter = "live" | "failed" | "all";
const PAGE = 25;

export function RunsTab({ d, runId }: { d: State; runId: string }) {
  const wide = useWide();
  const [filter, setFilter] = React.useState<Filter>("live");
  const [shown, setShown] = React.useState(PAGE);
  React.useEffect(() => setShown(PAGE), [filter]);

  const all: State[] = d.runs ?? [];
  const runs = all.filter((r) => r.status !== "running" && (filter === "live" ? r.mode === "live" : filter === "failed" ? failed(r) : true));
  const running: State[] = (d.runningAll ?? []).map((x: State) => ({ ...all.find((r) => r.id === x.id), ...x, status: "running", mode: "live" }));
  const selected: State | null = runId ? (all.find((r) => String(r.id) === runId) ?? { id: Number(runId) }) : null;
  const kindOf = (r: State) => d.lanes?.find((l: State) => l.name === r.lane)?.kind ?? "";

  const days: { day: string; runs: State[] }[] = [];
  for (const r of runs.slice(0, shown)) {
    const day = new Date(r.started_at).toLocaleDateString("en-US", { timeZone: d.timezone, weekday: "long", month: "short", day: "numeric" });
    if (days.at(-1)?.day !== day) days.push({ day, runs: [] });
    days.at(-1)!.runs.push(r);
  }

  const list = (
    <div className="flex min-w-0 flex-col gap-4">
      {running.map((r) => (
        <LiveCard key={r.id} d={d} r={r} selected={selected?.id === r.id} kind={kindOf(r)} />
      ))}
      <Section
        flush
        title="Recent runs"
        actions={
          <Segmented<Filter>
            value={filter}
            onChange={setFilter}
            options={[
              { value: "live", label: "Live" },
              { value: "failed", label: "Failed" },
              { value: "all", label: "All" },
            ]}
          />
        }
      >
        {days.length === 0 ? (
          <div className="p-4">
            <Empty icon={PlayCircleIcon} title={filter === "failed" ? "No failed runs" : "No runs yet"} />
          </div>
        ) : (
          <div>
            {days.map((g) => (
              <div key={g.day}>
                <div className="border-b bg-muted/40 px-4 py-1.5 text-[11px] font-medium text-muted-foreground">{g.day}</div>
                <div className="divide-y">
                  {g.runs.map((r) => (
                    <RunRow key={r.id} d={d} r={r} on={selected?.id === r.id} kind={kindOf(r)} />
                  ))}
                </div>
              </div>
            ))}
            {runs.length > shown && (
              <div className="border-t p-2 text-center">
                <Button size="xs" variant="ghost" onClick={() => setShown(shown + PAGE)}>
                  Show older ({runs.length - shown})
                </Button>
              </div>
            )}
          </div>
        )}
      </Section>
    </div>
  );

  if (wide) {
    return (
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] items-start gap-4">
        {list}
        <Card className="sticky top-[4.75rem] h-[calc(100dvh-6.5rem)] min-h-96 overflow-hidden">
          {selected ? (
            <RunDetail key={selected.id} d={d} r={selected} closable />
          ) : (
            <div className="grid h-full place-items-center p-6">
              <Empty icon={MousePointerClickIcon} title="Pick a run" className="border-0">
                Its transcript shows here.
              </Empty>
            </div>
          )}
        </Card>
      </div>
    );
  }

  return (
    <>
      {list}
      <Sheet open={!!selected} onOpenChange={(o) => !o && go("runs")}>
        {selected && (
          <SheetContent title={runTitle(d, selected)} className="h-[92dvh] md:h-full">
            <RunDetail key={selected.id} d={d} r={selected} />
          </SheetContent>
        )}
      </Sheet>
    </>
  );
}

function LaneName({ lane, kind }: { lane: string; kind: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span className="h-3.5 w-0.5 shrink-0 rounded-full" style={{ background: laneColor(kind) }} />
      <span className="truncate font-medium">{lane}</span>
    </span>
  );
}

function RunRow({ d, r, on, kind }: { d: State; r: State; on: boolean; kind: string }) {
  const repo = r.repo ?? d.repo;
  const what = runTitle(d, r);
  const took = r.ended_at ? dur(r.started_at, r.ended_at) : "";
  const cost = r.cost_usd ? money(r.cost_usd) : "";
  const open = () => go("runs", "run", String(r.id));
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => e.key === "Enter" && open()}
      className={cn("group grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2 text-sm transition hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none", on && "bg-accent shadow-[inset_2px_0_0_var(--brand)]")}
    >
      <Dot tone={toneOf(r)} />
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <LaneName lane={r.lane} kind={kind} />
          {r.card && <IssueRef repo={repo} primary={d.repo} n={r.card} className="shrink-0" />}
          {repo !== d.repo && <Badge variant="outline" className="hidden sm:inline-flex">{short(repo)}</Badge>}
          {r.mode !== "live" && <Badge variant="outline">dry</Badge>}
        </div>
        <div className={cn("truncate text-xs", failed(r) ? "text-bad" : "text-muted-foreground")}>
          {r.card ? what : (r.action ?? WORD[r.status] ?? r.status)}
          {r.card && r.action ? ` · ${r.action}` : ""}
        </div>
      </div>
      <div className="flex items-center gap-3 text-xs tabular-nums text-muted-foreground">
        <span className="hidden w-14 text-right sm:block">{took}</span>
        <span className="hidden w-12 text-right sm:block">{cost}</span>
        <span className="hidden w-16 text-right text-foreground/80 sm:block">{time(r.started_at, d.timezone, { weekday: undefined })}</span>
        <span className="grid text-right sm:hidden">
          <span className="text-foreground/80">{time(r.started_at, d.timezone, { weekday: undefined })}</span>
          <span>{[took, cost].filter(Boolean).join(" · ")}</span>
        </span>
        <ChevronRightIcon className="hidden size-4 text-muted-foreground/50 transition group-hover:translate-x-0.5 lg:block" />
      </div>
    </div>
  );
}

/** A run going now: live dot, "Working…", and its last few steps. */
function LiveCard({ d, r, selected, kind }: { d: State; r: State; selected: boolean; kind: string }) {
  const repo = r.repo ?? d.repo;
  const entries = useRunLog(r.id, true, d.running?.id === r.id ? d.running.log : undefined);
  const open = () => go("runs", "run", String(r.id));
  return (
    <Card role="button" tabIndex={0} onClick={open} onKeyDown={(e) => e.key === "Enter" && open()} className={cn("relative cursor-pointer overflow-hidden p-4 transition hover:bg-accent/30", selected && "ring-2 ring-brand/40")}>
      <BorderBeam />
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <Dot tone="brand" live />
        <LaneName lane={r.lane} kind={kind} />
        {r.card && <IssueRef repo={repo} primary={d.repo} n={r.card} className="shrink-0" />}
        <span className="flex-1" />
        <Shimmer className="shrink-0 text-xs font-medium">Working…</Shimmer>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{dur(r.started_at)}</span>
      </div>
      <div className="mt-1 truncate text-xs text-muted-foreground">{runTitle(d, r)}</div>
      <div className="mt-3 rounded-lg border bg-muted/30 px-3 py-2">
        <Tail entries={entries} />
      </div>
    </Card>
  );
}
