// Every factory setting the owner can change, on tabs kept in the URL (#/settings/alerts). Each setting is
// one row: what it is and a one-line hint on the left, its control on the right; longer notes sit behind an
// info icon. Lane switches stay on the Lanes view.
import type { State } from "@/lib/api";
import { go } from "@/lib/router";
import { NAV } from "@/components/nav";
import { PageHeader } from "@/components/patterns";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/primitives";
import { GeneralTab } from "@/components/settings/GeneralTab";
import { LimitsTab } from "@/components/settings/LimitsTab";
import { AlertsTab } from "@/components/settings/AlertsTab";
import { BuildsTab } from "@/components/settings/BuildsTab";
import { GameTestsTab } from "@/components/settings/GameTestsTab";
import { InstallTab } from "@/components/settings/InstallTab";

const TABS = NAV.find((n) => n.view === "settings")?.tabs ?? [];

export function SettingsView({ d, tab }: { d: State; tab: string; arg: string }) {
  const current = TABS.some((t) => t.tab === tab) ? tab : "general";
  return (
    <>
      <PageHeader
        title="Settings"
        description={
          <>
            Lane switches are on{" "}
            <button className="text-brand hover:underline" onClick={() => go("lanes")}>
              Lanes
            </button>
            ; schedules and models come from each repo's .factory.yml.
          </>
        }
      />
      <Tabs value={current} onValueChange={(v) => go("settings", v === "general" ? "" : v)} className="mx-auto flex max-w-3xl flex-col gap-4">
        <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
          <TabsList className="max-w-none">
            {TABS.map((t) => (
              <TabsTrigger key={t.tab} value={t.tab}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value="general">
          <GeneralTab d={d} />
        </TabsContent>
        <TabsContent value="limits">
          <LimitsTab d={d} />
        </TabsContent>
        <TabsContent value="alerts">
          <AlertsTab />
        </TabsContent>
        <TabsContent value="builds">
          <BuildsTab d={d} />
        </TabsContent>
        <TabsContent value="games">
          <GameTestsTab />
        </TabsContent>
        <TabsContent value="install">
          <InstallTab d={d} />
        </TabsContent>
      </Tabs>
    </>
  );
}
