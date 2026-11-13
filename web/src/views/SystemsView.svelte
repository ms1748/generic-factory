<script>
  // Systems: the owner's machines and the website, with the free-tier limits that matter (Functions
  // requests per day, R2 storage and operations).
  import DeviceCard from "../components/DeviceCard.svelte";
  import BarChart from "../components/BarChart.svelte";
  import { control } from "../lib/api.svelte.js";
  import { bytes, count, level, pull, setRange, systems, watchSystems } from "../lib/systems.svelte.js";
  import { go } from "../lib/ui.svelte.js";
  import { rel } from "../lib/format.js";
  let { d, confirm } = $props();
  $effect(() => watchSystems());

  const s = $derived(systems.data);
  const site = $derived(s?.site);
  const online = $derived(s ? s.devices.filter((m) => m.online).length : 0);
  const today = $derived(site?.functions?.at(-1)?.requests ?? null);
  const r2Bytes = $derived(site?.r2 ? site.r2.buckets.reduce((a, b) => a + b.bytes, 0) : null);
  const down = $derived(s ? s.checks.slice(1).filter((c) => c.last && !c.last.ok) : []);
  const siteDown = $derived(Boolean(s?.checks[0]?.last && !s.checks[0].last.ok));
  const day = (iso) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short" });

  // "**host** CPU ..." as plain text with the bold parts bold (alert texts come from the server).
  const parts = (t) => t.split("**");

  // Pausing waits for no confirmation: it only stops new CI jobs there, and Resume undoes it.
  const ci = (name, paused) => control(`devices/${name}/ci`, { paused }).then(pull);
  // CI build threads on a machine (its card's Build threads form).
  const threads = async (name, t) => {
    const ok = await control(`devices/${name}/threads`, t);
    pull();
    return ok;
  };

  function forget(name) {
    confirm({ title: `Forget ${name}?`, body: "Its saved report and history are removed. If its reporter still runs, it comes back at the next report.", yes: "Forget", action: () => control(`devices/${name}/forget`).then(pull) });
  }
</script>

