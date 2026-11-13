// History (/api/data): cards and PRs from GitHub; runs, cost and plan usage from the factory's database,
// by day, week or month (180 days at most). Then PR scores by lane, model and size, and the quality trials.
import * as React from "react";
import { BarChart3Icon, ChevronDownIcon, FlaskConicalIcon, InfoIcon, LightbulbIcon, ChevronRightIcon } from "lucide-react";
import { getJson, type State } from "@/lib/api";
import { openItem, openTrial } from "@/lib/overlays";
import { money } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Empty, IssueRef, Section, Segmented, Stat } from "@/components/patterns";
import { Badge, Card, Skeleton, Tip } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { BarChart, COLORS } from "@/components/charts";

type Period = "day" | "week" | "month";
const PERIODS: Record<Period, { n: number; label: string; tab: string }> = {
  day: { n: 30, label: "30 days", tab: "Days" },
  week: { n: 12, label: "12 weeks", tab: "Weeks" },
  month: { n: 6, label: "6 months", tab: "Months" },
};

/** The start of the bucket a time falls in, in the project's time zone. */
function bucketOf(iso: string, p: Period, tz: string) {
  const t = new Date(new Date(iso).toLocaleString("en-US", { timeZone: tz }));
  t.setHours(0, 0, 0, 0);
  if (p === "week") t.setDate(t.getDate() - ((t.getDay() + 6) % 7));
  if (p === "month") t.setDate(1);
  return t.getTime();
}

function useBuckets(period: Period, tz: string) {
  return React.useMemo(() => {
    const now = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
    const out: number[] = [];
    for (let i = PERIODS[period].n - 1; i >= 0; i--) {
      const t = new Date(now);
      t.setHours(0, 0, 0, 0);
      if (period === "day") t.setDate(t.getDate() - i);
      if (period === "week") t.setDate(t.getDate() - ((t.getDay() + 6) % 7) - i * 7);
      if (period === "month") {
        t.setDate(1);
        t.setMonth(t.getMonth() - i);
      }
      out.push(t.getTime());
    }
    return out;
  }, [period, tz]);
}

