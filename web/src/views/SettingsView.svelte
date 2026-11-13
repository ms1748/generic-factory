<script>
  // Every factory setting the owner can change, in one place. Lane modes stay on the Lanes view.
  import { control } from "../lib/api.svelte.js";
  import { gh, rel, time } from "../lib/format.js";
  import { go } from "../lib/ui.svelte.js";
  import { pull, systems, watchSystems } from "../lib/systems.svelte.js";
  import InstallSettings from "../components/InstallSettings.svelte";
  let { d } = $props();
  $effect(() => watchSystems());

  // Alert limits (alerts.ts): a copy to edit, refreshed from the server until it's changed here.
  const savedAlerts = $derived(systems.data?.alerts?.settings ?? null);
  let al = $state(null);
  let alDirty = $state(false);
  $effect(() => {
    if (savedAlerts && !alDirty) al = structuredClone($state.snapshot(savedAlerts));
  });
  const touch = () => (alDirty = true);
  async function saveAlerts(e) {
    e.preventDefault();
    const res = await fetch("/api/alerts/settings", { method: "POST", headers: { "content-type": "application/json", "x-factory": "1" }, body: JSON.stringify($state.snapshot(al)) });
    alDirty = false;
    await pull();
    alertMsg = res.ok ? "Saved" : "Couldn't save";
  }
  let alertMsg = $state("");
  let hook = $state("");
  let hookMsg = $state("");
  async function sendHook(url) {
    const res = await fetch("/api/alerts/discord", { method: "POST", headers: { "content-type": "application/json", "x-factory": "1" }, body: JSON.stringify({ url }) });
    const j = await res.json().catch(() => ({}));
    hookMsg = j.message ?? j.error ?? res.statusText;
    if (res.ok) hook = "";
    await pull();
  }
  function saveHook(e) {
    e.preventDefault();
    sendHook(hook);
  }
  async function testAlert() {
    const res = await fetch("/api/alerts/test", { method: "POST", headers: { "x-factory": "1" } });
    alertMsg = hookMsg = (await res.json().catch(() => ({}))).message ?? res.statusText;
  }

  const hours = $derived(d.settings?.testBuildDeleteHours ?? 24);
  // The form starts from the saved value, in days when it's a whole number of days.
  let unit = $state("hours");
  let amount = $state(24);
  let synced = $state(-1);
  $effect(() => {
    if (synced === hours) return;
    synced = hours;
    unit = hours % 24 === 0 ? "days" : "hours";
    amount = unit === "days" ? hours / 24 : hours;
  });
  const wanted = $derived(Math.round(Number(amount) * (unit === "days" ? 24 : 1)));
  const words = (h) => (h % 24 === 0 ? `${h / 24} day${h === 24 ? "" : "s"}` : `${h} hour${h === 1 ? "" : "s"}`);
  const c = $derived(d.testBuildCleanup);
  const step = (s) =>
    s.do === "wait" ? `deleted ${time(s.until, d.timezone)} (${rel(s.until)})` : s.do === "pending" ? `cleanup running since ${rel(s.since)}` : s.do === "dispatch" ? "cleanup due" : s.why;

  function save(e) {
    e.preventDefault();
    control("settings/test-builds", { hours: wanted });
  }

  // Limits (src/limits.ts): a copy to edit, the usage stops in percent, refreshed until it's changed here.
  const toForm = (l) => ({ fiveHour: Math.round(l.fiveHour * 100), sevenDay: Math.round(l.sevenDay * 100), runTimeoutMin: l.runTimeoutMin, usageRefreshMin: l.usageRefreshMin, autoQueueEveryH: l.autoQueueEveryH });
  let lim = $state(null);
  let limDirty = $state(false);
  $effect(() => {
    if (d.limits && !limDirty) lim = toForm(d.limits);
  });
  async function saveLimits(e) {
    e.preventDefault();
    const body = { ...$state.snapshot(lim), fiveHour: lim.fiveHour / 100, sevenDay: lim.sevenDay / 100 };
    if (await control("settings/limits", body)) limDirty = false;
  }
</script>

