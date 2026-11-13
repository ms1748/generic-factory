// Insights: the factory's history (charts, PR scores, quality trials) and players' crash reports.
// The tab lives in the URL (#/insights, #/insights/data, #/insights/reports).
import { BarChart3Icon, BugIcon } from "lucide-react";
import type { State } from "@/lib/api";
import { go } from "@/lib/router";
import { PageHeader } from "@/components/patterns";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/primitives";
import { DataTab } from "@/components/insights/DataTab";
import { ReportsTab } from "@/components/insights/ReportsTab";

export function InsightsView({ d, tab }: { d: State; tab: string; arg: string }) {
  const t = tab === "reports" ? "reports" : "data";
  return (
    <Tabs value={t} onValueChange={(v) => go("insights", v)}>
      <PageHeader title="Insights">
        <TabsList className="self-start">
          <TabsTrigger value="data">
            <BarChart3Icon /> Data
          </TabsTrigger>
          <TabsTrigger value="reports">
            <BugIcon /> Crash reports
          </TabsTrigger>
        </TabsList>
      </PageHeader>
      <TabsContent value="data">
        <DataTab d={d} />
      </TabsContent>
      <TabsContent value="reports">
        <ReportsTab d={d} />
      </TabsContent>
    </Tabs>
  );
}
