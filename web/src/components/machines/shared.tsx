// Small pieces the Machines tabs share: a labelled meter, the gauges a machine shows, the CI line's words,
// the history metrics, alert text with its bold parts, and the /api/devices poll (CI jobs and game tests).
import * as React from "react";
import { getJson, type State } from "@/lib/api";
import { bytes, level, rel, tempLevel, toneText, type Tone } from "@/lib/format";
import { cn } from "@/lib/utils";
import { COLORS } from "@/components/charts";
import { Progress, Tip } from "@/components/ui/primitives";

export const pctText = (v: number | null | undefined) => (v == null ? "–" : Math.round(v * 100) + "%");
export const deg = (v: number | null | undefined) => (v == null ? "–" : Math.round(v) + " °C");
/** A Progress tone for a level (no reading: brand, the bar is empty anyway). */
export const barTone = (t: Tone) => (t === "none" ? "brand" : t);

/** A label and number over a thin bar; the bar and (when busy or hot) the number take the tone. */
export function Meter({ label, value, tone, text, sub, className }: { label: React.ReactNode; value: number | null | undefined; tone: Tone; text: React.ReactNode; sub?: React.ReactNode; className?: string }) {
  const body = (
    <div className={cn("min-w-0", className)}>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
        <span className="truncate text-muted-foreground">{label}</span>
        <span className={cn("font-medium tabular-nums", (tone === "warn" || tone === "bad") && toneText[tone])}>{text}</span>
      </div>
      <Progress value={(value ?? 0) * 100} tone={barTone(tone)} />
    </div>
  );
  return sub ? (
    <Tip content={sub}>
      <div tabIndex={0} className="min-w-0 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
        {body}
      </div>
    </Tip>
  ) : (
    body
  );
}

export type Gauge = { label: string; value: number | null; tone: Tone; text: string; sub: string };

/** A machine's live gauges (only the ones it reports). Temperatures read in °C, the bar out of 100. */
export function gauges(m: State): Gauge[] {
  const mem = m.memTotal ? m.memUsed / m.memTotal : null;
  const disk = m.disks?.length ? Math.max(...m.disks.map((x: State) => x.used / x.total)) : null;
  const out: Gauge[] = [
    { label: "CPU", value: m.cpu ?? null, tone: level(m.cpu), text: pctText(m.cpu), sub: [m.cores ? `${m.cores} threads` : "", m.sensors?.cpuClock != null ? `${(m.sensors.cpuClock / 1000).toFixed(2)} GHz` : ""].filter(Boolean).join(" · ") },
    { label: "Memory", value: mem, tone: level(mem, 0.8, 0.92), text: pctText(mem), sub: m.memTotal ? `${bytes(m.memUsed)} / ${bytes(m.memTotal, 0)}` : "" },
    { label: "Disk", value: disk, tone: level(disk, 0.8, 0.92), text: pctText(disk), sub: m.disks?.length === 1 ? `${bytes(m.disks[0].total - m.disks[0].used)} free` : m.disks?.length ? `Fullest of ${m.disks.length} volumes` : "" },
  ];
  if (m.gpu?.util != null) out.push({ label: "GPU", value: m.gpu.util, tone: level(m.gpu.util), text: pctText(m.gpu.util), sub: m.gpu.memTotal ? `VRAM ${bytes(m.gpu.memUsed)} / ${bytes(m.gpu.memTotal, 0)}` : "" });
  const cpuT = m.sensors?.cpuTemp ?? null;
  if (cpuT != null) out.push({ label: "CPU temp", value: cpuT / 100, tone: tempLevel(cpuT), text: deg(cpuT), sub: m.sensors.cpuPower != null ? `${Math.round(m.sensors.cpuPower)} W` : "" });
  else if (m.temp != null) out.push({ label: "Temp", value: m.temp / 100, tone: tempLevel(m.temp), text: deg(m.temp), sub: "Hottest sensor" });
  if (m.gpu?.temp != null) {
    const fan = m.gpu.fan != null ? `fan ${Math.round(m.gpu.fan)}%` : m.facts?.["GPU fan"] ? `fan ${m.facts["GPU fan"]}` : "";
    out.push({ label: "GPU temp", value: m.gpu.temp / 100, tone: tempLevel(m.gpu.temp), text: deg(m.gpu.temp), sub: [fan, m.gpu.power != null ? `${Math.round(m.gpu.power)} W` : ""].filter(Boolean).join(" · ") });
  }
  return out;
}