{#if !s}
  <div class="loading">{#if systems.error}<p class="err">Can't load systems: {systems.error}</p>{:else}<div class="spinner" aria-label="Loading"></div>{/if}</div>
{:else}
  {@const al = s.alerts}
  {#if al?.open.length}
    <div class="alerts panel" role="status">
      <b>{al.open.length} alert{al.open.length === 1 ? "" : "s"} now</b>
      <ul>{#each al.open as a (a.id)}<li><span class="adot"></span>{#each parts(a.text) as p, i}{#if i % 2}<b>{p}</b>{:else}{p}{/if}{/each}<span class="muted small"> · since {rel(a.at)}</span></li>{/each}</ul>
      {#if !al.discord}<span class="muted small">Discord isn't set up, so these only show here (Settings › Alerts).</span>{/if}
    </div>
  {/if}
  <div class="kpis">
    <div class="kpi panel">
      <span class="muted small">Machines reporting</span>
      <b class="num">{online}<small>/{s.devices.length}</small></b>
      <span class="dots">{#each s.devices as m}<i title={m.name} style:background={m.online ? "var(--teal)" : "var(--line-2)"}></i>{/each}</span>
    </div>
    <div class="kpi panel" class:bad={siteDown} class:warn={!siteDown && down.length}>
      <span class="muted small">Website</span>
      <b>{s.checks[0]?.last ? (s.checks[0].last.ok ? "Up" : "Down") : "–"}</b>
      <span class="muted small num">{s.checks[0]?.last?.ms != null ? `${s.checks[0].last.ms} ms` : ""}{down.length ? ` · ${down.map((c) => c.label).join(", ")} failing` : ""}</span>
    </div>
    <div class="kpi panel">
      <span class="muted small">Functions requests today</span>
      <b class="num">{count(today)}<small> / 100k</small></b>
      <span class="track"><i style:width={today != null ? Math.min(100, (today / s.free.functionsPerDay) * 100) + "%" : "0"} style:background={level(today / s.free.functionsPerDay, 0.6, 0.85)}></i></span>
    </div>
    <div class="kpi panel">
      <span class="muted small">R2 storage</span>
      <b class="num">{bytes(r2Bytes)}<small> / 10 GB free</small></b>
      <span class="track"><i style:width={r2Bytes != null ? Math.min(100, (r2Bytes / s.free.r2Bytes) * 100) + "%" : "0"} style:background={level(r2Bytes / s.free.r2Bytes, 0.6, 0.85)}></i></span>
    </div>
  </div>

  <div class="sec-row">
    <h2 class="sec">Machines</h2>
    <span class="spacer"></span>
    <div class="ranges" role="group" aria-label="Chart range">
      {#each ["1h", "24h", "7d", "30d"] as r}<button class:on={systems.range === r} aria-pressed={systems.range === r} onclick={() => setRange(r)}>{r}</button>{/each}
    </div>
  </div>
  <div class="devices">
    {#each s.devices as m (m.name)}<DeviceCard {m} host={s.host} onforget={forget} onci={ci} onthreads={threads} />{/each}
  </div>
  {#if !s.configured.push}
    <p class="hint">Reporters need <code>DEVICE_TOKEN</code> in the factory's env first (<code>openssl rand -hex 32</code>), then each PC runs <code>machines/reporters/report-windows.ps1 -Install</code>.</p>
  {/if}

  <h2 class="sec">Website</h2>
  <div class="web">
    <section class="panel checks">
      <div class="panel-head"><h2>Uptime · 24 h</h2></div>
      <div class="panel-body">
        {#each s.checks as c (c.url)}
          <div class="check">
            <span class="cdot" style:background={!c.last ? "var(--line-2)" : c.last.ok ? "var(--teal)" : "var(--red)"}></span>
            <div class="cname">
              <a href={c.url} target="_blank" rel="noopener">{c.label}</a>
              <span class="muted small num">{c.last ? `${c.last.status ?? "no answer"}${c.last.ms != null ? ` · ${c.last.ms} ms` : ""}` : "checking…"}{c.detail ? ` · ${c.detail}` : ""}</span>
            </div>
            <span class="num small">{c.uptime != null ? (c.uptime * 100).toFixed(c.uptime === 1 ? 0 : 1) + "%" : ""}</span>
            <div class="ticks" aria-label={`${c.label}: ${c.points.length} checks`}>
              {#each c.points.slice(-72) as p}<i class:bad={!p.ok} title={`${new Date(p.at).toLocaleTimeString()} · ${p.ok ? p.ms + " ms" : "down"}`}></i>{/each}
            </div>
          </div>
        {/each}
      </div>
    </section>

    {#if !s.configured.cloudflare}
      <section class="panel setup-cf">
        <div class="panel-head"><h2>Traffic, Functions and R2</h2></div>
        <div class="panel-body small">
          <p>Make a Cloudflare API token with only <b>Account › Account Analytics: Read</b> and <b>Zone › Analytics: Read</b> (your site's zone only), then set <code>CF_API_TOKEN</code>, <code>CF_ACCOUNT_ID</code> and <code>CF_ZONE_ID</code> in the factory's env.</p>
          <p class="muted">This shows visitors, bandwidth and cache, the Functions requests that count against the free 100,000 a day (the updater's latest.json goes through one), and R2 storage and operations against the free tier.</p>
        </div>
      </section>
    {:else}
      <section class="panel">
        <div class="panel-head"><h2>Traffic · 7 days</h2><span class="spacer"></span><span class="muted small">{site?.at ? rel(site.at) : ""}</span></div>
        <div class="panel-body">
          {#if site?.traffic?.length}
            <BarChart title="Requests and visitors" labels={site.traffic.map((t) => day(t.date))} series={[{ name: "Requests", color: "var(--chart-1)", values: site.traffic.map((t) => t.requests) }, { name: "Visitors", color: "var(--chart-2)", values: site.traffic.map((t) => t.visitors) }]} format={count} />
            {@const sum = site.traffic.reduce((a, t) => ({ bytes: a.bytes + t.bytes, cached: a.cached + t.cachedBytes, threats: a.threats + t.threats, views: a.views + t.pageViews }), { bytes: 0, cached: 0, threats: 0, views: 0 })}
            <div class="mini-stats">
              <div><span class="muted small">Page views</span><b class="num">{count(sum.views)}</b></div>
              <div><span class="muted small">Bandwidth</span><b class="num">{bytes(sum.bytes)}</b></div>
              <div><span class="muted small">Served from cache</span><b class="num">{sum.bytes ? Math.round((sum.cached / sum.bytes) * 100) : 0}%</b></div>
              <div><span class="muted small">Threats blocked</span><b class="num">{count(sum.threats)}</b></div>
            </div>
          {:else}<div class="empty">No traffic data yet.</div>{/if}
        </div>
      </section>

      <section class="panel">
        <div class="panel-head"><h2>Free tier</h2></div>
        <div class="panel-body">
          {#if site?.functions?.length}
            <BarChart title="Functions requests a day (free: 100k)" labels={site.functions.map((f) => day(f.date))} series={[{ name: "Requests", color: "var(--chart-1)", values: site.functions.map((f) => f.requests) }]} format={count} />
          {/if}
          {#if site?.r2}
            {@const m = site.r2.month}
            <div class="quota">
              <div class="qrow"><span>R2 writes and lists (class A) this month</span><b class="num">{count(m.a)} / 1M</b></div>
              <span class="track"><i style:width={Math.min(100, (m.a / s.free.r2ClassA) * 100) + "%"} style:background={level(m.a / s.free.r2ClassA, 0.6, 0.85)}></i></span>
              <div class="qrow"><span>R2 reads (class B) this month</span><b class="num">{count(m.b)} / 10M</b></div>
              <span class="track"><i style:width={Math.min(100, (m.b / s.free.r2ClassB) * 100) + "%"} style:background={level(m.b / s.free.r2ClassB, 0.6, 0.85)}></i></span>
            </div>
            <div class="buckets">
              {#each site.r2.buckets as b (b.name)}
                <div class="bucket"><span class="mono small">{b.name}</span><span class="num small muted">{count(b.objects)} objects · {bytes(b.bytes)}</span></div>
              {:else}<div class="empty">No R2 buckets reported yet.</div>{/each}
            </div>
          {/if}
          {#if site?.problems?.length}<p class="warn small">Couldn't read: {site.problems.join("; ")}</p>{/if}
        </div>
      </section>
    {/if}
  </div>
  <h2 class="sec">Alert history</h2>
  <section class="panel">
    <div class="panel-body">
      {#each s.alerts?.recent ?? [] as a (a.id)}
        <div class="arow" class:open={!a.cleared_at}>
          <span class="adot" class:ok={a.cleared_at}></span>
          <span class="atext">{#each parts(a.text) as p, i}{#if i % 2}<b>{p}</b>{:else}{p}{/if}{/each}</span>
          <span class="muted small num">{new Date(a.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}{a.cleared_at ? ` · cleared ${rel(a.cleared_at)}` : " · ongoing"}</span>
        </div>
      {:else}
        <div class="empty">No alerts yet. Limits are in <button class="linkish" onclick={() => go("settings")}>Settings</button>.</div>
      {/each}
    </div>
  </section>
{/if}

<style>
  .loading { min-height: 50vh; display: grid; place-items: center; }
  .err { color: var(--red); }
  .spinner { width: 28px; height: 28px; border-radius: 50%; border: 3px solid var(--line-2); border-top-color: var(--accent); animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(1turn); } }
  .kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
  .kpi { padding: 14px 16px; display: grid; gap: 4px; }
  .kpi b { font-size: 24px; letter-spacing: -.02em; }
  .kpi b small { font-size: 13px; color: var(--muted); font-weight: 600; }
  .kpi.bad { border-color: color-mix(in srgb, var(--red) 50%, var(--line)); }
  .kpi.bad b { color: var(--red); }
  .kpi.warn { border-color: color-mix(in srgb, var(--amber) 45%, var(--line)); }
  .dots { display: flex; gap: 5px; }
  .dots i { width: 8px; height: 8px; border-radius: 50%; }
  .track { height: 6px; border-radius: 99px; background: var(--line); overflow: hidden; display: block; }
  .track i { display: block; height: 100%; border-radius: 99px; transition: width .6s; }
  .alerts { padding: 12px 16px; margin-bottom: 14px; border-color: color-mix(in srgb, var(--red) 50%, var(--line)); background: color-mix(in srgb, var(--red) 8%, var(--panel)); display: grid; gap: 6px; }
  .alerts ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 3px; font-size: 13px; }
  .adot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--red); margin-right: 8px; }
  .arow { display: grid; grid-template-columns: 14px 1fr auto; gap: 8px; align-items: center; padding: 7px 0; border-bottom: 1px solid var(--line); font-size: 13px; }
  .arow:last-child { border-bottom: 0; }
  .adot.ok { background: var(--teal); }
  .linkish { background: none; border: 0; padding: 0; color: var(--accent); cursor: pointer; font: inherit; }
  .sec-row { display: flex; align-items: center; gap: 10px; margin: 26px 2px 10px; }
  .sec-row .sec { margin: 0; }
  .spacer { flex: 1; }
  .ranges { display: inline-flex; padding: 3px; gap: 2px; border-radius: 10px; background: var(--bg-2); border: 1px solid var(--line); }
  .ranges button { border: 0; background: none; color: var(--muted); font: 650 12px var(--mono); padding: 3px 10px; border-radius: 7px; cursor: pointer; }
  .ranges button.on { background: var(--panel-2); color: var(--ink); box-shadow: 0 0 0 1px var(--line-2); }
  .sec { font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); margin: 26px 2px 10px; font-weight: 650; }
  .devices { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 14px; align-items: start; }
  .hint { font-size: 12.5px; color: var(--muted); }
  code { font-family: var(--mono); font-size: 11.5px; background: var(--bg-2); border: 1px solid var(--line); border-radius: 5px; padding: 0 4px; }
  .web { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; align-items: start; }
  .check { display: grid; grid-template-columns: 10px 1fr auto; gap: 4px 10px; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--line); }
  .check:last-child { border-bottom: 0; }
  .cdot { width: 9px; height: 9px; border-radius: 50%; }
  .cname { display: grid; min-width: 0; }
  .cname a { font-weight: 600; font-size: 13.5px; }
  .ticks { grid-column: 2 / -1; display: flex; gap: 2px; height: 16px; }
  .ticks i { flex: 1; max-width: 6px; border-radius: 2px; background: color-mix(in srgb, var(--teal) 65%, transparent); }
  .ticks i.bad { background: var(--red); }
  .mini-stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-top: 12px; }
  .mini-stats div { background: var(--bg-2); border: 1px solid var(--line); border-radius: 10px; padding: 8px 11px; display: grid; }
  .mini-stats b { font-size: 16px; }
  .quota { display: grid; gap: 5px; margin-top: 12px; }
  .qrow { display: flex; justify-content: space-between; gap: 10px; font-size: 12.5px; margin-top: 4px; }
  .buckets { margin-top: 12px; display: grid; gap: 4px; }
  .bucket { display: flex; justify-content: space-between; gap: 10px; padding: 5px 0; border-bottom: 1px solid var(--line); }
  .bucket:last-child { border-bottom: 0; }
  .setup-cf { grid-column: span 2; }
  .setup-cf p { margin: 0 0 8px; }
  .warn { color: var(--amber); margin: 10px 0 0; }
  @media (max-width: 1200px) { .kpis { grid-template-columns: repeat(2, 1fr); } .web { grid-template-columns: 1fr 1fr; } .checks { grid-column: 1 / -1; } }
  @media (max-width: 860px) { .web { grid-template-columns: 1fr; } .setup-cf { grid-column: auto; } .devices { grid-template-columns: 1fr; } .kpis { gap: 8px; } .kpi { padding: 10px 12px; gap: 2px; } .kpi b { font-size: 19px; } .kpi > :last-child:not(:first-child):not(b) { display: none; } }
</style>
