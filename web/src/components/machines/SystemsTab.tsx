// Machines › Systems: open alerts, the headline numbers, the site checks (uptime and a tick per check),
// every machine's history for one metric over the chosen range, the containers on each host, the website's
// traffic and free-tier use (Cloudflare), and the alert history.
import * as React from "react";
import { AlertTriangleIcon, BellIcon, GlobeIcon, ServerIcon } from "lucide-react";
import type { State } from "@/lib/api";
import { useSystems, type Range } from "@/lib/systems";
import { go } from "@/lib/router";
import { bytes, count, level, rel, type Tone } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BarChart, COLORS, Spark } from "@/components/charts";
import { Dot, NumberTicker } from "@/components/magic";
import { Empty, Section } from "@/components/patterns";
import { Badge, Card, Progress, Skeleton, Tip } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { AlertText, barTone, METRICS, MetricPicker, points, RANGE_WORDS } from "./shared";

const day = (iso: string) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short" });
const code = "rounded border bg-muted px-1 font-mono text-[11px] break-all";

function Kpi({ label, icon: Icon, children, sub, tone, bar, onClick }: { label: string; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode; sub?: React.ReactNode; tone?: "warn" | "bad"; bar?: { value: number | null; tone: Tone }; onClick?: () => void }) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp onClick={onClick} className={cn("flex min-w-0 flex-col gap-1 rounded-xl border bg-card p-3 text-left shadow-xs sm:p-4", onClick && "transition hover:bg-accent/40", tone === "bad" && "border-bad/50", tone === "warn" && "border-warn/50")}>
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon className="size-3.5" /> <span className="truncate">{label}</span>
      </div>
      <div className={cn("text-xl font-semibold tracking-tight tabular-nums sm:text-2xl", tone === "bad" && "text-bad")}>{children}</div>
      {sub && <div className="truncate text-xs text-muted-foreground">{sub}</div>}
      {bar && <Progress className="mt-1" value={(bar.value ?? 0) * 100} tone={barTone(bar.tone)} />}
    </Comp>
  );
}

