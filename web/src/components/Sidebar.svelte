<script>
  // The left rail: the views in three groups, with counts, and the theme at the bottom. It sits on the page
  // background; the work area is the inset panel beside it. On narrow screens it becomes a bottom tab bar.
  import { go, setTheme, themeNames, themes, ui } from "../lib/ui.svelte.js";
  import { systems } from "../lib/systems.svelte.js";
  let { d } = $props();

  const groups = $derived([
    {
      name: "Work",
      items: [
        { view: "overview", label: "Mission control", short: "Home", icon: "M4 5h16v14H4zM4 10h16M10 10v9" },
        { view: "board", label: "Board", icon: "M4 5h4v14H4zM10 5h4v9h-4zM16 5h4v6h-4z", count: d ? d.board.next.length + d.board.building.length : null },
        { view: "ideas", label: "Ideas", icon: "M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.6.6 1 1.4 1 2.5h6c0-1.1.4-1.9 1-2.5A6 6 0 0 0 12 3z", count: d?.board.ideas.length },
        { view: "runs", label: "Runs", icon: "M5 6h14M5 12h14M5 18h9", live: (d?.runningAll?.length ?? 0) > 0 },
      ],
    },
    {
      name: "Factory",
      items: [
        { view: "lanes", label: "Lanes", icon: "M4 7h10M4 12h16M4 17h7" },
        { view: "activity", label: "Activity", icon: "M3 12h4l3-8 4 16 3-8h4" },
        { view: "data", label: "Data", icon: "M5 20V11M11 20V5M17 20v-6M3 20h18" },
      ],
    },
    {
      name: "Homelab",
      items: [
        { view: "devices", label: "Devices", icon: "M3 6h18v10H3zM8 20h8M7 10h3M14 10h3" },
        { view: "perf", label: "Performance", icon: "M4 19h16M6 16l4-5 3 3 5-7" },
        { view: "systems", label: "Systems", icon: "M4 5h16v10H4zM9 19h6M12 15v4", alert: (systems.data?.alerts?.open.length ?? 0) > 0 },
        { view: "reports", label: "Crash reports", icon: "M12 4 3 20h18L12 4zM12 10v4M12 17v.5" },
        { view: "logs", label: "Logs", icon: "M6 4h12v16H6zM9 8h6M9 12h6M9 16h4" },
        { view: "links", label: "Links", icon: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" },
        { view: "settings", label: "Settings", icon: "M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4", alert: Boolean(d?.testBuildCleanup?.problem) },
      ],
    },
  ]);
  // On a phone the bottom bar has these four and More; the rest open from More's sheet.
  const MAIN = ["overview", "board", "runs", "systems"];
  const extras = $derived(groups.flatMap((g) => g.items).filter((x) => !MAIN.includes(x.view)));
  let more = $state(false);
</script>

<aside class="side">
  <a class="brand" href="#/overview" aria-label="Factory: mission control">
    <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="1" y="1" width="8" height="8" rx="2" /><rect x="11" y="1" width="8" height="8" rx="2" opacity=".55" /><rect x="1" y="11" width="8" height="8" rx="2" opacity=".55" /><rect x="11" y="11" width="8" height="8" rx="2" opacity=".3" /></svg>
    <span>Factory</span>
  </a>
  <button class="find" onclick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }))}>
    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4-4" /></svg>
    <span>Search or run…</span><kbd>Ctrl K</kbd>
  </button>
  <nav aria-label="Views">
    {#each groups as g (g.name)}
      <div class="group">
        <span class="g-name">{g.name}</span>
        {#each g.items as it (it.view)}
          <button class:on={ui.view === it.view} class:extra={!MAIN.includes(it.view)} aria-current={ui.view === it.view ? "page" : undefined} onclick={() => go(it.view)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d={it.icon} /></svg>
            <span class="label">{it.label}</span>{#if it.short}<span class="label short">{it.short}</span>{/if}
            {#if it.live}<i class="sdot run live" title="A run is going"></i>{/if}
            {#if it.alert}<i class="sdot fail" title="Needs a look"></i>{/if}
            {#if it.count}<em class="num">{it.count}</em>{/if}
          </button>
        {/each}
      </div>
    {/each}
    <button class="more-btn" class:on={more || !MAIN.includes(ui.view)} aria-expanded={more} onclick={() => (more = !more)}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h.01M12 12h.01M19 12h.01" /></svg>
      <span class="label">{MAIN.includes(ui.view) ? "More" : (extras.find((x) => x.view === ui.view)?.label ?? "More")}</span>
    </button>
  </nav>
  {#if more}
    <button class="scrim" aria-label="Close" onclick={() => (more = false)}></button>
    <div class="sheet" role="dialog" aria-label="More views">
      {#each extras as it (it.view)}
        <button class:on={ui.view === it.view} onclick={() => { more = false; go(it.view); }}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d={it.icon} /></svg>
          <span>{it.label}</span>
          {#if it.alert}<i class="sdot fail"></i>{/if}
        </button>
      {/each}
      <div class="sheet-themes">
        {#each themes as t}
          <button class:on={ui.theme === t} onclick={() => setTheme(t)}>{themeNames[t]}</button>
        {/each}
      </div>
    </div>
  {/if}
  <div class="foot">
    {#if d}<a class="repo mono" href={`https://github.com/${d.repo}`} target="_blank" rel="noopener">{d.repo}</a>{/if}
    <div class="themes" role="radiogroup" aria-label="Theme">
      {#each themes as t}
        <button role="radio" aria-checked={ui.theme === t} class:on={ui.theme === t} onclick={() => setTheme(t)}>{themeNames[t]}</button>
      {/each}
    </div>
  </div>
</aside>

<style>
  .side { position: sticky; top: 0; height: 100vh; display: flex; flex-direction: column; gap: 14px; padding: 14px 10px 12px 12px; }
  .brand { display: flex; align-items: center; gap: 9px; font-weight: 600; font-size: 14.5px; padding: 4px 8px; }
  .brand svg { width: 18px; height: 18px; fill: var(--ink); }
  .find { display: flex; align-items: center; gap: 8px; padding: 6px 9px; border-radius: 7px; border: 1px solid var(--line); background: var(--bg-2); color: var(--muted); cursor: pointer; font-size: 12.5px; }
  .find:hover { color: var(--ink); border-color: var(--line-2); }
  .find svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
  .find span { flex: 1; text-align: left; }
  .find kbd { font: 500 10px var(--mono); padding: 0 4px; border-radius: 4px; border: 1px solid var(--line-2); color: var(--muted); }
  nav { display: grid; gap: 14px; overflow-y: auto; }
  .group { display: grid; gap: 1px; }
  .g-name { font-size: 11.5px; color: var(--muted); padding: 0 9px 4px; }
  nav button { display: flex; align-items: center; gap: 9px; padding: 5px 9px; border-radius: 7px; border: 0; background: none; color: var(--ink-2); cursor: pointer; font-size: 13.5px; text-align: left; }
  nav button:hover { color: var(--ink); background: color-mix(in srgb, var(--panel-2) 70%, transparent); }
  nav button.on { background: var(--panel-2); color: var(--ink); }
  nav svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; flex: none; opacity: .8; }
  .label { flex: 1; }
  nav em { font-style: normal; font-size: 11.5px; color: var(--muted); }
  .foot { margin-top: auto; display: grid; gap: 10px; padding: 0 4px; }
  .repo { font-size: 11.5px; color: var(--muted); padding: 0 5px; }
  .themes { display: grid; grid-template-columns: repeat(3, 1fr); padding: 2px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg-2); }
  .themes button { border: 0; background: none; color: var(--muted); font-size: 12px; padding: 3px 0; border-radius: 6px; cursor: pointer; }
  .themes button.on { background: var(--panel-2); color: var(--ink); }
  .more-btn, .scrim, .sheet, .label.short { display: none; }
  @media (max-width: 860px) {
    .side { position: fixed; z-index: 25; inset: auto 0 0 0; height: auto; flex-direction: row; padding: 4px 4px calc(4px + env(safe-area-inset-bottom)); border-top: 1px solid var(--line); background: var(--bg); }
    .brand, .foot, .find, .g-name, nav button.extra { display: none; }
    nav { display: grid; grid-template-columns: repeat(5, 1fr); width: 100%; gap: 0; overflow: visible; }
    .group { display: contents; }
    nav button, .more-btn { display: flex; flex-direction: column; align-items: center; gap: 2px; font-size: 10.5px; padding: 6px 2px; min-width: 0; justify-content: center; }
    nav button .label { flex: none; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    nav em, nav .sdot { display: none; }
    nav button .label.short { display: block; } nav button .label:has(+ .short) { display: none; }
    .scrim { display: block; position: fixed; inset: 0; z-index: 24; background: rgb(0 0 0 / .45); border: 0; }
    .sheet { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; position: fixed; z-index: 26; left: 8px; right: 8px; bottom: calc(62px + env(safe-area-inset-bottom)); padding: 8px; background: var(--panel); border: 1px solid var(--line-2); border-radius: 12px; box-shadow: 0 12px 32px rgb(0 0 0 / .4); }
    .sheet > button { display: flex; align-items: center; gap: 9px; padding: 10px; border: 0; border-radius: 8px; background: none; color: var(--ink-2); font-size: 13.5px; text-align: left; cursor: pointer; }
    .sheet > button.on { background: var(--panel-2); color: var(--ink); }
    .sheet svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
    .sheet-themes { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(3, 1fr); margin-top: 4px; padding: 2px; border: 1px solid var(--line); border-radius: 8px; }
    .sheet-themes button { border: 0; background: none; color: var(--muted); font-size: 12px; padding: 5px 0; border-radius: 6px; cursor: pointer; }
    .sheet-themes button.on { background: var(--panel-2); color: var(--ink); }
  }
</style>
