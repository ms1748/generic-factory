// Machines › Performance (src/perf.ts): how each build did in the hardware tests. The list is every run,
// newest first, with startup, shutdown, frame rate, peaks and what changed against the build before on the
// same machine and game. A run opens its page (#/machines/performance/<run id>): the numbers, the comparison,
// charts over the run, processes and events. #/machines/performance/<build> lists one build's runs.
import * as React from "react";
import { ArrowLeftIcon, ExternalLinkIcon, GaugeIcon, RefreshCwIcon, SettingsIcon, XIcon, ChevronRightIcon } from "lucide-react";
import { getJson, postJson, say, type State } from "@/lib/api";
import { go } from "@/lib/router";
import { bytes, gh, rel, time } from "@/lib/format";
import { cn } from "@/lib/utils";
import { COLORS, Spark } from "@/components/charts";
import { Dot } from "@/components/magic";
import { Empty, Section, Segmented, SettingList, SettingRow } from "@/components/patterns";
import { Badge, Card, Input, Select, Skeleton, Switch, Tip } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";

const ms = (v: number | null | undefined) => (v == null ? "–" : v < 1000 ? `${Math.round(v)} ms` : `${(v / 1000).toFixed(1)} s`);
const pct = (v: number | null | undefined) => (v == null ? "–" : `${Math.round(v)}%`);
const deg = (v: number | null | undefined) => (v == null ? "–" : `${Math.round(v)} °C`);
const fps = (v: number) => `${Math.round(v * 10) / 10} fps`;
const FMT: Record<string, (v: number) => string> = { ms, fps, bytes: (v) => bytes(v), "%": (v) => `${Math.round(v)}%`, count: (v) => String(v) };
const change = (c: State) => `${c.what} ${c.pct > 0 ? "+" : ""}${Math.round(c.pct)}%`;
const outcomeTone = (o: string) => (o === "pass" ? "ok" : o === "fail" || o === "broken" ? "bad" : "warn");
const label = (r: State) => r.build || r.sha?.slice(0, 7) || `run ${r.id}`;
const kindWord = (k: string) => (k === "gaming" ? "Game test" : k === "box" ? "Test box" : k);

type App = { ui: string; processes: string[] };
const mainFps = (s: State, app: App): [string, { avg: number; low1: number }] | null => {
  const e = Object.entries((s.fps ?? {}) as Record<string, { avg: number; low1: number }>);
  return e.find(([k]) => k !== app.ui) ?? e[0] ?? null;
};
const memPeak = (s: State, app: App) => app.processes.map((k) => s.procs?.[k]?.mem.peak ?? 0).reduce((a, b) => a + b, 0) || null;
const tempPeak = (s: State) => s.sys?.cpuTemp?.peak ?? s.sys?.gpuTemp?.peak ?? s.sys?.acpiTemp?.peak ?? null;

export function PerfTab({ d, arg }: { d: State; arg: string }) {
  return /^\d+$/.test(arg) ? <RunPage d={d} id={Number(arg)} /> : <RunList build={decodeURIComponent(arg)} />;
}

/* ----- Every run ----- */

