<script>
  // A small area chart of 0..1 values (or `max` for others), with a hover readout. Gaps stay gaps.
  let { points = [], color = "var(--violet)", max = 1, height = 44, format = (v) => Math.round(v * 100) + "%", label = "" } = $props();
  let hover = $state(-1);
  const W = 100;
  const top = $derived(Math.max(max, ...points.map((p) => p.v ?? 0)));
  const xy = $derived(points.map((p, i) => (p.v == null ? null : [points.length > 1 ? (i / (points.length - 1)) * W : W / 2, height - 2 - (p.v / top) * (height - 4)])));
  // One path per run of points without gaps.
  const runs = $derived.by(() => {
    const out = [];
    let cur = [];
    for (const p of xy) {
      if (p) cur.push(p);
      else if (cur.length) (out.push(cur), (cur = []));
    }
    if (cur.length) out.push(cur);
    return out;
  });
  const id = `g${Math.random().toString(36).slice(2, 8)}`;
  function move(e) {
    const r = e.currentTarget.getBoundingClientRect();
    hover = Math.round(((e.clientX - r.left) / r.width) * (points.length - 1));
  }
</script>

<div class="spark" role="img" aria-label={label} onmousemove={move} onmouseleave={() => (hover = -1)}>
  <svg viewBox="0 0 {W} {height}" preserveAspectRatio="none" style:height={height + "px"} aria-hidden="true">
    <defs>
      <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stop-color={color} stop-opacity=".35" />
        <stop offset="1" stop-color={color} stop-opacity="0" />
      </linearGradient>
    </defs>
    {#each runs as r}
      {#if r.length > 1}
        <path d={`M${r.map((p) => p.join(",")).join("L")}L${r.at(-1)[0]},${height}L${r[0][0]},${height}Z`} fill={`url(#${id})`} />
        <path d={`M${r.map((p) => p.join(",")).join("L")}`} fill="none" stroke={color} stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round" />
      {:else}
        <circle cx={r[0][0]} cy={r[0][1]} r="1.2" fill={color} />
      {/if}
    {/each}
    {#if hover >= 0 && xy[hover]}
      <line x1={xy[hover][0]} x2={xy[hover][0]} y1="0" y2={height} class="cursor" vector-effect="non-scaling-stroke" />
    {/if}
  </svg>
  {#if hover >= 0 && points[hover]}
    <span class="tip num" style:left={`${(hover / Math.max(1, points.length - 1)) * 100}%`}>
      {points[hover].v == null ? "no data" : format(points[hover].v)} · {new Date(points[hover].at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
    </span>
  {/if}
</div>

<style>
  .spark { position: relative; width: 100%; }
  svg { display: block; width: 100%; }
  .cursor { stroke: var(--ink-2); stroke-width: 1; opacity: .5; }
  .tip { position: absolute; top: -22px; transform: translateX(-50%); white-space: nowrap; font-size: 11px; padding: 1px 7px; border-radius: 6px; background: var(--ink); color: var(--bg); pointer-events: none; z-index: 2; }
</style>
