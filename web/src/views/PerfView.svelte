<script>
  // Performance (src/perf.ts): how each build did in the hardware tests. The list is every run, newest
  // first, with startup, shutdown, frame rates, peaks and what got worse or better than the build before on
  // the same machine and game. A run opens its page: the numbers, the comparison, charts over the run, and
  // its events. #/perf/<run id> opens a run; #/perf/<build> (the PR comment's link) lists that build's runs.
  import Spark from "../components/Spark.svelte";
  import { gh, rel, time } from "../lib/format.js";
  import { bytes } from "../lib/systems.svelte.js";
  import { go, ui } from "../lib/ui.svelte.js";
  let { d } = $props();

  let list = $state(null);
  let page = $state(null);
  let failed = $state("");
  let kind = $state("");
  let machine = $state("");
  let pulling = $state("");
  const runId = $derived(/^\d+$/.test(ui.arg) ? Number(ui.arg) : null);
  const build = $derived(runId ? "" : decodeURIComponent(ui.arg ?? ""));

  async function getJson(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
    return res.json();
  }
  async function loadList() {
    try {
      const q = new URLSearchParams({ ...(kind && { kind }), ...(machine && { machine }), ...(build && { build }) });
      list = await getJson(`/api/perf?${q}`);
      failed = "";
    } catch (e) {
      failed = e.message;
    }
  }
  async function loadRun(id) {
    try {
      page = await getJson(`/api/perf/runs/${id}`);
      failed = "";
    } catch (e) {
      page = null;
      failed = e.message;
    }
  }
  $effect(() => {
    if (runId) loadRun(runId);
    else loadList();
  });
  async function pullNow() {
    pulling = "Checking GitHub for new runs…";
    const res = await fetch("/api/perf/pull", { method: "POST", headers: { "x-factory": "1" } });
    pulling = (await res.json().catch(() => ({}))).message ?? res.statusText;
    loadList();
  }

  // Formatting.
  const ms = (v) => (v == null ? "–" : v < 1000 ? `${Math.round(v)} ms` : `${(v / 1000).toFixed(1)} s`);
  const pct = (v) => (v == null ? "–" : `${Math.round(v)}%`);
  const deg = (v) => (v == null ? "–" : `${Math.round(v)} °C`);
  const fmtOf = { ms, fps: (v) => `${Math.round(v * 10) / 10} fps`, bytes: (v) => bytes(v), "%": (v) => `${Math.round(v)}%`, count: (v) => String(v) };
  const change = (c) => `${c.what} ${c.pct > 0 ? "+" : ""}${Math.round(c.pct)}%`;
  // Settings › Install names the app's own window (left out of the main frame rate) and its processes.
  const appCfg = $derived(page?.app ?? list?.app ?? { ui: "", processes: [] });
  const mainFps = (s) => Object.entries(s.fps ?? {}).find(([k]) => k !== appCfg.ui) ?? Object.entries(s.fps ?? {})[0] ?? null;
  const memPeak = (s) => {
    const app = appCfg.processes.map((k) => s.procs?.[k]?.mem.peak ?? 0).reduce((a, b) => a + b, 0);
    return app || null;
  };
  const tempPeak = (s) => s.sys?.cpuTemp?.peak ?? s.sys?.gpuTemp?.peak ?? s.sys?.acpiTemp?.peak ?? null;
  const outcomeCls = (o) => (o === "pass" ? "run" : o === "fail" || o === "broken" ? "fail" : "wait");
  const label = (r) => r.build || r.sha.slice(0, 7) || `run ${r.id}`;

  // The run page's charts: one per metric it has, in this order.
  const CHARTS = [
    ["sys.cpu", "CPU", "var(--violet)", 100, pct],
    ["sys.cpuTemp", "CPU temperature", "var(--pink)", 100, deg],
    ["sys.acpiTemp", "Board (ACPI) temperature", "var(--pink)", 100, deg],
    ["sys.cpuClock", "CPU clock", "var(--violet)", 0, (v) => `${Math.round(v)} MHz`],
    ["sys.cpuPower", "CPU power", "var(--amber)", 0, (v) => `${Math.round(v)} W`],
    ["sys.mem", "Memory used", "var(--teal)", 0, (v) => bytes(v)],
    ["sys.gpu", "GPU", "var(--red)", 100, pct],
    ["sys.gpuTemp", "GPU temperature", "var(--pink)", 100, deg],
    ["sys.gpuClock", "GPU clock", "var(--red)", 0, (v) => `${Math.round(v)} MHz`],
    ["sys.gpuPower", "GPU power", "var(--amber)", 0, (v) => `${Math.round(v)} W`],
    ["sys.gpuFan", "GPU fan", "var(--chart-2)", 100, pct],
    ["sys.fan", "Fastest fan", "var(--chart-2)", 0, (v) => `${Math.round(v)} RPM`],
    ["sys.vram", "Video memory", "var(--red)", 0, (v) => bytes(v)],
    ["sys.diskRead", "Disk reads", "var(--amber)", 0, (v) => `${bytes(v)}/s`],
    ["sys.diskWrite", "Disk writes", "var(--amber)", 0, (v) => `${bytes(v)}/s`],
    ["sys.netRx", "Network in", "var(--chart-2)", 0, (v) => `${bytes(v)}/s`],
    ["sys.netTx", "Network out", "var(--chart-2)", 0, (v) => `${bytes(v)}/s`],
  ];
  const charts = $derived.by(() => {
    if (!page) return [];
    const c = page.chart;
    const at = (i) => new Date(Date.parse(page.run.started) + c.t[i]).toISOString();
    const pts = (key) => c[key].map((v, i) => ({ at: at(i), v }));
    const has = (key) => c[key]?.some((v) => v != null);
    const out = [];
    for (const key of Object.keys(c).filter((k) => k.startsWith("fps.") && has(k))) out.push({ key, title: `${key.slice(4)} frame rate`, color: "var(--teal)", max: 60, fmt: (v) => `${Math.round(v * 10) / 10} fps`, points: pts(key) });
    for (const [key, title, color, max, fmt] of CHARTS) if (has(key)) out.push({ key, title, color, max, fmt, points: pts(key) });
    const procs = [...new Set(Object.keys(c).filter((k) => k.startsWith("proc.")).map((k) => k.slice(5, k.lastIndexOf("."))))];
    for (const p of procs) {
      if (has(`proc.${p}.cpu`)) out.push({ key: `proc.${p}.cpu`, title: `${p}: CPU`, color: "var(--violet)", max: 100, fmt: pct, points: pts(`proc.${p}.cpu`) });
      if (has(`proc.${p}.mem`)) out.push({ key: `proc.${p}.mem`, title: `${p}: memory`, color: "var(--teal)", max: 0, fmt: (v) => bytes(v), points: pts(`proc.${p}.mem`) });
      if (has(`proc.${p}.gpu`)) out.push({ key: `proc.${p}.gpu`, title: `${p}: GPU`, color: "var(--red)", max: 100, fmt: pct, points: pts(`proc.${p}.gpu`) });
      if (has(`proc.${p}.vram`)) out.push({ key: `proc.${p}.vram`, title: `${p}: video memory`, color: "var(--red)", max: 0, fmt: (v) => bytes(v), points: pts(`proc.${p}.vram`) });
    }
    return out;
  });
  const procRows = $derived(page ? Object.entries(page.summary.procs) : []);
  let settingsOpen = $state(false);
  let form = $state(null);
  $effect(() => {
    if (list?.settings && !form) form = { ...list.settings };
  });
  async function saveSettings(e) {
    e.preventDefault();
    const res = await fetch("/api/perf/settings", { method: "POST", headers: { "content-type": "application/json", "x-factory": "1" }, body: JSON.stringify($state.snapshot(form)) });
    pulling = (await res.json().catch(() => ({}))).message ?? res.statusText;
    form = null;
    loadList();
  }
