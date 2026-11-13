<script>
  // The command palette (Ctrl/⌘ K, or /): jump to any view, card, PR, run, lane, machine or link, or
  // run a control. Type to filter; arrows and Enter to pick; Esc to close.
  import { control } from "../lib/api.svelte.js";
  import { go, setTheme, themeNames, themes } from "../lib/ui.svelte.js";
  import { systems } from "../lib/systems.svelte.js";
  import { gh } from "../lib/format.js";
  let { d, open, confirm } = $props();

  let shown = $state(false);
  let q = $state("");
  let sel = $state(0);
  let input = $state();

  const VIEWS = [["overview", "Overview"], ["board", "Board"], ["ideas", "Ideas"], ["runs", "Runs"], ["activity", "Activity"], ["lanes", "Lanes"], ["systems", "Systems"], ["logs", "Logs"], ["data", "Data"], ["links", "Links"], ["settings", "Settings"]];

  const items = $derived.by(() => {
    if (!d) return [];
    const out = VIEWS.map(([v, label]) => ({ group: "Go to", label, hint: "view", run: () => go(v) }));
    const cols = [["next", "Up next"], ["building", "Building"], ["review", "Review"], ["needsYou", "Needs you"], ["hold", "On hold"], ["ideas", "Idea"]];
    const seen = new Set();
    for (const [col, name] of cols) {
      for (const c of d.board[col] ?? []) {
        if (seen.has(c.number)) continue;
        seen.add(c.number);
        out.push({ group: "Cards and PRs", label: `#${c.number} ${c.title}`, hint: name, run: () => open(c, col) });
      }
    }
    for (const r of d.runs.filter((x) => x.mode === "live").slice(0, 15)) {
      out.push({ group: "Runs", label: `Run ${r.id} · ${r.lane}${r.card ? ` · #${r.card}` : ""}`, hint: r.status, run: () => go("runs", String(r.id)) });
    }
    for (const l of d.lanes) out.push({ group: "Lanes", label: `${l.name} lane${l.repo && l.repo !== d.repo ? ` (${l.repo.split("/").pop()})` : ""}`, hint: l.enabled ? (l.live ? "live" : "dry") : "off", run: () => go("lanes") });
    for (const m of systems.data?.devices ?? []) out.push({ group: "Machines", label: m.name, hint: m.online ? "online" : "offline", run: () => go("systems") });
    for (const l of d.links) out.push({ group: "Links", label: l.title, hint: l.grp, run: () => window.open(l.url, "_blank", "noopener") });
    out.push(
      { group: "Actions", label: d.pause ? "Resume the factory" : "Pause the factory for 24 hours", hint: "control", run: () => (d.pause ? control("unpause", {}, "Resumed") : confirm({ title: "Pause the factory for 24 hours?", body: "No scheduled run, resume or Build now starts until you resume.", yes: "Pause 24 h", action: () => control("pause", { hours: 24 }, "Paused for 24 hours") })) },
      { group: "Actions", label: d.stop ? "Start the factory" : "Stop every agent", hint: "control", run: () => (d.stop ? control("start", {}, "Started") : confirm({ title: "Stop every agent?", body: "Adds the factory-stop label. No run starts, and a run that's going stops at its next checkpoint.", yes: "Stop the factory", action: () => control("stop") })) },
      { group: "Actions", label: "Open the repo on GitHub", hint: d.repo, run: () => window.open(`https://github.com/${d.repo}`, "_blank", "noopener") },
      { group: "Actions", label: "Open pull requests on GitHub", hint: d.repo, run: () => window.open(gh(d.repo, "pulls", "").replace(/\/$/, ""), "_blank", "noopener") },
      ...themes.map((t) => ({ group: "Theme", label: `Theme: ${themeNames[t]}`, hint: "look", run: () => setTheme(t) })),
    );
    return out;
  });

  const results = $derived.by(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const hits = words.length ? items.filter((it) => words.every((w) => `${it.label} ${it.hint} ${it.group}`.toLowerCase().includes(w))) : items.filter((it) => it.group === "Go to" || it.group === "Actions");
    return hits.slice(0, 40);
  });

  $effect(() => {
    q;
    sel = 0;
  });

  function show() {
    shown = true;
    q = "";
    queueMicrotask(() => input?.focus());
  }

  function pick(it) {
    shown = false;
    it?.run();
  }

  function onkey(e) {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? "") || document.activeElement?.isContentEditable;
    if ((e.key === "k" && (e.ctrlKey || e.metaKey)) || (e.key === "/" && !typing && !shown)) {
      e.preventDefault();
      shown ? (shown = false) : show();
    }
  }

  function nav(e) {
    if (e.key === "Escape") shown = false;
    else if (e.key === "ArrowDown") (e.preventDefault(), (sel = Math.min(results.length - 1, sel + 1)));
    else if (e.key === "ArrowUp") (e.preventDefault(), (sel = Math.max(0, sel - 1)));
    else if (e.key === "Enter") (e.preventDefault(), pick(results[sel]));
  }

  export function toggle() {
    shown ? (shown = false) : show();
  }