<section class="panel">
  <div class="panel-head"><h2>Test builds</h2></div>
  <div class="panel-body">
    <form class="row" onsubmit={save}>
      <label for="tb-amount"><b>Delete test builds after</b></label>
      <input id="tb-amount" class="field num" type="number" min="1" step="1" bind:value={amount} />
      <select class="field" bind:value={unit} aria-label="Unit">
        <option value="hours">hours</option>
        <option value="days">days</option>
      </select>
      <button class="btn primary" disabled={wanted === hours || !(wanted >= 1)}>Save</button>
    </form>
    <p class="muted small">
      Every version of a PR's test build stays up while the PR is open, so you can compare them. {words(hours)} after it's merged or closed,
      the factory runs the project's <code>{d.settings?.testBuilds?.cleanupWorkflow ?? "test-builds-cleanup.yml"}</code>, which deletes them from where they're hosted and from GitHub and marks the PR's Test builds comment (the one with the <code>{d.settings?.testBuilds?.marker ?? "factory-test-builds"}</code> marker). Checked hourly. Both names come from the project's <code>.factory.yml</code> (<code>test_builds:</code>).
    </p>
    {#if c?.problem}<div class="note bad">Can't clean up: {c.problem}.</div>{/if}
    {#if c}
      {#if c.prs.length}
        <ul class="list">
          {#each c.prs as p (p.pr)}
            <li><a href={gh(d.repo, "pull", p.pr)} target="_blank" rel="noopener">#{p.pr}</a> <span class="title">{p.title}</span> <span class="muted">{p.merged ? "merged" : "closed"} {rel(p.closedAt)} · {step(p.step)}</span></li>
          {/each}
        </ul>
      {:else}
        <p class="muted small">No closed PR has test builds waiting to be deleted (checked {rel(c.checkedAt)}).</p>
      {/if}
    {:else}
      <p class="muted small">The first check runs shortly after the dispatcher starts.</p>
    {/if}
  </div>
</section>

<section class="panel">
  <div class="panel-head"><h2>Alerts</h2><span class="spacer"></span><span class="muted small">{systems.data?.alerts?.discord ? "Discord is set up" : "Discord not set up"}</span></div>
  <div class="panel-body">
    {#if al}
      <form class="alerts" onsubmit={saveAlerts} oninput={touch} onchange={touch}>
        <label class="check"><input type="checkbox" bind:checked={al.enabled} /><span><b>Alerts on</b><span class="muted small">Checked every minute. Each one posts once when it starts and once when it clears.</span></span></label>
        <div class="grid" class:dim={!al.enabled}>
          <span>An always-on machine (Settings › Install › Machines) stops reporting for</span><span><input class="field num" type="number" min="2" max="1440" bind:value={al.offlineMin} /> min</span>
          <span>CPU at or above</span><span><input class="field num" type="number" min="10" max="100" bind:value={al.cpu.pct} /> % for <input class="field num" type="number" min="1" max="240" bind:value={al.cpu.min} /> min</span>
          <span>Memory at or above</span><span><input class="field num" type="number" min="10" max="100" bind:value={al.mem.pct} /> % for <input class="field num" type="number" min="1" max="240" bind:value={al.mem.min} /> min</span>
          <span>A disk at or above</span><span><input class="field num" type="number" min="10" max="100" bind:value={al.disk.pct} /> % full</span>
          <span>Temperature at or above</span><span><input class="field num" type="number" min="40" max="110" bind:value={al.temp.c} /> °C for <input class="field num" type="number" min="1" max="240" bind:value={al.temp.min} /> min</span>
          <span>Free tier (Functions a day, R2 storage, R2 writes a month) at</span><span><input class="field num" type="number" min="10" max="100" bind:value={al.freePct} /> % used</span>
          <span>The site, the updater or the factory tunnel down for two checks (10 min)</span><span><input type="checkbox" bind:checked={al.site} /></span>
          <span>A project has nothing ready to build (with auto-queue on: and auto-queue found nothing to add) for</span><span><input type="checkbox" bind:checked={al.queue.on} aria-label="Nothing ready to build alert" /> <input class="field num" type="number" min="5" max="1440" bind:value={al.queue.min} /> min</span>
        </div>
        <div class="row">
          <button class="btn primary" disabled={!alDirty}>Save</button>
          <button type="button" class="btn" onclick={testAlert}>Send a test to Discord</button>
          {#if alertMsg}<span class="muted small">{alertMsg}</span>{/if}
        </div>
      </form>
      <form class="hook" onsubmit={saveHook}>
        <label for="hook"><b>Discord webhook</b> <span class="muted small">{systems.data?.alerts?.discordFrom === "page" ? "set here" : systems.data?.alerts?.discordFrom === "env" ? "set in the factory's env" : "not set"}</span></label>
        <div class="row">
          <input id="hook" class="field wide" type="password" autocomplete="off" spellcheck="false" bind:value={hook} placeholder={systems.data?.alerts?.discord ? "Paste a new URL to replace it" : "https://discord.com/api/webhooks/..."} />
          <button class="btn primary" disabled={!hook.trim()}>Save</button>
          {#if systems.data?.alerts?.discordFrom === "page"}<button type="button" class="btn ghost" onclick={() => sendHook("")}>Remove</button>{/if}
          {#if systems.data?.alerts?.discord}<button type="button" class="btn" onclick={testAlert}>Send a test</button>{/if}
        </div>
        {#if hookMsg}<span class="small" class:bad={/isn't|doesn't|refused|No /.test(hookMsg)}>{hookMsg}</span>{/if}
        <p class="muted small">In Discord: Server Settings › Integrations › Webhooks › New Webhook, pick the channel, Copy Webhook URL. It's checked with Discord before it's saved, and never shown here again.</p>
      </form>
    {:else}
      <p class="muted small">Loading…</p>
    {/if}
  </div>
</section>

<section class="panel">
  <div class="panel-head"><h2>Budget</h2></div>
  <div class="panel-body">
    <div class="row">
      <label for="parallel-runs"><b>Parallel runs</b></label>
      <select id="parallel-runs" class="field" value={String(d.settings?.parallelRuns ?? 1)} onchange={(e) => control("settings/parallel", { runs: Number(e.currentTarget.value) })}>
        {#each Array.from({ length: d.settings?.maxParallelRuns ?? 3 }, (_, i) => i + 1) as n}
          <option value={String(n)}>{n === 1 ? "1 (one at a time)" : `${n} at once`}</option>
        {/each}
      </select>
    </div>
    <p class="muted small">
      {(d.settings?.parallelRuns ?? 1) === 1
        ? "One run at a time: builds, resumes and reviews wait for each other."
        : `Up to ${d.settings.parallelRuns} runs at once, each in its own container on its own card or PR. They share the plan's usage and split 5 CPUs and 8 GB between them, so each is a little slower.`}
    </p>
    <label class="check">
      <input type="checkbox" checked={d.settings?.autoMerge ?? true} onchange={(e) => control("settings/automerge", { on: e.currentTarget.checked })} />
      <span><b>Auto-merge</b><span class="muted small">{(d.settings?.autoMerge ?? true) ? "Factory PRs merge by themselves once the reviewer passes them and CI and the device tests are green. Workflows, signing, the updater, secrets, the app's permissions, and anything the reviewer flags still wait for you." : "Off: factory PRs wait for you to merge them."}</span></span>
    </label>
    <label class="check">
      <input type="checkbox" checked={d.settings?.autoQueue?.on ?? false} onchange={(e) => control("settings/autoqueue", { on: e.currentTarget.checked })} />
      <span><b>Auto-queue ideas</b><span class="muted small">{d.settings?.autoQueue?.on ? `When fewer than ${d.settings.autoQueue.threshold} cards are ready to build, a short Sonnet run (at most every few hours) queues up to ${d.settings.autoQueue.max} ideas an agent can do alone, with a comment saying why. Hardware checks, releases, billing, hold, needs-owner, p3 and someday ideas stay with you.${(d.settings.autoQueue.last ?? []).map((l) => ` Last (${l.repo.split("/")[1]}): ${rel(l.at)}, ${l.added?.length ? l.added.map((n) => "#" + n).join(" ") : l.note}.`).join("")}` : "Off: ideas wait for you to queue them."}</span>{#if d.settings?.autoQueue?.on}<span class="small">Below <input class="field num" type="number" min="1" max="20" value={d.settings.autoQueue.threshold} onchange={(e) => control("settings/autoqueue", { threshold: Number(e.currentTarget.value) })} /> ready cards, up to <input class="field num" type="number" min="1" max="10" value={d.settings.autoQueue.max} onchange={(e) => control("settings/autoqueue", { max: Number(e.currentTarget.value) })} /> ideas</span>{/if}</span>
    </label>
    <label class="check">
      <input type="checkbox" checked={d.allowCredits} onchange={(e) => control("settings/credits", { on: e.currentTarget.checked })} />
      <span><b>Use paid credits</b><span class="muted small">{d.allowCredits ? "Runs keep going on your extra-usage credits when the plan runs out." : "Off: a run stops the moment the plan runs out, so credits are never spent."}</span></span>
    </label>
  </div>
</section>

<section class="panel">
  <div class="panel-head"><h2>Limits</h2></div>
  <div class="panel-body">
    {#if lim}
      <form class="alerts" onsubmit={saveLimits} oninput={() => (limDirty = true)}>
        <div class="grid">
          <span>No new run once the plan's 5-hour window is at</span><span><input class="field num" type="number" min="10" max="100" required bind:value={lim.fiveHour} aria-label="5-hour stop" /> %</span>
          <span>No new run once the week is at</span><span><input class="field num" type="number" min="10" max="100" required bind:value={lim.sevenDay} aria-label="Weekly stop" /> %</span>
          <span>Stop a run that's still going after</span><span><input class="field num" type="number" min="10" max="600" required bind:value={lim.runTimeoutMin} aria-label="Run time limit" /> min</span>
          <span>While nothing reports usage, refresh the meters with a tiny Haiku call every (0 is off)</span><span><input class="field num" type="number" min="0" max="240" required bind:value={lim.usageRefreshMin} aria-label="Usage refresh" /> min</span>
          <span>Auto-queue tries at most once per project every</span><span><input class="field num" type="number" min="1" max="48" required bind:value={lim.autoQueueEveryH} aria-label="Auto-queue interval" /> h</span>
        </div>
        <div class="row">
          <button class="btn primary" disabled={!limDirty}>Save</button>
          {#if limDirty}<button type="button" class="btn ghost" onclick={() => { limDirty = false; lim = toForm(d.limits); }}>Undo</button>{/if}
        </div>
        <p class="muted small">The usage stops leave room for your own Claude use; the meters on Budget mark them. A run's time limit applies from its next start.</p>
      </form>
    {:else}
      <p class="muted small">Loading…</p>
    {/if}
  </div>
</section>

<InstallSettings {d} />

<section class="panel">
  <div class="panel-head"><h2>Lanes</h2></div>
  <div class="panel-body">
    <p class="muted small">Each lane's off, dry or live switch is on the <button class="linkish" onclick={() => go("lanes")}>Lanes</button> view. Schedules and models come from each repo's own <code>.factory.yml</code>, or the built-in lanes without one.</p>
  </div>
</section>

<style>
  section + section { margin-top: 14px; }
  .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .row input { width: 80px; }
  .note { margin-top: 10px; padding: 8px 10px; border-radius: 9px; background: color-mix(in srgb, var(--red) 14%, transparent); font-size: 13px; }
  .list { list-style: none; padding: 0; margin: 10px 0 0; display: grid; gap: 4px; font-size: 13px; }
  .title { margin: 0 4px; }
  .check { display: flex; gap: 10px; align-items: flex-start; cursor: pointer; }
  .check input { margin-top: 3px; accent-color: var(--accent); }
  .check > span { display: grid; gap: 1px; font-size: 13px; }
  .check input.num { width: 56px; margin: 4px 2px 0; }
  .alerts { display: grid; gap: 12px; }
  .hook { display: grid; gap: 6px; margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--line); }
  .hook p { margin: 0; }
  .hook .bad { color: var(--red); }
  .wide { flex: 1; min-width: 220px; }
  .grid { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px 16px; align-items: center; font-size: 13px; }
  .grid.dim { opacity: .5; }
  .grid input.num { width: 64px; }
  .spacer { flex: 1; }
  @media (max-width: 600px) { .grid { grid-template-columns: 1fr; } }
  .linkish { background: none; border: 0; padding: 0; color: var(--accent); cursor: pointer; font: inherit; }
</style>
