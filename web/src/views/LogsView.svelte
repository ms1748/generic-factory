<script>
  // Logs: every container on the factory's Docker (dispatcher, tunnel, agent runs, GlitchTip) and its
  // live log, the way Dozzle shows them, without another site. #/logs/<container> links straight to one.
  import { go, ui } from "../lib/ui.svelte.js";

  let list = $state([]);
  let listError = $state("");
  let lines = $state([]);
  let error = $state("");
  let filter = $state("");
  let onlyProblems = $state(false);
  let follow = $state(true);
  let wrap = $state(false);
  let tail = $state(500);
  let pane = $state();

  const selected = $derived(ui.arg || list.find((c) => c.name.endsWith("dispatcher-1"))?.name || list[0]?.name || "");
  const PROBLEM = /\b(err(or)?|fail(ed|ure)?|fatal|panic|exception|denied|refused|timed? ?out)\b/i;
  const WARN = /\b(warn(ing)?|retry|slow)\b/i;
  const shown = $derived.by(() => {
    const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
    return lines.filter((l) => (!onlyProblems || PROBLEM.test(l.text)) && words.every((w) => l.text.toLowerCase().includes(w)));
  });
  const groups = $derived.by(() => {
    const out = new Map();
    for (const c of list) {
      const g = c.name.startsWith("factory-run-") ? "Agent runs" : c.project ? c.project : "Other";
      out.set(g, [...(out.get(g) ?? []), c]);
    }
    return [...out.entries()].sort((a, b) => (a[0] === "Agent runs") - (b[0] === "Agent runs") || a[0].localeCompare(b[0]));
  });

  async function loadList() {
    try {
      const res = await fetch("/api/logs", { cache: "no-store" });
      const j = await res.json();
      if (j.error) throw new Error(j.error);
      list = j;
      listError = "";
    } catch (e) {
      listError = e.message;
    }
  }

  $effect(() => {
    loadList();
    const t = setInterval(() => !document.hidden && loadList(), 15_000);
    return () => clearInterval(t);
  });

  // Load the selected container's log, then follow it with ?since= while Follow is on.
  $effect(() => {
    const name = selected;
    const n = tail;
    const following = follow;
    if (!name) return;
    let stop = false;
    let timer = 0;
    lines = [];
    error = "";
    const pull = async (since) => {
      try {
        const res = await fetch(`/api/logs/${encodeURIComponent(name)}?tail=${n}${since ? `&since=${encodeURIComponent(since)}` : ""}`, { cache: "no-store" });
        const j = await res.json();
        if (stop) return;
        if (!res.ok || j.error) throw new Error(j.error || res.statusText);
        if (j.length) lines = since ? [...lines, ...j].slice(-5000) : j;
        error = "";
      } catch (e) {
        if (!stop) error = e.message;
      }
      if (!stop && following) timer = setTimeout(() => pull(lines.at(-1)?.at), document.hidden ? 15_000 : 3000);
    };
    pull();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  });

  // Stick to the bottom while following, unless the reader scrolled up.
  let pinned = $state(true);
  $effect(() => {
    shown.length;
    if (follow && pinned && pane) queueMicrotask(() => (pane.scrollTop = pane.scrollHeight));
  });
  const onScroll = () => (pinned = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 40);

  function download() {
    const blob = new Blob([lines.map((l) => `${l.at} ${l.text}`).join("\n") + "\n"], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${selected}-${new Date().toISOString().slice(0, 19).replace(/:/g, "")}.log`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "");
  const short = (n) => n.replace(/^factory-/, "").replace(/-1$/, "");
</script>

<div class="logs">
  <aside class="panel side">
    <div class="panel-head"><h2>Containers</h2><span class="spacer"></span><span class="muted small">{list.length}</span></div>
    {#if listError}<p class="err small">Can't list containers: {listError}</p>{/if}
    <div class="clist">
      {#each groups as [g, items] (g)}
        <div class="grp">{g}</div>
        {#each items as c (c.name)}
          <button class:on={c.name === selected} onclick={() => go("logs", c.name)} title={`${c.image} · ${c.status}`}>
            <i class="dot" class:run={c.state === "running"} class:bad={/Exited \((?!0\))/.test(c.status)}></i>
            <span class="cname">{short(c.name)}</span>
            <span class="muted small cstat">{c.state === "running" ? c.status.replace(/^Up /, "up ") : c.status.replace(/^Exited \((\d+)\) /, "exit $1 · ")}</span>
          </button>
        {/each}
      {:else}
        {#if !listError}<p class="muted small pad">Loading…</p>{/if}
      {/each}
    </div>
  </aside>

  <section class="panel main">
    <div class="bar">
      <b class="mono">{selected || "—"}</b>
      <span class="muted small">{shown.length === lines.length ? `${lines.length} lines` : `${shown.length} of ${lines.length} lines`}</span>
      <span class="spacer"></span>
      <input class="field" type="search" placeholder="Filter" bind:value={filter} aria-label="Filter lines" />
      <label class="tog"><input type="checkbox" bind:checked={onlyProblems} /> Errors</label>
      <label class="tog"><input type="checkbox" bind:checked={follow} /> Follow</label>
      <label class="tog"><input type="checkbox" bind:checked={wrap} /> Wrap</label>
      <select class="field" bind:value={tail} aria-label="Lines to load">
        {#each [200, 500, 2000, 5000] as n}<option value={n}>last {n}</option>{/each}
      </select>
      <button class="btn sm" onclick={download} disabled={!lines.length}>Download</button>
    </div>
    {#if error}<p class="err small pad">{error}</p>{/if}
    <div class="pane mono" class:wrap bind:this={pane} onscroll={onScroll} role="log" aria-live="off">
      {#each shown as l, i (i)}
        <div class="ln" class:bad={PROBLEM.test(l.text)} class:warn={!PROBLEM.test(l.text) && WARN.test(l.text)}><time title={l.at}>{clock(l.at)}</time><span>{l.text}</span></div>
      {:else}
        <p class="muted small pad">{lines.length ? "No line matches." : error ? "" : "No output yet."}</p>
      {/each}
    </div>
  </section>
</div>

<style>
  .logs { display: grid; grid-template-columns: 260px minmax(0, 1fr); gap: 14px; height: calc(100vh - 110px); min-height: 420px; }
  .side, .main { display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
  .clist { overflow: auto; padding: 4px 8px 10px; }
  .grp { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); font-weight: 650; padding: 10px 8px 4px; }
  .clist button { display: grid; grid-template-columns: 10px 1fr; gap: 0 8px; width: 100%; text-align: left; border: 0; background: none; color: var(--ink-2); padding: 6px 8px; border-radius: 8px; cursor: pointer; align-items: center; }
  .clist button:hover { background: var(--panel-2); }
  .clist button.on { background: color-mix(in srgb, var(--accent) 16%, transparent); color: var(--ink); }
  .cname { font: 600 12.5px var(--mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cstat { grid-column: 2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--line-2); }
  .dot.run { background: var(--teal); }
  .dot.bad { background: var(--red); }
  .bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--line); }
  .bar input[type="search"] { width: 160px; }
  .tog { display: inline-flex; align-items: center; gap: 4px; font-size: 12.5px; color: var(--ink-2); cursor: pointer; }
  .tog input { accent-color: var(--accent); }
  .spacer { flex: 1; }
  .pane { flex: 1; overflow: auto; padding: 8px 0; font-size: 12px; line-height: 1.55; background: color-mix(in srgb, var(--bg) 60%, var(--panel)); }
  .ln { display: grid; grid-template-columns: 70px auto; gap: 10px; padding: 0 12px; white-space: pre; }
  .wrap .ln { white-space: pre-wrap; overflow-wrap: anywhere; grid-template-columns: 70px minmax(0, 1fr); }
  .ln:hover { background: var(--panel-2); }
  .ln time { color: var(--muted); user-select: none; }
  .ln.bad span { color: var(--red); }
  .ln.warn span { color: var(--amber); }
  .err { color: var(--red); margin: 8px 12px; }
  .pad { padding: 8px 12px; margin: 0; }
  @media (max-width: 860px) { .logs { grid-template-columns: 1fr; height: auto; } .side { max-height: 220px; } .main { height: 70vh; } }
</style>
