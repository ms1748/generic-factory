<script>
  // Runs: the list on the left, grouped by day (filter: live, failed, everything), and the selected run's
  // inspector on the right: what it was, how it ended, what it cost, and its transcript.
  import { runLog } from "../lib/api.svelte.js";
  import { go, ui } from "../lib/ui.svelte.js";
  import { dur, gh, money, time } from "../lib/format.js";
  import Transcript from "../components/Transcript.svelte";
  let { d, openTrial, openPrompt } = $props();
  const laneOf = (r) => d.lanes.find((l) => l.name === r.lane && (l.repo ?? d.repo) === (r.repo ?? d.repo));

  const PAGE = 14;
  let filter = $state("live");
  let page = $state(0);
  const FILTERS = [
    ["live", "Live"],
    ["failed", "Failed"],
    ["all", "Everything"],
  ];
  const failedRun = (r) => r.status === "failed" || r.status === "limited";
  const runs = $derived(filter === "live" ? d.runs.filter((r) => r.mode === "live") : filter === "failed" ? d.runs.filter(failedRun) : d.runs);
  const pages = $derived(Math.max(1, Math.ceil(runs.length / PAGE)));
  const shown = $derived(runs.slice(page * PAGE, page * PAGE + PAGE));
  const dayOf = (iso) => new Date(iso).toLocaleDateString("en-US", { timeZone: d.timezone, weekday: "long", month: "short", day: "numeric" });
  const groups = $derived.by(() => {
    const out = [];
    for (const r of shown) {
      const day = dayOf(r.started_at);
      if (out.at(-1)?.day !== day) out.push({ day, runs: [] });
      out.at(-1).runs.push(r);
    }
    return out;
  });
  const selected = $derived(d.runs.find((r) => String(r.id) === ui.arg) ?? (d.running ? d.running : runs[0]));
  const statusOf = (r) => (r.status === "running" ? "run live" : r.status === "done" ? "run" : failedRun(r) ? "fail" : "");
  const WORD = { running: "Running", done: "Done", failed: "Failed", limited: "Hit the usage limit", dry: "Dry run", idle: "Nothing to do" };
  const cards = $derived([...d.board.building, ...d.board.next, ...d.board.review, ...d.board.needsYou, ...d.board.hold]);
  const titleOf = (r) => (r.card ? cards.find((c) => (c.number === r.card || c.issue === r.card) && (c.repo ?? d.repo) === (r.repo ?? d.repo))?.title : null);
  const short = (repo) => (repo && repo !== d.repo ? repo.split("/")[1] : "");

  let entries = $state([]);
  const selId = $derived(selected?.id);
  const selLive = $derived(selected?.mode === "live");
  $effect(() => {
    const id = selId;
    if (!id || !selLive) return void (entries = []);
    let stop = false;
    let timer = 0;
    const pull = async () => {
      const e = await runLog(id);
      if (stop) return;
      if (e.length !== entries.length) entries = e;
      if (d.running?.id === id || d.runningAll?.some((r) => r.id === id)) timer = setTimeout(pull, 5000);
    };
    entries = [];
    pull();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  });
  $effect(() => {
    filter;
    page = 0;
  });
</script>

