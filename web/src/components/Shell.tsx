// The frame round every view: the sidebar (desktop), the top bar (status, plan usage, Stop and Pause), and
// the bottom tab bar with a More sheet (phones).
import * as React from "react";
import { MoreHorizontalIcon, SearchIcon, OctagonXIcon, PauseIcon, PlayIcon, MonitorIcon, MoonIcon, SunIcon, ChevronDownIcon, WifiOffIcon } from "lucide-react";
import { control, useStore, type State } from "@/lib/api";
import { useRoute, go } from "@/lib/router";
import { confirm, setPalette, openItem } from "@/lib/overlays";
import { dur, pct, rel, time, short } from "@/lib/format";
import { savedTheme, setTheme, type Theme } from "@/lib/theme";
import { useSystems } from "@/lib/systems";
import { cn } from "@/lib/utils";
import { NAV, MOBILE_MAIN, type NavItem } from "./nav";
import { Button } from "./ui/button";
import { Kbd, Tip, Progress } from "./ui/primitives";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, Sheet, SheetContent } from "./ui/overlays";
import { Dot, Shimmer } from "./magic";

/** How many things wait on the owner: cards with questions or steps, and PRs the reviewer handed over. */
export function needsCount(d: State): number {
  return (d?.board?.needsYou?.length ?? 0) + (d?.board?.review ?? []).filter((p: State) => p.factory && p.verdict === "ready").length;
}

function badgeFor(view: string, d: State | null, alerts: number): { count?: number; live?: boolean; alert?: boolean } {
  if (!d) return {};
  if (view === "inbox") return { count: needsCount(d) || undefined };
  if (view === "work") return { count: (d.board.next.length + d.board.building.length) || undefined };
  if (view === "runs") return { live: (d.runningAll?.length ?? 0) > 0 };
  if (view === "machines") return { alert: alerts > 0 };
  if (view === "settings") return { alert: Boolean(d.testBuildCleanup?.problem) };
  return {};
}

function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} aria-hidden="true">
      <rect x="1" y="1" width="8" height="8" rx="2.2" className="fill-brand" />
      <rect x="11" y="1" width="8" height="8" rx="2.2" className="fill-foreground/55" />
      <rect x="1" y="11" width="8" height="8" rx="2.2" className="fill-foreground/55" />
      <rect x="11" y="11" width="8" height="8" rx="2.2" className="fill-foreground/25" />
    </svg>
  );
}

function ThemePicker({ className }: { className?: string }) {
  const [t, setT] = React.useState<Theme>(savedTheme());
  const opts: [Theme, React.ComponentType<{ className?: string }>, string][] = [
    ["system", MonitorIcon, "System"],
    ["dark", MoonIcon, "Dark"],
    ["light", SunIcon, "Light"],
  ];
  return (
    <div className={cn("inline-flex rounded-lg bg-muted p-0.5", className)} role="radiogroup" aria-label="Theme">
      {opts.map(([v, Icon, label]) => (
        <Tip key={v} content={label}>
          <button
            role="radio"
            aria-checked={t === v}
            aria-label={label}
            onClick={() => (setTheme(v), setT(v))}
            className={cn("grid h-7 flex-1 place-items-center rounded-md px-2.5 text-muted-foreground transition hover:text-foreground", t === v && "bg-background text-foreground shadow-sm")}
          >
            <Icon className="size-3.5" />
          </button>
        </Tip>
      ))}
    </div>
  );
}

function NavButton({ it, active, d, alerts, onClick }: { it: NavItem; active: boolean; d: State | null; alerts: number; onClick: () => void }) {
  const b = badgeFor(it.view, d, alerts);
  return (
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-[13.5px] text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground",
        active && "bg-accent text-foreground font-medium",
      )}
    >
      <it.icon className={cn("size-4 shrink-0 opacity-80", active && "text-brand opacity-100")} />
      <span className="flex-1 truncate text-left">{it.label}</span>
      {b.live && <Dot tone="ok" live />}
      {b.alert && <Dot tone="bad" />}
      {b.count ? <span className={cn("min-w-5 rounded-full px-1.5 text-center text-[11px] tabular-nums", it.view === "inbox" ? "bg-warn/15 text-warn" : "text-muted-foreground")}>{b.count}</span> : null}
    </button>
  );
}

