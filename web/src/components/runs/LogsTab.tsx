// The Logs tab: pick a container on the factory's Docker and read its log, following new lines.
// #/runs/logs/<container> links straight to one.
import * as React from "react";
import { CheckIcon, DownloadIcon, MoreHorizontalIcon, ScrollTextIcon } from "lucide-react";
import { go } from "@/lib/router";
import { cn } from "@/lib/utils";
import { Empty } from "@/components/patterns";
import { Card, Input, Select, Switch, Tip } from "@/components/ui/primitives";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/overlays";
import { Button } from "@/components/ui/button";
import { Dot } from "@/components/magic";

type Container = { name: string; image: string; state: string; status: string; project: string | null };
type Line = { at: string; text: string };

const PROBLEM = /\b(err(or)?|fail(ed|ure)?|fatal|panic|exception|denied|refused|timed? ?out)\b/i;
const WARN = /\b(warn(ing)?|retry|slow)\b/i;
const TAILS = [200, 500, 2000, 5000];
const shortName = (n: string) => n.replace(/^factory-/, "").replace(/-1$/, "");
const clock = (iso: string) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "");
const exitedBad = (c: Container) => /Exited \((?!0\))/.test(c.status);

export function LogsTab({ name: arg }: { name: string }) {
  const [list, setList] = React.useState<Container[]>([]);
  const [listError, setListError] = React.useState("");
  const [lines, setLines] = React.useState<Line[]>([]);
  const [error, setError] = React.useState("");
  const [filter, setFilter] = React.useState("");
  const [problems, setProblems] = React.useState(false);
  const [follow, setFollow] = React.useState(true);
  const [wrap, setWrap] = React.useState(false);
  const [tail, setTail] = React.useState(500);
  const pane = React.useRef<HTMLDivElement>(null);
  const pinned = React.useRef(true);

  React.useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/logs", { cache: "no-store" });
        const j = await res.json();
        if (j.error) throw new Error(j.error);
        setList(j);
        setListError("");
      } catch (e) {
        setListError((e as Error).message);
      }
    };
    load();
    const t = setInterval(() => !document.hidden && load(), 15_000);
    return () => clearInterval(t);
  }, []);

  const selected = arg || list.find((c) => c.name.endsWith("dispatcher-1"))?.name || list[0]?.name || "";
  const current = list.find((c) => c.name === selected);

  // Load the tail, then follow it with ?since= while Follow is on.
  React.useEffect(() => {
    if (!selected) return;
    let stop = false;
    let timer = 0;
    let last = "";
    setLines([]);
    setError("");
    pinned.current = true;
    const pull = async (since?: string) => {
      try {
        const res = await fetch(`/api/logs/${encodeURIComponent(selected)}?tail=${tail}${since ? `&since=${encodeURIComponent(since)}` : ""}`, { cache: "no-store" });
        const j = await res.json();
        if (stop) return;
        if (!res.ok || j.error) throw new Error(j.error || res.statusText);
        if (j.length) {
          last = j.at(-1)?.at || last;
          setLines((old) => (since ? [...old, ...j].slice(-5000) : j));
        }
        setError("");
      } catch (e) {
        if (!stop) setError((e as Error).message);
      }
      if (!stop && follow) timer = window.setTimeout(() => pull(last || undefined), document.hidden ? 15_000 : 3000);
    };
    pull();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [selected, tail, follow]);

  const shown = React.useMemo(() => {
    const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
    return lines.filter((l) => (!problems || PROBLEM.test(l.text)) && words.every((w) => l.text.toLowerCase().includes(w)));
  }, [lines, filter, problems]);

  React.useLayoutEffect(() => {
    const p = pane.current;
    if (p && follow && pinned.current) p.scrollTop = p.scrollHeight;
  }, [shown, follow]);

  const groups = React.useMemo(() => {
    const m = new Map<string, Container[]>();
    for (const c of list) {
      const g = c.name.startsWith("factory-run-") ? "Agent runs" : (c.project ?? "Other");
      m.set(g, [...(m.get(g) ?? []), c]);
    }
    return [...m.entries()].sort((a, b) => Number(a[0] === "Agent runs") - Number(b[0] === "Agent runs") || a[0].localeCompare(b[0]));
  }, [list]);

  const download = () => {
    const blob = new Blob([lines.map((l) => `${l.at} ${l.text}`).join("\n") + "\n"], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${selected}-${new Date().toISOString().slice(0, 19).replace(/:/g, "")}.log`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  if (listError && !list.length) {
    return (
      <Empty icon={ScrollTextIcon} title="Can't list containers">
        {listError}
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:flex-none">
          {current && (
            <Tip content={`${current.image} · ${current.status}`}>
              <span className="inline-flex">
                <Dot tone={current.state === "running" ? "ok" : exitedBad(current) ? "bad" : "muted"} live={current.state === "running" && follow} />
              </span>
            </Tip>
          )}
          <Select value={selected} onChange={(e) => go("runs", "logs", e.target.value)} aria-label="Container" className="min-w-0 flex-1 font-mono text-xs sm:w-64 sm:flex-none">
            {!list.length && <option value="">Loading…</option>}
            {groups.map(([g, items]) => (
              <optgroup key={g} label={g}>
                {items.map((c) => (
                  <option key={c.name} value={c.name}>
                    {shortName(c.name)} · {c.state === "running" ? c.status.replace(/^Up /, "up ") : c.status.replace(/^Exited \((\d+)\) /, "exit $1 · ")}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </div>
        <Input type="search" placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter lines" className="h-9 w-full sm:w-48" />
        <span className="hidden flex-1 sm:block" />
        <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
          <Switch checked={follow} onCheckedChange={setFollow} aria-label="Follow" /> Follow
        </label>
        <span className="flex-1 sm:hidden" />
        <span className="text-xs tabular-nums text-muted-foreground">{shown.length === lines.length ? `${lines.length} lines` : `${shown.length}/${lines.length}`}</span>
        <Menu>
          <MenuTrigger asChild>
            <Button size="icon-sm" variant="outline" aria-label="Log options">
              <MoreHorizontalIcon />
            </Button>
          </MenuTrigger>
          <MenuContent>
            <MenuItem onSelect={(e) => (e.preventDefault(), setProblems(!problems))}>
              <CheckIcon className={cn(!problems && "invisible")} /> Errors only
            </MenuItem>
            <MenuItem onSelect={(e) => (e.preventDefault(), setWrap(!wrap))}>
              <CheckIcon className={cn(!wrap && "invisible")} /> Wrap lines
            </MenuItem>
            <MenuSeparator />
            <MenuLabel>Load</MenuLabel>
            {TAILS.map((n) => (
              <MenuItem key={n} onSelect={() => setTail(n)}>
                <CheckIcon className={cn(tail !== n && "invisible")} /> Last {n}
              </MenuItem>
            ))}
            <MenuSeparator />
            <MenuItem onSelect={download} disabled={!lines.length}>
              <DownloadIcon /> Download
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
      {error && <div className="text-xs text-bad">{error}</div>}
      <Card className="overflow-hidden">
        <div
          ref={pane}
          onScroll={() => {
            const p = pane.current;
            if (p) pinned.current = p.scrollHeight - p.scrollTop - p.clientHeight < 40;
          }}
          role="log"
          aria-live="off"
          className="h-[calc(100dvh-20rem)] min-h-72 overflow-auto overscroll-contain bg-muted/30 py-2 font-mono text-xs leading-relaxed md:h-[calc(100dvh-15rem)]"
        >
          {shown.length === 0 ? (
            <div className="px-3 py-2 text-muted-foreground">{lines.length ? "No line matches." : error ? "" : "No output yet."}</div>
          ) : (
            <div className={cn(!wrap && "w-max min-w-full")}>
              {shown.map((l, i) => {
                const bad = PROBLEM.test(l.text);
                return (
                  <div key={i} className="flex gap-3 px-3 hover:bg-muted">
                    <time title={l.at} className="w-16 shrink-0 select-none text-muted-foreground">
                      {clock(l.at)}
                    </time>
                    <span className={cn(wrap ? "min-w-0 whitespace-pre-wrap break-all" : "whitespace-pre", bad ? "text-bad" : WARN.test(l.text) && "text-warn")}>{l.text}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