<div class="runs">
  <section class="panel list">
    <div class="list-head">
      <div class="seg" role="radiogroup" aria-label="Show">
        {#each FILTERS as [k, label]}<button role="radio" aria-checked={filter === k} class:on={filter === k} onclick={() => (filter = k)}>{label}</button>{/each}
      </div>
      <span class="muted small num">{runs.length}</span>
    </div>
    <div class="rows">
      {#each groups as g (g.day)}
        <div class="day">{g.day}</div>
        {#each g.runs as r (r.id)}
          <button class="row" class:on={selected?.id === r.id} onclick={() => go("runs", String(r.id))}>
            <i class="sdot {statusOf(r)}"></i>
            <span class="main">
              <span class="top">{r.lane}{#if r.card}<span class="num"> #{r.card}</span>{/if}{#if short(r.repo)}<span class="chip site">{short(r.repo).replace(new RegExp("^" + d.repo.split("/")[1] + "-"), "")}</span>{/if}</span>
              <span class="sub">{r.action ?? WORD[r.status] ?? r.status}{titleOf(r) ? ` · ${titleOf(r)}` : ""}</span>
            </span>
            <span class="side num">
              <span>{time(r.started_at, d.timezone)}</span>
              <span class="muted">{r.ended_at ? dur(r.started_at, r.ended_at) : r.status === "running" ? dur(r.started_at) : ""}{r.cost_usd ? ` · ${money(r.cost_usd)}` : ""}</span>
            </span>
          </button>
        {/each}
      {:else}
        <div class="empty">{filter === "failed" ? "No failed runs. Good." : filter === "live" ? "No live runs yet." : "No runs yet."}</div>
      {/each}
    </div>
    <div class="pager">
      <button class="btn ghost sm" disabled={page === 0} onclick={() => page--}>Newer</button>
      <span class="muted small num">{page + 1} / {pages}</span>
      <button class="btn ghost sm" disabled={page >= pages - 1} onclick={() => page++}>Older</button>
    </div>
    {#if d.trials?.length}
      <div class="trials">
        <span class="muted small">Quality trials</span>
        {#each d.trials as t (t.name)}<button class="btn ghost sm" onclick={() => openTrial(t)}>{t.title} · {t.wins.replace("Wins: ", "")}</button>{/each}
      </div>
    {/if}
  </section>

  <section class="panel detail">
    {#if selected}
      <header class="head">
        <div class="status">
          <i class="sdot {statusOf(selected)}"></i>
          <span>{WORD[selected.status] ?? selected.status}</span>
          <span class="muted">· run <span class="num">{selected.id}</span> · {selected.mode}</span>
        </div>
        <h2>{titleOf(selected) ?? `${selected.lane}${selected.action ? ` · ${selected.action}` : ""}`}</h2>
        <dl class="meta">
          <div><dt>Lane</dt><dd>{selected.lane} <span class="muted">({selected.model})</span></dd></div>
          {#if selected.card}<div><dt>Card</dt><dd><a class="num" href={gh(selected.repo ?? d.repo, "issues", selected.card)} target="_blank" rel="noopener">{short(selected.repo) ? short(selected.repo) : ""}#{selected.card}</a></dd></div>{/if}
          {#if selected.pr}<div><dt>PR</dt><dd><a class="num" href={gh(selected.repo ?? d.repo, "pull", selected.pr)} target="_blank" rel="noopener">#{selected.pr}</a></dd></div>{/if}
          <div><dt>Started</dt><dd class="num">{time(selected.started_at, d.timezone)}</dd></div>
          <div><dt>Took</dt><dd class="num">{selected.ended_at ? dur(selected.started_at, selected.ended_at) : selected.status === "running" ? `${dur(selected.started_at)} so far` : "–"}</dd></div>
          <div><dt>Cost</dt><dd class="num">{selected.cost_usd ? money(selected.cost_usd) : "–"} <span class="muted small">API-equivalent</span></dd></div>
          {#if laneOf(selected)}<div><dt>Followed</dt><dd><button class="link" onclick={() => openPrompt(laneOf(selected).prompt, selected.repo)}>{laneOf(selected).prompt.split("/").pop()}</button> + <button class="link" onclick={() => openPrompt("docs/factory/prompts/common.md", selected.repo)}>common.md</button></dd></div>{/if}
        </dl>
        {#if selected.summary && selected.status !== "running"}<p class="summary">{selected.summary.split("\n").find((l) => l.trim())}</p>{/if}
      </header>
      {#if selected.mode === "live"}
        <div class="body"><Transcript {entries} repo={selected.repo ?? d.repo} live={selected.status === "running"} /></div>
      {:else}
        <div class="body"><p class="muted">A dry run: nothing ran. {selected.summary}</p></div>
      {/if}
    {:else}
      <div class="body empty">Pick a run.</div>
    {/if}
  </section>
</div>

<style>
  .runs { display: grid; grid-template-columns: 380px minmax(0, 1fr); gap: 14px; height: calc(100vh - 52px - 76px); min-height: 520px; }
  .list, .detail { display: flex; flex-direction: column; min-height: 0; }
  .list-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; border-bottom: 1px solid var(--line); }
  .seg { display: inline-flex; padding: 2px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg-2); }
  .seg button { background: none; border: 0; padding: 3px 10px; font-size: 12.5px; color: var(--muted); cursor: pointer; border-radius: 6px; }
  .seg button.on { background: var(--panel-2); color: var(--ink); }
  .rows { overflow-y: auto; flex: 1; min-height: 0; padding: 4px 6px 8px; }
  .day { position: sticky; top: 0; background: var(--panel); font-size: 11.5px; color: var(--muted); padding: 10px 8px 4px; z-index: 1; }
  .row { display: grid; grid-template-columns: 8px minmax(0, 1fr) auto; align-items: center; gap: 10px; width: 100%; padding: 7px 8px; border: 0; background: none; border-radius: 7px; cursor: pointer; text-align: left; color: var(--ink); }
  .row:hover { background: var(--panel-2); }
  .row.on { background: var(--panel-2); box-shadow: inset 2px 0 0 var(--queue); }
  .main { display: grid; min-width: 0; }
  .top { font-size: 13px; display: flex; align-items: center; gap: 6px; overflow: hidden; white-space: nowrap; }
  .top .num { color: var(--muted); font-size: 12px; }
  .sub { font-size: 12px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .side { display: grid; text-align: right; font-size: 11.5px; }
  .pager { display: flex; align-items: center; justify-content: center; gap: 10px; padding: 6px 0 8px; border-top: 1px solid var(--line); }
  .trials { border-top: 1px solid var(--line); padding: 8px 12px 10px; display: grid; gap: 2px; }
  .trials .btn { justify-content: flex-start; white-space: normal; text-align: left; }
  .head { padding: 16px 20px 14px; border-bottom: 1px solid var(--line); display: grid; gap: 8px; }
  .status { display: flex; align-items: center; gap: 8px; font-size: 12.5px; }
  .head h2 { margin: 0; font-size: 17px; font-weight: 600; line-height: 1.3; }
  .meta { display: flex; flex-wrap: wrap; gap: 6px 22px; margin: 0; }
  .meta div { display: grid; }
  .meta dt { font-size: 11.5px; color: var(--muted); }
  .meta dd { margin: 0; font-size: 13px; }
  .meta a, .link { color: var(--queue); }
  .link { background: none; border: 0; padding: 0; cursor: pointer; font: inherit; text-decoration: underline; text-underline-offset: 2px; }
  .summary { margin: 2px 0 0; color: var(--ink-2); font-size: 13px; }
  .body { padding: 12px 20px 16px; flex: 1; min-height: 0; display: flex; flex-direction: column; }
  @media (max-width: 1000px) { .runs { grid-template-columns: 1fr; height: auto; } .rows { max-height: 50vh; } .detail { min-height: 70vh; } }
</style>
