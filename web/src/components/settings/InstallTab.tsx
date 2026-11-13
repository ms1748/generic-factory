// Settings › Install (src/install.ts): the repos this factory serves, its addresses, review and merge rules,
// performance and game-test names, and its machines. Saved in the factory's database (the env only gives the
// first values). One form, one Save that stays in reach at the bottom; Edit as JSON for pasting a whole setup.
import * as React from "react";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { control, type State } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Section, SettingList, SettingRow } from "@/components/patterns";
import { Input, Switch, Textarea } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { More, Note, SaveBar, useDraft } from "./bits";

type Machine = { name: string; role: string; always: boolean; runner: string; labels: string };

const toForm = (s: State) => ({
  projects: s.projects.join("\n"),
  dashboardUrl: s.dashboardUrl,
  host: s.host,
  machines: s.machines.map((m: State) => ({ ...m, labels: m.labels.join(", ") })) as Machine[],
  uptime: s.uptime.map((c: State) => `${c.label} ${c.url}`).join("\n"),
  deviceChecks: s.deviceChecks,
  riskyPaths: (s.riskyPaths ?? []).join("\n"),
  reviewerCi: s.reviewerCi ?? "",
  previewHost: s.previewHost,
  factoryRepo: s.factoryRepo,
  apps: s.apps.join(", "),
  stopIssue: s.stopIssue,
  reportsUrl: s.reports.url,
  reportsOrg: s.reports.org,
  legacyMarkers: (s.legacyMarkers ?? []).join(", "),
  perfUi: s.perfApp?.ui ?? "",
  perfProcesses: (s.perfApp?.processes ?? []).join(", "),
  game: { workflow: "", askStep: "", start: "", later: "", skip: "", ...s.gamingTest },
});
type F = ReturnType<typeof toForm>;

/** "Label https://..." per line; a line with only an address uses its host as the label. */
const uptime = (text: string) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const at = l.search(/https?:\/\//);
      return at > 0 ? { label: l.slice(0, at).trim(), url: l.slice(at).trim() } : { label: "", url: l };
    });

const mono = "font-mono text-xs";
const wide = "h-8 w-full sm:w-72";
const area = cn(mono, "min-h-20 w-full sm:w-72");

