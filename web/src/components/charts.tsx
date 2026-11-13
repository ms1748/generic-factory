// The dashboard's charts, all plain SVG (no chart library): bars per time bucket for one or two series,
// a small area sparkline, a round gauge, and the timeline of scheduled runs.
import * as React from "react";
import { time } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "./ui/primitives";
import { Button } from "./ui/button";
import type { State } from "@/lib/api";

/** Chart colours by role: use these, not hex values, so both themes work. */
export const COLORS = { brand: "var(--brand)", ok: "var(--ok)", warn: "var(--warn)", bad: "var(--bad)", info: "var(--info)", muted: "var(--muted-foreground)" };

export type Series = { name: string; values: number[]; color: string };

/** Bars per time bucket for one or two series (side by side), with a hover readout, a legend, and a table view. */
export function BarChart({ title, labels, series, format = (v) => String(v), height = 150, className }: { title: React.ReactNode; labels: string[]; series: Series[]; format?: (v: number) => string; height?: number; className?: string }) {
  const [hover, setHover] = React.useState(-1);
  const [table, setTable] = React.useState(false);
  const H = height;
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const ticks = [0, max / 2, max].map((v) => Math.round(v * 100) / 100);
  const step = labels.length ? 100 / labels.length : 100;
  const barW = Math.max(0.6, (step - 1.2) / series.length - 0.4);
  return (
    <figure className={cn("m-0", className)}>
      <figcaption className="mb-3 flex flex-wrap items-center gap-3">
        <span className="text-sm font-semibold">{title}</span>
        {series.length > 1 && (
          <span className="ml-auto flex gap-3 text-xs text-muted-foreground">
            {series.map((s) => (
              <span key={s.name} className="inline-flex items-center gap-1.5">
                <i className="inline-block size-2.5 rounded-sm" style={{ background: s.color }} />
                {s.name}
              </span>
            ))}
          </span>
        )}
        <Button size="xs" variant="ghost" className={series.length > 1 ? "" : "ml-auto"} onClick={() => setTable(!table)}>
          {table ? "Chart" : "Table"}
        </Button>
      </figcaption>
      {table ? (
        <div className="max-h-72 overflow-auto rounded-lg border">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted">
              <tr>
                <th className="px-2 py-1.5 text-left font-medium" />
                {series.map((s) => (
                  <th key={s.name} className="px-2 py-1.5 text-right font-medium">
                    {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {labels.map((l, i) => (
                <tr key={i} className="border-t">
                  <td className="px-2 py-1">{l}</td>
                  {series.map((s) => (
                    <td key={s.name} className="px-2 py-1 text-right tabular-nums">
                      {format(s.values[i] ?? 0)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-[40px_1fr] gap-1.5" role="img" aria-label={`${typeof title === "string" ? title : "Chart"}: ${series.map((s) => s.name + " " + s.values.map(format).join(", ")).join("; ")}`}>
          <div className="flex flex-col justify-between text-right text-[11px] tabular-nums text-muted-foreground" style={{ height: H }}>
            {[...ticks].reverse().map((t, i) => (
              <span key={i}>{format(t)}</span>
            ))}
          </div>
          <div className="relative" onMouseLeave={() => setHover(-1)}>
            <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" className="block w-full" style={{ height: H }} aria-hidden="true">
              {[0.5, 1].map((g) => (
                <line key={g} x1="0" x2="100" y1={H - g * H} y2={H - g * H} stroke="var(--border)" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
              ))}
              {labels.map((_, i) => (
                <g key={i}>
                  {hover === i && <rect x={i * step} y="0" width={step} height={H} fill="var(--accent)" />}
                  {series.map((s, k) => {
                    const v = s.values[i] ?? 0;
                    const h = (v / max) * (H - 4);
                    return v > 0 ? <rect key={k} x={i * step + 0.6 + k * (barW + 0.4)} y={H - h} width={barW} height={h} rx="0.6" fill={s.color} /> : null;
                  })}
                  <rect x={i * step} y="0" width={step} height={H} fill="transparent" onMouseEnter={() => setHover(i)} />
                </g>
              ))}
              <line x1="0" x2="100" y1={H} y2={H} stroke="var(--input)" vectorEffect="non-scaling-stroke" />
            </svg>
            {hover >= 0 && (
              <div className="pointer-events-none absolute top-1 z-10 min-w-36 translate-x-2 rounded-lg border bg-popover px-2.5 py-1.5 text-xs shadow-lg" style={{ left: `min(${(hover + 0.5) * step}%, calc(100% - 150px))` }}>
                <b className="mb-0.5 block font-medium">{labels[hover]}</b>
                {series.map((s) => (
                  <div key={s.name} className="flex items-center gap-1.5">
                    <i className="inline-block size-2 rounded-sm" style={{ background: s.color }} />
                    {s.name} <span className="ml-auto tabular-nums">{format(s.values[hover] ?? 0)}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
              <span>{labels[0] ?? ""}</span>
              <span>{labels[Math.floor(labels.length / 2)] ?? ""}</span>
              <span>{labels.at(-1) ?? ""}</span>
            </div>
          </div>
        </div>
      )}
    </figure>
  );
}

/** A small area chart of 0..1 values (or up to `max`), with a hover readout. Gaps (null) stay gaps. */
export function Spark({ points = [], color = COLORS.brand, max = 1, height = 44, format = (v: number) => Math.round(v * 100) + "%", label = "" }: { points: { at: string; v: number | null }[]; color?: string; max?: number; height?: number; format?: (v: number) => string; label?: string }) {
  const [hover, setHover] = React.useState(-1);
  const id = React.useId().replace(/:/g, "");
  const W = 100;
  const top = Math.max(max, ...points.map((p) => p.v ?? 0));
  const xy = points.map((p, i) => (p.v == null ? null : ([points.length > 1 ? (i / (points.length - 1)) * W : W / 2, height - 2 - (p.v / top) * (height - 4)] as [number, number])));
  const runs: [number, number][][] = [];
  let cur: [number, number][] = [];
  for (const p of xy) {
    if (p) cur.push(p);
    else if (cur.length) (runs.push(cur), (cur = []));
  }
  if (cur.length) runs.push(cur);
  const move = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setHover(Math.round(((e.clientX - r.left) / r.width) * (points.length - 1)));
  };
  return (
    <div className="relative w-full" role="img" aria-label={label} onMouseMove={move} onMouseLeave={() => setHover(-1)}>
      <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" className="block w-full" style={{ height }} aria-hidden="true">
        <defs>
          <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity=".3" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {runs.map((r, i) =>
          r.length > 1 ? (
            <g key={i}>
              <path d={`M${r.map((p) => p.join(",")).join("L")}L${r.at(-1)![0]},${height}L${r[0][0]},${height}Z`} fill={`url(#${id})`} />
              <path d={`M${r.map((p) => p.join(",")).join("L")}`} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
            </g>
          ) : (
            <circle key={i} cx={r[0][0]} cy={r[0][1]} r="1.2" fill={color} />
          ),
        )}
        {hover >= 0 && xy[hover] && <line x1={xy[hover]![0]} x2={xy[hover]![0]} y1="0" y2={height} stroke="var(--foreground)" strokeOpacity=".4" vectorEffect="non-scaling-stroke" />}
      </svg>
      {hover >= 0 && points[hover] && (
        <span className="pointer-events-none absolute -top-6 z-10 -translate-x-1/2 whitespace-nowrap rounded-md bg-primary px-1.5 py-0.5 text-[11px] tabular-nums text-primary-foreground" style={{ left: `${(hover / Math.max(1, points.length - 1)) * 100}%` }}>
          {points[hover].v == null ? "no data" : format(points[hover].v!)} · {new Date(points[hover].at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
        </span>
      )}
    </div>
  );
}

/** A round gauge: value 0..1, the arc coloured by `color`, the number in the middle. */
export function Ring({ value, label, sub, color = COLORS.ok, size = 76 }: { value: number | null | undefined; label: React.ReactNode; sub?: React.ReactNode; color?: string; size?: number }) {
  const R = 15.5;
  const C = 2 * Math.PI * R;
  const v = value == null ? 0 : Math.max(0, Math.min(1, value));
  return (
    <div className="relative grid justify-items-center gap-0.5" style={{ width: size }} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value == null ? undefined : Math.round(v * 100)}>
      <svg viewBox="0 0 36 36" className="w-full -rotate-90 overflow-visible" aria-hidden="true">
        <circle cx="18" cy="18" r={R} fill="none" stroke="var(--border)" strokeWidth="3.2" />
        {value != null && <circle cx="18" cy="18" r={R} fill="none" stroke={color} strokeWidth="3.2" strokeLinecap="round" strokeDasharray={`${v * C} ${C}`} style={{ transition: "stroke-dasharray .8s cubic-bezier(.2,.8,.2,1)" }} />}
      </svg>
      <div className="absolute inset-x-0 top-0 grid aspect-square place-items-center">
        <b className="text-base font-semibold tabular-nums">
          {value == null ? "–" : Math.round(v * 100)}
          {value != null && <small className="ml-px text-[10px] text-muted-foreground">%</small>}
        </b>
      </div>
      <span className="text-[11.5px] font-medium text-muted-foreground">{label}</span>
      {sub && <span className="whitespace-nowrap text-[11px] tabular-nums text-muted-foreground">{sub}</span>}
    </div>
  );
}

const LANE_COLOR: Record<string, string> = { builder: COLORS.brand, maintainer: COLORS.ok, ideas: COLORS.warn, security: COLORS.bad, reviewer: COLORS.info };
export const laneColor = (kind: string) => LANE_COLOR[kind] ?? COLORS.muted;

/** The scheduled runs ahead (d.upcoming), grouped by day: when, which lane, live or dry. */
export function Timeline({ d, limit = 0 }: { d: State; limit?: number }) {
  const items: State[] = limit ? d.upcoming.slice(0, limit) : d.upcoming;
  const days: { day: string; runs: State[] }[] = [];
  for (const u of items) {
    const day = new Date(u.at).toLocaleDateString("en-US", { timeZone: d.timezone, weekday: "long", month: "short", day: "numeric" });
    if (days.at(-1)?.day !== day) days.push({ day, runs: [] });
    days.at(-1)!.runs.push(u);
  }
  if (!days.length) return <div className="py-6 text-center text-sm text-muted-foreground">No runs scheduled: every lane is off.</div>;
  return (
    <div className="divide-y">
      {days.map((g) => (
        <div key={g.day} className="grid gap-2 py-3 first:pt-0 last:pb-0 sm:grid-cols-[140px_1fr] sm:gap-4">
          <div className="pt-1 text-xs font-medium text-muted-foreground">{g.day}</div>
          <div className="flex flex-wrap gap-1.5">
            {g.runs.map((u, i) => (
              <div key={i} className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg border bg-muted/40 px-2.5 py-1 text-[13px]">
                <span className="min-w-14 text-xs tabular-nums text-muted-foreground">{time(u.at, d.timezone, { weekday: undefined })}</span>
                <span className="h-3.5 w-0.5 rounded-full" style={{ background: laneColor(u.kind) }} />
                <span className="font-medium">{u.lane}</span>
                {u.repo && u.repo !== d.repo && <span className="text-muted-foreground">· {u.repo.split("/").pop()}</span>}
                <Badge variant={u.live ? "ok" : "outline"}>{u.live ? "live" : "dry"}</Badge>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
