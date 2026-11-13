// Settings › Alerts (src/alerts.ts via /api/alerts/*): alerts on or off and the switches save at once; the
// thresholds are one form with one Save. Then the Discord webhook they post to.
import * as React from "react";
import { BellRingIcon } from "lucide-react";
import { postJson, say } from "@/lib/api";
import { pull, useSystems } from "@/lib/systems";
import { cn } from "@/lib/utils";
import { Section, SettingList, SettingRow } from "@/components/patterns";
import { Badge, Input, Skeleton } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { LiveSwitch, More, Num, SaveBar, numVal, useDraft } from "./bits";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type A = any;

/** The server's defaults (src/alerts.ts DEFAULTS), for any group an older server leaves out. */
const ALERT_DEFAULTS = { enabled: true, offlineMin: 5, cpu: { pct: 90, min: 10 }, mem: { pct: 90, min: 10 }, disk: { pct: 90 }, temp: { c: 85, min: 5 }, site: true, freePct: 80, queue: { on: true, min: 30 } };
const failed = (msg: string) => /isn't|doesn't|refused|No /.test(msg);

async function post(path: string, body?: unknown): Promise<{ ok: boolean; msg: string }> {
  try {
    const { ok, json } = await postJson(path, body);
    const msg: string = json.message ?? json.error ?? (ok ? "Done" : "Couldn't save");
    say(msg, !ok || failed(msg));
    return { ok, msg };
  } catch (e) {
    say((e as Error).message, true);
    return { ok: false, msg: (e as Error).message };
  } finally {
    pull();
  }
}

export function AlertsTab() {
  const sys = useSystems();
  const alerts = sys.data?.alerts;
  // Fill any group an older server leaves out, so a missing one shows its default instead of breaking the page.
  const saved = alerts?.settings ? { ...ALERT_DEFAULTS, ...alerts.settings, cpu: { ...ALERT_DEFAULTS.cpu, ...alerts.settings.cpu }, mem: { ...ALERT_DEFAULTS.mem, ...alerts.settings.mem }, disk: { ...ALERT_DEFAULTS.disk, ...alerts.settings.disk }, temp: { ...ALERT_DEFAULTS.temp, ...alerts.settings.temp }, queue: { ...ALERT_DEFAULTS.queue, ...alerts.settings.queue } } : null;
  const { form: f, dirty, edit, quiet, undo, setDirty } = useDraft<A>(saved, (s) => structuredClone(s));
  const [msg, setMsg] = React.useState("");

  if (!f)
    return (
      <Section title="Alerts">
        {sys.error ? <p className="text-sm text-bad">Can't load the alert settings: {sys.error}</p> : <Skeleton className="h-40" />}
      </Section>
    );

  /** A number in the form, at a dotted path like "cpu.pct". */
  const n = (path: string, min: number, max: number, unit: string, label: string) => {
    const [a, b] = path.split(".");
    const value = b ? f[a][b] : f[a];
    const set = (v: number | "") => edit((x: A) => (b ? { ...x, [a]: { ...x[a], [b]: v } } : { ...x, [a]: v }));
    return <Num aria-label={label} required min={min} max={max} value={value} onChange={(e) => set(numVal(e))} unit={unit} />;
  };
  /** A switch that saves at once (the saved settings with this one change), and keeps the form in step. */
  const toggle = (change: (x: A) => A) => {
    quiet(change);
    return post("/api/alerts/settings", change(structuredClone(saved))).then((r) => r.ok);
  };
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const body = JSON.parse(JSON.stringify(f, (_k, v) => (v === "" ? 0 : v)));
    if ((await post("/api/alerts/settings", body)).ok) setDirty(false);
  }
  async function test() {
    setMsg((await post("/api/alerts/test")).msg);
  }

  const dim = !f.enabled && "opacity-50";
  return (
    <div className="flex flex-col gap-4">
      <Section title="Alerts" actions={<Badge variant={alerts?.discord ? "ok" : "outline"}>{alerts?.discord ? "Discord set up" : "Discord not set up"}</Badge>}>
        <form onSubmit={save}>
          <SettingList>
            <SettingRow htmlFor="al-on" label="Alerts on" hint="Checked every minute. Each posts once when it starts and once when it clears.">
              <LiveSwitch id="al-on" checked={!!f.enabled} onSave={(on) => toggle((x) => ({ ...x, enabled: on }))} />
            </SettingRow>
            <SettingRow className={cn(dim)} label="Machine offline" hint="An always-on machine (Install › Machines) stops reporting for">
              {n("offlineMin", 2, 1440, "min", "Offline minutes")}
            </SettingRow>
            <SettingRow className={cn(dim)} label="CPU" hint="At or above, for">
              {n("cpu.pct", 10, 100, "% for", "CPU percent")}
              {n("cpu.min", 1, 240, "min", "CPU minutes")}
            </SettingRow>
            <SettingRow className={cn(dim)} label="Memory" hint="At or above, for">
              {n("mem.pct", 10, 100, "% for", "Memory percent")}
              {n("mem.min", 1, 240, "min", "Memory minutes")}
            </SettingRow>
            <SettingRow className={cn(dim)} label="Disk" hint="Any disk at or above">
              {n("disk.pct", 10, 100, "% full", "Disk percent")}
            </SettingRow>
            <SettingRow className={cn(dim)} label="Temperature" hint="At or above, for">
              {n("temp.c", 40, 110, "°C for", "Temperature")}
              {n("temp.min", 1, 240, "min", "Temperature minutes")}
            </SettingRow>
            <SettingRow className={cn(dim)} label={<>Free tier<More>Functions a day, R2 storage, and R2 writes a month.</More></>} hint="A free allowance is this used.">
              {n("freePct", 10, 100, "% used", "Free tier percent")}
            </SettingRow>
            <SettingRow className={cn(dim)} htmlFor="al-site" label="Site down" hint="The site, the updater or the factory tunnel fails two checks (10 min).">
              <LiveSwitch id="al-site" checked={!!f.site} onSave={(on) => toggle((x) => ({ ...x, site: on }))} />
            </SettingRow>
            <SettingRow
              className={cn(dim)}
              htmlFor="al-queue"
              label={<>Nothing to build<More>With auto-queue on, only when auto-queue also found nothing to add.</More></>}
              hint="A project has no card ready to build for"
            >
              {n("queue.min", 5, 1440, "min", "Nothing to build minutes")}
              <LiveSwitch id="al-queue" label="Nothing to build alert" checked={!!f.queue?.on} onSave={(on) => toggle((x) => ({ ...x, queue: { ...x.queue, on } }))} />
            </SettingRow>
          </SettingList>
          <SaveBar dirty={dirty} onUndo={undo} className="mt-3">
            <Button type="button" size="sm" variant="outline" onClick={test}>
              <BellRingIcon /> Send a test
            </Button>
            {msg && <span className={cn("text-xs", failed(msg) ? "text-bad" : "text-muted-foreground")}>{msg}</span>}
          </SaveBar>
        </form>
      </Section>
      <Discord alerts={alerts} onTest={test} />
    </div>
  );
}

