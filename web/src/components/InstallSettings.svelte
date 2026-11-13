<script>
  // Settings › Install (src/install.ts): the repos this factory serves, its machines, its addresses, the
  // checks it treats as device tests, the paths auto-merge leaves to the owner and the reviewer's CI note. Saved in the factory's database; the env only gives the first values.
  import { control } from "../lib/api.svelte.js";
  let { d } = $props();

  const saved = $derived(d.settings?.install ?? null);
  let f = $state(null);
  let dirty = $state(false);
  let json = $state("");
  let jsonOpen = $state(false);
  let jsonMsg = $state("");

  // A form copy of the saved settings, refreshed from the server until it's changed here.
  $effect(() => {
    if (!saved || dirty) return;
    f = {
      projects: saved.projects.join("\n"),
      dashboardUrl: saved.dashboardUrl,
      host: saved.host,
      machines: saved.machines.map((m) => ({ ...m, labels: m.labels.join(", ") })),
      uptime: saved.uptime.map((c) => `${c.label} ${c.url}`).join("\n"),
      deviceChecks: saved.deviceChecks,
      riskyPaths: (saved.riskyPaths ?? []).join("\n"),
      reviewerCi: saved.reviewerCi ?? "",
      previewHost: saved.previewHost,
      factoryRepo: saved.factoryRepo,
      apps: saved.apps.join(", "),
      stopIssue: saved.stopIssue,
      reportsUrl: saved.reports.url,
      reportsOrg: saved.reports.org,
      legacyMarkers: (saved.legacyMarkers ?? []).join(", "),
      perfUi: saved.perfApp?.ui ?? "",
      perfProcesses: (saved.perfApp?.processes ?? []).join(", "),
    };
    json = JSON.stringify(saved, null, 2);
  });
  const touch = () => (dirty = true);

  // "Label https://..." per line; a line with only an address uses its host as the label.
  function uptime(text) {
    return text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
      const at = l.search(/https?:\/\//);
      return at > 0 ? { label: l.slice(0, at).trim(), url: l.slice(at).trim() } : { label: "", url: l };
    });
  }

  async function send(body) {
    if (await control("settings/install", body)) dirty = false;
  }

  function save(e) {
    e.preventDefault();
    send({
      projects: f.projects,
      dashboardUrl: f.dashboardUrl,
      host: f.host,
      machines: f.machines.filter((m) => m.name.trim()).map((m) => ({ ...m, name: m.name.trim() })),
      uptime: uptime(f.uptime),
      deviceChecks: f.deviceChecks,
      riskyPaths: f.riskyPaths,
      reviewerCi: f.reviewerCi,
      previewHost: f.previewHost,
      factoryRepo: f.factoryRepo,
      apps: f.apps,
      stopIssue: Number(f.stopIssue) || 0,
      reports: { url: f.reportsUrl, org: f.reportsOrg },
      legacyMarkers: f.legacyMarkers,
      perfApp: { ui: f.perfUi, processes: f.perfProcesses },
    });
  }

  function saveJson(e) {
    e.preventDefault();
    let body;
    try {
      body = JSON.parse(json);
    } catch {
      jsonMsg = "That isn't valid JSON";
      return;
    }
    jsonMsg = "";
    send(body);
  }

  const addMachine = () => (f.machines.push({ name: "", role: "", always: false, runner: "", labels: "" }), touch());
  const removeMachine = (i) => (f.machines.splice(i, 1), touch());
</script>