export function InstallTab({ d }: { d: State }) {
  const saved = d.settings?.install ?? null;
  const { form: f, dirty, edit, undo, setDirty } = useDraft<F>(saved, toForm);
  const [json, setJson] = React.useState("");
  const [jsonMsg, setJsonMsg] = React.useState("");
  const savedJson = React.useMemo(() => (saved ? JSON.stringify(saved, null, 2) : ""), [saved]);
  React.useEffect(() => setJson(savedJson), [savedJson]);

  if (!f) return <Section title="Install"><p className="text-sm text-muted-foreground">Loading…</p></Section>;

  const set = (patch: Partial<F>) => edit((x) => ({ ...x, ...patch }));
  /** Props for a text input bound to a top-level field. */
  const bind = (k: keyof F) => ({ id: `in-${k}`, value: f[k] as string, onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set({ [k]: e.target.value } as Partial<F>) });
  const game = (k: keyof F["game"]) => ({ value: f.game[k], spellCheck: false, onChange: (e: React.ChangeEvent<HTMLInputElement>) => set({ game: { ...f.game, [k]: e.target.value } }) });
  const machine = (i: number, patch: Partial<Machine>) => set({ machines: f.machines.map((m, j) => (j === i ? { ...m, ...patch } : m)) });

  async function send(body: unknown) {
    if (await control("settings/install", body as Record<string, unknown>)) setDirty(false);
  }
  function save(e: React.FormEvent) {
    e.preventDefault();
    send({
      projects: f!.projects,
      dashboardUrl: f!.dashboardUrl,
      host: f!.host,
      machines: f!.machines.filter((m) => m.name.trim()).map((m) => ({ ...m, name: m.name.trim() })),
      uptime: uptime(f!.uptime),
      deviceChecks: f!.deviceChecks,
      riskyPaths: f!.riskyPaths,
      reviewerCi: f!.reviewerCi,
      previewHost: f!.previewHost,
      factoryRepo: f!.factoryRepo,
      apps: f!.apps,
      stopIssue: Number(f!.stopIssue) || 0,
      reports: { url: f!.reportsUrl, org: f!.reportsOrg },
      legacyMarkers: f!.legacyMarkers,
      perfApp: { ui: f!.perfUi, processes: f!.perfProcesses },
      gamingTest: f!.game,
    });
  }
  function saveJson(e: React.FormEvent) {
    e.preventDefault();
    let body: unknown;
    try {
      body = JSON.parse(json);
    } catch {
      setJsonMsg("That isn't valid JSON");
      return;
    }
    setJsonMsg("");
    send(body);
  }

  return (
    <div className="flex flex-col gap-4">
      {d.settings?.installNeedsSetup && (
        <Note tone="warn">This factory's database predates these settings, so most of them are off until you save them here (fill in the form or use Edit as JSON).</Note>
      )}
      <form onSubmit={save} className="flex flex-col gap-4">
        <Section title="Projects">
          <SettingList>
            <SettingRow htmlFor="in-projects" label={<>Projects<More>Each repo runs the lanes in its own .factory.yml and must be in the GitHub App's installation.</More></>} hint="One owner/name per line. The first is the primary and can't change.">
              <Textarea {...bind("projects")} rows={3} spellCheck={false} className={area} />
            </SettingRow>
            <SettingRow htmlFor="in-factoryRepo" label="Factory repo" hint="This dispatcher's own repo, named in agents' notes. Empty: left out.">
              <Input {...bind("factoryRepo")} spellCheck={false} placeholder="owner/factory" className={wide} />
            </SettingRow>
            <SettingRow htmlFor="in-apps" label={<>GitHub App<More>The app's slug comes from GitHub and leads the list. Former apps' comments count as the agents' in Activity; agents are told they're signed in as the first.</More></>} hint="Former app slugs, comma-separated.">
              <Input {...bind("apps")} spellCheck={false} placeholder="my-factory" className={wide} />
            </SettingRow>
            <SettingRow htmlFor="in-stopIssue" label="Stop switch issue" hint="The primary repo's issue that Stop labels factory-stop. 0: Stop is off.">
              <Input id="in-stopIssue" type="number" min={0} className="h-8 w-24" value={f.stopIssue} onChange={(e) => set({ stopIssue: e.target.value })} />
            </SettingRow>
            <SettingRow htmlFor="in-legacyMarkers" label={<>Older comment markers<More>Earlier names of the agents' comment marker (&lt;!-- name --&gt;), so comments already on GitHub still count as the agents'. "factory" always counts.</More></>} hint="Comma-separated. Empty: none.">
              <Input {...bind("legacyMarkers")} spellCheck={false} placeholder="old-factory" className={wide} />
            </SettingRow>
          </SettingList>
        </Section>

        <Section title="Addresses">
          <SettingList>
            <SettingRow htmlFor="in-dashboardUrl" label={<>Dashboard address<More>Where you open this page (behind Cloudflare Access). Used for webhooks and in agents' notes.</More></>} hint="Empty: none.">
              <Input {...bind("dashboardUrl")} type="url" placeholder="https://factory.example.com" className={wide} />
            </SettingRow>
            <SettingRow htmlFor="in-previewHost" label={<>Preview host<More>Host of the project's PR previews behind Cloudflare Access, which the reviewer opens.</More></>} hint="Like myproject.pages.dev. Empty: no previews.">
              <Input {...bind("previewHost")} spellCheck={false} className={wide} />
            </SettingRow>
            <SettingRow htmlFor="in-uptime" label={<>Uptime checks<More>Checked every 5 minutes. The first shows as the site on Home; a latest.json also shows its version.</More></>} hint={'"Label https://…" per line.'}>
              <Textarea {...bind("uptime")} rows={3} spellCheck={false} className={area} />
            </SettingRow>
            <SettingRow htmlFor="in-reportsUrl" label={<>Crash reports (GlitchTip)<More>Its address in your browser and its organization. Needs GLITCHTIP_TOKEN in the env too.</More></>} hint="Address and organization. Empty: off.">
              <span className="grid w-full grid-cols-[2fr_1fr] gap-2 sm:w-72">
                <Input {...bind("reportsUrl")} type="url" placeholder="https://crash.example.com" className="h-8" />
                <Input aria-label="GlitchTip organization" placeholder="org" className="h-8" value={f.reportsOrg} onChange={(e) => set({ reportsOrg: e.target.value })} />
              </span>
            </SettingRow>
          </SettingList>
        </Section>

        <Section title="Review and merge">
          <SettingList>
            <SettingRow htmlFor="in-deviceChecks" label={<>Device checks<More>A case-insensitive pattern over CI check names that ran on a test machine, like "test box|device". The Done line names them.</More></>} hint="Pattern for test-machine checks. Empty: no device tests.">
              <Input {...bind("deviceChecks")} spellCheck={false} className={cn(wide, mono)} />
            </SettingRow>
            <SettingRow htmlFor="in-riskyPaths" label={<>Risky paths<More>Like updater.*, sign* or deploy/. A name without / matches at any depth; a trailing / means a folder's files. Workflows and secrets are always yours, built in.</More></>} hint="Files auto-merge leaves to you, one glob per line.">
              <Textarea {...bind("riskyPaths")} rows={3} spellCheck={false} className={area} />
            </SettingRow>
            <SettingRow htmlFor="in-reviewerCi" label="Reviewer CI note" hint="A line the reviewer reads about the project's CI. Empty: none.">
              <Input {...bind("reviewerCi")} className={wide} />
            </SettingRow>
          </SettingList>
        </Section>

        <Section title="Performance and game tests">
          <SettingList>
            <SettingRow htmlFor="in-perfUi" label={<>The app<More>The fps line of the app's own window is left out of a run's main frame rate; the listed processes' memory adds up to the app's RAM.</More></>} hint="Its UI fps line, and its processes (comma-separated). Empty: none.">
              <span className="grid w-full grid-cols-2 gap-2 sm:w-72">
                <Input {...bind("perfUi")} spellCheck={false} placeholder="App UI" className="h-8" />
                <Input aria-label="The app's processes" spellCheck={false} placeholder="App, WebView2" className="h-8" value={f.perfProcesses} onChange={(e) => set({ perfProcesses: e.target.value })} />
              </span>
            </SettingRow>
            <SettingRow htmlFor="in-game" label="Game-test workflow" hint="The primary repo's workflow file and the step that waits for you. Empty: no game tests.">
              <span className="grid w-full grid-cols-2 gap-2 sm:w-72">
                <Input id="in-game" placeholder="game-test.yml" className="h-8" {...game("workflow")} />
                <Input aria-label="The step that waits for you" placeholder="Ask" className="h-8" {...game("askStep")} />
              </span>
            </SettingRow>
            <SettingRow htmlFor="in-game-start" label={<>Game-test answers<More>The commit status each button posts (state success) on the tested PR's head, as the workflow's ask step reads it.</More></>} hint="Statuses for Start, Later, Skip. Empty: no such button.">
              <span className="grid w-full grid-cols-3 gap-2 sm:w-72">
                <Input id="in-game-start" aria-label="Start status" placeholder="Start" className="h-8" {...game("start")} />
                <Input aria-label="Later status" placeholder="Later" className="h-8" {...game("later")} />
                <Input aria-label="Skip status" placeholder="Skip" className="h-8" {...game("skip")} />
              </span>
            </SettingRow>
          </SettingList>
        </Section>

        <Section
          title="Machines"
          description="Shown first in Systems, in this order."
          actions={
            <Button type="button" size="xs" variant="outline" onClick={() => set({ machines: [...f.machines, { name: "", role: "", always: false, runner: "", labels: "" }] })}>
              <PlusIcon /> Add
            </Button>
          }
        >
          <SettingList>
            <SettingRow htmlFor="in-host" label="Factory host" hint="The Systems name of the machine the dispatcher runs on.">
              <Input {...bind("host")} spellCheck={false} className="h-8 w-full sm:w-48" />
            </SettingRow>
            <div className="py-3 last:pb-0">
              <div className="mb-2 text-xs text-muted-foreground">
                Always on: alerts when it stops reporting. A runner name or labels make it a CI machine in Devices.
              </div>
              <div className="flex flex-col gap-2">
                {f.machines.map((m, i) => (
                  <div key={i} className="grid grid-cols-2 items-center gap-2 rounded-lg border p-2 sm:grid-cols-[1fr_1.6fr_1fr_1.2fr_auto_auto] sm:border-0 sm:p-0">
                    <Input aria-label="Name" placeholder="name" spellCheck={false} className="h-8" value={m.name} onChange={(e) => machine(i, { name: e.target.value })} />
                    <Input aria-label="Role" placeholder="role" className="h-8" value={m.role} onChange={(e) => machine(i, { role: e.target.value })} />
                    <Input aria-label="Runner name" placeholder="runner name" spellCheck={false} className="h-8" value={m.runner} onChange={(e) => machine(i, { runner: e.target.value })} />
                    <Input aria-label="Runner labels" placeholder="labels" spellCheck={false} className="h-8" value={m.labels} onChange={(e) => machine(i, { labels: e.target.value })} />
                    <label className="flex items-center gap-2 text-xs whitespace-nowrap">
                      <Switch checked={m.always} onCheckedChange={(always) => machine(i, { always })} aria-label="Always on" /> Always on
                    </label>
                    <Button type="button" size="icon-sm" variant="ghost" className="justify-self-end" aria-label={`Remove ${m.name || "machine"}`} onClick={() => set({ machines: f.machines.filter((_, j) => j !== i) })}>
                      <Trash2Icon />
                    </Button>
                  </div>
                ))}
                {!f.machines.length && <div className="text-sm text-muted-foreground">No machines yet.</div>}
              </div>
            </div>
          </SettingList>
        </Section>

        <div className="sticky bottom-20 z-10 md:bottom-4">
          <SaveBar dirty={dirty} onUndo={undo} className={cn("rounded-xl border bg-card px-4 py-3 shadow-md transition", !dirty && "shadow-none")}>
            <span className="text-xs text-muted-foreground">{dirty ? "Unsaved changes" : "Saved"}</span>
          </SaveBar>
        </div>
      </form>

      <details className="group rounded-xl border bg-card">
        <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium hover:text-brand">Edit as JSON</summary>
        <form onSubmit={saveJson} className="flex flex-col gap-2 border-t p-4">
          <Textarea rows={14} spellCheck={false} className={cn(mono, "min-h-64")} value={json} onChange={(e) => setJson(e.target.value)} />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" variant="brand">
              Save JSON
            </Button>
            <span className={cn("text-xs", jsonMsg ? "text-bad" : "text-muted-foreground")}>{jsonMsg || "Only the keys you include change."}</span>
          </div>
        </form>
      </details>
    </div>
  );
}