export function DataTab({ d }: { d: State }) {
  const [data, setData] = React.useState<State | null>(null);
  const [error, setError] = React.useState(false);
  const [period, setPeriod] = React.useState<Period>("week");
  const tz: string = d.timezone;
  React.useEffect(() => {
    getJson("/api/data").then((j) => (j ? setData(j) : setError(true)));
  }, []);

  const buckets = useBuckets(period, tz);
  const labels = buckets.map((k) => new Date(k).toLocaleDateString("en-US", period === "month" ? { month: "short", year: "2-digit" } : { month: "short", day: "numeric" }));
  const idx = new Map(buckets.map((b, i) => [b, i]));
  const fold = (list: State[], field: string, add: (acc: number, x: State) => number, pred: (x: State) => boolean = () => true) => {
    const v = buckets.map(() => 0);
    for (const x of list) {
      if (!x[field] || !pred(x)) continue;
      const i = idx.get(bucketOf(x[field], period, tz));
      if (i !== undefined) v[i] = add(v[i], x);
    }
    return v;
  };
  const count = (list: State[], field: string, pred?: (x: State) => boolean) => fold(list, field, (a) => a + 1, pred);
  const inRange = (iso: string | null) => !!iso && bucketOf(iso, period, tz) >= (buckets[0] ?? 0);

  const live: State[] = data ? data.runs.filter((r: State) => r.mode === "live") : [];
  const totals = React.useMemo(() => {
    if (!data) return null;
    const runs = live.filter((r) => inRange(r.at));
    const done = runs.filter((r) => r.status === "done").length;
    const took = runs.filter((r) => r.minutes != null).map((r) => r.minutes as number);
    return {
      opened: data.issues.filter((i: State) => inRange(i.created)).length,
      closed: data.issues.filter((i: State) => inRange(i.closed)).length,
      mergedFactory: data.pulls.filter((p: State) => inRange(p.merged) && p.factory).length,
      mergedYou: data.pulls.filter((p: State) => inRange(p.merged) && !p.factory).length,
      runs: runs.length,
      doneRate: runs.length ? Math.round((done / runs.length) * 100) : null,
      cost: runs.reduce((a, r) => a + r.cost, 0),
      minutes: took.length ? Math.round(took.reduce((a, b) => a + b, 0) / took.length) : null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, buckets]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented<Period> value={period} onChange={setPeriod} options={(Object.keys(PERIODS) as Period[]).map((p) => ({ value: p, label: PERIODS[p].tab }))} />
        <span className="text-xs text-muted-foreground">Last {PERIODS[period].label}</span>
        <Tip content="Cards and PRs from GitHub (primary repo); runs, cost and plan usage from the factory's own database.">
          <button className="rounded p-0.5 text-muted-foreground hover:text-foreground" aria-label="Where this comes from">
            <InfoIcon className="size-3.5" />
          </button>
        </Tip>
      </div>

      {error ? (
        <Empty icon={BarChart3Icon} title="Couldn't load the history" />
      ) : !data || !totals ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Skeleton className="h-56" />
            <Skeleton className="h-56" />
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Cards opened" value={totals.opened} />
            <Stat label="Cards closed" value={totals.closed} tone="ok" />
            <Stat label="Factory PRs merged" value={totals.mergedFactory} tone="brand" />
            <Stat label="Your PRs merged" value={totals.mergedYou} />
            <Stat label="Live runs" value={totals.runs} hint={totals.doneRate != null ? `${totals.doneRate}% done` : undefined} />
            <Stat label="API-equivalent" value={totals.cost} format={money} hint={totals.minutes != null ? `~${totals.minutes} min a run` : undefined} />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Card className="p-4">
              <BarChart title="Cards" labels={labels} series={[{ name: "Opened", color: COLORS.brand, values: count(data.issues, "created") }, { name: "Closed", color: COLORS.ok, values: count(data.issues, "closed") }]} />
            </Card>
            <Card className="p-4">
              <BarChart title="PRs merged" labels={labels} series={[{ name: "Factory", color: COLORS.brand, values: count(data.pulls, "merged", (p) => p.factory) }, { name: "You", color: COLORS.info, values: count(data.pulls, "merged", (p) => !p.factory) }]} />
            </Card>
            <Card className="p-4">
              <BarChart title="Live runs" labels={labels} series={[{ name: "Done", color: COLORS.ok, values: count(live, "at", (r) => r.status === "done") }, { name: "Not done", color: COLORS.bad, values: count(live, "at", (r) => r.status !== "done") }]} />
            </Card>
            <Card className="p-4">
              <BarChart title="API-equivalent cost" labels={labels} format={(v) => "$" + v.toFixed(v >= 10 ? 0 : 2)} series={[{ name: "Cost", color: COLORS.brand, values: fold(live, "at", (a, r) => a + r.cost) }]} />
            </Card>
            <Card className="p-4 md:col-span-2">
              <BarChart title="Peak plan usage (week window)" labels={labels} format={(v) => Math.round(v) + "%"} series={[{ name: "Week", color: COLORS.warn, values: fold(data.usage, "at", (a, u) => Math.max(a, (u.week ?? 0) * 100)) }]} />
            </Card>
          </div>
          {data.scores && <Scores d={d} sc={data.scores} />}
        </>
      )}

      <Trials d={d} />
    </div>
  );
}

const sizeLabel = (s: string) => (s === "none" ? "unsized" : s);
const th = "px-3 py-2 text-left font-medium whitespace-nowrap";
const td = "px-3 py-2 whitespace-nowrap";

