// The Activity tab: what the agents did on GitHub lately, by day, each with an Undo where the dispatcher
// can reverse it (it looks the action up again itself; the page only names it).
import * as React from "react";
import { HistoryIcon, InfoIcon, RefreshCwIcon, Undo2Icon, AlertTriangleIcon } from "lucide-react";
import { control, type State } from "@/lib/api";
import { confirm } from "@/lib/overlays";
import { rel, time } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Empty, IssueRef, Section, Segmented } from "@/components/patterns";
import { Badge, Skeleton, Tip } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { openCard } from "./util";

type Win = "24h" | "3d" | "7d";
type Action = { id: string; at: string; n: number; kind: "issue" | "pr"; what: string; canUndo: boolean; undone: boolean };

export function ActivityTab({ d }: { d: State }) {
  const [win, setWin] = React.useState<Win>("24h");
  const [data, setData] = React.useState<{ actions: Action[]; unseen: number[] } | null>(null);
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  const fetchIt = React.useCallback(async (w: Win) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/activity?window=${w}`, { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || res.statusText);
      setData({ ...j, actions: j?.actions ?? [], unseen: j?.unseen ?? [] });
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  React.useEffect(() => void fetchIt(win), [win, fetchIt]);

  const undo = (a: Action) =>
    confirm({
      title: `Undo this on #${a.n}?`,
      body: `"${a.what}". The factory's GitHub App reverses it now${a.what.startsWith("opened") ? " (it closes it; nothing is deleted)" : ""}.`,
      yes: "Undo it",
      danger: true,
      action: async () => {
        if (await control(`activity/${a.id}/undo`)) fetchIt(win);
      },
    });

  const days: { day: string; items: Action[] }[] = [];
  for (const a of data?.actions ?? []) {
    const day = new Date(a.at).toLocaleDateString("en-US", { timeZone: d.timezone, weekday: "long", month: "short", day: "numeric" });
    if (days.at(-1)?.day !== day) days.push({ day, items: [] });
    days.at(-1)!.items.push(a);
  }

  return (
    <Section
      flush
      title={
        <span className="inline-flex items-center gap-1.5">
          Agent actions on GitHub
          <Tip content="Merged code isn't undone here: revert it with a PR. An undo is also an action by the app, so it shows up here too.">
            <InfoIcon className="size-3.5 text-muted-foreground" />
          </Tip>
        </span>
      }
      actions={
        <>
          <Segmented<Win>
            value={win}
            onChange={setWin}
            options={[
              { value: "24h", label: "24h" },
              { value: "3d", label: "3d" },
              { value: "7d", label: "7d" },
            ]}
          />
          <Tip content="Refresh">
            <Button size="icon-sm" variant="ghost" onClick={() => fetchIt(win)} disabled={loading} aria-label="Refresh">
              <RefreshCwIcon className={cn(loading && "animate-spin")} />
            </Button>
          </Tip>
        </>
      }
    >
      {error && <div className="border-b px-4 py-2 text-xs text-bad">Couldn't read GitHub: {error}</div>}
      {data && data.unseen.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b bg-warn/5 px-4 py-2 text-xs">
          <Tip content="Label changes and closes by cloud runs acted as you, so they can't be told apart. Check these by hand.">
            <span className="inline-flex items-center gap-1 font-medium text-warn">
              <AlertTriangleIcon className="size-3.5" /> Not listed
            </span>
          </Tip>
          {data.unseen.map((n) => (
            <IssueRef key={n} repo={d.repo} n={n} />
          ))}
        </div>
      )}
      {!data && !error ? (
        <div className="grid gap-3 p-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-5" />
          ))}
        </div>
      ) : data && !data.actions.length ? (
        <div className="p-4">
          <Empty icon={HistoryIcon} title="Nothing in this window" />
        </div>
      ) : (
        days.map((g) => (
          <div key={g.day}>
            <div className="border-b bg-muted/40 px-4 py-1.5 text-[11px] font-medium text-muted-foreground">{g.day}</div>
            <ul className="divide-y">
              {g.items.map((a) => (
                <li key={a.id} role="button" tabIndex={0} onClick={() => openCard(d, a.n, d.repo, a.kind === "pr")} onKeyDown={(e) => e.key === "Enter" && openCard(d, a.n, d.repo, a.kind === "pr")} className="grid cursor-pointer grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2 text-sm transition hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none">
                  <Tip content={rel(a.at)}>
                    <time dateTime={a.at} className="w-14 text-xs tabular-nums text-muted-foreground">
                      {time(a.at, d.timezone, { weekday: undefined })}
                    </time>
                  </Tip>
                  <IssueRef repo={d.repo} n={a.n} pr={a.kind === "pr"} />
                  <span className={cn("break-words", a.undone && "text-muted-foreground line-through")}>{a.what}</span>
                  {a.undone ? (
                    <Badge variant="outline">Undone</Badge>
                  ) : a.canUndo ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      aria-label="Undo"
                      onClick={(e) => {
                        e.stopPropagation();
                        undo(a);
                      }}
                    >
                      <Undo2Icon /> <span className="hidden sm:inline">Undo</span>
                    </Button>
                  ) : (
                    <span />
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </Section>
  );
}