/** The history a machine can chart; a metric shows only when the machine reported it in the range. */
export type Metric = { key: string; label: string; color: string; max: number; fmt: (v: number) => string };
const pctFmt = (v: number) => Math.round(v * 100) + "%";
export const METRICS: Metric[] = [
  { key: "cpu", label: "CPU", color: COLORS.brand, max: 1, fmt: pctFmt },
  { key: "mem", label: "Memory", color: COLORS.info, max: 1, fmt: pctFmt },
  { key: "disk", label: "Disk", color: COLORS.warn, max: 1, fmt: pctFmt },
  { key: "temp", label: "Temp", color: COLORS.bad, max: 100, fmt: (v) => Math.round(v) + " °C" },
  { key: "net", label: "Network", color: COLORS.ok, max: 0, fmt: (v) => bytes(v) + "/s" },
  { key: "gpu", label: "GPU", color: COLORS.brand, max: 1, fmt: pctFmt },
  { key: "gpuTemp", label: "GPU temp", color: COLORS.bad, max: 100, fmt: (v) => Math.round(v) + " °C" },
  { key: "gpuPower", label: "GPU W", color: COLORS.warn, max: 0, fmt: (v) => Math.round(v) + " W" },
  { key: "cpuPower", label: "CPU W", color: COLORS.warn, max: 0, fmt: (v) => Math.round(v) + " W" },
  { key: "fan", label: "Fans", color: COLORS.info, max: 0, fmt: (v) => Math.round(v) + " RPM" },
];
export const metricsOf = (history: State[] | undefined) => METRICS.filter((x) => ["cpu", "mem"].includes(x.key) || (history ?? []).some((h) => typeof h[x.key] === "number"));
export const points = (history: State[] | undefined, key: string) => (history ?? []).map((h: State) => ({ at: h.at as string, v: typeof h[key] === "number" ? (h[key] as number) : null }));
export const RANGE_WORDS: Record<string, string> = { "1h": "last hour", "24h": "last 24 hours", "7d": "last 7 days", "30d": "last 30 days" };

/** Small metric chips (scrolls inside itself on a phone, never the page). */
export function MetricPicker({ metrics, value, onChange }: { metrics: Metric[]; value: string; onChange: (k: string) => void }) {
  return (
    <div className="-mx-1 flex min-w-0 gap-0.5 overflow-x-auto px-1 [scrollbar-width:none]" role="tablist" aria-label="Metric">
      {metrics.map((x) => (
        <button
          key={x.key}
          role="tab"
          aria-selected={value === x.key}
          onClick={() => onChange(x.key)}
          className={cn("h-6 shrink-0 rounded-full px-2.5 text-[11px] font-medium text-muted-foreground transition hover:text-foreground", value === x.key && "bg-muted text-foreground")}
        >
          {x.label}
        </button>
      ))}
    </div>
  );
}

/** What CI on a machine is doing (its game guard), in a few words. */
export function ciText(c: State): string {
  const g = c.guard;
  if (!g) return c.owner ? "CI paused by you · guard not checking in" : `CI guard not checking in${c.lastCheck ? ` · last ${rel(c.lastCheck)}` : ""}`;
  if (g.state === "running" && g.game) return `CI ${g.busy ? "running a job" : "ready"} on ${c.threads?.gaming ?? "fewer"} threads while ${g.game} runs`;
  if (g.state === "running") return g.busy ? "CI running a job" : "CI ready for jobs";
  const why = g.why === "owner" ? "paused by you" : g.game ? `paused while ${g.game} runs` : "paused while a game runs";
  return `CI ${why}${g.busy ? " · current job at idle priority" : ""}`;
}
export const ciPaused = (c: State) => Boolean(c?.owner || c?.guard?.state === "paused");

/** Alert text from the server: "**host** CPU ..." with the starred parts bold. */
export function AlertText({ text }: { text: string }) {
  return (
    <>
      {String(text ?? "")
        .split("**")
        .map((p, i) => (i % 2 ? <b key={i} className="font-semibold">{p}</b> : <React.Fragment key={i}>{p}</React.Fragment>))}
    </>
  );
}

/** /api/devices (CI per machine and game tests), every 10 s while mounted and the page is visible. */
export function useDevices() {
  const [data, setData] = React.useState<State | null>(null);
  const [error, setError] = React.useState("");
  const timer = React.useRef(0);
  const load = React.useCallback(async () => {
    clearTimeout(timer.current);
    const j = await getJson("/api/devices");
    if (j) {
      setData(j);
      setError(j.error ?? "");
    } else setError("Couldn't reach the dispatcher");
    if (!document.hidden) timer.current = window.setTimeout(load, 10_000);
  }, []);
  React.useEffect(() => {
    load();
    const vis = () => !document.hidden && load();
    document.addEventListener("visibilitychange", vis);
    return () => {
      clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [load]);
  return { data, error, load };
}

/** Seconds as "42s" or "3m 5s". */
export const secs = (n: number | null | undefined) => (n == null ? "" : n < 60 ? `${n}s` : `${Math.floor(n / 60)}m ${n % 60}s`);
