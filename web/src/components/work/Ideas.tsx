// Every untriaged idea: search, size and type filters, pages of 12. Each row opens the sheet; Queue and
// Build now sit on the row (in the ⋯ menu on phones).
import * as React from "react";
import { ChevronLeftIcon, ChevronRightIcon, LightbulbIcon, PlayIcon, BotIcon } from "lucide-react";
import { control, type State } from "@/lib/api";
import { buildNow, openItem } from "@/lib/overlays";
import { IssueRef, Empty } from "@/components/patterns";
import { Badge, Card, Select } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { CardBadges, CardMenu, FilterBar, Stop, matches, type Filter } from "./shared";

const PAGE = 12;
const TYPES = ["feature", "fix", "chore", "security"];
const typeOf = (labels: string[] = []) => TYPES.find((t) => labels.includes(t)) ?? "";

export function Ideas({ d }: { d: State }) {
  const primary: string = d.repo;
  const repos: string[] = d.repos ?? [primary];
  const [f, setF] = React.useState<Filter>({ q: "", repo: "all" });
  const [size, setSize] = React.useState("all");
  const [type, setType] = React.useState("all");
  const [page, setPage] = React.useState(0);
  const all: State[] = d.board.ideas ?? [];
  const ideas = all.filter((i) => matches(f, i, primary) && (size === "all" || (i.size ?? "none") === size) && (type === "all" || typeOf(i.labels) === type));
  const pages = Math.max(1, Math.ceil(ideas.length / PAGE));
  const p = Math.min(page, pages - 1);
  const shown = ideas.slice(p * PAGE, p * PAGE + PAGE);
  React.useEffect(() => setPage(0), [f, size, type]);

  return (
    <div className="flex flex-col gap-3">
      <FilterBar f={f} set={setF} repos={repos} placeholder="Search ideas">
        <Select value={size} onChange={(e) => setSize(e.target.value)} aria-label="Size" className="h-8 text-[13px]">
          <option value="all">Any size</option>
          {["S", "M", "L", "XL"].map((s) => (
            <option key={s} value={s}>
              Size {s}
            </option>
          ))}
          <option value="none">Unsized</option>
        </Select>
        <Select value={type} onChange={(e) => setType(e.target.value)} aria-label="Type" className="h-8 text-[13px]">
          <option value="all">Any type</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t[0].toUpperCase() + t.slice(1)}
            </option>
          ))}
        </Select>
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {ideas.length === all.length ? all.length : `${ideas.length} of ${all.length}`} ideas
        </span>
      </FilterBar>

      {!shown.length ? (
        <Empty icon={LightbulbIcon} title={all.length ? "No idea matches" : "No untriaged ideas"} />
      ) : (
        <Card className="divide-y overflow-hidden">
          {shown.map((i) => (
            <IdeaRow key={`${i.repo ?? primary}#${i.number}`} i={i} primary={primary} />
          ))}
        </Card>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button size="sm" variant="outline" disabled={p === 0} onClick={() => setPage(p - 1)} aria-label="Previous page">
            <ChevronLeftIcon />
          </Button>
          <span className="min-w-24 text-center text-xs tabular-nums text-muted-foreground">
            Page {p + 1} of {pages}
          </span>
          <Button size="sm" variant="outline" disabled={p >= pages - 1} onClick={() => setPage(p + 1)} aria-label="Next page">
            <ChevronRightIcon />
          </Button>
        </div>
      )}
    </div>
  );
}

function IdeaRow({ i, primary }: { i: State; primary: string }) {
  const repo: string = i.repo ?? primary;
  const open = () => openItem({ ...i, repo, column: "ideas" });
  const t = typeOf(i.labels);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => e.key === "Enter" && open()}
      className="group flex cursor-pointer items-center gap-3 px-3 py-2.5 transition hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none sm:px-4"
    >
      <IssueRef repo={repo} n={i.number} className="w-11 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm group-hover:text-brand">{i.title}</div>
        <div className="mt-1 flex flex-wrap items-center gap-1 empty:hidden">
          <CardBadges c={i} primary={primary} />
          {t && <Badge variant="outline">{t}</Badge>}
          {i.labels?.includes("factory") && (
            <Badge variant="brand">
              <BotIcon /> factory
            </Badge>
          )}
        </div>
      </div>
      <Stop className="hidden shrink-0 items-center gap-1.5 sm:flex">
        <Button size="xs" variant="outline" onClick={() => control(`cards/${i.number}/requeue`, { repo }, `#${i.number} queued`)}>
          Queue
        </Button>
        <Button size="xs" variant="brand" onClick={() => buildNow({ number: i.number, title: i.title, repo })}>
          <PlayIcon /> Build now
        </Button>
      </Stop>
      <CardMenu c={i} column="ideas" repo={repo} className="shrink-0 sm:hidden" />
    </div>
  );
}
