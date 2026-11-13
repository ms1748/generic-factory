// Home's one-row summary: each machine (online dot, uptime, CPU / RAM / temp mini meters) and the website,
// live from /api/systems. A machine opens Machines › Devices; the website opens Machines › Systems.
import { useSystems } from "@/lib/systems";
import { go } from "@/lib/router";
import { level, tempLevel, toneBg, uptime, type Tone } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { State } from "@/lib/api";
import { Dot } from "@/components/magic";
import { Skeleton } from "@/components/ui/primitives";

function Mini({ label, value, tone, text }: { label: string; value: number | null; tone: Tone; text: string }) {
  return (
    <div className="grid grid-cols-[2.25rem_1fr_2.5rem] items-center gap-1.5 text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="h-1 overflow-hidden rounded-full bg-muted">
        <span className={cn("block h-full rounded-full transition-[width] duration-500", toneBg[tone])} style={{ width: `${Math.max(0, Math.min(100, (value ?? 0) * 100))}%` }} />
      </span>
      <span className="text-right tabular-nums">{text}</span>
    </div>
  );
}

const tile = "flex min-w-0 flex-col gap-2 rounded-xl border bg-card p-3 text-left shadow-xs transition hover:border-foreground/15 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

export function SystemsStrip({ className, site = true }: { className?: string; site?: boolean }) {
  const { data: s, error } = useSystems();
  const grid = cn("grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(180px,1fr))]", className);
  if (!s)
    return error ? (
      <div className={cn("rounded-xl border border-dashed p-3 text-xs text-muted-foreground", className)}>Can't load machines: {error}</div>
    ) : (
      <div className={grid}>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
    );
  const check = s.checks?.[0];
  return (
    <div className={grid}>
      {s.devices.map((m: State) => {
        const mem = m.memTotal ? m.memUsed / m.memTotal : null;
        const temp = m.sensors?.cpuTemp ?? m.temp ?? null;
        return (
          <button key={m.name} className={cn(tile, !m.online && "opacity-60")} onClick={() => go("machines", "devices")}>
            <div className="flex min-w-0 items-center gap-2">
              <Dot tone={m.online ? "ok" : "muted"} live={m.online} />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{m.name}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground">{m.online ? uptime(m.uptime) : m.lastSeen ? "offline" : "not set up"}</span>
            </div>
            <div className="grid gap-1">
              <Mini label="CPU" value={m.cpu ?? null} tone={level(m.cpu)} text={m.cpu != null ? Math.round(m.cpu * 100) + "%" : "–"} />
              <Mini label="RAM" value={mem} tone={level(mem, 0.8, 0.92)} text={mem != null ? Math.round(mem * 100) + "%" : "–"} />
              {temp != null && <Mini label="Temp" value={temp / 100} tone={tempLevel(temp)} text={Math.round(temp) + "°"} />}
            </div>
          </button>
        );
      })}
      {site && check && (
        <button className={cn(tile, check.last && !check.last.ok && "border-bad/50")} onClick={() => go("machines", "systems")}>
          <div className="flex min-w-0 items-center gap-2">
            <Dot tone={!check.last ? "muted" : check.last.ok ? "ok" : "bad"} live={check.last?.ok === false} />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{check.label}</span>
            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{check.last?.ms != null ? `${check.last.ms} ms` : ""}</span>
          </div>
          <div className="grid gap-1 text-[11px]">
            {s.checks.slice(1).map((c: State) => (
              <div key={c.url} className="flex min-w-0 items-center gap-1.5">
                <Dot tone={!c.last ? "muted" : c.last.ok ? "ok" : "bad"} />
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{c.label}</span>
                <span className="shrink-0 tabular-nums">{c.uptime != null ? Math.round(c.uptime * 100) + "%" : "–"}</span>
              </div>
            ))}
            {check.uptime != null && <div className="text-muted-foreground">{(check.uptime * 100).toFixed(check.uptime === 1 ? 0 : 1)}% up, 24 h</div>}
          </div>
        </button>
      )}
    </div>
  );
}
