// Features in progress: one row each (progress, parts done), opening to its parts step by step, in the
// order they can be built ("Part of #n" makes a part, "Blocked by #n" makes the steps). Parts open the sheet.
import * as React from "react";
import { ChevronRightIcon, ShapesIcon } from "lucide-react";
import type { State } from "@/lib/api";
import { openItem } from "@/lib/overlays";
import { cn } from "@/lib/utils";
import { IssueRef, Section } from "@/components/patterns";
import { Badge, Progress, Tip, type BadgeVariant } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";

const STAGE: Record<string, { label: string; tone: BadgeVariant; column?: string }> = {
  done: { label: "done", tone: "ok", column: "done" },
  building: { label: "building", tone: "warn", column: "building" },
  review: { label: "in review", tone: "info", column: "review" },
  queued: { label: "queued", tone: "brand", column: "next" },
  waiting: { label: "waiting", tone: "outline", column: "blocked" },
  idea: { label: "idea", tone: "outline", column: "ideas" },
  hold: { label: "on hold", tone: "outline", column: "hold" },
  open: { label: "open", tone: "outline" },
};

export function Features({ d, repoFilter }: { d: State; repoFilter: string }) {
  const primary: string = d.repo;
  const all: State[] = [
    ...(d.deps?.features ?? []).map((f: State) => ({ ...f, repo: primary })),
    ...Object.entries(d.depsByRepo ?? {}).flatMap(([repo, dep]) => ((dep as State)?.features ?? []).map((f: State) => ({ ...f, repo }))),
  ].filter((f) => repoFilter === "all" || f.repo === repoFilter);
  const [all_, setAll] = React.useState(false);
  if (!all.length) return null;
  const shown = all_ ? all : all.slice(0, 4);
  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <ShapesIcon className="size-4 text-muted-foreground" /> Features
          <span className="rounded-full bg-muted px-2 text-xs font-medium tabular-nums text-muted-foreground">{all.length}</span>
        </span>
      }
      actions={
        all.length > 4 && (
          <Button size="xs" variant="ghost" onClick={() => setAll(!all_)}>
            {all_ ? "Show fewer" : `Show all ${all.length}`}
          </Button>
        )
      }
      flush
    >
      <div className="divide-y">
        {shown.map((f) => (
          <Feature key={`${f.repo}#${f.number}`} f={f} primary={primary} />
        ))}
      </div>
    </Section>
  );
}

function Feature({ f, primary }: { f: State; primary: string }) {
  const [open, setOpen] = React.useState(false);
  const total = f.parts.length;
  const levels: State[][] = [];
  for (const p of f.parts) (levels[p.level] ??= []).push(p);
  const steps = levels.filter(Boolean);
  return (
    <div>
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="group flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-accent/40">
        <ChevronRightIcon className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
        <IssueRef repo={f.repo} primary={primary} n={f.number} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{f.title}</span>
        <Tip content={`${f.done} of ${total} parts done`}>
          <span className="flex shrink-0 items-center gap-2">
            <Progress value={(f.done / Math.max(1, total)) * 100} tone="ok" className="hidden w-20 sm:block" />
            <span className="text-xs tabular-nums text-muted-foreground">
              {f.done}/{total}
            </span>
          </span>
        </Tip>
      </button>
      {open && (
        <ol className="flex flex-col gap-2 px-4 pb-3 sm:pl-11">
          {steps.map((level, i) => (
            <li key={i} className="flex gap-2">
              <span className="mt-1.5 w-4 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground" title={`Step ${i + 1}`}>
                {i + 1}
              </span>
              <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                {level.map((p) => (
                  <Part key={p.number} p={p} repo={f.repo} primary={primary} />
                ))}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Part({ p, repo, primary }: { p: State; repo: string; primary: string }) {
  const s = STAGE[p.stage] ?? STAGE.open;
  const open = () => openItem({ number: p.number, title: p.title, repo, column: s.column });
  return (
    <Tip content={p.waitsOn?.length ? `Waits on ${p.waitsOn.map((n: number) => "#" + n).join(", ")}` : "Can start now"}>
      <div
        role="button"
        tabIndex={0}
        onClick={open}
        onKeyDown={(e) => e.key === "Enter" && open()}
        className={cn(
          "flex max-w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-xs transition hover:border-foreground/20 hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none sm:max-w-64",
          p.stage === "done" && "opacity-60",
        )}
      >
        <IssueRef repo={repo} primary={primary} n={p.number} className="shrink-0 text-[11px]" />
        <span className={cn("min-w-0 truncate", p.stage === "done" && "line-through")}>{p.title.replace(/^[^:]+:\s*/, "")}</span>
        <Badge variant={s.tone} className="shrink-0">
          {s.label}
        </Badge>
      </div>
    </Tip>
  );
}
