// One lane as a compact card: who it is (kind, model, what it does in a tooltip), Off / Dry / Live,
// today's schedule as a 24-hour strip with now marked, the next run, what it would take next, how its live
// runs have gone, and Run now plus its prompt.
import type * as React from "react";
import { InfoIcon, PlayIcon, FileTextIcon } from "lucide-react";
import { control, type State } from "@/lib/api";
import { confirm, openItem, openPrompt } from "@/lib/overlays";
import { money, pct, rel, time } from "@/lib/format";
import { cn } from "@/lib/utils";
import { IssueRef, Segmented } from "@/components/patterns";
import { Badge, Card, Tip } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { BorderBeam, Dot, Shimmer } from "@/components/magic";
import { laneColor } from "@/components/charts";
import { summary, ticks, zonedNow } from "./schedule";

type Mode = "off" | "dry" | "live";
export const modeOf = (l: State): Mode => (!l.enabled ? "off" : l.live ? "live" : "dry");

const MODES: { value: Mode; label: string; tip: string }[] = [
  { value: "off", label: "Off", tip: "Doesn't run" },
  { value: "dry", label: "Dry", tip: "Only records what it would do" },
  { value: "live", label: "Live", tip: "Runs start Claude for real" },
];

export function LaneCard({ d, l, repo, label }: { d: State; l: State; repo: string; label: string }) {
  const mode = modeOf(l);
  const running: State[] = (d.runningAll ?? []).filter((r: State) => r.lane === l.name && (r.repo ?? d.repo) === repo);
  const queued = (d.queuedRuns ?? []).some((q: State) => q.lane === l.name && !q.card && (q.repo ?? d.repo) === repo);
  const tz: string = l.timezone ?? d.timezone;
  const now = zonedNow(d.now, tz);
  const today = ticks(l.schedule, now.day);
  const q = l.quality;

  function setMode(m: Mode) {
    if (m === mode) return;
    const body = { mode: m, repo };
    if (m !== "live") return void control(`lanes/${l.name}/mode`, body);
    confirm({
      title: `Switch ${label} to live?`,
      body: "Its scheduled runs start Claude for real and use your Claude plan.",
      yes: "Go live",
      action: () => control(`lanes/${l.name}/mode`, body),
    });
  }

  function runNow() {
    const body = { repo };
    if (l.live)
      confirm({ title: `Run ${label} now?`, body: "It's live: this starts Claude and uses your Claude plan.", yes: "Run now", action: () => control(`lanes/${l.name}/run`, body, `${label} starts next`) });
    else confirm({ title: `Dry-run ${label} now?`, body: "It only records what it would do.", yes: "Run now", action: () => control(`lanes/${l.name}/run`, body, `${label}: dry run queued`) });
  }

  const pick = l.pick;
  return (
    <Card className={cn("relative flex min-w-0 flex-col gap-3 p-4", running.length > 0 && "border-ok/40")}>
      {running.length > 0 && <BorderBeam />}

      {/* Who */}
      <div className="flex items-start gap-2.5">
        <span className="mt-1 h-8 w-1 shrink-0 rounded-full" style={{ background: laneColor(l.kind) }} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Dot tone={running.length ? "ok" : mode === "live" ? "brand" : mode === "dry" ? "info" : "muted"} live={running.length > 0} />
            <h3 className="truncate text-sm font-semibold">{l.name}</h3>
            {l.about && (
              <Tip content={l.about}>
                <button className="rounded p-0.5 text-muted-foreground hover:text-foreground" aria-label={`What ${label} does`}>
                  <InfoIcon className="size-3.5" />
                </button>
              </Tip>
            )}
          </div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            {l.kind} · {l.model}
          </div>
        </div>
        <Segmented
          value={mode}
          onChange={setMode}
          options={MODES.map((m) => ({
            value: m.value,
            label: (
              <Tip content={m.tip}>
                <span className={cn(mode === m.value && m.value === "live" && "text-ok", mode === m.value && m.value === "dry" && "text-info")}>{m.label}</span>
              </Tip>
            ),
          }))}
        />
      </div>

      {running.length > 0 && (
        <Badge variant="ok" className="self-start">
          <Dot tone="ok" live /> <Shimmer>Running {running.map((r) => (r.card ? "#" + r.card : (r.action ?? ""))).filter(Boolean).join(", ")}</Shimmer>
        </Badge>
      )}

      {/* Schedule: today's runs on a 24-hour strip */}
      <div className={cn("flex flex-col gap-1.5", mode === "off" && "opacity-60")}>
        <Tip content={l.schedule?.length ? `Today's runs (${tz}); the line is now` : "Runs when there's something to do"}>
          <div className="relative h-4 rounded border bg-muted/50">
            {today.map((m) => (
              <i key={m} className={cn("absolute inset-y-0.5 w-0.5 rounded-full", m < now.min ? "bg-muted-foreground/30" : "bg-brand")} style={{ left: `${(m / 1440) * 100}%` }} />
            ))}
            <i className="absolute -inset-y-0.5 w-0.5 rounded-full bg-warn" style={{ left: `${(now.min / 1440) * 100}%` }} />
          </div>
        </Tip>
        <div className="flex flex-wrap justify-between gap-x-3 text-xs">
          <span className="truncate text-muted-foreground">{summary(l.schedule)}</span>
          {mode !== "off" && l.nextRun && (
            <span className="tabular-nums">
              {time(l.nextRun, tz)} <span className="text-muted-foreground">({rel(l.nextRun)})</span>
            </span>
          )}
        </div>
      </div>

      {/* What it takes next */}
      <div className="flex min-w-0 items-center gap-1.5 text-xs">
        <span className="shrink-0 text-muted-foreground">Next</span>
        {mode === "off" ? (
          <span className="text-muted-foreground">Nothing while off</span>
        ) : !pick ? (
          <span className="text-muted-foreground">Decides from its prompt</span>
        ) : !pick.card ? (
          <Tip content={pick.idle}>
            <span className="text-muted-foreground underline decoration-dotted underline-offset-2">Nothing to take</span>
          </Tip>
        ) : (
          <button
            className="flex min-w-0 items-center gap-1.5 rounded text-left hover:text-brand"
            onClick={() => openItem({ number: pick.card.number, title: pick.card.title, repo: pick.card.repo ?? repo, column: "next", priority: pick.card.priority, size: pick.card.size, labels: pick.card.labels })}
          >
            <Badge variant="outline" className="shrink-0">{pick.action}</Badge>
            <IssueRef repo={pick.card.repo ?? repo} primary={d.repo} n={pick.card.number} className="shrink-0" />
            <span className="truncate">{pick.card.title}</span>
          </button>
        )}
      </div>

      {/* Track record of live runs */}
      {q ? (
        <div className="grid grid-cols-4 gap-1 rounded-lg bg-muted/50 px-2 py-1.5 text-center">
          <Fact label="done" tip={`${q.done} of ${q.runs} live runs done${q.failed ? `, ${q.failed} failed` : ""}${q.limited ? `, ${q.limited} hit a limit` : ""}`}>
            {q.done}/{q.runs}
            {q.failed > 0 && <span className="ml-1 text-bad">−{q.failed}</span>}
          </Fact>
          <Fact label="step errors" tip="Share of tool steps that errored" tone={q.stepErrorRate > 0.1 ? "text-bad" : ""}>
            {pct(q.stepErrorRate)}
          </Fact>
          <Fact label="min a run" tip="Average run length">
            {q.avgMinutes ?? "?"}
          </Fact>
          <Fact label="a run" tip="Average API-equivalent cost">
            {money(q.avgCost)}
          </Fact>
        </div>
      ) : (
        <div className="rounded-lg bg-muted/50 px-2 py-2 text-center text-xs text-muted-foreground">No live runs yet</div>
      )}

      {/* Actions */}
      <div className="mt-auto flex items-center gap-2">
        <Button size="xs" variant="outline" disabled={mode === "off" || queued} onClick={runNow}>
          <PlayIcon className="size-3.5" /> {queued ? "Queued" : "Run now"}
        </Button>
        <Tip content={l.prompt}>
          <Button size="xs" variant="ghost" className="ml-auto min-w-0" onClick={() => openPrompt(l.prompt, repo)}>
            <FileTextIcon className="size-3.5" />
            <span className="truncate">{String(l.prompt ?? "").split("/").pop()}</span>
          </Button>
        </Tip>
      </div>
    </Card>
  );
}

function Fact({ label, tip, tone, children }: { label: string; tip: string; tone?: string; children: React.ReactNode }) {
  return (
    <Tip content={tip}>
      <div className="min-w-0">
        <div className={cn("truncate text-sm font-semibold tabular-nums", tone)}>{children}</div>
        <div className="truncate text-[10.5px] text-muted-foreground">{label}</div>
      </div>
    </Tip>
  );
}
