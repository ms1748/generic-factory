// A run's transcript as a chat log: the agent's words in Markdown, each tool call as one row (tap it for the
// command and its output), errors in red and open, the outcome on top. Follows new lines while you're at the bottom.
import * as React from "react";
import { BotIcon, ChevronRightIcon, FilePlusIcon, FileTextIcon, GlobeIcon, ListChecksIcon, PencilIcon, SearchIcon, TerminalIcon, WrenchIcon, CheckCircle2Icon, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Markdown } from "@/components/patterns";
import { Skeleton, Switch } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { Dot, Shimmer } from "@/components/magic";
import { build, type Entry, type Item } from "./util";

const ICONS: Record<string, LucideIcon> = { Bash: TerminalIcon, Read: FileTextIcon, Edit: PencilIcon, MultiEdit: PencilIcon, Write: FilePlusIcon, Grep: SearchIcon, Glob: SearchIcon, WebFetch: GlobeIcon, WebSearch: SearchIcon, Task: BotIcon, Agent: BotIcon, TodoWrite: ListChecksIcon };

export function Transcript({ entries, repo, live, className }: { entries: Entry[] | null; repo: string; live: boolean; className?: string }) {
  const items = React.useMemo(() => build(entries ?? []), [entries]);
  const [steps, setSteps] = React.useState(true);
  const [all, setAll] = React.useState(false);
  const box = React.useRef<HTMLDivElement>(null);
  const pinned = React.useRef(true);
  const onScroll = () => {
    const b = box.current;
    if (b) pinned.current = b.scrollHeight - b.scrollTop - b.clientHeight < 60;
  };
  React.useLayoutEffect(() => {
    const b = box.current;
    if (b && live && pinned.current) b.scrollTop = b.scrollHeight;
  }, [entries, live]);

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2 text-xs text-muted-foreground">
        <span className="tabular-nums">
          {items.steps} step{items.steps === 1 ? "" : "s"}
          {items.errors > 0 && <span className="text-bad"> · {items.errors} error{items.errors === 1 ? "" : "s"}</span>}
        </span>
        <span className="flex-1" />
        <label className="inline-flex cursor-pointer items-center gap-1.5">
          <Switch checked={steps} onCheckedChange={setSteps} aria-label="Show steps" /> Steps
        </label>
        <Button size="xs" variant="ghost" onClick={() => setAll(!all)} disabled={!steps}>
          {all ? "Fold all" : "Open all"}
        </Button>
      </div>
      <div ref={box} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="flex flex-col gap-2 p-4">
          {entries === null ? (
            <>
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-3/5" />
            </>
          ) : (
            <>
              {items.outcome && (
                <div className="rounded-lg border border-ok/30 bg-ok/5 px-3 py-2.5">
                  <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ok">
                    <CheckCircle2Icon className="size-3.5" /> Outcome
                  </div>
                  <Markdown text={items.outcome} repo={repo} className="text-sm" />
                </div>
              )}
              {!items.list.length && !items.outcome && <div className="py-8 text-center text-sm text-muted-foreground">{live ? <Shimmer>Starting…</Shimmer> : "No transcript."}</div>}
              {items.list.map((it, i) =>
                it.type === "say" ? <Say key={i} text={it.text} repo={repo} /> : steps ? it.type === "step" ? <Step key={`${i}-${all}`} it={it} all={all} live={live} /> : <Note key={i} it={it} /> : null,
              )}
              {live && items.list.length > 0 && (
                <div className="flex items-center gap-2 px-2 py-1 text-xs">
                  <Dot tone="brand" live /> <Shimmer>Working…</Shimmer>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Say({ text, repo }: { text: string; repo: string }) {
  const long = text.length > 1400;
  const [more, setMore] = React.useState(false);
  return (
    <div className="flex gap-2.5 py-1">
      <div className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-brand/10 text-brand">
        <BotIcon className="size-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className={cn("relative", long && !more && "max-h-64 overflow-hidden")}>
          <Markdown text={text} repo={repo} className="text-sm" />
          {long && !more && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-background" />}
        </div>
        {long && (
          <Button size="xs" variant="ghost" className="-ml-2 mt-1" onClick={() => setMore(!more)}>
            {more ? "Show less" : "Show all"}
          </Button>
        )}
      </div>
    </div>
  );
}

function Step({ it, all, live }: { it: Extract<Item, { type: "step" }>; all: boolean; live: boolean }) {
  const [o, setO] = React.useState<boolean | null>(null);
  const open = o ?? (all || it.error);
  const Icon = ICONS[it.name] ?? WrenchIcon;
  const pending = it.result === null;
  return (
    <div className={cn("rounded-md", open && "bg-muted/40 ring-1 ring-border", it.error && "ring-1 ring-bad/40")}>
      <button onClick={() => setO(!open)} className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition hover:bg-accent/60">
        <span className={cn("grid size-5 shrink-0 place-items-center rounded border bg-background text-muted-foreground", it.error && "border-bad/40 text-bad")}>
          <Icon className="size-3" />
        </span>
        <span className={cn("shrink-0 font-medium", it.error && "text-bad")}>{it.name}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">{it.text}</span>
        {pending && live && <Dot tone="info" live />}
        <ChevronRightIcon className={cn("size-3.5 shrink-0 text-muted-foreground/60 transition", open && "rotate-90")} />
      </button>
      {open && (
        <div className="grid gap-1.5 px-2 pb-2">
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded border bg-background px-2.5 py-1.5 font-mono text-xs">{it.text}</pre>
          {!pending && <pre className={cn("max-h-72 overflow-auto whitespace-pre-wrap break-words rounded border bg-background px-2.5 py-1.5 font-mono text-xs", it.error ? "text-bad" : "text-muted-foreground")}>{it.result || "(no output)"}</pre>}
        </div>
      )}
    </div>
  );
}

function Note({ it }: { it: Extract<Item, { type: "note" }> }) {
  return <div className={cn("whitespace-pre-wrap break-words px-2 font-mono text-xs", it.error ? "text-bad" : "text-muted-foreground")}>{it.text}</div>;
}

/** The last few lines of a live run, one line each (the pinned card's peek). */
export function Tail({ entries, n = 3 }: { entries: Entry[] | null; n?: number }) {
  const items = build(entries ?? []).list.slice(-n);
  if (!items.length) return <div className="text-xs text-muted-foreground">Starting…</div>;
  return (
    <div className="grid gap-1">
      {items.map((it, i) => {
        if (it.type === "step") {
          const Icon = ICONS[it.name] ?? WrenchIcon;
          return (
            <div key={i} className={cn("flex min-w-0 items-center gap-2 text-xs", it.error ? "text-bad" : "text-muted-foreground")}>
              <Icon className="size-3 shrink-0" />
              <span className="shrink-0 font-medium text-foreground">{it.name}</span>
              <span className="truncate font-mono">{it.text}</span>
            </div>
          );
        }
        return (
          <div key={i} className={cn("flex min-w-0 items-center gap-2 text-xs", it.type === "note" && it.error ? "text-bad" : "text-foreground/80")}>
            <BotIcon className="size-3 shrink-0 text-brand" />
            <span className="truncate">{it.text.split("\n").find((l) => l.trim())}</span>
          </div>
        );
      })}
    </div>
  );
}
