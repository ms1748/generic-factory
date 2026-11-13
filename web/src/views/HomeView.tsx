// Home: the state of the factory at a glance. Four numbers, what's running, what waits on you, what
// happened since you last looked, the budget, and what's next. Everything opens its full view or card.
import * as React from "react";
import { ActivityIcon, InboxIcon, ListTodoIcon, WalletIcon, ArrowRightIcon, HammerIcon, PlayIcon, CircleAlertIcon, MessageCircleQuestionIcon, GitPullRequestIcon, BugIcon } from "lucide-react";
import { control, getJson, type State } from "@/lib/api";
import { go } from "@/lib/router";
import { buildNow, openItem } from "@/lib/overlays";
import { dur, money, pct, rel, time } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Section, Stat, Empty, IssueRef } from "@/components/patterns";
import { Badge, Progress, Switch, Tip } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { BorderBeam, Dot, Shimmer } from "@/components/magic";
import { Timeline } from "@/components/charts";
import { needsCount } from "@/components/Shell";
import { SystemsStrip } from "@/components/machines/SystemsStrip";

const KEY = "factory.lastLooked";

/** The previous visit's time; this visit counts as "looked" once it's been open a little while. */
function useSince(): string {
  const [since] = React.useState(() => {
    try {
      return localStorage.getItem(KEY) ?? new Date(Date.now() - 24 * 3600_000).toISOString();
    } catch {
      return new Date(Date.now() - 24 * 3600_000).toISOString();
    }
  });
  React.useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(KEY, new Date().toISOString());
      } catch {
        // private mode: every visit shows the last day
      }
    }, 20_000);
    return () => clearTimeout(t);
  }, []);
  return since;
}