</script>

<svelte:window onkeydown={onkey} />

{#if shown}
  <div class="scrim" role="presentation" onclick={() => (shown = false)}></div>
  <div class="pal" role="dialog" aria-modal="true" aria-label="Command palette">
    <div class="search">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      <input bind:this={input} bind:value={q} onkeydown={nav} placeholder="Jump to a card, PR, run, machine, or type a command…" aria-label="Search" role="combobox" aria-expanded="true" aria-controls="pal-list" />
      <kbd>Esc</kbd>
    </div>
    <ul id="pal-list" role="listbox">
      {#each results as it, i}
        {#if i === 0 || results[i - 1].group !== it.group}<li class="grp" role="presentation">{it.group}</li>{/if}
        <li role="option" aria-selected={i === sel} class:sel={i === sel} onmouseenter={() => (sel = i)} onclick={() => pick(it)} onkeydown={() => {}}>
          <span class="lbl">{it.label}</span><span class="hint">{it.hint}</span>
        </li>
      {:else}
        <li class="none">Nothing matches "{q}".</li>
      {/each}
    </ul>
    <div class="foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Ctrl</kbd><kbd>K</kbd> or <kbd>/</kbd> anywhere</span></div>
  </div>
{/if}

<style>
  .scrim { position: fixed; inset: 0; z-index: 60; background: rgb(0 0 0 / .45); backdrop-filter: blur(3px); animation: fade .15s; }
  .pal {
    position: fixed; z-index: 61; left: 50%; top: 12vh; transform: translateX(-50%); width: min(640px, calc(100vw - 32px));
    background: var(--panel); border: 1px solid var(--line-2); border-radius: 16px; box-shadow: 0 30px 80px rgb(0 0 0 / .45), 0 0 0 1px color-mix(in srgb, var(--accent) 18%, transparent);
    overflow: hidden; animation: pop .16s cubic-bezier(.2, .8, .2, 1);
  }
  @keyframes fade { from { opacity: 0; } }
  @keyframes pop { from { opacity: 0; transform: translate(-50%, -6px) scale(.98); } }
  .search { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-bottom: 1px solid var(--line); }
  .search svg { width: 18px; height: 18px; fill: none; stroke: var(--muted); stroke-width: 2; stroke-linecap: round; flex: none; }
  input { flex: 1; border: 0; background: none; outline: none; font-size: 15px; color: var(--ink); min-width: 0; }
  ul { list-style: none; margin: 0; padding: 6px; max-height: 52vh; overflow: auto; }
  .grp { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); font-weight: 650; padding: 10px 10px 4px; }
  li[role="option"] { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 9px; cursor: pointer; font-size: 13.5px; }
  li.sel { background: color-mix(in srgb, var(--accent) 16%, transparent); }
  .lbl { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .hint { font-size: 12px; color: var(--muted); white-space: nowrap; }
  .none { padding: 18px 10px; color: var(--muted); font-size: 13px; }
  .foot { display: flex; gap: 16px; padding: 8px 14px; border-top: 1px solid var(--line); font-size: 11.5px; color: var(--muted); }
  kbd { font: 600 10.5px var(--mono); padding: 1px 5px; border-radius: 5px; border: 1px solid var(--line-2); background: var(--bg-2); color: var(--ink-2); margin-right: 2px; }
  @media (max-width: 600px) { .foot { display: none; } .pal { top: 8vh; } }
</style>