</script>

{#if failed}<p class="err">Couldn't read the performance records: {failed}</p>{/if}

{#if runId}
  <!-- One run -->
  <div class="head">
    <button class="btn ghost" onclick={() => go("perf", page?.run.build ?? "")}>← {page?.run.build ? `All runs of ${page.run.build}` : "All runs"}</button>
    <span class="spacer"></span>
    {#if page?.run.runUrl}<a class="btn" href={page.run.runUrl} target="_blank" rel="noopener">CI run</a>{/if}
    {#if page?.run.pr}<a class="btn" href={gh(page.run.repo, "pull", page.run.pr)} target="_blank" rel="noopener">PR #{page.run.pr}</a>{/if}
  </div>
  {#if !page}
    <div class="empty">Loading…</div>
  {:else}
    {@const r = page.run}
    {@const s = page.summary}
    {@const f = mainFps(s)}
    <section class="panel">
      <div class="panel-head">
        <i class="sdot {outcomeCls(r.outcome)}"></i>
        <h2>{label(r)}{r.version ? ` · v${r.version}` : ""}</h2>
        <span class="spacer"></span>
        <span class="chip">{r.outcome}</span>
      </div>
      <div class="panel-body">
        <p class="muted small sub">{r.kind === "gaming" ? "Game test" : r.kind === "box" ? "Test box" : r.kind} on {r.machine}{r.game ? ` · ${r.game}` : ""} · {time(r.started, d.timezone)} · {Math.round(s.seconds / 60) || "<1"} min · <span class="mono">{r.sha.slice(0, 7)}</span></p>
        <div class="tiles">
          <div><span>Startup</span><b class="num">{ms(r.startup)}</b></div>
          <div><span>Shutdown</span><b class="num">{ms(r.shutdown)}</b><em>{r.cleanExit === false ? "not clean" : r.cleanExit ? "clean" : ""}</em></div>
          {#if page.meta.sessionWindows != null}<div><span>Game windows up</span><b class="num">{ms(page.meta.sessionWindows)}</b></div>{/if}
          {#if f}<div><span>{f[0]} fps</span><b class="num">{f[1].avg}</b><em>1% low {f[1].low1}</em></div>{/if}
          <div><span>CPU peak</span><b class="num">{pct(s.sys.cpu?.peak)}</b><em>avg {pct(s.sys.cpu?.avg)}</em></div>
          {#if s.sys.gpu}<div><span>GPU peak</span><b class="num">{pct(s.sys.gpu.peak)}</b><em>avg {pct(s.sys.gpu.avg)}</em></div>{/if}
          {#if s.sys.mem}<div><span>Memory peak</span><b class="num">{bytes(s.sys.mem.peak)}</b></div>{/if}
          {#if s.sys.cpuTemp}<div><span>CPU temp</span><b class="num">{deg(s.sys.cpuTemp.peak)}</b><em>avg {deg(s.sys.cpuTemp.avg)}</em></div>{/if}
          {#if s.sys.gpuTemp}<div><span>GPU temp</span><b class="num">{deg(s.sys.gpuTemp.peak)}</b><em>avg {deg(s.sys.gpuTemp.avg)}</em></div>{/if}
          {#if s.sys.gpuPower}<div><span>GPU power</span><b class="num">{Math.round(s.sys.gpuPower.peak)} W</b><em>avg {Math.round(s.sys.gpuPower.avg)} W</em></div>{/if}
          {#if s.crashes}<div class="bad"><span>Crashes</span><b class="num">{s.crashes}</b></div>{/if}
        </div>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head"><h2>Against the build before</h2></div>
      <div class="panel-body">
        {#if !page.prev}
          <p class="muted small">No earlier run of another commit on {r.machine}{r.game ? ` with ${r.game}` : ""} to compare with.</p>
        {:else}
          <p class="muted small sub">
            <a href={`#/perf/${page.prev.id}`}>{label(page.prev)}</a>, {rel(page.prev.started)}. Flagged when startup or shutdown is {list?.settings?.timePct ?? 20}% slower, frame rates {list?.settings?.fpsPct ?? 10}% lower, or the app's memory or CPU {list?.settings?.usePct ?? 20}% higher (Settings below the run list).
          </p>
          {#if page.changes.length}
            <ul class="changes">
              {#each page.changes as c}
                <li class:bad={c.bad} class:good={!c.bad}><b>{change(c)}</b> <span class="muted num">{fmtOf[c.unit](c.before)} → {fmtOf[c.unit](c.now)}</span></li>
              {/each}
            </ul>
          {:else}
            <p class="small">Nothing changed beyond the limits.</p>
          {/if}
        {/if}
      </div>
    </section>

    <section class="panel">
      <div class="panel-head"><h2>Over the run</h2><span class="spacer"></span><span class="muted small">{page.samples} samples, about one a second</span></div>
      <div class="panel-body">
        {#if !page.samples}
          <p class="muted small">This run's time series was deleted (Settings › keep series), or it had none. Its numbers above stay.</p>
        {:else}
          <div class="charts">
            {#each charts as c (c.key)}
              {@const vs = c.points.map((p) => p.v).filter((v) => v != null)}
              <div class="chart">
                <span class="small ct"><span>{c.title}</span><span class="num muted">avg {c.fmt(vs.reduce((a, b) => a + b, 0) / vs.length)} · peak {c.fmt(Math.max(...vs))}</span></span>
                <Spark points={c.points} color={c.color} max={c.max} format={c.fmt} height={52} label={c.title} />
              </div>
            {/each}
          </div>
        {/if}
        {#if page.meta.fpsNote}<p class="muted small">Frame rates: {page.meta.fpsNote}.</p>{/if}
      </div>
    </section>

    {#if procRows.length}
      <section class="panel">
        <div class="panel-head"><h2>Processes</h2></div>
        <div class="panel-body table">
          <div class="tr th"><span>Process</span><span>CPU avg / peak</span><span>Memory peak</span><span>GPU peak</span><span>Video memory</span></div>
          {#each procRows as [name, p] (name)}
            <div class="tr"><span>{name}</span><span class="num">{pct(p.cpu.avg)} / {pct(p.cpu.peak)}</span><span class="num">{p.mem.peak == null ? "–" : bytes(p.mem.peak)}</span><span class="num">{pct(p.gpu.peak)}</span><span class="num">{p.vram.peak == null ? "–" : bytes(p.vram.peak)}</span></div>
          {/each}
        </div>
      </section>
    {/if}

    <section class="panel">
      <div class="panel-head"><h2>Events</h2></div>
      <div class="panel-body">
        <ul class="events">
          {#each page.meta.events as e}
            <li><span class="num muted">{(e.t / 1000).toFixed(1)} s</span> {e.name}{e.clean === false ? " (forced)" : ""}{e.note ? `: ${e.note}` : ""}</li>
          {/each}
          {#each page.meta.crashes as c}
            <li class="bad"><span class="num muted">{time(c.at, d.timezone)}</span> {c.kind}: {c.exe}{c.module ? ` in ${c.module}` : ""}{c.code ? ` (${c.code})` : ""}</li>
          {/each}
        </ul>
        {#if page.meta.steps?.length}
          <details>
            <summary class="small">Test steps ({page.meta.steps.length})</summary>
            <ul class="events">
              {#each page.meta.steps as st}
                <li class:bad={st.ok === false}><span class="num muted">{ms(st.ms)}</span> {st.ok === null ? "skipped" : st.ok ? "passed" : "failed"}: {st.name}</li>
              {/each}
            </ul>
          </details>
        {/if}
        {#if page.meta.system}
          <p class="muted small sys">{Object.entries(page.meta.system).filter(([, v]) => v != null).map(([k, v]) => `${k}: ${typeof v === "number" && v > 1e8 ? bytes(v) : v}`).join(" · ")}</p>
        {/if}
      </div>
    </section>
  {/if}
{:else}
  <!-- Every run -->
  <div class="head">
    <div class="seg" role="radiogroup" aria-label="Kind">
      {#each [["", "All"], ...(list?.kinds ?? []).map((k) => [k, k === "box" ? "Test box" : k === "gaming" ? "Game tests" : k])] as [k, l]}
        <button role="radio" aria-checked={kind === k} class:on={kind === k} onclick={() => ((kind = k), loadList())}>{l}</button>
      {/each}
    </div>
    {#if (list?.machines ?? []).length > 1}
      <select class="field" bind:value={machine} onchange={loadList} aria-label="Machine">
        <option value="">Every machine</option>
        {#each list.machines as m}<option value={m}>{m}</option>{/each}
      </select>
    {/if}
    {#if build}<button class="chip" onclick={() => go("perf")}>{build} ✕</button>{/if}
    <span class="spacer"></span>
    <button class="btn ghost" onclick={pullNow}>Check now</button>
  </div>
  {#if pulling}<p class="muted small">{pulling}</p>{/if}

  <section class="panel">
    <div class="panel-body">
      {#if !list}
        <div class="empty">Loading…</div>
      {:else}
        {#each list.runs as r (r.id)}
          {@const s = r.summary}
          {@const f = mainFps(s)}
          <a class="row" href={`#/perf/${r.id}`}>
            <i class="sdot {outcomeCls(r.outcome)}" title={r.outcome}></i>
            <span class="what">
              <span class="title">{label(r)}{r.game ? ` · ${r.game}` : ""}</span>
              <span class="muted small">{r.kind === "gaming" ? "game test" : r.kind === "box" ? "test box" : r.kind} · {r.machine} · {rel(r.started)}{r.pr ? ` · #${r.pr}` : ""}</span>
            </span>
            <span class="nums">
              <span><em>start</em> <b class="num">{ms(r.startup)}</b></span>
              <span><em>quit</em> <b class="num" class:badtxt={r.cleanExit === false}>{ms(r.shutdown)}</b></span>
              {#if f}<span><em>fps</em> <b class="num">{f[1].avg}</b><em class="num"> / {f[1].low1}</em></span>{/if}
              <span><em>CPU</em> <b class="num">{pct(s.sys.cpu?.peak)}</b></span>
              {#if s.sys.gpu}<span><em>GPU</em> <b class="num">{pct(s.sys.gpu.peak)}</b></span>{/if}
              {#if memPeak(s)}<span><em>app RAM</em> <b class="num">{bytes(memPeak(s))}</b></span>{/if}
              {#if tempPeak(s) != null}<span><em>temp</em> <b class="num">{deg(tempPeak(s))}</b></span>{/if}
            </span>
            {#if r.changes.length}
              <span class="flags">
                {#each r.changes.slice(0, 4) as c}<span class="chip" class:bad={c.bad} class:live={!c.bad}>{change(c)}</span>{/each}
              </span>
            {/if}
          </a>
        {:else}
          <div class="empty">
            {build ? `No runs of ${build} yet. A run shows up a few minutes after its test finishes.` : "No test runs recorded yet. Each hardware test uploads a perf-* artifact; the dispatcher reads them every 5 minutes."}
          </div>
        {/each}
      {/if}
    </div>
  </section>

  {#if list}
    <section class="panel">
      <button class="panel-head toggle" aria-expanded={settingsOpen} onclick={() => (settingsOpen = !settingsOpen)}>
        <h2>Settings</h2><span class="spacer"></span><span class="muted small">{list.total} runs stored{list.last ? ` · checked ${rel(list.last.at)}` : ""}</span>
      </button>
      {#if settingsOpen && form}
        <form class="panel-body settings" onsubmit={saveSettings}>
          <label>Keep each run's time series for <input class="field num" type="number" min="0" max="3650" bind:value={form.keepDays} /> days <span class="muted small">(0 = forever; runs and their numbers are always kept)</span></label>
          <label>Flag startup or shutdown <input class="field num" type="number" min="1" max="500" bind:value={form.timePct} />% slower</label>
          <label>Flag frame rates <input class="field num" type="number" min="1" max="100" bind:value={form.fpsPct} />% lower</label>
          <label>Flag the app's memory or CPU <input class="field num" type="number" min="1" max="500" bind:value={form.usePct} />% higher</label>
          <label><input type="checkbox" bind:checked={form.status} /> Put a <code>factory/perf</code> line on the PR's checks (always passing) linking the run</label>
          <div><button class="btn primary">Save</button></div>
          {#if list.last?.error}<p class="err">Last check failed: {list.last.error}</p>{/if}
        </form>
      {/if}
    </section>
  {/if}
{/if}

<style>
  .head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
  .spacer { flex: 1; }
  .panel { margin-bottom: 12px; }
  .seg { display: inline-flex; padding: 2px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg-2); }
  .seg button { border: 0; background: none; color: var(--muted); padding: 3px 10px; border-radius: 6px; cursor: pointer; font-size: 12.5px; }
  .seg button.on { background: var(--panel-2); color: var(--ink); }
  .row { display: grid; grid-template-columns: 8px minmax(0, 1fr) auto; align-items: center; gap: 4px 12px; padding: 9px 4px; border-top: 1px solid var(--line); color: var(--ink); }
  .row:first-child { border-top: 0; }
  .row:hover { background: var(--panel-2); color: var(--ink); }
  .what { display: grid; min-width: 0; }
  .title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--mono); font-size: 12.5px; }
  .nums { display: flex; gap: 12px; flex-wrap: wrap; justify-content: flex-end; font-size: 12.5px; }
  .nums em { font-style: normal; color: var(--muted); font-size: 11.5px; }
  .badtxt { color: var(--fail); }
  .flags { grid-column: 2 / -1; display: flex; gap: 6px; flex-wrap: wrap; }
  .sub { margin: 0 0 10px; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 10px; }
  .tiles div { display: grid; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; }
  .tiles span { font-size: 11.5px; color: var(--muted); }
  .tiles b { font-size: 18px; font-weight: 500; }
  .tiles em { font-style: normal; font-size: 11.5px; color: var(--muted); }
  .tiles .bad b { color: var(--fail); }
  .changes, .events { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; font-size: 13px; }
  .changes li.bad b, .events li.bad { color: var(--fail); }
  .changes li.good b { color: var(--run); }
  .events .num { display: inline-block; min-width: 64px; }
  .charts { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px 18px; }
  .chart { display: grid; gap: 4px; }
  .ct { display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
  .table { display: grid; font-size: 12.5px; overflow-x: auto; }
  .tr { display: grid; grid-template-columns: minmax(120px, 1.4fr) repeat(4, minmax(90px, 1fr)); gap: 8px; padding: 5px 0; border-top: 1px solid var(--line); }
  .tr.th { color: var(--muted); font-size: 11.5px; border-top: 0; }
  .sys { margin: 10px 0 0; }
  .toggle { width: 100%; border: 0; background: none; color: inherit; cursor: pointer; padding-bottom: 12px; text-align: left; }
  .settings { display: grid; gap: 10px; font-size: 13px; }
  .settings input.num { width: 70px; margin: 0 4px; }
  .err { color: var(--fail); font-size: 12.5px; }
  code { font-family: var(--mono); font-size: 12px; }
  details summary { cursor: pointer; margin-top: 10px; }
  @media (max-width: 760px) {
    .row { grid-template-columns: 8px minmax(0, 1fr); }
    .nums { grid-column: 2; justify-content: flex-start; gap: 10px; }
    .tr { grid-template-columns: minmax(100px, 1.2fr) repeat(4, minmax(70px, 1fr)); }
  }
</style>
