<script>
  // The scheduled runs ahead, grouped by day: when, which lane, live or dry.
  import { time } from "../lib/format.js";
  let { d, limit = 0 } = $props();
  const color = { builder: "var(--violet)", maintainer: "var(--teal)", ideas: "var(--amber)", security: "var(--pink)" };
  const items = $derived(limit ? d.upcoming.slice(0, limit) : d.upcoming);
  const days = $derived.by(() => {
    const out = [];
    for (const u of items) {
      const day = new Date(u.at).toLocaleDateString("en-US", { timeZone: d.timezone, weekday: "long", month: "short", day: "numeric" });
      if (out.at(-1)?.day !== day) out.push({ day, runs: [] });
      out.at(-1).runs.push(u);
    }
    return out;
  });
</script>

<div class="tl">
{#each days as g (g.day)}
  <div class="day">
    <div class="d muted small">{g.day}</div>
    <div class="runs">
      {#each g.runs as u}
        <div class="slot" style:--c={color[u.kind] ?? "var(--muted)"}>
          <span class="t num">{time(u.at, d.timezone, { weekday: undefined })}</span>
          <span class="bar"></span>
          <span class="l">{u.lane}{#if u.repo && u.repo !== d.repo}<span class="muted"> · {u.repo.split("/").pop()}</span>{/if}</span>
          <span class="chip" class:live={u.live}>{u.live ? "live" : "dry"}</span>
        </div>
      {/each}
    </div>
  </div>
{:else}
  <div class="empty">No runs scheduled: every lane is off.</div>
{/each}
</div>

<style>
  .tl { container-type: inline-size; }
  .day { display: grid; grid-template-columns: 150px 1fr; gap: 12px; padding: 6px 0; border-bottom: 1px solid var(--line); }
  .day:last-child { border-bottom: 0; }
  .d { padding-top: 6px; }
  .runs { display: flex; flex-wrap: wrap; gap: 8px; }
  .slot { display: inline-flex; align-items: center; gap: 8px; padding: 5px 10px; border-radius: 9px; background: var(--panel-2); border: 1px solid var(--line); font-size: 13px; }
  .bar { width: 3px; height: 16px; border-radius: 2px; background: var(--c); }
  .t { color: var(--muted); font-size: 12.5px; min-width: 62px; }
  .l { font-weight: 600; white-space: nowrap; }
  .slot { white-space: nowrap; }
  @container (max-width: 560px) { .day { grid-template-columns: 1fr; gap: 6px; } .d { padding-top: 2px; } }
  @media (max-width: 860px) { .day { grid-template-columns: 1fr; } }
</style>
