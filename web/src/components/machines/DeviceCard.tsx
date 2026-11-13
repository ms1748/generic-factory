// One machine on the Devices tab: a compact header, its live meters and a sparkline, CI on it (pause,
// build threads, the job running now with its steps, the last results), any game test waiting on the owner,
// and everything else (specs, disks, sensors, queue, artifacts, starts and stops, facts) behind Details.
import * as React from "react";
import { CheckCircle2Icon, ChevronDownIcon, CpuIcon, ExternalLinkIcon, Gamepad2Icon, MoreHorizontalIcon, PauseIcon, PlayIcon, Settings2Icon, Trash2Icon, XCircleIcon, CircleDashedIcon, MinusCircleIcon, BoxesIcon } from "lucide-react";
import { control, type State } from "@/lib/api";
import { pull } from "@/lib/systems";
import { confirm } from "@/lib/overlays";
import { go } from "@/lib/router";
import { bytes, level, rel, uptime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Spark } from "@/components/charts";
import { BorderBeam, Dot, Shimmer } from "@/components/magic";
import { IssueRef } from "@/components/patterns";
import { Badge, Card, Input, Progress, Select, Tip } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/overlays";
import { barTone, ciPaused, ciText, gauges, Meter, metricsOf, MetricPicker, points, RANGE_WORDS, secs } from "./shared";

const ANSWER: Record<string, string> = { start: "Start", later: "Later", skip: "Skip" };

