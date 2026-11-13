// Settings › Limits (src/limits.ts): the usage stops in percent, a run's time limit, the usage refresh and
// the auto-queue interval. One form, one Save.
import * as React from "react";
import { control, type State } from "@/lib/api";
import { Section, SettingList, SettingRow } from "@/components/patterns";
import { More, Num, SaveBar, numVal, useDraft } from "./bits";

type F = { fiveHour: number | ""; sevenDay: number | ""; runTimeoutMin: number | ""; usageRefreshMin: number | ""; autoQueueEveryH: number | "" };
const toForm = (l: State): F => ({ fiveHour: Math.round(l.fiveHour * 100), sevenDay: Math.round(l.sevenDay * 100), runTimeoutMin: l.runTimeoutMin, usageRefreshMin: l.usageRefreshMin, autoQueueEveryH: l.autoQueueEveryH });

export function LimitsTab({ d }: { d: State }) {
  const { form: f, dirty, edit, undo, setDirty } = useDraft<F>(d.limits, toForm);
  if (!f) return <Section title="Limits"><p className="text-sm text-muted-foreground">Loading…</p></Section>;
  const field = (k: keyof F) => ({ id: `lim-${k}`, required: true, value: f[k], onChange: (e: React.ChangeEvent<HTMLInputElement>) => edit((x) => ({ ...x, [k]: numVal(e) })) });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const body = {
      fiveHour: Number(f!.fiveHour) / 100,
      sevenDay: Number(f!.sevenDay) / 100,
      runTimeoutMin: Number(f!.runTimeoutMin),
      usageRefreshMin: Number(f!.usageRefreshMin),
      autoQueueEveryH: Number(f!.autoQueueEveryH),
    };
    if (await control("settings/limits", body)) setDirty(false);
  }

  const stops = <More>The usage stops leave room for your own Claude use; the plan meters mark them.</More>;
  return (
    <Section title="Limits">
      <form onSubmit={save}>
        <SettingList>
          <SettingRow htmlFor="lim-fiveHour" label={<>5-hour stop{stops}</>} hint="No new run once the plan's 5-hour window is this full.">
            <Num {...field("fiveHour")} min={10} max={100} unit="%" />
          </SettingRow>
          <SettingRow htmlFor="lim-sevenDay" label={<>Weekly stop{stops}</>} hint="No new run once the week is this full.">
            <Num {...field("sevenDay")} min={10} max={100} unit="%" />
          </SettingRow>
          <SettingRow htmlFor="lim-runTimeoutMin" label={<>Run time limit<More>Applies from a run's next start.</More></>} hint="Stop a run that's still going after this.">
            <Num {...field("runTimeoutMin")} min={10} max={600} unit="min" />
          </SettingRow>
          <SettingRow htmlFor="lim-usageRefreshMin" label="Usage refresh" hint="While nothing reports usage, a tiny Haiku call refreshes the meters. 0 is off.">
            <Num {...field("usageRefreshMin")} min={0} max={240} unit="min" />
          </SettingRow>
          <SettingRow htmlFor="lim-autoQueueEveryH" label="Auto-queue interval" hint="Auto-queue tries at most once per project this often.">
            <Num {...field("autoQueueEveryH")} min={1} max={48} unit="h" />
          </SettingRow>
        </SettingList>
        <SaveBar dirty={dirty} onUndo={undo} className="mt-3" />
      </form>
    </Section>
  );
}