function Discord({ alerts, onTest }: { alerts: A; onTest: () => void }) {
  const [hook, setHook] = React.useState("");
  const [msg, setMsg] = React.useState("");
  const from = alerts?.discordFrom;
  async function send(url: string) {
    const r = await post("/api/alerts/discord", { url });
    setMsg(r.msg);
    if (r.ok) setHook("");
  }
  return (
    <Section title="Discord">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(hook);
        }}
      >
        <SettingRow
          htmlFor="al-hook"
          label={
            <>
              Webhook
              <More>In Discord: Server Settings › Integrations › Webhooks › New Webhook, pick the channel, Copy Webhook URL. It's checked with Discord before it's saved, and never shown here again.</More>
            </>
          }
          hint={msg ? <span className={failed(msg) ? "text-bad" : ""}>{msg}</span> : from === "page" ? "Set here." : from === "env" ? "Set in the factory's env." : "Not set: alerts go nowhere."}
        >
          <Input
            id="al-hook"
            type="password"
            autoComplete="off"
            spellCheck={false}
            className="h-8 w-full sm:w-64"
            value={hook}
            onChange={(e) => setHook(e.target.value)}
            placeholder={alerts?.discord ? "Paste a new URL to replace it" : "https://discord.com/api/webhooks/…"}
          />
          <Button type="submit" size="sm" variant="brand" disabled={!hook.trim()}>
            Save
          </Button>
          {from === "page" && (
            <Button type="button" size="sm" variant="ghost" onClick={() => send("")}>
              Remove
            </Button>
          )}
          {alerts?.discord && (
            <Button type="button" size="sm" variant="outline" onClick={onTest}>
              Send a test
            </Button>
          )}
        </SettingRow>
      </form>
    </Section>
  );
}