function Sidebar({ d }: { d: State | null }) {
  const r = useRoute();
  const sys = useSystems();
  const alerts = sys.data?.alerts?.open?.length ?? 0;
  const groups = ["Work", "Factory", "Homelab"] as const;
  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-4 bg-sidebar px-3 py-4 md:flex">
      <a href="#/home" className="flex items-center gap-2.5 px-2 text-[15px] font-semibold tracking-tight">
        <Logo className="size-5" />
        Factory
      </a>
      <button onClick={() => setPalette(true)} className="flex h-8 items-center gap-2 rounded-md border bg-background/50 px-2.5 text-[13px] text-muted-foreground transition hover:border-foreground/15 hover:text-foreground">
        <SearchIcon className="size-3.5" />
        <span className="flex-1 text-left">Search or run…</span>
        <Kbd>Ctrl K</Kbd>
      </button>
      <nav className="-mx-1 flex flex-1 flex-col gap-4 overflow-y-auto px-1" aria-label="Views">
        {groups.map((g) => (
          <div key={g} className="flex flex-col gap-0.5">
            <div className="px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">{g}</div>
            {NAV.filter((x) => x.group === g).map((it) => (
              <NavButton key={it.view} it={it} d={d} alerts={alerts} active={r.view === it.view} onClick={() => go(it.view)} />
            ))}
          </div>
        ))}
      </nav>
      <div className="flex flex-col gap-2.5">
        {d && (
          <a href={`https://github.com/${d.repo}`} target="_blank" rel="noopener" className="truncate px-2 font-mono text-[11px] text-muted-foreground hover:text-foreground">
            {d.repos?.length > 1 ? `${d.repos.length} repos · ${short(d.repo)}` : d.repo}
          </a>
        )}
        <ThemePicker className="w-full" />
      </div>
    </aside>
  );
}