export function SystemsTab({ range }: { range: Range }) {
  const { data: s, error } = useSystems();
  const [metric, setMetric] = React.useState("cpu");
  if (!s)
    return error ? (
      <Empty icon={AlertTriangleIcon} title="Can't load systems">
        {error}
      </Empty>
    ) : (
      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );

  const site = s.site;
  const devices: State[] = s.devices ?? [];
  const checks: State[] = s.checks ?? [];
  const online = devices.filter((m) => m.online).length;
  const main = checks[0];
  const siteDown = Boolean(main?.last && !main.last.ok);
  const failing = checks.slice(1).filter((c) => c.last && !c.last.ok);
  const today: number | null = site?.functions?.at(-1)?.requests ?? null;
  const r2Bytes: number | null = site?.r2 ? site.r2.buckets.reduce((a: number, b: State) => a + b.bytes, 0) : null;
  const free = s.free ?? {};
  const al = s.alerts;
  const histMetrics = METRICS.filter((x) => ["cpu", "mem"].includes(x.key) || devices.some((m) => (m.history ?? []).some((h: State) => typeof h[x.key] === "number")));
  const cur = histMetrics.find((x) => x.key === metric) ?? histMetrics[0];
  const hosts = devices.filter((m) => m.containers?.length || m.guests?.length);

  return (
    <div className="grid min-w-0 gap-4">
      {al?.open?.length > 0 && (
        <Card className="border-bad/50 bg-bad/5 p-4" role="status">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-bad">
            <AlertTriangleIcon className="size-4" /> {al.open.length} alert{al.open.length === 1 ? "" : "s"} now
          </div>
          <ul className="grid gap-1 text-sm">
            {al.open.map((a: State) => (
              <li key={a.id} className="flex min-w-0 items-start gap-2">
                <Dot tone="bad" live className="mt-1.5" />
                <span className="min-w-0 flex-1">
                  <AlertText text={a.text} /> <span className="text-xs text-muted-foreground">· since {rel(a.at)}</span>
                </span>
              </li>
            ))}
          </ul>
          {!al.discord && (
            <button onClick={() => go("settings", "alerts")} className="mt-2 text-xs text-muted-foreground hover:text-foreground hover:underline">
              Discord isn't set up, so these only show here. Set it up →
            </button>
          )}
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Machines reporting" icon={ServerIcon} onClick={() => go("machines", "devices")} sub={<span className="flex gap-1">{devices.map((m) => <Tip key={m.name} content={m.name}><span className="inline-flex"><Dot tone={m.online ? "ok" : "muted"} /></span></Tip>)}</span>}>
          <NumberTicker value={online} />
          <span className="text-sm font-normal text-muted-foreground">/{devices.length}</span>
        </Kpi>
        <Kpi label="Website" icon={GlobeIcon} tone={siteDown ? "bad" : failing.length ? "warn" : undefined} sub={[main?.last?.ms != null ? `${main.last.ms} ms` : "", failing.length ? `${failing.map((c) => c.label).join(", ")} failing` : ""].filter(Boolean).join(" · ") || undefined}>
          {main?.last ? (main.last.ok ? "Up" : "Down") : "–"}
        </Kpi>
        <Kpi label="Functions today" icon={GlobeIcon} sub={free.functionsPerDay ? `of ${count(free.functionsPerDay)} free` : undefined} bar={free.functionsPerDay ? { value: today == null ? null : Math.min(1, today / free.functionsPerDay), tone: level(today == null ? null : today / free.functionsPerDay, 0.6, 0.85) } : undefined}>
          {count(today)}
        </Kpi>
        <Kpi label="R2 storage" icon={GlobeIcon} sub={free.r2Bytes ? `of ${bytes(free.r2Bytes, 0)} free` : undefined} bar={free.r2Bytes ? { value: r2Bytes == null ? null : Math.min(1, r2Bytes / free.r2Bytes), tone: level(r2Bytes == null ? null : r2Bytes / free.r2Bytes, 0.6, 0.85) } : undefined}>
          {bytes(r2Bytes)}
        </Kpi>
      </div>

      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <Section title="Checks" description="Last 24 hours" flush>
          {checks.length ? (
            <div className="divide-y">
              {checks.map((c) => (
                <div key={c.url} className="grid min-w-0 gap-1.5 px-4 py-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <Dot tone={!c.last ? "muted" : c.last.ok ? "ok" : "bad"} live={c.last?.ok === false} />
                    <a href={c.url} target="_blank" rel="noopener" className="min-w-0 truncate text-sm font-medium hover:text-brand hover:underline">
                      {c.label}
                    </a>
                    <span className="min-w-0 flex-1 truncate text-xs tabular-nums text-muted-foreground">
                      {c.last ? `${c.last.status ?? "no answer"}${c.last.ms != null ? ` · ${c.last.ms} ms` : ""}` : "checking…"}
                      {c.detail ? ` · ${c.detail}` : ""}
                    </span>
                    <span className="shrink-0 text-xs font-medium tabular-nums">{c.uptime != null ? (c.uptime * 100).toFixed(c.uptime === 1 ? 0 : 1) + "%" : ""}</span>
                  </div>
                  <div className="flex h-4 gap-px" aria-label={`${c.label}: ${c.points.length} checks`}>
                    {c.points.slice(-72).map((p: State, i: number) => (
                      <i key={i} className={cn("max-w-1.5 flex-1 rounded-[2px]", p.ok ? "bg-ok/60" : "bg-bad")} title={`${new Date(p.at).toLocaleTimeString()} · ${p.ok ? p.ms + " ms" : "down"}`} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-4 text-sm text-muted-foreground">No checks set up.</div>
          )}
        </Section>

        <Section title="History" description={RANGE_WORDS[range]} actions={<span className="text-xs tabular-nums text-muted-foreground">{range}</span>}>
          <div className="grid min-w-0 gap-3">
            <MetricPicker metrics={histMetrics} value={cur.key} onChange={setMetric} />
            {devices.map((m) => {
              const pts = points(m.history, cur.key);
              const last = [...pts].reverse().find((p) => p.v != null)?.v;
              return (
                <div key={m.name} className="grid min-w-0 grid-cols-[minmax(0,6rem)_1fr_3.5rem] items-center gap-3">
                  <span className="flex min-w-0 items-center gap-1.5 text-xs">
                    <Dot tone={m.online ? "ok" : "muted"} />
                    <span className="truncate">{m.name}</span>
                  </span>
                  {pts.filter((p) => p.v != null).length > 1 ? <Spark points={pts} color={cur.color} max={cur.max} format={cur.fmt} height={32} label={`${m.name} ${cur.label}, ${RANGE_WORDS[range] ?? ""}`} /> : <span className="text-xs text-muted-foreground">no data</span>}
                  <span className="text-right text-xs tabular-nums">{last != null ? cur.fmt(last) : "–"}</span>
                </div>
              );
            })}
          </div>
        </Section>
      </div>

      {hosts.length > 0 && (
        <Section title="Containers" description="Docker on the factory's host, and Proxmox containers and VMs" flush>
          <div className="divide-y">
            {hosts.map((m) => {
              const docker = [...(m.containers ?? [])].sort((a: State, b: State) => (b.cpu ?? 0) - (a.cpu ?? 0));
              const guests: State[] = m.guests ?? [];
              return (
                <div key={m.name} className="grid min-w-0 gap-3 p-4">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Dot tone={m.online ? "ok" : "muted"} /> {m.name}
                    {guests.length > 0 && <Badge variant="outline">{guests.filter((g) => g.status === "running").length} of {guests.length} guests running</Badge>}
                    {docker.length > 0 && <Badge variant="outline">{docker.length} Docker</Badge>}
                  </div>
                  <div className="grid min-w-0 gap-x-6 gap-y-1.5 text-xs md:grid-cols-2">
                    {docker.map((c: State) => (
                      <div key={c.name} className="grid min-w-0 grid-cols-[minmax(0,1fr)_3.5rem_auto] items-center gap-2">
                        <span className={cn("truncate font-mono", c.name.startsWith("factory-run-") && "font-semibold text-brand")} title={c.name}>
                          {c.name.replace(/^factory-/, "").replace(/-1$/, "")}
                        </span>
                        <Progress value={Math.min(100, (c.cpu ?? 0) * 100)} />
                        <span className="w-24 text-right tabular-nums text-muted-foreground">
                          {Math.round((c.cpu ?? 0) * 100)}% · {bytes(c.mem)}
                        </span>
                      </div>
                    ))}
                    {guests.map((g) => (
                      <div key={g.id} className={cn("grid min-w-0 grid-cols-[2.25rem_minmax(0,1fr)_3.5rem_auto] items-center gap-2", g.status !== "running" && "opacity-50")}>
                        <span className="font-mono text-muted-foreground">{g.id}</span>
                        <span className="truncate">
                          {g.name} <span className="text-muted-foreground">· {g.type === "qemu" ? "VM" : "LXC"}</span>
                        </span>
                        <Progress value={(g.cpu ?? 0) * 100} />
                        <span className="w-24 text-right tabular-nums text-muted-foreground">{g.memTotal ? `${bytes(g.mem)} / ${bytes(g.memTotal, 0)}` : g.status}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {!s.configured?.cloudflare ? (
        <Section title="Traffic and free tier" description="Needs a Cloudflare token">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Make a token with only <b className="text-foreground">Account Analytics: Read</b> and <b className="text-foreground">Zone Analytics: Read</b>, then set <code className={code}>CF_API_TOKEN</code>, <code className={code}>CF_ACCOUNT_ID</code> and <code className={code}>CF_ZONE_ID</code> in the factory's env.{" "}
            <Tip content="Shows visitors, bandwidth and cache, the Functions requests that count against the free daily limit, and R2 storage and operations against the free tier.">
              <span className="cursor-help underline decoration-dotted">What it shows</span>
            </Tip>
          </p>
        </Section>
      ) : (
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <Section title="Traffic" description="Last 7 days" actions={site?.at && <span className="text-xs text-muted-foreground">{rel(site.at)}</span>}>
            {site?.traffic?.length ? (
              <TrafficBody traffic={site.traffic} />
            ) : (
              <div className="text-sm text-muted-foreground">No traffic data yet.</div>
            )}
          </Section>
          <Section title="Free tier">
            <div className="grid gap-4">
              {site?.functions?.length > 0 && (
                <BarChart title={`Functions a day (free ${count(free.functionsPerDay)})`} labels={site.functions.map((f: State) => day(f.date))} series={[{ name: "Requests", color: COLORS.brand, values: site.functions.map((f: State) => f.requests) }]} format={count} height={110} />
              )}
              {site?.r2 && (
                <>
                  <div className="grid gap-3">
                    <Quota label="R2 writes and lists this month" used={site.r2.month.a} total={free.r2ClassA} />
                    <Quota label="R2 reads this month" used={site.r2.month.b} total={free.r2ClassB} />
                  </div>
                  <div className="divide-y text-xs">
                    {site.r2.buckets.length ? (
                      site.r2.buckets.map((b: State) => (
                        <div key={b.name} className="flex min-w-0 justify-between gap-3 py-1.5">
                          <span className="truncate font-mono">{b.name}</span>
                          <span className="shrink-0 tabular-nums text-muted-foreground">
                            {count(b.objects)} objects · {bytes(b.bytes)}
                          </span>
                        </div>
                      ))
                    ) : (
                      <div className="text-muted-foreground">No R2 buckets reported yet.</div>
                    )}
                  </div>
                </>
              )}
              {site?.problems?.length > 0 && <p className="text-xs text-warn">Couldn't read: {site.problems.join("; ")}</p>}
            </div>
          </Section>
        </div>
      )}

      <Section
        title="Alert history"
        flush
        actions={
          <Button size="xs" variant="ghost" onClick={() => go("settings", "alerts")}>
            <BellIcon /> Limits
          </Button>
        }
      >
        {al?.recent?.length ? (
          <div className="max-h-96 divide-y overflow-y-auto">
            {al.recent.map((a: State) => (
              <div key={a.id} className="flex min-w-0 items-start gap-2.5 px-4 py-2.5 text-sm">
                <Dot tone={a.cleared_at ? "ok" : "bad"} className="mt-1.5" />
                <div className="min-w-0 flex-1">
                  <div className="break-words">
                    <AlertText text={a.text} />
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(a.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    {a.cleared_at ? ` · cleared ${rel(a.cleared_at)}` : " · ongoing"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-4 text-sm text-muted-foreground">No alerts yet.</div>
        )}
      </Section>

      {s.configured && !s.configured.push && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Reporters need <code className={code}>DEVICE_TOKEN</code> in the factory's env (<code className={code}>openssl rand -hex 32</code>), then each PC runs <code className={code}>machines/reporters/report-windows.ps1 -Install</code>.
        </p>
      )}
    </div>
  );
}

function Quota({ label, used, total }: { label: string; used: number; total: number }) {
  const f = total ? used / total : null;
  return (
    <div className="grid gap-1">
      <div className="flex justify-between gap-3 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="shrink-0 font-medium tabular-nums">
          {count(used)} / {count(total)}
        </span>
      </div>
      <Progress value={Math.min(100, (f ?? 0) * 100)} tone={barTone(level(f, 0.6, 0.85))} />
    </div>
  );
}

function TrafficBody({ traffic }: { traffic: State[] }) {
  const sum = traffic.reduce((a, t) => ({ bytes: a.bytes + t.bytes, cached: a.cached + t.cachedBytes, threats: a.threats + t.threats, views: a.views + t.pageViews }), { bytes: 0, cached: 0, threats: 0, views: 0 });
  const tiles: [string, string][] = [
    ["Page views", count(sum.views)],
    ["Bandwidth", bytes(sum.bytes)],
    ["From cache", `${sum.bytes ? Math.round((sum.cached / sum.bytes) * 100) : 0}%`],
    ["Threats blocked", count(sum.threats)],
  ];
  return (
    <div className="grid gap-4">
      <BarChart
        title="Requests and visitors"
        labels={traffic.map((t) => day(t.date))}
        series={[
          { name: "Requests", color: COLORS.brand, values: traffic.map((t) => t.requests) },
          { name: "Visitors", color: COLORS.info, values: traffic.map((t) => t.visitors) },
        ]}
        format={count}
        height={110}
      />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tiles.map(([k, v]) => (
          <div key={k} className="rounded-lg border bg-muted/30 px-3 py-2">
            <div className="truncate text-[11px] text-muted-foreground">{k}</div>
            <div className="text-sm font-semibold tabular-nums">{v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
