// Bits the Work tabs share: the card actions menu (one place for build now, hold, requeue, watch run,
// GitHub), the priority/size/repo badges, and the board filter.
import * as React from "react";
import { MoreHorizontalIcon, PlayIcon, PauseIcon, RotateCcwIcon, EyeIcon, ExternalLinkIcon, MessageCircleQuestionIcon, SearchIcon } from "lucide-react";
import { control, type State } from "@/lib/api";
import { buildNow } from "@/lib/overlays";
import { go } from "@/lib/router";
import { gh, short } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge, Input, Select, Tip } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { Menu, MenuTrigger, MenuContent, MenuItem, MenuSeparator } from "@/components/ui/overlays";

/** Keeps clicks and Enter inside (menus and buttons on a card) from also opening the card; React bubbles portal events. */
export function Stop({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={className} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      {children}
    </span>
  );
}

const PRIO: Record<string, "bad" | "warn" | "outline"> = { p0: "bad", p1: "warn" };

/** Priority, size and (for another repo) the repo, as small badges. */
export function CardBadges({ c, primary }: { c: State; primary: string }) {
  const repo = c.repo ?? primary;
  return (
    <>
      {c.priority && <Badge variant={PRIO[c.priority] ?? "outline"}>{c.priority}</Badge>}
      {c.size && <Badge variant="outline">{c.size}</Badge>}
      {repo !== primary && (
        <Tip content={repo}>
          <Badge variant="info">{short(repo).replace(new RegExp("^" + short(primary) + "-"), "")}</Badge>
        </Tip>
      )}
    </>
  );
}

/** The actions a card has where it sits, in a small menu. */
export function CardMenu({ c, column, repo, className }: { c: State; column: string; repo: string; className?: string }) {
  const n = c.number;
  const isPr = column === "review";
  const done = column === "done";
  const issueNo = done ? null : n;
  return (
    <Stop className={className}>
      <Menu>
        <MenuTrigger asChild>
          <Button size="icon-sm" variant="ghost" className="size-7 text-muted-foreground" aria-label={`Actions for #${n}`}>
            <MoreHorizontalIcon />
          </Button>
        </MenuTrigger>
        <MenuContent>
          {c.answered && (
            <MenuItem onSelect={() => control(`cards/${n}/requeue`, { repo }, `#${n} requeued`)}>
              <RotateCcwIcon /> Requeue
            </MenuItem>
          )}
          {!c.answered && (column === "next" || column === "blocked" || column === "ideas") && (
            <MenuItem onSelect={() => buildNow({ number: n, title: c.title, repo })}>
              <PlayIcon /> Build now
            </MenuItem>
          )}
          {column === "ideas" && (
            <MenuItem onSelect={() => control(`cards/${n}/requeue`, { repo }, `#${n} queued`)}>
              <RotateCcwIcon /> Queue
            </MenuItem>
          )}
          {!c.answered && (column === "next" || column === "blocked") && (
            <MenuItem onSelect={() => control(`cards/${n}/hold`, { repo })}>
              <PauseIcon /> Hold
            </MenuItem>
          )}
          {(column === "hold" || column === "needsYou") && (
            <MenuItem onSelect={() => control(`cards/${n}/requeue`, { repo }, `#${n} requeued`)}>
              <RotateCcwIcon /> Requeue
            </MenuItem>
          )}
          {column === "needsYou" && (
            <MenuItem onSelect={() => go("inbox", "", repo + "/" + n)}>
              <MessageCircleQuestionIcon /> Answer in Inbox
            </MenuItem>
          )}
          {c.run && (column === "building" || isPr) && (
            <MenuItem onSelect={() => go("runs", "run", String(c.run))}>
              <EyeIcon /> {c.running ? "Watch run" : "See run"}
            </MenuItem>
          )}
          <MenuSeparator />
          <MenuItem asChild>
            <a href={gh(repo, isPr ? "pull" : "issues", issueNo ?? n)} target="_blank" rel="noopener">
              <ExternalLinkIcon /> {isPr ? "Review on GitHub" : "Open on GitHub"}
            </a>
          </MenuItem>
          {done && c.pr && (
            <MenuItem asChild>
              <a href={gh(repo, "pull", c.pr)} target="_blank" rel="noopener">
                <ExternalLinkIcon /> PR #{c.pr}
              </a>
            </MenuItem>
          )}
        </MenuContent>
      </Menu>
    </Stop>
  );
}

export type Filter = { q: string; repo: string };

/** Does a card match the search box and the repo picker? */
export const matches = (f: Filter, c: State, primary: string) =>
  (f.repo === "all" || (c.repo ?? primary) === f.repo) && (!f.q.trim() || `#${c.number} ${c.title}`.toLowerCase().includes(f.q.trim().toLowerCase()));

/** Search plus (with several repos) a repo picker, sized for a toolbar. */
export function FilterBar({ f, set, repos, placeholder = "Search", children, className }: { f: Filter; set: (f: Filter) => void; repos: string[]; placeholder?: string; children?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <div className="relative min-w-0 flex-1 sm:max-w-64">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input type="search" value={f.q} onChange={(e) => set({ ...f, q: e.target.value })} placeholder={placeholder} aria-label={placeholder} className="h-8 pl-8 text-[13px]" />
      </div>
      {repos.length > 1 && (
        <Select value={f.repo} onChange={(e) => set({ ...f, repo: e.target.value })} aria-label="Repo" className="h-8 text-[13px]">
          <option value="all">All repos</option>
          {repos.map((r) => (
            <option key={r} value={r}>
              {short(r)}
            </option>
          ))}
        </Select>
      )}
      {children}
    </div>
  );
}
