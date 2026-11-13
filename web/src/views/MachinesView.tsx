// Machines: the homelab and the test PCs. Devices is a card per machine (live meters, history, CI on it and
// any game test waiting on you); Systems is the website checks, alerts, containers, history and free tier;
// Performance is every hardware test run. The tab follows the URL (#/machines/<tab>[/<arg>]).
import * as React from "react";
import { GaugeIcon, ServerIcon, ActivityIcon, AlertTriangleIcon } from "lucide-react";
import { control, type State } from "@/lib/api";
import { go } from "@/lib/router";
import { RANGES, setRange, useSystems, type Range } from "@/lib/systems";
import { PageHeader, Segmented, Empty } from "@/components/patterns";
import { Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/primitives";
import { DeviceCard, GameTest } from "@/components/machines/DeviceCard";
import { SystemsTab } from "@/components/machines/SystemsTab";
import { PerfTab } from "@/components/machines/PerfTab";
import { useDevices } from "@/components/machines/shared";

const TABS = ["devices", "systems", "performance"] as const;
const DESCRIPTION: Record<string, string> = {
  devices: "Live stats, CI and game tests on each machine.",
  systems: "Site checks, alerts, containers and history.",
  performance: "How each build did in the hardware tests.",
};

export function MachinesView({ d, tab, arg }: { d: State; tab: string; arg: string }) {
  const t = (TABS as readonly string[]).includes(tab) ? tab : "devices";
  return (
    <Tabs value={t} onValueChange={(v) => go("machines", v)}>
      <PageHeader title="Machines" description={DESCRIPTION[t]} actions={t !== "performance" && <RangePicker />}>
        <TabsList className="self-start">
          <TabsTrigger value="devices">
            <ServerIcon /> Devices
          </TabsTrigger>
          <TabsTrigger value="systems">
            <ActivityIcon /> Systems
          </TabsTrigger>
          <TabsTrigger value="performance">
            <GaugeIcon /> Performance
          </TabsTrigger>
        </TabsList>
      </PageHeader>
      <TabsContent value="devices" className="outline-none">
        {t === "devices" && <DevicesTab d={d} />}
      </TabsContent>
      <TabsContent value="systems" className="outline-none">
        {t === "systems" && <SystemsWrap />}
      </TabsContent>
      <TabsContent value="performance" className="outline-none">
        {t === "performance" && <PerfTab d={d} arg={arg} />}
      </TabsContent>
    </Tabs>
  );
}

/** The history range for every chart on Devices and Systems, remembered on this browser. */
function RangePicker() {
  const { range } = useSystems();
  return <Segmented value={range} onChange={(r: Range) => setRange(r)} options={RANGES.map((r) => ({ value: r, label: r }))} />;
}

function SystemsWrap() {
  const { range } = useSystems();
  return <SystemsTab range={range} />;
}

function DevicesTab({ d }: { d: State }) {
  const { data: sys, error: sysError, range } = useSystems();
  const { data: dev, error: devError, load } = useDevices();
  // One game-test request at a time; the buttons stay off until the view reloads, so a double click never
  // posts twice and an answered test doesn't flash its buttons again.
  const [busyRun, setBusyRun] = React.useState(0);
  const act = React.useCallback(
    async (g: State, what: string) => {
      if (busyRun) return;
      setBusyRun(g.run);
      try {
        await control(`gaming/${g.run}/${what}`);
        await load();
      } finally {
        setBusyRun(0);
      }
    },
    [busyRun, load],
  );

  if (!sys && !dev)
    return sysError ? (
      <Empty icon={AlertTriangleIcon} title="Can't load machines">
        {sysError}
      </Empty>
    ) : (
      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {[0, 1].map((i) => (
          <Skeleton key={i} className="h-72 rounded-xl" />
        ))}
      </div>
    );

  // Every machine either side knows: the reporters' order first, then CI-only ones.
  const sysDevices: State[] = sys?.devices ?? [];
  const ciMachines: State[] = dev?.machines ?? [];
  const names = [...sysDevices.map((m) => m.name), ...ciMachines.map((m) => m.name).filter((n) => !sysDevices.some((m) => m.name === n))];
  const games: State[] = dev?.games ?? [];
  const unplaced = games.filter((g) => !g.machine || !names.includes(g.machine));

  return (
    <div className="grid min-w-0 gap-4">
      {devError && <p className="text-xs text-bad">Couldn't read CI: {devError}</p>}
      {unplaced.map((g) => (
        <GameTest key={g.run} g={g} repo={d.repo} busy={busyRun !== 0} act={act} />
      ))}
      {names.length === 0 ? (
        <Empty icon={ServerIcon} title="No machines yet">
          Add them in Settings › Install, or start a reporter on one.
        </Empty>
      ) : (
        <div className="grid min-w-0 items-start gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {names.map((name) => (
            <DeviceCard
              key={name}
              name={name}
              m={sysDevices.find((m) => m.name === name)}
              ci={ciMachines.find((m) => m.name === name)}
              games={games.filter((g) => g.machine === name)}
              repo={d.repo}
              host={sys?.host}
              range={range}
              busyRun={busyRun}
              act={act}
            />
          ))}
        </div>
      )}
      {sys?.configured && !sys.configured.push && (
        <p className="text-xs text-muted-foreground">
          Reporters need <code className="rounded border bg-muted px-1 font-mono text-[11px]">DEVICE_TOKEN</code> in the factory's env first.
        </p>
      )}
    </div>
  );
}
