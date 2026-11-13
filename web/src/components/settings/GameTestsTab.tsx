// Settings › Game tests (src/gaming.ts): the game-test workflow's repository variables on the primary repo,
// read from GitHub when the tab opens. The on switch saves at once; the rest is one form that writes only these fields.
import * as React from "react";
import { control, getJson, type State } from "@/lib/api";
import { go } from "@/lib/router";
import { Section, SettingList, SettingRow } from "@/components/patterns";
import { Input, Skeleton, Textarea } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { LiveSwitch, Note, Num, SaveBar, numVal } from "./bits";

export function GameTestsTab() {
  const [info, setInfo] = React.useState<State>(null);
  const [f, setF] = React.useState<State>(null);
  const [dirty, setDirty] = React.useState(false);
  const load = React.useCallback(async () => {
    const i = (await getJson("/api/gaming")) ?? { error: "Couldn't reach the dispatcher" };
    setInfo(i);
    if (i.vars) setF({ ...i.vars });
    setDirty(false);
  }, []);
  React.useEffect(() => {
    load();
  }, [load]);
  const edit = (patch: State) => {
    setF((x: State) => ({ ...x, ...patch }));
    setDirty(true);
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (await control("settings/gaming", { on: f.on, autoHours: f.autoHours, limitMin: Number(f.limitMin), games: f.games })) load();
  }

  return (
    <Section
      title="Game tests"
      description={info?.workflow ? `${info.repo} · ${info.workflow}` : undefined}
      actions={
        <Button size="xs" variant="ghost" onClick={() => go("machines", "devices")}>
          Waiting tests
        </Button>
      }
    >
      {!info ? (
        <Skeleton className="h-32" />
      ) : info.error ? (
        <Note>Can't read the settings: {info.error}</Note>
      ) : !info.workflow ? (
        <p className="text-sm text-muted-foreground">
          No game-test workflow is set. Name it in{" "}
          <button className="text-brand hover:underline" onClick={() => go("settings", "install")}>
            Install › Game tests
          </button>
          .
        </p>
      ) : f ? (
        <form onSubmit={save}>
          <SettingList>
            <SettingRow htmlFor="gt-on" label="Game tests on" hint="Off: the workflow doesn't run a game test.">
              <LiveSwitch
                id="gt-on"
                checked={!!f.on}
                onSave={async (on) => {
                  const ok = await control("settings/gaming", { on });
                  if (ok) setF((x: State) => ({ ...x, on }));
                  return ok;
                }}
              />
            </SettingRow>
            <SettingRow htmlFor="gt-hours" label="Start by themselves" hint="Hours like 1-7 on the test machine's clock. Empty: they wait for you.">
              <Input id="gt-hours" className="h-8 w-24" spellCheck={false} placeholder="1-7" value={f.autoHours} onChange={(e) => edit({ autoHours: e.target.value })} />
            </SettingRow>
            <SettingRow htmlFor="gt-limit" label="Time limit" hint="A test stops after this long.">
              <Num id="gt-limit" min={1} max={600} required value={f.limitMin} onChange={(e) => edit({ limitMin: numVal(e) })} unit="min" />
            </SettingRow>
            <SettingRow htmlFor="gt-games" label="Games" hint="As the workflow reads them. Empty: its default.">
              <Textarea id="gt-games" rows={3} spellCheck={false} className="min-h-16 w-full font-mono text-xs sm:w-72" value={f.games} onChange={(e) => edit({ games: e.target.value })} />
            </SettingRow>
          </SettingList>
          <SaveBar dirty={dirty} onUndo={load} className="mt-3">
            <span className="text-xs text-muted-foreground">Repository variables: the next game test uses them.</span>
          </SaveBar>
        </form>
      ) : null}
    </Section>
  );
}
