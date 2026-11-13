// One run: how it went, what it touched, what it cost, and its transcript.
import { FileCodeIcon, PanelRightOpenIcon, XIcon } from "lucide-react";
import type { State } from "@/lib/api";
import { go } from "@/lib/router";
import { openPrompt } from "@/lib/overlays";
import { dur, money, time } from "@/lib/format";
import { IssueRef } from "@/components/patterns";
import { Badge, Tip } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { Dot } from "@/components/magic";
import { Transcript } from "./Transcript";
import { WORD, cardOf, openCard, toneOf, useRunLog } from "./util";

/** The card's title, else the lane and what it did. */
export const runTitle = (d: State, r: State): string => cardOf(d, r.card, r.repo ?? d.repo)?.card.title ?? (r.lane ? `${r.lane}${r.action ? ` · ${r.action}` : ""}` : `Run ${r.id}`);

/** The header: status, title and the facts in one wrapped line. */
export function RunHead({ d, r, onClose }: { d: State; r: State; onClose?: () => void }) {
  const repo = r.repo ?? d.repo;
  const lane = d.lanes?.find((l: State) => l.name === r.lane && (l.repo ?? d.repo) === repo);
  const title = runTitle(d, r);
  const running = r.status === "running";
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-xs">
        <Dot tone={toneOf(r)} live={running} />
        <span className="font-medium">{WORD[r.status] ?? r.status ?? "Run"}</span>
        <span className="text-muted-foreground">
          · run <span className="tabular-nums">{r.id}</span>
        </span>
        {r.mode && <Badge variant={r.mode === "live" ? "ok" : "outline"}>{r.mode}</Badge>}
        <span className="flex-1" />
        {onClose && (
          <Button size="icon-sm" variant="ghost" className="-my-1" onClick={onClose} aria-label="Close">
            <XIcon />
          </Button>
        )}
      </div>
      {onClose && <h2 className="text-base font-semibold leading-snug">{title}</h2>}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
        {r.lane && (
          <span>
            <span className="font-medium text-foreground">{r.lane}</span>
            {r.model && <span> · {r.model}</span>}
          </span>
        )}
        {r.card && (
          <span className="inline-flex items-center gap-1">
            Card <IssueRef repo={repo} primary={d.repo} n={r.card} />
            <Tip content="Card details">
              <button onClick={() => openCard(d, r.card, repo)} className="rounded p-0.5 hover:bg-accent hover:text-foreground" aria-label="Card details">
                <PanelRightOpenIcon className="size-3.5" />
              </button>
            </Tip>
          </span>
        )}
        {r.pr && (
          <span className="inline-flex items-center gap-1">
            PR <IssueRef repo={repo} primary={d.repo} n={r.pr} pr />
          </span>
        )}
        {r.started_at && <span className="tabular-nums">{time(r.started_at, d.timezone)}</span>}
        {r.started_at && (r.ended_at || running) && <span className="tabular-nums">{dur(r.started_at, r.ended_at)}{running ? " so far" : ""}</span>}
        {r.cost_usd ? (
          <Tip content="API-equivalent cost; your plan covers it">
            <span className="tabular-nums underline decoration-dotted underline-offset-2">{money(r.cost_usd)}</span>
          </Tip>
        ) : null}
        {lane?.prompt && (
          <Tip content={`Followed ${lane.prompt.split("/").pop()} + common.md`}>
            <button onClick={() => openPrompt(lane.prompt, repo)} className="inline-flex items-center gap-1 font-medium text-brand hover:underline">
              <FileCodeIcon className="size-3.5" /> Prompt
            </button>
          </Tip>
        )}
      </div>
      {r.summary && !running && <p className="line-clamp-2 text-sm text-foreground/80">{String(r.summary).split("\n").find((l: string) => l.trim())}</p>}
    </div>
  );
}

/** Header plus transcript, filling its parent's height. */
export function RunDetail({ d, r, closable }: { d: State; r: State; closable?: boolean }) {
  const running = r.status === "running";
  const dry = r.mode && r.mode !== "live";
  const entries = useRunLog(dry ? null : r.id, running, d.running?.id === r.id ? d.running.log : undefined);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b px-4 py-3">
        <RunHead d={d} r={r} onClose={closable ? () => go("runs") : undefined} />
      </div>
      {dry ? (
        <div className="p-4 text-sm text-muted-foreground">A dry run: nothing ran.{r.summary ? ` ${r.summary}` : ""}</div>
      ) : (
        <Transcript entries={entries} repo={r.repo ?? d.repo} live={running} className="flex-1" />
      )}
    </div>
  );
}
