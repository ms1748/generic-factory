// Work: the board (a kanban of every card and PR, with the features above it) and the untriaged ideas.
// The tab lives in the URL (#/work/board, #/work/ideas).
import * as React from "react";
import { KanbanSquareIcon, LightbulbIcon } from "lucide-react";
import type { State } from "@/lib/api";
import { go } from "@/lib/router";
import { PageHeader } from "@/components/patterns";
import { Badge, Tabs, TabsList, TabsTrigger, TabsContent, Tip } from "@/components/ui/primitives";
import { Board } from "@/components/work/Board";
import { Features } from "@/components/work/Features";
import { Ideas } from "@/components/work/Ideas";
import { FilterBar, type Filter } from "@/components/work/shared";

export function WorkView({ d, tab }: { d: State; tab: string; arg: string }) {
  const t = tab === "ideas" ? "ideas" : "board";
  const b = d.board;
  const [f, setF] = React.useState<Filter>({ q: "", repo: "all" });
  const queued = b.next.filter((c: State) => !c.answered).length;
  const prs = `${d.openFactoryPrs}${d.maxOpenPrs > 0 ? `/${d.maxOpenPrs}` : ""}`;

  return (
    <Tabs value={t} onValueChange={(v) => go("work", v)}>
      <PageHeader
        title="Work"
        description={`${queued} queued · ${prs} factory PRs open${b.blocked.length ? ` · ${b.blocked.length} blocked` : ""}`}
        actions={
          <TabsList>
            <TabsTrigger value="board">
              <KanbanSquareIcon /> Board
            </TabsTrigger>
            <TabsTrigger value="ideas">
              <LightbulbIcon /> Ideas
              {b.ideas?.length > 0 && <span className="text-[11px] tabular-nums text-muted-foreground">{b.ideas.length}</span>}
            </TabsTrigger>
          </TabsList>
        }
      />
      <TabsContent value="board" className="flex min-w-0 flex-col gap-4 outline-none">
        <FilterBar f={f} set={setF} repos={d.repos ?? [d.repo]} placeholder="Filter cards">
          {d.maxOpenPrs > 0 && d.openFactoryPrs >= d.maxOpenPrs && (
            <Tip content="Builders wait until a factory PR merges or closes">
              <Badge variant="warn">PR limit reached</Badge>
            </Tip>
          )}
        </FilterBar>
        <Features d={d} repoFilter={f.repo} />
        <Board d={d} f={f} />
      </TabsContent>
      <TabsContent value="ideas" className="outline-none">
        <Ideas d={d} />
      </TabsContent>
    </Tabs>
  );
}
