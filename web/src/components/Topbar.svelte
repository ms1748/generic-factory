<script>
  // The top of the work area: the view's name, one quiet status pill ("2 running · 3 need you") that opens
  // what's going and what waits on you, the plan's usage, and Stop / Pause.
  import { control, store } from "../lib/api.svelte.js";
  import { go, ui } from "../lib/ui.svelte.js";
  import { dur, gh, pct, rel, time } from "../lib/format.js";
  let { d, confirm } = $props();

  const titles = { overview: "Mission control", board: "Board", ideas: "Ideas", runs: "Runs", activity: "Activity", lanes: "Lanes", devices: "Devices", systems: "Systems", logs: "Logs", reports: "Crash reports", data: "Data", links: "Links", settings: "Settings" };
  const running = $derived(d.runningAll ?? (d.running ? [d.running] : []));
  const needs = $derived([
    ...d.board.needsYou.map((c) => ({ n: c.number, repo: c.repo, title: c.title, why: "question", kind: "issues" })),
    ...d.board.review.map((c) => ({ n: c.number, repo: c.repo, title: c.title, why: c.verdict === "needs-work" ? "needs work" : "review", kind: "pull" })),
  ]);
  const titleOf = (n) => [...d.board.building, ...d.board.next, ...d.board.review].find((c) => c.number === n || c.issue === n)?.title;
  const meter = (w, limit) => (w ? { value: w.utilization, warn: w.utilization >= limit * 0.8, over: w.utilization >= limit } : null);
  const usage = $derived([
    ["5 h", meter(d.usage?.fiveHour, d.limits.fiveHour)],
    ["week", meter(d.usage?.sevenDay, d.limits.sevenDay)],
  ]);
  const state = $derived(d.stop ? "stopped" : d.pause ? "paused" : running.length ? "running" : "idle");

  let openPill = $state(false);
  let tick = $state(0);
  $effect(() => {
    const t = setInterval(() => tick++, 1000);
    return () => clearInterval(t);
  });
  function away(e) {
    if (openPill && !e.target.closest?.(".pill-wrap")) openPill = false;
  }

  function toggleStop() {
    if (d.stop) return control("start", {}, "Started: runs go ahead again");
    confirm({
      title: "Stop every agent?",
      body: "Adds the factory-stop label (you can also add it from the GitHub app). No build, resume or review starts, and a run that's going stops at its next checkpoint. Start removes the label again.",
      yes: "Stop the factory",
      action: () => control("stop"),
    });
  }
  function togglePause() {
    if (d.pause) return control("unpause", {}, "Resumed");
    confirm({ title: "Pause the factory for 24 hours?", body: "No scheduled run, resume or Build now starts until you resume.", yes: "Pause 24 h", action: () => control("pause", { hours: 24 }, "Paused for 24 hours") });
  }
</script>

<svelte:window onclick={away} onkeydown={(e) => e.key === "Escape" && (openPill = false)} />