/** PR scores (src/scores.ts): all time, every repo the factory serves. */
function Scores({ d, sc }: { d: State; sc: State }) {
  const [every, setEvery] = React.useState(false);
  const rows: State[] = sc.rows ?? [];
  const avg = rows.length ? Math.round(rows.reduce((a, r) => a + r.score, 0) / rows.length) : null;
  return (
    <Section
      title="PR scores"
      description={`All time · ${rows.length} merged factory PR${rows.length === 1 ? "" : "s"}${avg != null ? ` · average ${avg}` : ""}`}
      flush
      actions={
        sc.formula?.length ? (
          <Tip
            content={
              <ul className="list-disc space-y-0.5 pl-4">
                {sc.formula.map((l: string, i: number) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            }
          >
            <Button size="xs" variant="ghost">
              <InfoIcon /> How it's scored
            </Button>
          </Tip>
        ) : undefined
      }
    >
      {!rows.length ? (
        <div className="p-4 text-sm text-muted-foreground">No merged factory PRs scored yet.</div>
      ) : (
        <>
          {sc.advice?.length > 0 && (
            <ul className="flex flex-col gap-1.5 border-b px-4 py-3 text-sm">
              {sc.advice.map((a: string, i: number) => (
                <li key={i} className="flex gap-2">
                  <LightbulbIcon className="mt-0.5 size-3.5 shrink-0 text-warn" />
                  <span>{a}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className={th}>Size</th>
                  <th className={th}>Lane</th>
                  <th className={th}>Model</th>
                  <th className={cn(th, "text-right")}>PRs</th>
                  <th className={cn(th, "text-right")}>Score</th>
                  <th className={cn(th, "text-right")}>Cost a PR</th>
                  <th className={cn(th, "text-right")}>Review rounds</th>
                  <th className={cn(th, "text-right")}>Reverted</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {(sc.groups ?? []).map((g: State, i: number) => (
                  <tr key={i}>
                    <td className={td}>{sizeLabel(g.size)}</td>
                    <td className={td}>{g.lane}</td>
                    <td className={cn(td, "text-muted-foreground")}>{g.model}</td>
                    <td className={cn(td, "text-right tabular-nums")}>{g.prs}</td>
                    <td className={cn(td, "text-right font-semibold tabular-nums")}>{g.score}</td>
                    <td className={cn(td, "text-right tabular-nums")}>{g.cost != null ? money(g.cost) : "–"}</td>
                    <td className={cn(td, "text-right tabular-nums")}>{g.rounds}</td>
                    <td className={cn(td, "text-right tabular-nums", g.reverted && "text-bad")}>{g.reverted || "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button onClick={() => setEvery(!every)} className="flex w-full items-center gap-1.5 border-t px-4 py-2.5 text-xs font-medium text-muted-foreground transition hover:bg-accent/40 hover:text-foreground">
            <ChevronDownIcon className={cn("size-3.5 transition", !every && "-rotate-90")} /> Every PR ({rows.length})
          </button>
          {every && (
            <div className="max-h-[28rem] overflow-auto border-t">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted text-muted-foreground">
                  <tr>
                    <th className={th}>PR</th>
                    <th className={th}>Size</th>
                    <th className={th}>Model</th>
                    <th className={cn(th, "text-right")}>Score</th>
                    <th className={th}>Points off</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((r) => (
                    <tr key={`${r.repo}#${r.pr}`} className="cursor-pointer hover:bg-accent/40" onClick={() => openItem({ number: r.pr, title: r.title, repo: r.repo, pr: r.pr, isPr: true, column: "done" })}>
                      <td className="max-w-72 px-3 py-2">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <IssueRef repo={r.repo} primary={d.repo} n={r.pr} pr />
                          <span className="truncate">{r.title}</span>
                        </div>
                      </td>
                      <td className={td}>{sizeLabel(r.size)}</td>
                      <td className={cn(td, "text-muted-foreground")}>{r.model}</td>
                      <td className={cn(td, "text-right font-semibold tabular-nums")}>{r.score}</td>
                      <td className="min-w-48 px-3 py-2 text-muted-foreground">{r.parts?.length ? r.parts.map((p: State) => `−${p.points} ${p.why}`).join(" · ") : "none"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Section>
  );
}

/** Quality trial reports (data/trials/*.md); each opens in the details sheet. */
function Trials({ d }: { d: State }) {
  const trials: State[] = d.trials ?? [];
  if (!trials.length) return null;
  return (
    <Section title="Quality trials" description={`${trials.length} report${trials.length === 1 ? "" : "s"}`} flush>
      <div className="divide-y">
        {trials.map((t) => (
          <button key={t.name} onClick={() => openTrial(t)} className="group flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-accent/50">
            <FlaskConicalIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-sm">{t.title}</span>
            {t.wins && (
              <Badge variant="ok" className="hidden max-w-56 truncate sm:inline-flex">
                {String(t.wins).replace(/^Wins:\s*/, "")}
              </Badge>
            )}
            <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground/50 transition group-hover:translate-x-0.5" />
          </button>
        ))}
      </div>
    </Section>
  );
}
