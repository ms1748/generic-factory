<script>
  // Bars per time bucket for one or two series (side by side, never stacked across scales), with a
  // hover tooltip, a legend for two series, and a table view. One y-axis, starting at zero.
  let { title, labels, series, format = (v) => String(v) } = $props();

  const H = 150;
  let hover = $state(-1);
  let table = $state(false);
  const max = $derived(Math.max(1, ...series.flatMap((s) => s.values)));
  const ticks = $derived([0, max / 2, max].map((v) => Math.round(v * 100) / 100));
  const step = $derived(labels.length ? 100 / labels.length : 100);
  const barW = $derived(Math.max(0.6, (step - 1.2) / series.length - 0.4));
</script>

<figure class="chart">
  <figcaption>
    <span class="t">{title}</span>
    {#if series.length > 1}
      <span class="legend">{#each series as s}<span><i style:background={s.color}></i>{s.name}</span>{/each}</span>
    {/if}
    <button class="btn ghost sm" onclick={() => (table = !table)}>{table ? "Chart" : "Table"}</button>
  </figcaption>
  {#if table}
    <div class="tbl"><table>
      <thead><tr><th></th>{#each series as s}<th>{s.name}</th>{/each}</tr></thead><tbody>
      {#each labels as l, i}<tr><td>{l}</td>{#each series as s}<td class="num">{format(s.values[i])}</td>{/each}</tr>{/each}
    </tbody></table></div>
  {:else}
    <div class="plot" role="img" aria-label={`${title}: ${series.map((s) => s.name + " " + s.values.map(format).join(", ")).join("; ")}`}>
      <div class="y">{#each [...ticks].reverse() as t}<span class="num">{format(t)}</span>{/each}</div>
      <div class="area" onmouseleave={() => (hover = -1)} role="presentation">
        <svg viewBox="0 0 100 {H}" preserveAspectRatio="none" aria-hidden="true">
          {#each [0.5, 1] as g}<line x1="0" x2="100" y1={H - g * H} y2={H - g * H} class="grid" />{/each}
          {#each labels as _, i}
            {#if hover === i}<rect x={i * step} y="0" width={step} height={H} class="hl" />{/if}
            {#each series as s, k}
              {@const v = s.values[i] ?? 0}
              {@const h = (v / max) * (H - 4)}
              {#if v > 0}<rect x={i * step + 0.6 + k * (barW + 0.4)} y={H - h} width={barW} height={h} rx="0.6" fill={s.color} />{/if}
            {/each}
            <rect x={i * step} y="0" width={step} height={H} fill="transparent" onmouseenter={() => (hover = i)} role="presentation" />
          {/each}
          <line x1="0" x2="100" y1={H} y2={H} class="base" />
        </svg>
        {#if hover >= 0}
          <div class="tip" style:left={`min(calc(${(hover + 0.5) * step}% ), calc(100% - 150px))`}>
            <b>{labels[hover]}</b>
            {#each series as s}<div><i style:background={s.color}></i>{s.name} <span class="num">{format(s.values[hover] ?? 0)}</span></div>{/each}
          </div>
        {/if}
        <div class="x">
          <span>{labels[0] ?? ""}</span><span>{labels[Math.floor(labels.length / 2)] ?? ""}</span><span>{labels.at(-1) ?? ""}</span>
        </div>
      </div>
    </div>
  {/if}
</figure>

<style>
  .chart { margin: 0; }
  figcaption { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
  .t { font-weight: 650; font-size: 13.5px; }
  .legend { display: flex; gap: 12px; font-size: 12px; color: var(--ink-2); margin-left: auto; }
  .legend i, .tip i { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 5px; }
  figcaption .btn { margin-left: auto; }
  .legend + .btn { margin-left: 0; }
  .plot { display: grid; grid-template-columns: 40px 1fr; gap: 6px; }
  .y { display: flex; flex-direction: column; justify-content: space-between; height: 150px; font-size: 11px; color: var(--muted); text-align: right; }
  .area { position: relative; }
  svg { width: 100%; height: 150px; display: block; }
  .grid { stroke: var(--line); stroke-width: 1; vector-effect: non-scaling-stroke; stroke-dasharray: 3 3; }
  .base { stroke: var(--line-2); stroke-width: 1; vector-effect: non-scaling-stroke; }
  .hl { fill: var(--panel-2); }
  .x { display: flex; justify-content: space-between; font-size: 11px; color: var(--muted); margin-top: 4px; }
  .tip { position: absolute; top: 4px; transform: translateX(8px); background: var(--panel-2); border: 1px solid var(--line-2); border-radius: 8px; padding: 6px 10px; font-size: 12px; pointer-events: none; min-width: 140px; box-shadow: var(--shadow); z-index: 2; }
  .tip b { display: block; margin-bottom: 2px; }
</style>
