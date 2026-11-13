// Runs: what the agents ran (and are running), what they did on GitHub, and the containers' logs.
// #/runs/run/42 (or the old #/runs/42) opens run 42; #/runs/logs/<container> opens that log.
import { FlaskConicalIcon } from "lucide-react";
import type { State } from "@/lib/api";
import { go } from "@/lib/router";
import { openTrial } from "@/lib/overlays";
import { PageHeader } from "@/components/patterns";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/primitives";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from "@/components/ui/overlays";
import { Button } from "@/components/ui/button";
import { RunsTab } from "@/components/runs/RunsTab";
import { ActivityTab } from "@/components/runs/ActivityTab";
import { LogsTab } from "@/components/runs/LogsTab";

export function RunsView({ d, tab, arg }: { d: State; tab: string; arg: string }) {
  const sub = tab === "activity" || tab === "logs" ? tab : "runs";
  const runId = tab === "run" ? arg.split("/")[0] : /^\d+$/.test(tab) ? tab : "";
  const trials: { name: string; title: string; wins: string }[] = d.trials ?? [];

  return (
    <Tabs value={sub} onValueChange={(v) => go("runs", v === "runs" ? "" : v)}>
      <PageHeader
        title="Runs"
        actions={
          sub === "runs" && trials.length > 0 ? (
            <Menu>
              <MenuTrigger asChild>
                <Button size="sm" variant="outline">
                  <FlaskConicalIcon /> Trials
                </Button>
              </MenuTrigger>
              <MenuContent className="max-w-80">
                <MenuLabel>Quality trials</MenuLabel>
                {trials.map((t) => (
                  <MenuItem key={t.name} onSelect={() => openTrial(t)} className="flex-col items-start gap-0">
                    <span className="font-medium">{t.title}</span>
                    <span className="text-xs text-muted-foreground">{t.wins.replace("Wins: ", "")}</span>
                  </MenuItem>
                ))}
              </MenuContent>
            </Menu>
          ) : null
        }
      >
        <TabsList className="self-start">
          <TabsTrigger value="runs">Runs</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
        </TabsList>
      </PageHeader>
      <TabsContent value="runs" className="outline-none">
        <RunsTab d={d} runId={runId} />
      </TabsContent>
      <TabsContent value="activity" className="outline-none">
        <ActivityTab d={d} />
      </TabsContent>
      <TabsContent value="logs" className="outline-none">
        <LogsTab name={sub === "logs" ? arg : ""} />
      </TabsContent>
    </Tabs>
  );
}