function MobileNav({ d }: { d: State | null }) {
  const r = useRoute();
  const sys = useSystems();
  const alerts = sys.data?.alerts?.open?.length ?? 0;
  const [more, setMore] = React.useState(false);
  const main = NAV.filter((x) => MOBILE_MAIN.includes(x.view));
  const extra = NAV.filter((x) => !MOBILE_MAIN.includes(x.view));
  const inExtra = extra.find((x) => x.view === r.view);
  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t bg-background/85 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden" aria-label="Views">
        {main.map((it) => {
          const b = badgeFor(it.view, d, alerts);
          const on = r.view === it.view;
          return (
            <button key={it.view} onClick={() => go(it.view)} aria-current={on ? "page" : undefined} className={cn("relative flex flex-col items-center gap-0.5 py-2 text-[10.5px] text-muted-foreground", on && "text-foreground")}>
              <span className="relative">
                <it.icon className={cn("size-5", on && "text-brand")} />
                {b.count ? <span className="absolute -top-1.5 -right-2.5 min-w-4 rounded-full bg-warn px-1 text-center text-[9.5px] font-semibold leading-4 text-black tabular-nums">{b.count}</span> : null}
                {b.live && <Dot tone="ok" live className="absolute -top-0.5 -right-1" />}
              </span>
              {it.label}
            </button>
          );
        })}
        <button onClick={() => setMore(true)} className={cn("relative flex flex-col items-center gap-0.5 py-2 text-[10.5px] text-muted-foreground", inExtra && "text-foreground")}>
          <span className="relative">
            <MoreHorizontalIcon className={cn("size-5", inExtra && "text-brand")} />
            {extra.some((it) => badgeFor(it.view, d, alerts).alert) && <Dot tone="bad" className="absolute -top-0.5 -right-1" />}
          </span>
          {inExtra?.label ?? "More"}
        </button>
      </nav>
      <Sheet open={more} onOpenChange={setMore}>
        <SheetContent title="More">
          <div className="grid grid-cols-2 gap-2 p-4">
            {extra.map((it) => (
              <button key={it.view} onClick={() => (setMore(false), go(it.view))} className={cn("flex items-center gap-3 rounded-xl border bg-card p-3.5 text-left text-sm", r.view === it.view && "border-brand/40 bg-brand/5")}>
                <it.icon className="size-4.5 text-muted-foreground" />
                <span className="flex-1">{it.label}</span>
                {badgeFor(it.view, d, alerts).alert && <Dot tone="bad" />}
              </button>
            ))}
            <button onClick={() => (setMore(false), setPalette(true))} className="col-span-2 flex items-center gap-3 rounded-xl border bg-card p-3.5 text-left text-sm">
              <SearchIcon className="size-4.5 text-muted-foreground" /> Search or run…
            </button>
            <div className="col-span-2 mt-2 flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Theme</span>
              <ThemePicker />
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

/** Ticks once a second so running times stay current. */
function useTick(ms = 1000) {
  const [, set] = React.useState(0);
  React.useEffect(() => {
    const t = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

function StatusMenu({ d }: { d: State }) {
  useTick();
  const running: State[] = d.runningAll ?? (d.running ? [d.running] : []);
  const state = d.stop ? "stopped" : d.pause ? "paused" : running.length ? "running" : "idle";
  const all = [...d.board.building, ...d.board.next, ...d.board.review];
  const titleOf = (n: number) => all.find((c: State) => c.number === n || c.issue === n)?.title;
  const needs = needsCount(d);
  return (
    <Menu>
      <MenuTrigger asChild>
        <button className="inline-flex h-8 min-w-0 items-center gap-2 rounded-full border bg-card px-3 text-[13px] shadow-xs transition hover:border-foreground/20">
          {state === "stopped" ? (
            <>
              <Dot tone="bad" /> Stopped
            </>
          ) : state === "paused" ? (
            <>
              <Dot tone="warn" /> <span className="truncate">Paused until {time(d.pause.until, d.timezone)}</span>
            </>
          ) : running.length ? (
            <>
              <Dot tone="ok" live /> <Shimmer>{running.length} running</Shimmer>
            </>
          ) : (
            <>
              <Dot /> Idle
            </>
          )}
          {needs > 0 && (
            <>
              <span className="text-muted-foreground">·</span>
              <span className="text-warn tabular-nums">
                {needs}
                <span className="hidden sm:inline"> need{needs === 1 ? "s" : ""} you</span>
              </span>
            </>
          )}
          <ChevronDownIcon className="size-3.5 text-muted-foreground" />
        </button>
      </MenuTrigger>
      <MenuContent align="start" className="w-[min(420px,92vw)]">
        <MenuLabel>Running · {running.length}</MenuLabel>
        {running.length ? (
          running.map((r) => (
            <MenuItem key={r.id} onSelect={() => go("runs", "run", String(r.id))}>
              <Dot tone="ok" live />
              <span className="min-w-0 flex-1 truncate">
                <b className="font-mono text-xs font-medium">{r.card ? `#${r.card}` : r.lane}</b> <span className="text-muted-foreground">{r.card ? (titleOf(r.card) ?? r.lane) : (r.action ?? "")}</span>
              </span>
              <span className="text-xs tabular-nums text-muted-foreground">{dur(r.started_at)}</span>
            </MenuItem>
          ))
        ) : (
          <div className="px-2 py-1.5 text-sm text-muted-foreground">Nothing running{d.upcoming?.[0] ? ` · next ${d.upcoming[0].lane} ${rel(d.upcoming[0].at)}` : ""}</div>
        )}
        <MenuSeparator />
        <MenuLabel>Needs you · {needs}</MenuLabel>
        {d.board.needsYou.slice(0, 6).map((c: State) => (
          <MenuItem key={`${c.repo}#${c.number}`} onSelect={() => openItem({ ...c, column: "needsYou" })}>
            <Dot tone="warn" />
            <span className="min-w-0 flex-1 truncate">
              <b className="font-mono text-xs font-medium">#{c.number}</b> <span className="text-muted-foreground">{c.title}</span>
            </span>
          </MenuItem>
        ))}
        {needs > 0 ? (
          <MenuItem onSelect={() => go("inbox")} className="text-brand">
            Open the inbox
          </MenuItem>
        ) : (
          <div className="px-2 py-1.5 text-sm text-muted-foreground">Nothing waits on you.</div>
        )}
      </MenuContent>
    </Menu>
  );
}

function Usage({ d }: { d: State }) {
  const meter = (w: State, limit: number) => (w ? { v: w.utilization as number, tone: (w.utilization >= limit ? "bad" : w.utilization >= limit * 0.8 ? "warn" : "brand") as "bad" | "warn" | "brand" } : null);
  const rows: [string, ReturnType<typeof meter>][] = [
    ["5 h", meter(d.usage?.fiveHour, d.limits.fiveHour)],
    ["Week", meter(d.usage?.sevenDay, d.limits.sevenDay)],
  ];
  return (
    <Tip content={d.usage ? `Your Claude plan, as of ${rel(d.usage.at)}. Runs stop at ${pct(d.limits.fiveHour)} (5 h) and ${pct(d.limits.sevenDay)} (week).` : "No usage report yet"}>
      <div className="hidden items-center gap-4 lg:flex">
        {rows.map(([label, m]) => (
          <div key={label} className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">{label}</span>
            <Progress value={m ? m.v * 100 : 0} tone={m?.tone ?? "brand"} className="w-16" />
            <span className={cn("w-8 tabular-nums", m?.tone === "bad" && "text-bad")}>{m ? pct(m.v) : "–"}</span>
          </div>
        ))}
      </div>
    </Tip>
  );
}

function Topbar({ d }: { d: State }) {
  const { error } = useStore();
  const r = useRoute();
  const title = NAV.find((x) => x.view === r.view)?.label ?? "Home";
  const stop = () =>
    d.stop
      ? control("start", {}, "Started: runs go ahead again")
      : confirm({
          title: "Stop every agent?",
          body: "Adds the factory-stop label. No build, resume or review starts, and a run that's going stops at its next checkpoint. Start removes the label again.",
          yes: "Stop the factory",
          danger: true,
          action: () => control("stop"),
        });
  const pause = () =>
    d.pause
      ? control("unpause", {}, "Resumed")
      : confirm({ title: "Pause the factory for 24 hours?", body: "No scheduled run, resume or Build now starts until you resume.", yes: "Pause 24 h", action: () => control("pause", { hours: 24 }, "Paused for 24 hours") });
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur-xl md:px-6">
      <a href="#/home" className="md:hidden" aria-label="Home">
        <Logo className="size-5" />
      </a>
      <span className="hidden text-sm font-medium md:inline">{title}</span>
      <span className="hidden h-4 w-px bg-border md:inline" />
      <StatusMenu d={d} />
      <span className="flex-1" />
      {error && (
        <Tip content={error}>
          <span className="flex items-center gap-1 text-xs text-bad">
            <WifiOffIcon className="size-3.5" /> <span className="hidden sm:inline">offline</span>
          </span>
        </Tip>
      )}
      <Usage d={d} />
      <Button size="sm" variant="ghost" className="md:hidden" onClick={() => setPalette(true)} aria-label="Search">
        <SearchIcon />
      </Button>
      <Button size="sm" variant="outline" onClick={pause}>
        {d.pause ? <PlayIcon /> : <PauseIcon />}
        <span className="hidden sm:inline">{d.pause ? "Resume" : "Pause"}</span>
      </Button>
      <Button size="sm" variant={d.stop ? "brand" : "outline"} className={cn(!d.stop && "hover:border-bad/40 hover:text-bad")} onClick={stop}>
        {d.stop ? <PlayIcon /> : <OctagonXIcon />}
        <span className="hidden sm:inline">{d.stop ? "Start" : "Stop"}</span>
      </Button>
    </header>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const { data: d } = useStore();
  return (
    <div className="flex min-h-dvh md:bg-sidebar">
      <Sidebar d={d} />
      <div className="flex min-w-0 flex-1 flex-col md:my-2 md:mr-2 md:rounded-xl md:border md:bg-background md:shadow-sm">
        {d && <Topbar d={d} />}
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 pt-5 pb-28 md:px-6 md:pb-10">{children}</main>
      </div>
      <MobileNav d={d} />
    </div>
  );
}