/** A game test (src/gaming.ts): Start / Later / Skip while it waits for the owner, Stop (asks first) any time. */
export function GameTest({ g, repo, busy, act }: { g: State; repo: string; busy: boolean; act: (g: State, what: string) => void }) {
  const waiting = g.state === "waiting";
  const stop = () =>
    confirm({
      title: `Stop the game test${g.pr ? ` for #${g.pr}` : ""}?`,
      body: "Its run is cancelled on GitHub. What it measured so far may not be uploaded.",
      yes: "Stop",
      danger: true,
      action: () => act(g, "stop"),
    });
  return (
    <div className={cn("relative grid gap-2 overflow-hidden rounded-lg border p-3", waiting ? "border-warn/40 bg-warn/5" : "border-ok/30 bg-ok/5")}>
      {waiting && <BorderBeam size={60} from="var(--warn)" to="var(--brand)" />}
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <Gamepad2Icon className={cn("size-4 shrink-0", waiting ? "text-warn" : "text-ok")} />
        <span className="font-medium">Game test</span>
        {g.pr && <IssueRef repo={repo} n={g.pr} pr />}
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{g.title}</span>
        <a href={g.url} target="_blank" rel="noopener" className="inline-flex shrink-0 items-center gap-1 text-xs text-brand hover:underline">
          Log <ExternalLinkIcon className="size-3" />
        </a>
      </div>
      <div className="text-xs text-muted-foreground">
        {waiting ? <span className="font-medium text-warn">Waiting for you</span> : <Shimmer>Running{g.step ? `: ${g.step}` : ""}</Shimmer>}
        {g.at && ` · started ${rel(g.at)}`}
        {!g.sha && waiting && (
          <Tip content="Can't tell which PR it's for, so answer on the machine.">
            <span className="ml-1 cursor-help text-warn underline decoration-dotted">answer on the machine</span>
          </Tip>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {(g.answers ?? []).map((a: string) => (
          <Button key={a} size="xs" variant={a === "start" ? "brand" : "outline"} disabled={busy} onClick={() => act(g, a)}>
            {a === "start" && <PlayIcon />}
            {ANSWER[a] ?? a}
          </Button>
        ))}
        <Button size="xs" variant="ghost" className="text-bad hover:text-bad" disabled={busy} onClick={stop}>
          Stop
        </Button>
      </div>
    </div>
  );
}

const stepIcon = (s: State) =>
  s.status === "in_progress" ? <Dot tone="warn" live className="mx-1" /> : s.status !== "completed" ? <CircleDashedIcon className="size-3.5 text-muted-foreground" /> : s.conclusion === "success" ? <CheckCircle2Icon className="size-3.5 text-ok" /> : s.conclusion === "skipped" ? <MinusCircleIcon className="size-3.5 text-muted-foreground" /> : <XCircleIcon className="size-3.5 text-bad" />;

/** The job running now: its current step and progress; every step on demand. */
function JobNow({ j }: { j: State }) {
  const [open, setOpen] = React.useState(false);
  const steps: State[] = j.steps ?? [];
  const done = steps.filter((s) => s.status === "completed").length;
  const cur = steps.find((s) => s.status === "in_progress");
  return (
    <div className="grid gap-2 rounded-lg border border-ok/30 p-3">
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <Dot tone="ok" live />
        <span className="min-w-0 flex-1 truncate font-medium">{j.name}</span>
        <a href={j.url} target="_blank" rel="noopener" className="inline-flex shrink-0 items-center gap-1 text-xs text-brand hover:underline">
          Log <ExternalLinkIcon className="size-3" />
        </a>
      </div>
      <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">{cur ? <Shimmer>{cur.name}</Shimmer> : "Starting"}</span>
        <span className="shrink-0 tabular-nums">
          {done}/{steps.length} · {rel(j.at)}
        </span>
      </div>
      {steps.length > 0 && <Progress value={(done / steps.length) * 100} tone="ok" />}
      {steps.length > 0 && (
        <button onClick={() => setOpen(!open)} className="inline-flex items-center gap-1 self-start text-xs text-muted-foreground hover:text-foreground">
          <ChevronDownIcon className={cn("size-3.5 transition", open && "rotate-180")} /> {open ? "Hide steps" : "All steps"}
          {j.branch && <span className="ml-1 truncate font-mono">{j.branch}</span>}
        </button>
      )}
      {open && (
        <ol className="grid gap-1 text-xs">
          {steps.map((s, i) => (
            <li key={i} className={cn("grid grid-cols-[18px_1fr_auto] items-center gap-1.5", s.status !== "completed" && s.status !== "in_progress" && "text-muted-foreground")}>
              <span className="grid place-items-center">{stepIcon(s)}</span>
              <span className="truncate">{s.name}</span>
              <span className="tabular-nums text-muted-foreground">{secs(s.seconds)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

const failedAt = (j: State) => j.steps?.find((x: State) => x.status === "completed" && x.conclusion === "failure")?.name;
const size = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);

/** CI build threads (CARGO_BUILD_JOBS) the guard hands each job on this machine. */
function ThreadsDialog({ name, cores, threads, open, onOpenChange }: { name: string; cores?: number; threads: State; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [form, setForm] = React.useState({ default: "6", gaming: "pause", max: "12" });
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (open) setForm({ default: String(threads.default), gaming: threads.gaming == null ? "pause" : String(threads.gaming), max: String(threads.max) });
  }, [open, threads]);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const ok = await control(`devices/${name}/threads`, { default: Number(form.default), gaming: form.gaming === "pause" ? null : Number(form.gaming), max: Number(form.max) });
    pull();
    setBusy(false);
    if (ok) onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={`Build threads on ${name}`} description={`${cores ? `${cores} threads on this PC. ` : ""}Takes effect from the next job.`}>
        <form onSubmit={save} className="grid gap-3 text-sm">
          <label className="flex items-center justify-between gap-3">
            Every build
            <Input type="number" min={1} max={64} required value={form.default} onChange={(e) => setForm({ ...form, default: e.target.value })} />
          </label>
          <label className="flex items-center justify-between gap-3">
            While you play
            <Select value={form.gaming} onChange={(e) => setForm({ ...form, gaming: e.target.value })}>
              <option value="pause">Paused</option>
              {Array.from({ length: Math.max(cores ?? 16, 1) }, (_, i) => String(i + 1)).map((n) => (
                <option key={n} value={n}>
                  {n} threads
                </option>
              ))}
            </Select>
          </label>
          <label className="flex items-center justify-between gap-3">
            <span>
              Most a PR may ask for
              <span className="block text-xs text-muted-foreground">
                With a <code className="font-mono">build-threads:N</code> label or a "Build threads: N" line
              </span>
            </span>
            <Input type="number" min={1} max={64} required value={form.max} onChange={(e) => setForm({ ...form, max: e.target.value })} />
          </label>
          <div className="flex justify-end gap-2 pt-1">
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" variant="brand" disabled={busy}>
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeviceCard({ name, m, ci, games, repo, host, range, busyRun, act }: { name: string; range: string; m?: State; ci?: State; games: State[]; repo: string; host?: string; busyRun: number; act: (g: State, what: string) => void }) {
  const [metric, setMetric] = React.useState("cpu");
  const [details, setDetails] = React.useState(false);
  const [threads, setThreads] = React.useState(false);
  const running = (ci?.now?.length ?? 0) > 0;
  const online = Boolean(m?.online || running);
  const metrics = metricsOf(m?.history);
  const cur = metrics.find((x) => x.key === metric) ?? metrics[0];
  const pts = points(m?.history, cur.key);
  const facts = Object.entries((m?.facts ?? {}) as Record<string, string>).filter(([k]) => k !== "GPU fan");
  const warnings = facts.filter(([, v]) => /not installed|pending/.test(v)).length;
  const canForget = m && !m.online && !m.role;
  const c = m?.ci;
  const pauseCi = () => control(`devices/${name}/ci`, { paused: !c.owner }).then(pull);
  const forget = () =>
    confirm({
      title: `Forget ${name}?`,
      body: "Its saved report and history are removed. If its reporter still runs, it comes back at the next report.",
      yes: "Forget",
      danger: true,
      action: () => control(`devices/${name}/forget`).then(pull),
    });
  const role = m?.role ?? ci?.role ?? m?.model ?? "";
  const status = !m?.lastSeen ? (running ? "CI only" : "not set up") : m.online ? `up ${uptime(m.uptime)}` : `offline · ${rel(m.lastSeen)}`;
  const nGuests = (m?.containers?.length ?? 0) + (m?.guests?.length ?? 0);

  return (
    <Card className={cn("relative flex min-w-0 flex-col overflow-hidden", !online && m?.lastSeen && "opacity-80")}>
      {running && <BorderBeam size={70} duration={8} />}
      {/* Header */}
      <div className="flex min-w-0 items-center gap-3 border-b px-4 py-3">
        <Tip content={online ? "Reporting" : m?.lastSeen ? `Last report ${rel(m.lastSeen)}` : "No reports"}>
          <span className="inline-flex">
            <Dot tone={online ? "ok" : "muted"} live={online} />
          </span>
        </Tip>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{name}</div>
          {role && <div className="truncate text-xs text-muted-foreground">{role}</div>}
        </div>
        <Badge variant={m?.online ? "ok" : "outline"} className="shrink-0">
          {status}
        </Badge>
        {(c?.threads || canForget) && (
          <Menu>
            <MenuTrigger asChild>
              <Button size="icon-sm" variant="ghost" className="-mr-2 shrink-0" aria-label={`${name} actions`}>
                <MoreHorizontalIcon />
              </Button>
            </MenuTrigger>
            <MenuContent>
              {c?.threads && (
                <MenuItem onSelect={() => setThreads(true)}>
                  <Settings2Icon /> Build threads…
                </MenuItem>
              )}
              {canForget && (
                <MenuItem destructive onSelect={forget}>
                  <Trash2Icon /> Forget
                </MenuItem>
              )}
            </MenuContent>
          </Menu>
        )}
      </div>

      <div className="grid min-w-0 gap-3 p-4">
        {/* CI on it */}
        {c && (
          <div className={cn("flex min-w-0 items-center gap-2 rounded-lg border px-3 py-1.5 text-xs", ciPaused(c) && "border-warn/40 bg-warn/5")}>
            <Dot tone={ciPaused(c) ? "warn" : c.guard ? "ok" : "muted"} />
            <span className="min-w-0 flex-1 truncate">{ciText(c)}</span>
            {c.threads && (
              <Tip content={`Builds use ${c.threads.default} threads · PRs up to ${c.threads.max} · while you play: ${c.threads.gaming == null ? "paused" : c.threads.gaming}`}>
                <Button size="xs" variant="ghost" className="shrink-0 px-1.5" onClick={() => setThreads(true)} aria-label="Build threads">
                  <CpuIcon /> {c.threads.default}
                </Button>
              </Tip>
            )}
            <Button size="xs" variant={c.owner ? "brand" : "outline"} className="shrink-0" onClick={pauseCi}>
              {c.owner ? <PlayIcon /> : <PauseIcon />}
              {c.owner ? "Resume" : "Pause"}
            </Button>
          </div>
        )}

        {games.map((g) => (
          <GameTest key={g.run} g={g} repo={repo} busy={busyRun !== 0} act={act} />
        ))}
        {(ci?.now ?? []).map((j: State) => (
          <JobNow key={j.id} j={j} />
        ))}

        {/* Live meters and history */}
        {m?.lastSeen ? (
          <>
            <div className={cn("grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3", !m.online && "opacity-60")}>
              {gauges(m).map((g) => (
                <Meter key={g.label} label={g.label} value={g.value} tone={g.tone} text={g.text} sub={g.sub} />
              ))}
            </div>
            <div className="grid min-w-0 gap-1.5">
              <MetricPicker metrics={metrics} value={cur.key} onChange={setMetric} />
              {pts.filter((p) => p.v != null).length > 1 ? (
                <Spark points={pts} color={cur.color} max={cur.max} format={cur.fmt} height={40} label={`${name} ${cur.label}, ${RANGE_WORDS[range] ?? "history"}`} />
              ) : (
                <div className="grid h-10 place-items-center rounded-lg border border-dashed text-xs text-muted-foreground">History fills in as reports arrive</div>
              )}
            </div>
          </>
        ) : !ci ? (
          <SetupHint name={name} host={host} />
        ) : null}

        {/* CI summary: queue and last results */}
        {ci && (
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
            <span className="text-muted-foreground">CI</span>
            <Badge variant={running ? "ok" : ci.queue.length ? "warn" : "outline"}>{running ? "running" : ci.queue.length ? `${ci.queue.length} waiting` : "idle"}</Badge>
            {ci.recent.length > 0 && (
              <span className="flex items-center gap-0.5">
                {ci.recent.map((j: State) => (
                  <Tip key={j.id} content={`${j.name}${j.branch ? ` · ${j.branch}` : ""} · ${rel(j.at)}${failedAt(j) ? ` · failed at ${failedAt(j)}` : ""}`}>
                    <a href={j.url} target="_blank" rel="noopener" className="rounded-full p-0.5 hover:bg-accent" aria-label={`${j.name}: ${j.conclusion}`}>
                      {j.conclusion === "success" ? <CheckCircle2Icon className="size-4 text-ok" /> : <XCircleIcon className="size-4 text-bad" />}
                    </a>
                  </Tip>
                ))}
              </span>
            )}
            {!ci.recent.length && <span className="text-muted-foreground">no finished jobs lately</span>}
          </div>
        )}
      </div>

      {/* Details */}
      {(m?.lastSeen || ci) && (
        <button onClick={() => setDetails(!details)} aria-expanded={details} className="flex items-center gap-2 border-t px-4 py-2 text-xs font-medium text-muted-foreground transition hover:bg-accent/40 hover:text-foreground">
          <ChevronDownIcon className={cn("size-3.5 transition", details && "rotate-180")} />
          Details
          {warnings > 0 && <Badge variant="warn">{warnings} to check</Badge>}
          <span className="ml-auto font-normal">{m?.lastSeen ? rel(m.lastSeen) : ""}</span>
        </button>
      )}
      {details && (
        <div className="grid min-w-0 gap-4 border-t bg-muted/20 p-4 text-xs">
          {m?.lastSeen ? <Specs m={m} /> : <SetupHint name={name} host={host} />}
          {m?.disks?.length > 0 && (
            <Block title="Disks">
              {m.disks.map((x: State) => {
                const f = x.used / x.total;
                return (
                  <div key={x.mount} className="grid grid-cols-[minmax(0,5rem)_1fr_auto] items-center gap-2">
                    <span className="truncate font-mono" title={x.mount}>
                      {x.mount}
                    </span>
                    <Progress value={f * 100} tone={barTone(level(f, 0.8, 0.92))} />
                    <span className="tabular-nums text-muted-foreground">
                      {bytes(x.used)} / {bytes(x.total, 0)}
                    </span>
                  </div>
                );
              })}
            </Block>
          )}
          {ci?.queue?.length > 0 && (
            <Block title="Waiting for it">
              {ci.queue.map((j: State) => (
                <div key={j.id} className="flex min-w-0 gap-2">
                  <CircleDashedIcon className="mt-px size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{j.name}</span>
                  <span className="shrink-0 text-muted-foreground">queued {rel(j.at)}</span>
                </div>
              ))}
            </Block>
          )}
          {ci?.recent?.length > 0 && (
            <Block title="Last results">
              {ci.recent.map((j: State) => (
                <div key={j.id} className="grid min-w-0 gap-0.5">
                  <div className="flex min-w-0 items-center gap-2">
                    {j.conclusion === "success" ? <CheckCircle2Icon className="size-3.5 shrink-0 text-ok" /> : <XCircleIcon className="size-3.5 shrink-0 text-bad" />}
                    <a href={j.url} target="_blank" rel="noopener" className="min-w-0 flex-1 truncate hover:text-brand hover:underline">
                      {j.name}
                    </a>
                    <span className="shrink-0 text-muted-foreground">{rel(j.at)}</span>
                  </div>
                  {j.conclusion !== "success" && failedAt(j) && (
                    <div className="pl-5 text-muted-foreground">
                      Failed at <b className="font-medium text-foreground">{failedAt(j)}</b>
                    </div>
                  )}
                  {j.artifacts?.length > 0 && (
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 pl-5">
                      {j.artifacts.map((a: State) =>
                        a.expired ? (
                          <span key={a.name} className="text-muted-foreground line-through">
                            {a.name}
                          </span>
                        ) : (
                          <a key={a.name} href={a.url} target="_blank" rel="noopener" className="text-brand hover:underline">
                            {a.name} <span className="text-muted-foreground">{size(a.size)}</span>
                          </a>
                        ),
                      )}
                    </div>
                  )}
                </div>
              ))}
            </Block>
          )}
          {m?.events?.length > 0 && (
            <Block title="Starts and stops">
              {m.events.map((e: State) => (
                <div key={e.at + e.id} className={cn("flex min-w-0 gap-2", (e.id === 6008 || e.id === 41) && "text-bad")}>
                  <span className="w-16 shrink-0 tabular-nums text-muted-foreground">{rel(e.at)}</span>
                  <span className="min-w-0 truncate" title={e.reason ?? ""}>
                    {e.kind}
                    {e.reason ? `: ${e.reason}` : ""}
                  </span>
                </div>
              ))}
            </Block>
          )}
          {facts.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {facts.map(([k, v]) => (
                <Badge key={k} variant={/not installed|pending/.test(v) ? "warn" : "outline"} className="max-w-full whitespace-normal">
                  <span className="text-muted-foreground">{k}</span> <b className="font-medium">{v}</b>
                </Badge>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
            <span>{m?.sources?.length ? `From ${m.sources.map((s: string) => (s === "pve" ? "Proxmox" : s === "docker" ? "Docker" : "its reporter")).join(" and ")}` : m?.lastSeen ? "Saved report" : "CI only"}</span>
            {nGuests > 0 && (
              <Button size="xs" variant="ghost" className="ml-auto" onClick={() => go("machines", "systems")}>
                <BoxesIcon /> {nGuests} containers
              </Button>
            )}
            {canForget && (
              <Button size="xs" variant="ghost" className={cn("text-bad hover:text-bad", !nGuests && "ml-auto")} onClick={forget}>
                <Trash2Icon /> Forget
              </Button>
            )}
          </div>
        </div>
      )}
      {c?.threads && <ThreadsDialog name={name} cores={m?.cores} threads={c.threads} open={threads} onOpenChange={setThreads} />}
    </Card>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}

function Specs({ m }: { m: State }) {
  const rows: [string, React.ReactNode][] = [];
  if (m.cpuModel) rows.push(["CPU", m.cpuModel]);
  if (m.sensors?.cpuClock != null) rows.push(["Clock", `${(m.sensors.cpuClock / 1000).toFixed(2)} GHz`]);
  if (m.gpu) rows.push(["GPU", `${m.gpu.name ?? ""}${m.gpu.memTotal ? ` · ${bytes(m.gpu.memUsed)} / ${bytes(m.gpu.memTotal, 0)}` : ""}${m.gpu.clock != null ? ` · ${Math.round(m.gpu.clock)} MHz` : ""}`]);
  if (m.os) rows.push(["OS", m.os]);
  if (m.load?.length) rows.push(["Load", m.load.map((x: number) => x.toFixed(2)).join(" · ")]);
  if (m.net) rows.push(["Network", `↓ ${bytes(m.net.rx)}/s · ↑ ${bytes(m.net.tx)}/s`]);
  if (m.sensors?.ccdTemps?.length) rows.push(["CCDs", m.sensors.ccdTemps.map((t: number) => Math.round(t) + " °C").join(" · ")]);
  if (m.sensors?.fans?.length) rows.push(["Fans", m.sensors.fans.map((f: State) => `${f.name} ${Math.round(f.rpm)}`).join(" · ") + " RPM"]);
  if (!rows.length) return null;
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
      {rows.map(([k, v]) => (
        <React.Fragment key={k}>
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="truncate tabular-nums" title={typeof v === "string" ? v : undefined}>
            {v}
          </dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

/** A machine that's never reported: how to set its reporter up. */
function SetupHint({ name, host }: { name: string; host?: string }) {
  const code = "rounded border bg-muted px-1 font-mono text-[11px] break-all";
  return (
    <div className="rounded-lg border border-dashed p-3 text-xs leading-relaxed text-muted-foreground">
      {name === host ? (
        <>
          Set <code className={code}>PVE_URL</code> and <code className={code}>PVE_TOKEN</code> (a read-only PVEAuditor token) in the factory's env, and run <code className={code}>machines/reporters/report-linux.sh</code> on the host for temperatures.
        </>
      ) : (
        <>
          In an elevated PowerShell on this PC: <code className={code}>reporters\report-windows.ps1 -Install -Name {name} -Url http://&lt;factory-host&gt;:8080</code>
        </>
      )}
    </div>
  );
}
