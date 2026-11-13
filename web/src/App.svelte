<script>
  import { load, store, toast } from "./lib/api.svelte.js";
  import { ui } from "./lib/ui.svelte.js";
  import Sidebar from "./components/Sidebar.svelte";
  import Topbar from "./components/Topbar.svelte";
  import Overview from "./views/Overview.svelte";
  import BoardView from "./views/BoardView.svelte";
  import IdeasView from "./views/IdeasView.svelte";
  import RunsView from "./views/RunsView.svelte";
  import LanesView from "./views/LanesView.svelte";
  import ActivityView from "./views/ActivityView.svelte";
  import LinksView from "./views/LinksView.svelte";
  import DataView from "./views/DataView.svelte";
  import SettingsView from "./views/SettingsView.svelte";
  import SystemsView from "./views/SystemsView.svelte";
  import DevicesView from "./views/DevicesView.svelte";
  import LogsView from "./views/LogsView.svelte";
  import ReportsView from "./views/ReportsView.svelte";
  import PerfView from "./views/PerfView.svelte";
  import Palette from "./components/Palette.svelte";
  import Drawer from "./components/Drawer.svelte";
  import Confirm from "./components/Confirm.svelte";

  // The side drawer: a card ({ type: "card", card, column }) or a trial report ({ type: "trial", trial }).
  let drawer = $state(null);
  // A pending confirmation: { title, body, yes, action }.
  let ask = $state(null);
  const openCard = (card, column) => (drawer = { type: "card", card, column });
  const confirm = (a) => (ask = a);
  const openPrompt = (path, repo) => (drawer = { type: "prompt", path, repo });

  load();
</script>

<div class="shell">
  <Sidebar d={store.data} />
  <div class="main">
    {#if store.data}
      {@const d = store.data}
      <Topbar {d} {confirm} />
      <main>
        {#if ui.view === "board"}<BoardView {d} open={openCard} {confirm} />
        {:else if ui.view === "ideas"}<IdeasView {d} open={openCard} {confirm} />
        {:else if ui.view === "runs"}<RunsView {d} {openPrompt} openTrial={(trial) => (drawer = { type: "trial", trial })} />
        {:else if ui.view === "activity"}<ActivityView {d} {confirm} />
        {:else if ui.view === "lanes"}<LanesView {d} {confirm} {openPrompt} />
        {:else if ui.view === "links"}<LinksView {d} />
        {:else if ui.view === "data"}<DataView {d} />
        {:else if ui.view === "settings"}<SettingsView {d} />
        {:else if ui.view === "systems"}<SystemsView {d} {confirm} />
        {:else if ui.view === "devices"}<DevicesView />
        {:else if ui.view === "logs"}<LogsView />
        {:else if ui.view === "reports"}<ReportsView {d} />
        {:else if ui.view === "perf"}<PerfView {d} />
        {:else}<Overview {d} open={openCard} {confirm} />{/if}
      </main>
      <Drawer {d} bind:view={drawer} {confirm} />
    {:else}
      <div class="loading">
        {#if store.error}<p class="err">Can't reach the dispatcher: {store.error}</p>{:else}<div class="spinner" aria-label="Loading"></div>{/if}
      </div>
    {/if}
  </div>
</div>

<Confirm bind:ask />
<Palette d={store.data} open={openCard} {confirm} />

{#key toast.key}
  {#if toast.text}<div class="toast" class:bad={toast.bad} role="status">{toast.text}</div>{/if}
{/key}

<style>
  /* The inset shell: the rail on the page background, the work area one raised panel beside it. */
  .shell { display: grid; grid-template-columns: var(--side) 1fr; min-height: 100vh; }
  .main { min-width: 0; display: flex; flex-direction: column; margin: 8px 8px 8px 0; background: var(--bg-2); border: 1px solid var(--line); border-radius: 12px; min-height: calc(100vh - 16px); }
  main { padding: 18px 20px 40px; max-width: 1480px; width: 100%; }
  @media (max-width: 860px) { .shell { grid-template-columns: 1fr; } .main { margin: 0; border: 0; border-radius: 0; } main { padding: 12px 12px 90px; } }
  .loading { min-height: 80vh; display: grid; place-items: center; }
  .err { color: var(--red); }
  .spinner { width: 28px; height: 28px; border-radius: 50%; border: 3px solid var(--line-2); border-top-color: var(--accent); animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(1turn); } }
  .toast {
    position: fixed; left: 50%; bottom: 22px; transform: translateX(-50%); z-index: 50;
    background: var(--ink); color: var(--bg); padding: 10px 16px; border-radius: 12px; font-weight: 600; font-size: 13px;
    box-shadow: 0 10px 30px rgb(0 0 0 / .3); animation: toast 3s ease forwards;
  }
  .toast.bad { background: var(--red); color: #fff; }
  @keyframes toast { 0% { opacity: 0; transform: translate(-50%, 8px); } 8%, 85% { opacity: 1; transform: translate(-50%, 0); } 100% { opacity: 0; } }
</style>
