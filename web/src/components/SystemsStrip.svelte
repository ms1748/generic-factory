<script>
  // The overview's line of machines and the website: one tile each, live, linking to Systems.
  import { go } from "../lib/ui.svelte.js";
  import Spark from "./Spark.svelte";
  import { bytes, count, level, systems, uptime, watchSystems } from "../lib/systems.svelte.js";
  $effect(() => watchSystems());
  const s = $derived(systems.data);
  const site = $derived(s?.checks?.[0]);
  const updater = $derived(s?.checks?.[1]);
  const fnToday = $derived(s?.site?.functions?.at(-1)?.requests ?? null);
</script>

<section class="panel">
  <div class="panel-head"><h2>Systems</h2><span class="spacer"></span><button class="btn ghost sm" onclick={() => go("systems")}>Systems →</button></div>
  <div class="panel-body strip">
    {#if !s}
      <div class="empty">Loading machines…</div>
    {:else}
      {#each s.devices as m (m.name)}
        {@const mem = m.memTotal ? m.memUsed / m.memTotal : null}
        <button class="tile" class:off={!m.online} onclick={() => go("systems")}>
          <div class="top"><i class="dot" class:on={m.online}></i><b>{m.name}</b><span class="muted small">{m.online ? uptime(m.uptime) : m.lastSeen ? "offline" : "not set up"}</span></div>
          <div class="meters">
            <span>CPU</span><span class="track"><i style:width={(m.cpu ?? 0) * 100 + "%"} style:background={level(m.cpu)}></i></span><span class="num">{m.cpu != null ? Math.round(m.cpu * 100) + "%" : "–"}</span>
            <span>RAM</span><span class="track"><i style:width={(mem ?? 0) * 100 + "%"} style:background={level(mem, 0.8, 0.92)}></i></span><span class="num">{mem != null ? Math.round(mem * 100) + "%" : "–"}</span>
          </div>
          {#if m.history?.length > 1}<div class="spk"><Spark points={m.history.map((h) => ({ at: h.at, v: h.cpu }))} height={26} color="var(--violet)" label={`${m.name} CPU, 24 hours`} /></div>{/if}
          {#if m.temp != null}<span class="muted small num">{Math.round(m.temp)} °C{m.guests?.length ? ` · ${m.guests.filter((g) => g.status === "running").length} containers up` : ""}</span>
          {:else if m.guests?.length}<span class="muted small">{m.guests.filter((g) => g.status === "running").length} containers up</span>{/if}
        </button>
      {/each}
      <button class="tile" class:bad={site?.last && !site.last.ok} onclick={() => go("systems")}>
        <div class="top"><i class="dot" class:on={site?.last?.ok} class:down={site?.last && !site.last.ok}></i><b>{site?.label ?? "Site"}</b><span class="muted small num">{site?.last?.ms != null ? site.last.ms + " ms" : ""}</span></div>
        <div class="kv"><span class="muted">Updater</span><span>{updater?.detail ?? "–"}</span></div>
        <div class="kv"><span class="muted">Functions today</span><span class="num">{count(fnToday)} / 100k</span></div>
        <div class="kv"><span class="muted">R2</span><span class="num">{s.site?.r2 ? bytes(s.site.r2.buckets.reduce((a, b) => a + b.bytes, 0)) : "–"}</span></div>
      </button>
    {/if}
  </div>
</section>

<style>
  .strip { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 10px; }
  .tile { display: grid; gap: 7px; text-align: left; background: var(--bg-2); border: 1px solid var(--line); border-radius: 12px; padding: 11px 12px; cursor: pointer; min-width: 0; transition: border-color .15s, transform .15s; }
  .tile:hover { border-color: var(--accent); transform: translateY(-1px); }
  .tile.off { opacity: .6; }
  .tile.bad { border-color: color-mix(in srgb, var(--red) 55%, var(--line)); }
  .top { display: flex; align-items: center; gap: 7px; }
  .top b { flex: 1; font-size: 13.5px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--line-2); }
  .dot.on { background: var(--teal); }
  .dot.down { background: var(--red); }
  .meters { display: grid; grid-template-columns: 30px 1fr 34px; gap: 4px 8px; align-items: center; font-size: 11.5px; color: var(--muted); }
  .meters .num { text-align: right; color: var(--ink-2); }
  .track { height: 5px; border-radius: 99px; background: var(--line); overflow: hidden; display: block; }
  .track i { display: block; height: 100%; border-radius: 99px; transition: width .6s; }
  .kv { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; }
  @media (max-width: 760px) { .strip { grid-template-columns: 1fr 1fr; gap: 8px; } .tile { padding: 9px 10px; gap: 5px; } .spk, .tile .small.muted:last-child { display: none; } }
</style>
