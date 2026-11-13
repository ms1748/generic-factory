<script>
  // A round gauge: value 0..1, the arc coloured by how full it is, the label in the middle.
  let { value = null, label, sub = "", color = "var(--teal)", size = 76 } = $props();
  const R = 15.5;
  const C = 2 * Math.PI * R;
  const v = $derived(value == null ? 0 : Math.max(0, Math.min(1, value)));
</script>

<div class="ring" style:width={size + "px"} role="meter" aria-label={label} aria-valuemin="0" aria-valuemax="100" aria-valuenow={value == null ? undefined : Math.round(v * 100)}>
  <svg viewBox="0 0 36 36" aria-hidden="true">
    <circle cx="18" cy="18" r={R} class="track" />
    {#if value != null}
      <circle cx="18" cy="18" r={R} class="arc" stroke={color} stroke-dasharray={`${v * C} ${C}`} />
    {/if}
  </svg>
  <div class="mid">
    <b class="num">{value == null ? "–" : Math.round(v * 100)}<small>{value == null ? "" : "%"}</small></b>
  </div>
  <span class="lbl">{label}</span>
  {#if sub}<span class="sub num">{sub}</span>{/if}
</div>

<style>
  .ring { position: relative; display: grid; justify-items: center; gap: 2px; max-width: 100%; justify-self: center; }
  svg { width: 100%; transform: rotate(-90deg); overflow: visible; }
  .track { fill: none; stroke: var(--line); stroke-width: 3.2; }
  .arc { fill: none; stroke-width: 3.2; stroke-linecap: round; transition: stroke-dasharray .8s cubic-bezier(.2, .8, .2, 1), stroke .4s; filter: drop-shadow(0 0 3px color-mix(in srgb, currentColor 30%, transparent)); }
  .mid { position: absolute; inset: 0 0 auto 0; aspect-ratio: 1; display: grid; place-items: center; }
  .mid b { font-size: 17px; letter-spacing: -.02em; }
  .mid small { font-size: 10px; color: var(--muted); margin-left: 1px; }
  .lbl { font-size: 11.5px; font-weight: 650; color: var(--ink-2); }
  .sub { font-size: 11px; color: var(--muted); white-space: nowrap; }
</style>
