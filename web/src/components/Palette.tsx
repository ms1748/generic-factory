// Ctrl K / Cmd K: jump to a view or a card, or run a control.
import * as React from "react";
import { Command } from "cmdk";
import { Dialog as DialogP } from "radix-ui";
import { SearchIcon, HammerIcon, OctagonXIcon, PauseIcon, PlayIcon, MoonIcon, SunIcon, MonitorIcon, CircleDotIcon, GitPullRequestIcon } from "lucide-react";
import { control, useStore, type State } from "@/lib/api";
import { go } from "@/lib/router";
import { buildNow, confirm, openItem, setPalette, useOverlays } from "@/lib/overlays";
import { setTheme } from "@/lib/theme";
import { short } from "@/lib/format";
import { NAV } from "./nav";

const item = "flex cursor-default select-none items-center gap-2.5 rounded-md px-2.5 py-2 text-sm outline-none data-[selected=true]:bg-accent [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground";
const group = "px-1.5 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground";

export function Palette() {
  const { palette } = useOverlays();
  const { data: d } = useStore();
  React.useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette(!palette);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [palette]);
  const run = (f: () => unknown) => () => {
    setPalette(false);
    f();
  };
  const cols: [string, State[]][] = d
    ? [
        ["needsYou", d.board.needsYou],
        ["building", d.board.building],
        ["next", d.board.next],
        ["review", d.board.review],
        ["blocked", d.board.blocked ?? []],
        ["hold", d.board.hold],
        ["ideas", d.board.ideas],
      ]
    : [];
  return (
    <DialogP.Root open={palette} onOpenChange={setPalette}>
      <DialogP.Portal>
        <DialogP.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogP.Content className="fixed top-[12vh] left-1/2 z-50 w-[calc(100%-1.5rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border bg-popover shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
          <DialogP.Title className="sr-only">Search or run</DialogP.Title>
          <DialogP.Description className="sr-only">Jump to a view or card, or run a control</DialogP.Description>
          <Command loop className="flex max-h-[70vh] flex-col">
            <div className="flex items-center gap-2 border-b px-3">
              <SearchIcon className="size-4 text-muted-foreground" />
              <Command.Input autoFocus placeholder="Search views, cards and controls…" className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
            </div>
            <Command.List className="overflow-y-auto pb-2">
              <Command.Empty className="py-8 text-center text-sm text-muted-foreground">Nothing matches.</Command.Empty>
              <Command.Group heading="Go to" className={group}>
                {NAV.flatMap((n) =>
                  n.tabs
                    ? n.tabs.map((t) => (
                        <Command.Item key={n.view + t.tab} value={`${n.label} ${t.label}`} onSelect={run(() => go(n.view, t.tab))} className={item}>
                          <n.icon /> {n.label} <span className="text-muted-foreground">› {t.label}</span>
                        </Command.Item>
                      ))
                    : [
                        <Command.Item key={n.view} value={n.label} onSelect={run(() => go(n.view))} className={item}>
                          <n.icon /> {n.label}
                        </Command.Item>,
                      ],
                )}
              </Command.Group>
              {d && (
                <Command.Group heading="Controls" className={group}>
                  <Command.Item value="stop start factory" onSelect={run(() => (d.stop ? control("start") : confirm({ title: "Stop every agent?", yes: "Stop the factory", danger: true, action: () => control("stop") })))} className={item}>
                    {d.stop ? <PlayIcon /> : <OctagonXIcon />} {d.stop ? "Start the factory" : "Stop the factory"}
                  </Command.Item>
                  <Command.Item value="pause resume" onSelect={run(() => (d.pause ? control("unpause") : control("pause", { hours: 24 }, "Paused for 24 hours")))} className={item}>
                    {d.pause ? <PlayIcon /> : <PauseIcon />} {d.pause ? "Resume" : "Pause for 24 hours"}
                  </Command.Item>
                  <Command.Item value="theme dark" onSelect={run(() => setTheme("dark"))} className={item}>
                    <MoonIcon /> Dark theme
                  </Command.Item>
                  <Command.Item value="theme light" onSelect={run(() => setTheme("light"))} className={item}>
                    <SunIcon /> Light theme
                  </Command.Item>
                  <Command.Item value="theme system" onSelect={run(() => setTheme("system"))} className={item}>
                    <MonitorIcon /> System theme
                  </Command.Item>
                </Command.Group>
              )}
              {d && (
                <Command.Group heading="Cards and PRs" className={group}>
                  {cols.flatMap(([col, list]) =>
                    list.map((c: State) => (
                      <Command.Item key={`${col}${c.repo}#${c.number}`} value={`#${c.number} ${c.title} ${short(c.repo)} ${col}`} onSelect={run(() => openItem({ ...c, column: col }))} className={item}>
                        {col === "review" ? <GitPullRequestIcon /> : <CircleDotIcon />}
                        <span className="font-mono text-xs text-muted-foreground">
                          {c.repo !== d.repo ? short(c.repo) : ""}#{c.number}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{c.title}</span>
                        {(col === "next" || col === "ideas") && (
                          <span
                            role="button"
                            tabIndex={-1}
                            className="rounded p-1 hover:bg-background"
                            title="Build now"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPalette(false);
                              buildNow(c);
                            }}
                          >
                            <HammerIcon />
                          </span>
                        )}
                      </Command.Item>
                    )),
                  )}
                </Command.Group>
              )}
            </Command.List>
          </Command>
        </DialogP.Content>
      </DialogP.Portal>
    </DialogP.Root>
  );
}