<header>
  <h1>{titles[ui.view]}</h1>
  <div class="pill-wrap">
    <button class="pill {state}" aria-expanded={openPill} aria-haspopup="dialog" onclick={() => (openPill = !openPill)}>
      {#if state === "stopped"}<i class="sdot fail"></i>Stopped
      {:else if state === "paused"}<i class="sdot wait"></i>Paused until {time(d.pause.until, d.timezone)}
      {:else}
        <i class="sdot" class:run={running.length} class:live={running.length}></i>
        {running.length ? `${running.length} running` : "Idle"}
      {/if}
      {#if needs.length}<span class="sep">·</span><i class="sdot wait"></i>{needs.length}<span class="wide"> need{needs.length === 1 ? "s" : ""} you</span>{/if}
      <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" /></svg>
    </button>
    {#if openPill}
      <div class="pop" role="dialog" aria-label="What's going and what needs you">
        <div class="pop-h">Running <span class="num muted">{running.length}</span></div>
        {#each running as r (r.id)}
          <button class="row" onclick={() => { openPill = false; go("runs", String(r.id)); }}>
            <i class="sdot run live"></i>
            <span class="what"><b>{r.card ? `#${r.card}` : r.lane}</b> <span class="muted">{r.card ? (titleOf(r.card) ?? r.lane) : r.action ?? ""}</span></span>
            <span class="num muted">{(tick, dur(r.started_at))}</span>
          </button>
        {:else}
          <div class="row muted">Nothing running{d.upcoming?.[0] ? ` · next ${d.upcoming[0].lane} ${rel(d.upcoming[0].at)}` : ""}</div>
        {/each}
        <div class="pop-h">Needs you <span class="num muted">{needs.length}</span></div>
        {#each needs.slice(0, 8) as x (x.kind + (x.repo ?? "") + x.n)}
          <a class="row" href={gh(x.repo ?? d.repo, x.kind, x.n)} target="_blank" rel="noopener">
            <i class="sdot wait"></i>
            <span class="what"><b>#{x.n}</b> <span class="muted">{x.title}</span></span>
            <span class="tag">{x.why}</span>
          </a>
        {:else}
          <div class="row muted">Nothing waits on you.</div>
        {/each}
      </div>
    {/if}
  </div>
  <span class="spacer"></span>
  <div class="usage" title={d.usage ? `Your Claude plan, as of ${rel(d.usage.at)}` : "No usage report yet"}>
    {#each usage as [label, m]}
      <span class="meter" class:warn={m?.warn} class:over={m?.over}>
        <span class="muted">{label}</span>
        <span class="track"><span class="fill" style:width={m ? Math.min(100, m.value * 100) + "%" : "0"}></span></span>
        <span class="num">{m ? pct(m.value) : "–"}</span>
      </span>
    {/each}
  </div>
  <button class="btn ghost" class:danger={!d.stop} onclick={toggleStop}>{d.stop ? "Start" : "Stop"}</button>
  <button class="btn ghost" onclick={togglePause}>{d.pause ? "Resume" : "Pause"}</button>
  {#if store.error}<span class="offline" title={store.error}>offline</span>{/if}
</header>

<style>
  header { position: sticky; top: 0; z-index: 20; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 10px 20px; min-height: 52px; background: var(--bg-2); border-bottom: 1px solid var(--line); border-radius: 12px 12px 0 0; }
  h1 { margin: 0; font-size: 15px; font-weight: 600; }
  .spacer { flex: 1; }
  .pill-wrap { position: relative; }
  .pill { display: inline-flex; align-items: center; gap: 7px; font-size: 12.5px; padding: 3px 10px; border-radius: 99px; background: var(--panel); border: 1px solid var(--line); color: var(--ink); cursor: pointer; }
  .pill:hover { border-color: var(--line-2); }
  .pill .sep { color: var(--muted); }
  .pill svg { width: 12px; height: 12px; fill: none; stroke: var(--muted); stroke-width: 1.5; }
  .pop { position: absolute; top: calc(100% + 6px); left: 0; width: min(420px, 90vw); background: var(--panel); border: 1px solid var(--line-2); border-radius: 10px; padding: 6px; box-shadow: 0 12px 32px rgb(0 0 0 / .35); }
  .pop-h { font-size: 11.5px; color: var(--muted); padding: 8px 8px 4px; display: flex; gap: 6px; }
  .row { display: flex; align-items: center; gap: 9px; width: 100%; padding: 6px 8px; border: 0; border-radius: 6px; background: none; text-align: left; cursor: pointer; font-size: 13px; color: var(--ink); }
  a.row:hover, button.row:hover { background: var(--panel-2); color: var(--ink); }
  .what { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .what b { font-weight: 500; font-family: var(--mono); font-size: 12px; }
  .tag { font-size: 11.5px; color: var(--wait); }
  .usage { display: flex; gap: 14px; }
  .meter { display: inline-flex; align-items: center; gap: 7px; font-size: 12px; }
  .track { width: 56px; height: 4px; border-radius: 99px; background: var(--line-2); overflow: hidden; }
  .fill { display: block; height: 100%; background: var(--ink-2); transition: width .6s; }
  .meter.warn .fill { background: var(--wait); }
  .meter.over .fill { background: var(--fail); }
  .meter.over .num { color: var(--fail); }
  .btn.danger:hover { color: var(--fail); }
  .offline { font-size: 12px; color: var(--fail); }
  @media (max-width: 860px) {
    header { padding: 8px 12px; gap: 8px; flex-wrap: nowrap; border-radius: 0; min-height: 48px; }
    h1 { font-size: 14px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .usage, .wide { display: none; }
    .pill { padding: 3px 8px; gap: 5px; white-space: nowrap; }
    header > .btn { padding: 2px 7px; }
    .pop { position: fixed; top: 50px; left: 8px; right: 8px; width: auto; }
  }
</style>