function useTick() {
  const [, set] = React.useState(0);
  React.useEffect(() => {
    const t = setInterval(() => set((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
}

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Working late" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

const firstLine = (s: string | null | undefined) => (s ?? "").split("\n").find((l) => l.trim()) ?? "";

export function HomeView({ d }: { d: State }) {
  useTick();
  const since = useSince();
  const [crashes, setCrashes] = React.useState<State[] | null>(null);
  React.useEffect(() => {
    getJson("/api/reports").then((j) => setCrashes(j?.configured ? j.issues.filter((x: State) => x.status === "unresolved" && x.kind === "crash") : null));
  }, []);

  const all: State[] = [...d.board.building, ...d.board.next, ...d.board.review, ...d.board.needsYou];
  const titleOf = (n: number) => all.find((c) => c.number === n || c.issue === n)?.title;
  const running: State[] = d.runningAll ?? (d.running ? [d.running] : []);
  const finished: State[] = d.runs.filter((r: State) => r.mode === "live" && r.ended_at && r.ended_at > since);
  const failed = finished.filter((r) => r.status === "failed" || r.status === "limited");
  const next: State[] = d.board.next.filter((c: State) => !c.answered);
  const needs = needsCount(d);
  const week = d.usage?.sevenDay;
  const state = d.stop ? "stopped" : d.pause ? "paused" : running.length ? "running" : "idle";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight md:text-2xl">{greeting()}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {state === "stopped"
              ? "The factory is stopped: nothing new starts."
              : state === "paused"
                ? `Paused until ${time(d.pause.until, d.timezone)}.`
                : running.length
                  ? `${running.length} agent${running.length === 1 ? " is" : "s are"} working${needs ? `, and ${needs} thing${needs === 1 ? "" : "s"} wait${needs === 1 ? "s" : ""} on you` : ""}.`
                  : needs
                    ? `Nothing running. ${needs} thing${needs === 1 ? "" : "s"} wait${needs === 1 ? "s" : ""} on you.`
                    : d.upcoming?.[0]
                      ? `All quiet. Next: ${d.upcoming[0].lane} ${rel(d.upcoming[0].at)}.`
                      : "All quiet."}
          </p>
        </div>
        {d.budgetBlock && (
          <Badge variant="warn" className="py-1">
            <CircleAlertIcon /> New runs wait: {d.budgetBlock}
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={ActivityIcon} label="Running" value={running.length} suffix={`of ${d.settings?.parallelRuns ?? 1}`} tone={running.length ? "ok" : undefined} hint={running.length ? "Watch them in Runs" : d.queuedRuns?.length ? `Starting: ${d.queuedRuns.map((q: State) => (q.card ? `#${q.card}` : q.lane)).join(", ")}` : "Idle"} onClick={() => go("runs")} />
        <Stat icon={InboxIcon} label="Needs you" value={needs} tone={needs ? "warn" : undefined} hint={needs ? "Open the inbox" : "You're caught up"} onClick={() => go("inbox")} />
        <Stat icon={ListTodoIcon} label="Ready to build" value={next.length} hint={`${d.board.building.length} building · ${d.board.review.length} in review`} onClick={() => go("work", "board")} />
        <Stat icon={WalletIcon} label="Plan this week" value={week ? Math.round(week.utilization * 100) : null} format={(n) => `${Math.round(n)}%`} tone={week && week.utilization >= d.limits.sevenDay ? "bad" : undefined} hint={week ? `Resets ${rel(week.resetsAt)} · ${money(d.spend.week.costUsd)} API-equiv.` : "No usage report yet"} onClick={() => go("settings", "limits")} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Section title="Running now" description={`${running.length} of ${d.settings?.parallelRuns ?? 1} slots`} actions={<Button size="xs" variant="ghost" onClick={() => go("runs")}>All runs <ArrowRightIcon /></Button>} flush>
            {running.length ? (
              <div className="flex flex-col gap-2 p-3">
                {running.map((r) => {
                  const log = r.id === d.running?.id ? [...(d.running.log ?? [])].reverse().find((e: State) => e.kind === "text" || e.kind === "tool") : null;
                  return (
                    <button key={r.id} onClick={() => go("runs", "run", String(r.id))} className="relative flex items-start gap-3 overflow-hidden rounded-lg border bg-muted/30 p-3 text-left transition hover:bg-muted/60">
                      <BorderBeam size={70} duration={7} />
                      <Dot tone="ok" live className="mt-1.5" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          {r.card ? <IssueRef repo={r.repo ?? d.repo} primary={d.repo} n={r.card} /> : null}
                          <span className="truncate">{r.card ? (titleOf(r.card) ?? r.lane) : `${r.lane}${r.action ? ` · ${r.action}` : ""}`}</span>
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {r.lane} · {dur(r.started_at)}
                        </div>
                        {log && (
                          <div className="mt-1.5 truncate font-mono text-[11.5px]">
                            <Shimmer>{log.kind === "tool" ? `${log.name}: ${log.text}` : log.text.split("\n")[0]}</Shimmer>
                          </div>
                        )}
                      </div>
                      <PlayIcon className="mt-1 size-4 text-muted-foreground" />
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="px-4 py-6 text-sm text-muted-foreground">
                Nothing running.
                {d.queuedRuns?.length ? ` Starting next: ${d.queuedRuns.map((q: State) => (q.card ? `#${q.card}` : q.lane)).join(", ")}.` : d.upcoming?.[0] ? ` Next is ${d.upcoming[0].lane} at ${time(d.upcoming[0].at, d.timezone)}${d.upcoming[0].live ? "" : " (dry)"}.` : ""}
              </div>
            )}
          </Section>

          <Section
            title="Since you last looked"
            description={
              finished.length ? (
                <>
                  {rel(since)} · {finished.length} run{finished.length === 1 ? "" : "s"}
                  {failed.length ? <span className="text-bad">, {failed.length} failed</span> : null}
                  {finished.some((r) => r.cost_usd) ? `, ${money(finished.reduce((s, r) => s + (r.cost_usd ?? 0), 0))}` : ""}
                </>
              ) : (
                rel(since)
              )
            }
            flush
          >
            {finished.length ? (
              <div className="divide-y">
                {finished.slice(0, 8).map((r) => (
                  <button key={r.id} onClick={() => go("runs", "run", String(r.id))} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition hover:bg-accent/50">
                    <Dot tone={r.status === "done" ? "ok" : r.status === "failed" || r.status === "limited" ? "bad" : "muted"} />
                    <span className="w-24 shrink-0 truncate text-xs text-muted-foreground">{r.lane}</span>
                    {r.card ? <IssueRef repo={r.repo ?? d.repo} primary={d.repo} n={r.card} /> : null}
                    <span className="min-w-0 flex-1 truncate">{firstLine(r.summary) || r.status}</span>
                    <span className="hidden shrink-0 text-xs tabular-nums text-muted-foreground sm:inline">{time(r.ended_at, d.timezone)}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="px-4 py-6 text-sm text-muted-foreground">Nothing finished since then.</div>
            )}
          </Section>

          <div className="grid gap-6 xl:grid-cols-2">
            <Section title="Up next" actions={<Button size="xs" variant="ghost" onClick={() => go("work", "board")}>Board <ArrowRightIcon /></Button>} flush>
              {next.length ? (
                <div className="divide-y">
                  {next.slice(0, 5).map((c, i) => (
                    <div key={`${c.repo}#${c.number}`} className="group flex items-center gap-3 px-4 py-2.5">
                      <span className="w-4 text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                      <button onClick={() => openItem({ ...c, column: "next" })} className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm hover:text-brand">
                        <IssueRef repo={c.repo ?? d.repo} primary={d.repo} n={c.number} />
                        <span className="truncate">{c.title}</span>
                      </button>
                      {c.priority && <Badge variant={c.priority === "p1" ? "bad" : c.priority === "p2" ? "warn" : "outline"}>{c.priority}</Badge>}
                      <Tip content="Build now">
                        <Button size="icon-sm" variant="ghost" className="opacity-60 group-hover:opacity-100" onClick={() => buildNow(c)} aria-label={`Build #${c.number} now`}>
                          <HammerIcon />
                        </Button>
                      </Tip>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="px-4 py-6 text-sm text-muted-foreground">Nothing queued.</div>
              )}
            </Section>
            <Section title="Schedule" actions={<Button size="xs" variant="ghost" onClick={() => go("lanes")}>Lanes <ArrowRightIcon /></Button>}>
              <Timeline d={d} limit={5} />
            </Section>
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <NeedsYou d={d} crashes={crashes} />
          <Budget d={d} />
        </div>
      </div>

      <SystemsStrip />
    </div>
  );
}

function NeedsYou({ d, crashes }: { d: State; crashes: State[] | null }) {
  const qs: State[] = d.board.needsYou;
  const prs: State[] = d.board.review.filter((p: State) => p.factory && p.verdict === "ready");
  const fixing: State[] = d.board.review.filter((p: State) => p.verdict === "needs-work");
  const empty = !qs.length && !prs.length && !crashes?.length;
  return (
    <Section title="Needs you" actions={<Button size="xs" variant="ghost" onClick={() => go("inbox")}>Inbox <ArrowRightIcon /></Button>} flush>
      {empty ? (
        <Empty className="m-3 border-0 py-6" title="Nothing waits on you" />
      ) : (
        <div className="divide-y">
          {qs.slice(0, 5).map((c) => (
            <button key={`${c.repo}#${c.number}`} onClick={() => go("inbox", "", `${c.repo !== d.repo ? c.repo + "/" : ""}${c.number}`)} className="flex w-full items-start gap-3 px-4 py-2.5 text-left transition hover:bg-accent/50">
              <MessageCircleQuestionIcon className="mt-0.5 size-4 shrink-0 text-warn" />
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 text-sm">{c.title}</span>
                <IssueRef repo={c.repo ?? d.repo} primary={d.repo} n={c.number} />
              </span>
            </button>
          ))}
          {prs.slice(0, 4).map((p) => (
            <button key={`pr${p.repo}#${p.number}`} onClick={() => openItem({ ...p, column: "review", isPr: true })} className="flex w-full items-start gap-3 px-4 py-2.5 text-left transition hover:bg-accent/50">
              <GitPullRequestIcon className="mt-0.5 size-4 shrink-0 text-ok" />
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 text-sm">{p.title}</span>
                <span className="text-xs text-muted-foreground">
                  <IssueRef repo={p.repo ?? d.repo} primary={d.repo} n={p.number} pr /> · ready to merge
                </span>
              </span>
            </button>
          ))}
          {crashes && crashes.length > 0 && (
            <button onClick={() => go("insights", "reports")} className="flex w-full items-start gap-3 px-4 py-2.5 text-left transition hover:bg-accent/50">
              <BugIcon className="mt-0.5 size-4 shrink-0 text-bad" />
              <span className="min-w-0 flex-1 text-sm">
                {crashes.length} open crash report{crashes.length === 1 ? "" : "s"}
                <span className="block truncate text-xs text-muted-foreground">{crashes[0].title}</span>
              </span>
            </button>
          )}
          {fixing.length > 0 && <div className="px-4 py-2 text-xs text-muted-foreground">{fixing.length} PR{fixing.length === 1 ? " is" : "s are"} being fixed after review.</div>}
        </div>
      )}
    </Section>
  );
}

function Budget({ d }: { d: State }) {
  const u = d.usage;
  const rows = [
    { label: "5-hour window", w: u?.fiveHour, limit: d.limits.fiveHour },
    { label: "This week", w: u?.sevenDay, limit: d.limits.sevenDay },
  ];
  return (
    <Section title="Budget" description={u ? `Claude plan, as of ${rel(u.at)}` : "No usage report yet"}>
      <div className="flex flex-col gap-4">
        {rows.map((r) => {
          const v = r.w?.utilization ?? 0;
          const tone = v >= r.limit ? "bad" : v >= r.limit * 0.8 ? "warn" : "brand";
          return (
            <div key={r.label}>
              <div className="mb-1.5 flex items-baseline justify-between text-sm">
                <span>{r.label}</span>
                <b className={cn("font-semibold tabular-nums", tone === "bad" && "text-bad")}>{r.w ? pct(v) : "–"}</b>
              </div>
              <div className="relative">
                <Progress value={v * 100} tone={tone} className="h-2" />
                <Tip content={`No new run starts past ${pct(r.limit)}`}>
                  <span className="absolute -top-0.5 h-3 w-0.5 rounded bg-foreground/60" style={{ left: `${r.limit * 100}%` }} />
                </Tip>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">{r.w ? `Resets ${time(r.w.resetsAt, d.timezone)} (${rel(r.w.resetsAt)})` : "Fills in after the next usage check"}</div>
            </div>
          );
        })}
        <div className="grid grid-cols-2 gap-3 rounded-lg bg-muted/40 p-3 text-xs">
          <div>
            <div className="text-muted-foreground">Last 24 h</div>
            <div className="text-base font-semibold tabular-nums">{money(d.spend.day.costUsd)}</div>
            <div className="text-muted-foreground">{d.spend.day.runs} runs</div>
          </div>
          <div>
            <div className="text-muted-foreground">Last 7 days</div>
            <div className="text-base font-semibold tabular-nums">{money(d.spend.week.costUsd)}</div>
            <div className="text-muted-foreground">{d.spend.week.runs} runs</div>
          </div>
        </div>
        <label className="flex items-center gap-3 text-sm">
          <span className="flex-1">
            Use paid credits
            <span className="block text-xs text-muted-foreground">{d.allowCredits ? "Runs continue on extra-usage credits." : "Runs stop when the plan runs out."}</span>
          </span>
          <Switch checked={d.allowCredits} onCheckedChange={(on) => control("settings/credits", { on })} />
        </label>
        <p className="text-[11px] leading-relaxed text-muted-foreground">Dollar amounts are what the same use would cost on the API; the plan isn't billed per run.</p>
      </div>
    </Section>
  );
}