function RunList({ build }: { build: string }) {
  const [list, setList] = React.useState<State | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [kind, setKind] = React.useState("");
  const [machine, setMachine] = React.useState("");
  const [pulling, setPulling] = React.useState(false);
  const load = React.useCallback(async () => {
    const q = new URLSearchParams({ ...(kind && { kind }), ...(machine && { machine }), ...(build && { build }) });
    const j = await getJson(`/api/perf?${q}`);
    const ok = Array.isArray(j?.runs);
    setFailed(!ok);
    setList((l: State) => (ok ? j : (l ?? { runs: [], kinds: [], machines: [], total: 0 })));
  }, [kind, machine, build]);
  React.useEffect(() => {
    load();
  }, [load]);
  const pullNow = async () => {
    setPulling(true);
    try {
      const { ok, json } = await postJson("/api/perf/pull");
      say(json.message ?? json.error ?? (ok ? "Checked" : "Couldn't check"), !ok);
    } catch (e) {
      say((e as Error).message, true);
    }
    setPulling(false);
    load();
  };
  const app: App = list?.app ?? { ui: "", processes: [] };

  return (
    <div className="grid min-w-0 gap-4">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div className="max-w-full overflow-x-auto [scrollbar-width:none]">
          <Segmented value={kind} onChange={setKind} options={[{ value: "", label: "All" }, ...((list?.kinds ?? []) as string[]).map((k) => ({ value: k, label: k === "box" ? "Test box" : k === "gaming" ? "Game tests" : k }))]} />
        </div>
        {(list?.machines ?? []).length > 1 && (
          <Select value={machine} onChange={(e) => setMachine(e.target.value)} aria-label="Machine" className="h-8 text-xs">
            <option value="">Every machine</option>
            {list.machines.map((m: string) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        )}
        {build && (
          <Badge variant="brand" className="h-7 gap-1.5 px-2 text-xs">
            {build}
            <button onClick={() => go("machines", "performance")} aria-label="Show every build" className="hover:text-foreground">
              <XIcon />
            </button>
          </Badge>
        )}
        <Button size="sm" variant="outline" className="ml-auto" disabled={pulling} onClick={pullNow}>
          <RefreshCwIcon className={cn(pulling && "animate-spin")} /> Check now
        </Button>
      </div>

      {failed && <p className="text-xs text-bad">Couldn't read the performance records.</p>}

      {!list ? (
        <Card className="grid gap-3 p-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </Card>
      ) : !list.runs.length ? (
        <Empty icon={GaugeIcon} title={build ? `No runs of ${build} yet` : "No test runs yet"}>
          {build ? "A run shows up a few minutes after its test finishes." : "Each hardware test uploads a perf artifact; the dispatcher reads them every 5 minutes."}
        </Empty>
      ) : (
        <Card className="divide-y overflow-hidden">
          {list.runs.map((r: State) => {
            const s = r.summary;
            const f = mainFps(s, app);
            const mem = memPeak(s, app);
            const t = tempPeak(s);
            return (
              <button key={r.id} onClick={() => go("machines", "performance", String(r.id))} className="group grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1.5 px-4 py-3 text-left transition hover:bg-accent/40">
                <Tip content={r.outcome}>
                  <span className="mt-1.5 inline-flex">
                    <Dot tone={outcomeTone(r.outcome)} />
                  </span>
                </Tip>
                <div className="min-w-0">
                  <div className="truncate font-mono text-[13px]">
                    {label(r)}
                    {r.game ? <span className="font-sans text-muted-foreground"> · {r.game}</span> : ""}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {kindWord(r.kind)} · {r.machine} · {rel(r.started)}
                    {r.pr ? ` · #${r.pr}` : ""}
                  </div>
                </div>
                <ChevronRightIcon className="mt-1 size-4 text-muted-foreground/50 transition group-hover:translate-x-0.5" />
                <div className="col-start-2 col-end-4 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                  <Num k="start" v={ms(r.startup)} />
                  <Num k="quit" v={ms(r.shutdown)} bad={r.cleanExit === false} />
                  {f && <Num k="fps" v={`${f[1].avg}`} extra={`/ ${f[1].low1}`} />}
                  <Num k="CPU" v={pct(s.sys?.cpu?.peak)} />
                  {s.sys?.gpu && <Num k="GPU" v={pct(s.sys.gpu.peak)} />}
                  {mem != null && <Num k="app RAM" v={bytes(mem)} />}
                  {t != null && <Num k="temp" v={deg(t)} />}
                </div>
                {r.changes?.length > 0 && (
                  <div className="col-start-2 col-end-4 flex flex-wrap gap-1">
                    {r.changes.slice(0, 4).map((c: State, i: number) => (
                      <Badge key={i} variant={c.bad ? "bad" : "ok"}>
                        {change(c)}
                      </Badge>
                    ))}
                  </div>
                )}
              </button>
            );
          })}
        </Card>
      )}

      {list?.settings && <PerfSettings list={list} onSaved={load} />}
    </div>
  );
}

function Num({ k, v, extra, bad }: { k: string; v: string; extra?: string; bad?: boolean }) {
  return (
    <span className="whitespace-nowrap">
      <span className="text-muted-foreground">{k}</span> <b className={cn("font-medium tabular-nums", bad && "text-bad")}>{v}</b>
      {extra && <span className="tabular-nums text-muted-foreground"> {extra}</span>}
    </span>
  );
}

function PerfSettings({ list, onSaved }: { list: State; onSaved: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState<State>(list.settings ?? {});
  React.useEffect(() => {
    if (!open) setForm(list.settings ?? {});
  }, [open, list.settings]);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const { ok, json } = await postJson("/api/perf/settings", { ...form, keepDays: Number(form.keepDays), timePct: Number(form.timePct), fpsPct: Number(form.fpsPct), usePct: Number(form.usePct) });
      say(json.message ?? json.error ?? "Saved", !ok);
      if (ok) setOpen(false);
    } catch (err) {
      say((err as Error).message, true);
    }
    onSaved();
  };
  const num = (k: string, min: number, max: number) => <Input type="number" min={min} max={max} value={form[k] ?? ""} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />;
  return (
    <Section
      title="Settings"
      description={`${list.total} runs stored${list.last ? ` · checked ${rel(list.last.at)}` : ""}`}
      actions={
        <Button size="xs" variant="ghost" onClick={() => setOpen(!open)} aria-expanded={open}>
          <SettingsIcon /> {open ? "Close" : "Edit"}
        </Button>
      }
      flush={!open}
    >
      {open ? (
        <form onSubmit={save} className="grid gap-3">
          <SettingList>
            <SettingRow label="Keep time series" hint="Days; 0 keeps them forever. Runs and their numbers always stay.">
              {num("keepDays", 0, 3650)}
            </SettingRow>
            <SettingRow label="Flag slower startup or shutdown" hint="Percent slower than the build before.">
              {num("timePct", 1, 500)}
            </SettingRow>
            <SettingRow label="Flag lower frame rates" hint="Percent lower.">
              {num("fpsPct", 1, 100)}
            </SettingRow>
            <SettingRow label="Flag more app memory or CPU" hint="Percent higher.">
              {num("usePct", 1, 500)}
            </SettingRow>
            <SettingRow label="PR check line" hint="An always-passing factory/perf status linking the run.">
              <Switch checked={Boolean(form.status)} onCheckedChange={(v) => setForm({ ...form, status: v })} />
            </SettingRow>
          </SettingList>
          <div className="flex items-center gap-3">
            <Button type="submit" variant="brand" size="sm">
              Save
            </Button>
            {list.last?.error && <span className="text-xs text-bad">Last check failed: {list.last.error}</span>}
          </div>
        </form>
      ) : list.last?.error ? (
        <div className="px-4 py-2 text-xs text-bad">Last check failed: {list.last.error}</div>
      ) : null}
    </Section>
  );
}

/* ----- One run ----- */

// The run page's charts: one per metric the run has, in this order. [key, title, colour, max (0 = auto), format]
const CHARTS: [string, string, string, number, (v: number) => string][] = [
  ["sys.cpu", "CPU", COLORS.brand, 100, pct],
  ["sys.cpuTemp", "CPU temperature", COLORS.bad, 100, deg],
  ["sys.acpiTemp", "Board temperature", COLORS.bad, 100, deg],
  ["sys.cpuClock", "CPU clock", COLORS.brand, 0, (v) => `${Math.round(v)} MHz`],
  ["sys.cpuPower", "CPU power", COLORS.warn, 0, (v) => `${Math.round(v)} W`],
  ["sys.mem", "Memory used", COLORS.info, 0, (v) => bytes(v)],
  ["sys.gpu", "GPU", COLORS.brand, 100, pct],
  ["sys.gpuTemp", "GPU temperature", COLORS.bad, 100, deg],
  ["sys.gpuClock", "GPU clock", COLORS.brand, 0, (v) => `${Math.round(v)} MHz`],
  ["sys.gpuPower", "GPU power", COLORS.warn, 0, (v) => `${Math.round(v)} W`],
  ["sys.gpuFan", "GPU fan", COLORS.info, 100, pct],
  ["sys.fan", "Fastest fan", COLORS.info, 0, (v) => `${Math.round(v)} RPM`],
  ["sys.vram", "Video memory", COLORS.info, 0, (v) => bytes(v)],
  ["sys.diskRead", "Disk reads", COLORS.warn, 0, (v) => `${bytes(v)}/s`],
  ["sys.diskWrite", "Disk writes", COLORS.warn, 0, (v) => `${bytes(v)}/s`],
  ["sys.netRx", "Network in", COLORS.ok, 0, (v) => `${bytes(v)}/s`],
  ["sys.netTx", "Network out", COLORS.ok, 0, (v) => `${bytes(v)}/s`],
];
type Chart = { key: string; title: string; color: string; max: number; fmt: (v: number) => string; points: { at: string; v: number | null }[] };

function chartsOf(page: State): Chart[] {
  const c = page.chart as Record<string, (number | null)[]>;
  const at = (i: number) => new Date(Date.parse(page.run.started) + (c.t[i] ?? 0)).toISOString();
  const pts = (key: string) => c[key].map((v, i) => ({ at: at(i), v }));
  const has = (key: string) => c[key]?.some((v) => v != null);
  const out: Chart[] = [];
  for (const key of Object.keys(c).filter((k) => k.startsWith("fps.") && has(k))) out.push({ key, title: `${key.slice(4)} frame rate`, color: COLORS.ok, max: 60, fmt: fps, points: pts(key) });
  for (const [key, title, color, max, fmt] of CHARTS) if (has(key)) out.push({ key, title, color, max, fmt, points: pts(key) });
  const procs = [...new Set(Object.keys(c).filter((k) => k.startsWith("proc.")).map((k) => k.slice(5, k.lastIndexOf("."))))];
  for (const p of procs) {
    const add = (m: string, title: string, color: string, max: number, fmt: (v: number) => string) => has(`proc.${p}.${m}`) && out.push({ key: `proc.${p}.${m}`, title: `${p}: ${title}`, color, max, fmt, points: pts(`proc.${p}.${m}`) });
    add("cpu", "CPU", COLORS.brand, 100, pct);
    add("mem", "memory", COLORS.info, 0, (v) => bytes(v));
    add("gpu", "GPU", COLORS.brand, 100, pct);
    add("vram", "video memory", COLORS.info, 0, (v) => bytes(v));
  }
  return out;
}

function RunPage({ d, id }: { d: State; id: number }) {
  const [page, setPage] = React.useState<State | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [limits, setLimits] = React.useState<State | null>(null);
  React.useEffect(() => {
    let stop = false;
    setPage(null);
    getJson(`/api/perf/runs/${id}`).then((j) => {
      if (stop) return;
      const ok = j?.run && j.summary ? j : null;
      setFailed(!ok);
      setPage(ok);
    });
    getJson("/api/perf").then((j) => !stop && setLimits(j?.settings ?? null));
    return () => {
      stop = true;
    };
  }, [id]);
  const charts = React.useMemo(() => (page ? chartsOf(page) : []), [page]);
  const back = (
    <Button size="sm" variant="ghost" className="-ml-2" onClick={() => go("machines", "performance", page?.run.build ? encodeURIComponent(page.run.build) : "")}>
      <ArrowLeftIcon /> {page?.run.build ? `All runs of ${page.run.build}` : "All runs"}
    </Button>
  );
  if (!page)
    return (
      <div className="grid gap-4">
        <div>{back}</div>
        {failed ? (
          <Empty icon={GaugeIcon} title="Couldn't load that run">
            It may have been removed.
          </Empty>
        ) : (
          <Skeleton className="h-48 rounded-xl" />
        )}
      </div>
    );

  const r = page.run;
  const s = page.summary;
  const app: App = page.app ?? { ui: "", processes: [] };
  const f = mainFps(s, app);
  const procRows = Object.entries((s.procs ?? {}) as Record<string, State>);
  const tiles: { k: string; v: string; sub?: string; bad?: boolean }[] = [
    { k: "Startup", v: ms(r.startup) },
    { k: "Shutdown", v: ms(r.shutdown), sub: r.cleanExit === false ? "not clean" : r.cleanExit ? "clean" : undefined, bad: r.cleanExit === false },
  ];
  if (page.meta?.sessionWindows != null) tiles.push({ k: "Game windows up", v: ms(page.meta.sessionWindows) });
  if (f) tiles.push({ k: `${f[0]} fps`, v: String(f[1].avg), sub: `1% low ${f[1].low1}` });
  tiles.push({ k: "CPU peak", v: pct(s.sys?.cpu?.peak), sub: `avg ${pct(s.sys?.cpu?.avg)}` });
  if (s.sys?.gpu) tiles.push({ k: "GPU peak", v: pct(s.sys.gpu.peak), sub: `avg ${pct(s.sys.gpu.avg)}` });
  if (s.sys?.mem) tiles.push({ k: "Memory peak", v: bytes(s.sys.mem.peak) });
  if (s.sys?.cpuTemp) tiles.push({ k: "CPU temp", v: deg(s.sys.cpuTemp.peak), sub: `avg ${deg(s.sys.cpuTemp.avg)}` });
  if (s.sys?.gpuTemp) tiles.push({ k: "GPU temp", v: deg(s.sys.gpuTemp.peak), sub: `avg ${deg(s.sys.gpuTemp.avg)}` });
  if (s.sys?.gpuPower) tiles.push({ k: "GPU power", v: `${Math.round(s.sys.gpuPower.peak)} W`, sub: `avg ${Math.round(s.sys.gpuPower.avg)} W` });
  if (s.crashes) tiles.push({ k: "Crashes", v: String(s.crashes), bad: true });

  return (
    <div className="grid min-w-0 gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {back}
        <span className="flex-1" />
        {r.runUrl && (
          <Button asChild size="sm" variant="outline">
            <a href={r.runUrl} target="_blank" rel="noopener">
              CI run <ExternalLinkIcon />
            </a>
          </Button>
        )}
        {r.pr && (
          <Button asChild size="sm" variant="outline">
            <a href={gh(r.repo, "pull", r.pr)} target="_blank" rel="noopener">
              PR #{r.pr} <ExternalLinkIcon />
            </a>
          </Button>
        )}
      </div>

      <Section
        title={
          <span className="flex min-w-0 items-center gap-2">
            <Dot tone={outcomeTone(r.outcome)} />
            <span className="truncate font-mono">
              {label(r)}
              {r.version ? ` · v${r.version}` : ""}
            </span>
          </span>
        }
        description={`${kindWord(r.kind)} on ${r.machine}${r.game ? ` · ${r.game}` : ""} · ${time(r.started, d.timezone)} · ${Math.round(s.seconds / 60) || "<1"} min · ${r.sha?.slice(0, 7) ?? ""}`}
        actions={<Badge variant={outcomeTone(r.outcome)}>{r.outcome}</Badge>}
      >
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-[repeat(auto-fill,minmax(130px,1fr))] sm:gap-2">
          {tiles.map((t) => (
            <div key={t.k} className="min-w-0 rounded-lg border px-2.5 py-1.5 sm:px-3 sm:py-2">
              <div className="truncate text-[11px] text-muted-foreground">{t.k}</div>
              <div className={cn("truncate text-base font-semibold tabular-nums sm:text-lg", t.bad && "text-bad")}>{t.v}</div>
              {t.sub && <div className="truncate text-[11px] text-muted-foreground">{t.sub}</div>}
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Against the build before"
        description={
          page.prev ? (
            <>
              <button className="text-brand hover:underline" onClick={() => go("machines", "performance", String(page.prev.id))}>
                {label(page.prev)}
              </button>
              , {rel(page.prev.started)}
            </>
          ) : undefined
        }
        actions={
          limits && (
            <Tip content={`Flagged when startup or shutdown is ${limits.timePct}% slower, frame rates ${limits.fpsPct}% lower, or the app's memory or CPU ${limits.usePct}% higher.`}>
              <span className="cursor-help text-xs text-muted-foreground underline decoration-dotted">Limits</span>
            </Tip>
          )
        }
      >
        {!page.prev ? (
          <p className="text-sm text-muted-foreground">
            No earlier run of another commit on {r.machine}
            {r.game ? ` with ${r.game}` : ""} to compare with.
          </p>
        ) : page.changes.length ? (
          <ul className="grid gap-1.5 text-sm">
            {page.changes.map((c: State, i: number) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-2">
                <b className={cn("font-medium", c.bad ? "text-bad" : "text-ok")}>{change(c)}</b>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {(FMT[c.unit] ?? String)(c.before)} → {(FMT[c.unit] ?? String)(c.now)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Nothing changed beyond the limits.</p>
        )}
      </Section>

      <Section title="Over the run" description={page.samples ? `${page.samples} samples, about one a second` : undefined}>
        {!page.samples ? (
          <p className="text-sm text-muted-foreground">This run's time series was deleted (Settings › keep series) or it had none. Its numbers above stay.</p>
        ) : (
          <div className="grid min-w-0 gap-x-6 gap-y-5 sm:grid-cols-2 xl:grid-cols-3">
            {charts.map((c) => {
              const vs = c.points.map((p) => p.v).filter((v): v is number => v != null);
              return (
                <div key={c.key} className="grid min-w-0 gap-1.5">
                  <div className="flex min-w-0 flex-wrap justify-between gap-x-2 text-xs">
                    <span className="truncate font-medium">{c.title}</span>
                    <span className="tabular-nums text-muted-foreground">
                      avg {c.fmt(vs.reduce((a, b) => a + b, 0) / vs.length)} · peak {c.fmt(Math.max(...vs))}
                    </span>
                  </div>
                  <Spark points={c.points} color={c.color} max={c.max} format={c.fmt} height={48} label={c.title} />
                </div>
              );
            })}
          </div>
        )}
        {page.meta?.fpsNote && <p className="mt-3 text-xs text-muted-foreground">Frame rates: {page.meta.fpsNote}.</p>}
      </Section>

      {procRows.length > 0 && (
        <Section title="Processes" flush>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-xs">
              <thead className="text-muted-foreground">
                <tr className="border-b">
                  <th className="px-4 py-2 text-left font-medium">Process</th>
                  <th className="px-2 py-2 text-right font-medium">CPU avg / peak</th>
                  <th className="px-2 py-2 text-right font-medium">Memory peak</th>
                  <th className="px-2 py-2 text-right font-medium">GPU peak</th>
                  <th className="px-4 py-2 text-right font-medium">Video memory</th>
                </tr>
              </thead>
              <tbody className="divide-y tabular-nums">
                {procRows.map(([name, p]) => (
                  <tr key={name}>
                    <td className="max-w-48 truncate px-4 py-2 font-mono">{name}</td>
                    <td className="px-2 py-2 text-right">
                      {pct(p.cpu.avg)} / {pct(p.cpu.peak)}
                    </td>
                    <td className="px-2 py-2 text-right">{p.mem.peak == null ? "–" : bytes(p.mem.peak)}</td>
                    <td className="px-2 py-2 text-right">{pct(p.gpu.peak)}</td>
                    <td className="px-4 py-2 text-right">{p.vram.peak == null ? "–" : bytes(p.vram.peak)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      <Section title="Events">
        <ul className="grid gap-1 text-xs">
          {(page.meta?.events ?? []).map((e: State, i: number) => (
            <li key={"e" + i} className="flex gap-3">
              <span className="w-14 shrink-0 text-right tabular-nums text-muted-foreground">{(e.t / 1000).toFixed(1)} s</span>
              <span className="min-w-0">
                {e.name}
                {e.clean === false ? " (forced)" : ""}
                {e.note ? `: ${e.note}` : ""}
              </span>
            </li>
          ))}
          {(page.meta?.crashes ?? []).map((c: State, i: number) => (
            <li key={"c" + i} className="flex gap-3 text-bad">
              <span className="w-14 shrink-0 text-right tabular-nums">{time(c.at, d.timezone, { weekday: undefined })}</span>
              <span className="min-w-0 break-words">
                {c.kind}: {c.exe}
                {c.module ? ` in ${c.module}` : ""}
                {c.code ? ` (${c.code})` : ""}
              </span>
            </li>
          ))}
          {!page.meta?.events?.length && !page.meta?.crashes?.length && <li className="text-muted-foreground">No events recorded.</li>}
        </ul>
        {page.meta?.steps?.length > 0 && <Steps steps={page.meta.steps} />}
        {page.meta?.system && (
          <p className="mt-3 break-words text-[11px] text-muted-foreground">
            {Object.entries(page.meta.system as Record<string, unknown>)
              .filter(([, v]) => v != null)
              .map(([k, v]) => `${k}: ${typeof v === "number" && v > 1e8 ? bytes(v) : v}`)
              .join(" · ")}
          </p>
        )}
      </Section>
    </div>
  );
}

function Steps({ steps }: { steps: State[] }) {
  const [open, setOpen] = React.useState(false);
  const failed = steps.filter((s) => s.ok === false).length;
  return (
    <div className="mt-3 border-t pt-3">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
        <ChevronRightIcon className={cn("size-3.5 transition", open && "rotate-90")} /> Test steps ({steps.length}){failed > 0 && <Badge variant="bad">{failed} failed</Badge>}
      </button>
      {open && (
        <ul className="mt-2 grid gap-1 text-xs">
          {steps.map((st, i) => (
            <li key={i} className={cn("flex gap-3", st.ok === false && "text-bad")}>
              <span className="w-14 shrink-0 text-right tabular-nums text-muted-foreground">{ms(st.ms)}</span>
              <span className="min-w-0">
                {st.ok === null ? "skipped" : st.ok ? "passed" : "failed"}: {st.name}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
