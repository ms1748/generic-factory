// Crash and problem reports from GlitchTip (/api/reports): what broke for players, how often, when last.
// Each row opens the issue in GlitchTip, where you resolve or comment on it.
import * as React from "react";
import { BugIcon, ExternalLinkIcon, InfoIcon, RefreshCwIcon, SettingsIcon } from "lucide-react";
import { getJson, type State } from "@/lib/api";
import { go } from "@/lib/router";
import { rel, time } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Empty, Segmented, Stat } from "@/components/patterns";
import { Badge, Card, Skeleton, Tip } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { Dot } from "@/components/magic";

type Kind = "all" | "crash" | "problem";
type Status = "unresolved" | "resolved" | "all";

export function ReportsTab({ d }: { d: State }) {
  const [data, setData] = React.useState<State | null>(null);
  const [failed, setFailed] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [kind, setKind] = React.useState<Kind>("all");
  const [status, setStatus] = React.useState<Status>("unresolved");

  const pull = React.useCallback(async (fresh = false) => {
    setBusy(true);
    const j = await getJson(`/api/reports${fresh ? "?fresh=1" : ""}`);
    if (j) {
      setData(j);
      setFailed("");
    } else setFailed("no answer from the dispatcher");
    setBusy(false);
  }, []);
  React.useEffect(() => {
    pull();
    const t = setInterval(() => document.hidden || pull(), 120_000);
    return () => clearInterval(t);
  }, [pull]);

  const all: State[] = data?.issues ?? [];
  const open = all.filter((r) => r.status === "unresolved");
  const crashes = open.filter((r) => r.kind === "crash").length;
  const problems = open.filter((r) => r.kind === "problem").length;
  const week = open.filter((r) => Date.now() - Date.parse(r.lastSeen) < 7 * 86_400_000).length;
  const list = all.filter((r) => (kind === "all" || r.kind === kind) && (status === "all" || r.status === status));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Crashes" hint="open" value={data ? crashes : null} tone={crashes ? "bad" : undefined} />
        <Stat label="Problems" hint="open reports" value={data ? problems : null} />
        <Stat label="This week" hint="open, seen" value={data ? week : null} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Segmented<Kind> value={kind} onChange={setKind} options={[{ value: "all", label: "All" }, { value: "crash", label: "Crashes" }, { value: "problem", label: "Problems" }]} />
        <Segmented<Status> value={status} onChange={setStatus} options={[{ value: "unresolved", label: "Open" }, { value: "resolved", label: "Resolved" }, { value: "all", label: "Any" }]} />
        <div className="ml-auto flex items-center gap-1.5">
          {data?.at && <span className="hidden text-xs text-muted-foreground sm:inline">checked {rel(data.at)}</span>}
          <Tip content="Crash reports come from players who turned them on; problem reports only when someone presses Send. Keys, folders and names are stripped before they leave the PC; GlitchTip deletes them after 90 days. The maintainer lane reads the same list.">
            <button className="rounded p-1 text-muted-foreground hover:text-foreground" aria-label="About these reports">
              <InfoIcon className="size-4" />
            </button>
          </Tip>
          <Button size="sm" variant="ghost" onClick={() => pull(true)} disabled={busy} aria-label="Refresh">
            <RefreshCwIcon className={cn(busy && "animate-spin")} />
          </Button>
          {data?.url && (
            <Button asChild size="sm" variant="outline">
              <a href={data.url} target="_blank" rel="noopener">
                GlitchTip <ExternalLinkIcon />
              </a>
            </Button>
          )}
        </div>
      </div>

      {(failed || data?.error) && <p className="text-xs text-bad">Couldn't read GlitchTip: {failed || data.error}. The list may be old.</p>}

      {data && !data.configured ? (
        <Empty icon={BugIcon} title="Reports are off">
          <span className="block">Set GlitchTip in Settings › Install and GLITCHTIP_TOKEN in the factory's env.</span>
          <Button size="xs" variant="outline" className="mt-3" onClick={() => go("settings", "install")}>
            <SettingsIcon /> Install settings
          </Button>
        </Empty>
      ) : !data ? (
        <Card className="divide-y">
          {[0, 1, 2].map((i) => (
            <div key={i} className="p-4">
              <Skeleton className="mb-2 h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          ))}
        </Card>
      ) : !list.length ? (
        <Empty icon={BugIcon} title={kind === "all" && status === "unresolved" ? "No open reports" : "Nothing matches"}>
          {kind === "all" && status === "unresolved" ? "Nothing has crashed lately." : undefined}
        </Empty>
      ) : (
        <Card className="divide-y overflow-hidden">
          {list.map((r) => (
            <a key={r.id} href={r.link} target="_blank" rel="noopener" className="flex items-center gap-3 px-4 py-3 transition hover:bg-accent/50">
              <Dot tone={r.status !== "unresolved" ? "muted" : r.kind === "crash" ? "bad" : "warn"} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{r.title}</span>
                <span className="block truncate font-mono text-[11px] text-muted-foreground">
                  {r.shortId}
                  {r.culprit ? ` · ${r.culprit}` : ""}
                </span>
              </span>
              <Badge variant={r.kind === "crash" ? "bad" : "outline"} className="hidden sm:inline-flex">
                {r.kind === "crash" ? "crash" : "problem"}
              </Badge>
              <Tip content="Times it happened">
                <span className="w-10 shrink-0 text-right text-xs tabular-nums">{r.count}×</span>
              </Tip>
              <Tip content={`First seen ${time(r.firstSeen, d.timezone)}`}>
                <span className="hidden w-20 shrink-0 text-right text-xs text-muted-foreground sm:inline">{rel(r.lastSeen)}</span>
              </Tip>
            </a>
          ))}
        </Card>
      )}
    </div>
  );
}