<section class="panel">
  <div class="panel-head"><h2>Install</h2><span class="spacer"></span><span class="muted small">Projects, machines and addresses</span></div>
  <div class="panel-body">
    {#if d.settings?.installNeedsSetup}
      <div class="note">This factory's database is older than these settings, so the dashboard address, machines, uptime checks, device checks, risky paths, the reviewer's CI note, previews, app name and stop issue are off until you save them here. Paste them below with <b>Edit as JSON</b>, or fill in the form.</div>
    {/if}
    {#if f}
      <form class="grid" onsubmit={save} oninput={touch} onchange={touch}>
        <label for="in-projects"><b>Projects</b><span class="muted small">One owner/name per line. The first is the primary, and it can't change here. Each repo runs the lanes in its own <code>.factory.yml</code>. Each must be in the GitHub App's installation.</span></label>
        <textarea id="in-projects" class="field" rows="3" spellcheck="false" bind:value={f.projects}></textarea>

        <label for="in-url"><b>Dashboard address</b><span class="muted small">Where you open this page (behind Cloudflare Access). Used for webhooks and in agents' notes. Empty: none.</span></label>
        <input id="in-url" class="field" type="url" placeholder="https://factory.example.com" bind:value={f.dashboardUrl} />

        <label for="in-stop"><b>Stop switch issue</b><span class="muted small">The primary repo's issue that <b>Stop</b> labels <code>factory-stop</code>. 0: Stop is off.</span></label>
        <input id="in-stop" class="field num" type="number" min="0" bind:value={f.stopIssue} />

        <label for="in-apps"><b>GitHub App</b><span class="muted small">The app's slug comes from GitHub and leads the list; add any former ones here (comma-separated). Their comments count as the agents' in Activity, and agents are told they're signed in as the first.</span></label>
        <input id="in-apps" class="field" spellcheck="false" placeholder="my-factory" bind:value={f.apps} />

        <label for="in-checks"><b>Device checks</b><span class="muted small">CI check names that ran on a test machine (a pattern, case-insensitive, like <code>test box|device</code>). The Done line names them; empty: no device tests.</span></label>
        <input id="in-checks" class="field" spellcheck="false" bind:value={f.deviceChecks} />

        <label for="in-risky"><b>Risky paths</b><span class="muted small">Files auto-merge always leaves to you, one glob per line (like <code>updater.*</code>, <code>sign*</code> or <code>deploy/</code>). A name without <code>/</code> matches at any depth; a trailing <code>/</code> means a folder's files. Workflows and secrets are always yours too, built in.</span></label>
        <textarea id="in-risky" class="field" rows="3" spellcheck="false" bind:value={f.riskyPaths}></textarea>

        <label for="in-revci"><b>Reviewer CI note</b><span class="muted small">A line the reviewer reads about the project's CI, e.g. checks that only run once it passes a PR. Empty: none.</span></label>
        <input id="in-revci" class="field" bind:value={f.reviewerCi} />

        <label for="in-preview"><b>Preview host</b><span class="muted small">Host of the project's PR previews behind Cloudflare Access (e.g. <code>myproject.pages.dev</code>). The reviewer opens them. Empty: no previews.</span></label>
        <input id="in-preview" class="field" spellcheck="false" bind:value={f.previewHost} />

        <label for="in-factory"><b>Factory repo</b><span class="muted small">This dispatcher's own repo, named in agents' notes. Empty: left out.</span></label>
        <input id="in-factory" class="field" spellcheck="false" placeholder="owner/factory" bind:value={f.factoryRepo} />

        <label for="in-uptime"><b>Uptime checks</b><span class="muted small">"Label https://..." per line, checked every 5 minutes. The first shows as the site on the overview; a <code>latest.json</code> also shows its version.</span></label>
        <textarea id="in-uptime" class="field" rows="3" spellcheck="false" bind:value={f.uptime}></textarea>

        <label for="in-gt"><b>Reports (GlitchTip)</b><span class="muted small">Its address in your browser and its organization. Needs <code>GLITCHTIP_TOKEN</code> in the env too. Empty: off.</span></label>
        <span class="pair"><input id="in-gt" class="field" type="url" placeholder="https://crash.example.com" bind:value={f.reportsUrl} /><input class="field" placeholder="org" aria-label="GlitchTip organization" bind:value={f.reportsOrg} /></span>

        <label for="in-markers"><b>Older comment markers</b><span class="muted small">Names the agents' comment marker had before (<code>&lt;!-- name --&gt;</code>, comma-separated), so comments already on GitHub still count as the agents'. <code>factory</code> always counts. Empty: none.</span></label>
        <input id="in-markers" class="field" spellcheck="false" placeholder="old-factory" bind:value={f.legacyMarkers} />

        <label for="in-perf-ui"><b>Performance: the app</b><span class="muted small">The fps line of the app's own window, left out of a run's main frame rate, and the process lines (comma-separated) whose memory adds up to the app's RAM. Empty: none.</span></label>
        <span class="pair"><input id="in-perf-ui" class="field" spellcheck="false" placeholder="App UI" bind:value={f.perfUi} /><input class="field" spellcheck="false" placeholder="App, WebView2" aria-label="The app's processes" bind:value={f.perfProcesses} /></span>

        <label for="in-host"><b>Factory host</b><span class="muted small">The Systems name of the machine the dispatcher runs on (its Docker and Proxmox stats).</span></label>
        <input id="in-host" class="field" spellcheck="false" bind:value={f.host} />

        <div class="machines">
          <b>Machines</b>
          <span class="muted small">Shown first in Systems, in this order. <i>Always on</i> alerts when it stops reporting. A runner name or labels make it a CI machine in Devices.</span>
          {#each f.machines as m, i}
            <div class="mrow">
              <input class="field" aria-label="Name" placeholder="name" spellcheck="false" bind:value={m.name} />
              <input class="field" aria-label="Role" placeholder="role" bind:value={m.role} />
              <input class="field" aria-label="Runner name" placeholder="runner name" spellcheck="false" bind:value={m.runner} />
              <input class="field" aria-label="Runner labels" placeholder="labels" spellcheck="false" bind:value={m.labels} />
              <label class="small"><input type="checkbox" bind:checked={m.always} /> Always on</label>
              <button type="button" class="btn ghost sm" onclick={() => removeMachine(i)}>Remove</button>
            </div>
          {/each}
          <button type="button" class="btn sm" onclick={addMachine}>Add a machine</button>
        </div>

        <div class="row"><button class="btn primary" disabled={!dirty}>Save</button>{#if dirty}<button type="button" class="btn ghost" onclick={() => (dirty = false)}>Undo changes</button>{/if}</div>
      </form>

      <details class="json" bind:open={jsonOpen}>
        <summary class="small">Edit as JSON</summary>
        <form onsubmit={saveJson}>
          <textarea class="field" rows="14" spellcheck="false" bind:value={json}></textarea>
          <div class="row"><button class="btn primary">Save JSON</button><span class="muted small">{jsonMsg || "Only the keys you include change."}</span></div>
        </form>
      </details>
    {:else}
      <p class="muted small">Loading…</p>
    {/if}
  </div>
</section>

<style>
  .grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr); gap: 12px 16px; align-items: start; font-size: 13px; }
  .grid label { display: grid; gap: 2px; }
  .grid textarea, .json textarea { width: 100%; font-family: var(--mono, monospace); font-size: 12px; resize: vertical; box-sizing: border-box; }
  .grid input.field:not(.num) { width: 100%; box-sizing: border-box; }
  .grid input.num { width: 90px; }
  .pair { display: grid; grid-template-columns: 2fr 1fr; gap: 6px; }
  .machines { grid-column: 1 / -1; display: grid; gap: 6px; justify-items: start; }
  .mrow { display: grid; grid-template-columns: 1fr 2fr 1.2fr 1.5fr auto auto; gap: 6px; align-items: center; width: 100%; }
  .mrow input.field { width: 100%; box-sizing: border-box; min-width: 0; }
  .mrow label { display: flex; gap: 4px; align-items: center; white-space: nowrap; }
  .row { grid-column: 1 / -1; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .note { margin-bottom: 12px; padding: 8px 10px; border-radius: 9px; background: color-mix(in srgb, var(--amber, var(--accent)) 16%, transparent); font-size: 13px; }
  .json { margin-top: 14px; padding-top: 10px; border-top: 1px solid var(--line); }
  .json form { display: grid; gap: 8px; margin-top: 8px; }
  .spacer { flex: 1; }
  @media (max-width: 700px) {
    .grid { grid-template-columns: 1fr; }
    .mrow { grid-template-columns: 1fr 1fr; padding-bottom: 8px; border-bottom: 1px solid var(--line); }
  }
</style>
