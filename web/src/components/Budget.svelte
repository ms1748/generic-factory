<script>
  import { money, pct, rel, time } from "../lib/format.js";
  import { control } from "../lib/api.svelte.js";
  let { d } = $props();
  const u = $derived(d.usage);
  const rows = $derived([
    { label: "5-hour window", w: u?.fiveHour, limit: d.limits.fiveHour },
    { label: "This week", w: u?.sevenDay, limit: d.limits.sevenDay },
  ]);
</script>

<section class="panel">
  <div class="panel-head"><h2>Budget</h2><span class="spacer"></span><span class="muted as-of">{u ? `as of ${rel(u.at)}` : "no report yet"}</span></div>
  <div class="panel-body">
    {#each rows as r}
      <div class="meter">
        <div class="row"><span>{r.label}</span><b class="num">{r.w ? pct(r.w.utilization) : "–"}</b></div>
        <div class="bar" role="meter" aria-label={r.label} aria-valuemin="0" aria-valuemax="100" aria-valuenow={r.w ? Math.round(r.w.utilization * 100) : 0}>
          <i class:warn={r.w && r.w.utilization >= r.limit * 0.8} class:over={r.w && r.w.utilization >= r.limit} style:width={r.w ? Math.min(100, r.w.utilization * 100) + "%" : "0"}></i>
          <span class="limit" style:left={r.limit * 100 + "%"} title="The factory starts no new run past this"></span>
        </div>
        <div class="muted small">{r.w ? `resets ${time(r.w.resetsAt, d.timezone)} (${rel(r.w.resetsAt)})` : "fills in after the next usage check"} · stops at {pct(r.limit)}</div>
      </div>
    {/each}
    <div class="spend">
      <div><span class="muted small">Last 24 h</span><b class="num">{money(d.spend.day.costUsd)}</b><span class="muted small">{d.spend.day.runs} live run{d.spend.day.runs === 1 ? "" : "s"}</span></div>
      <div><span class="muted small">Last 7 days</span><b class="num">{money(d.spend.week.costUsd)}</b><span class="muted small">{d.spend.week.runs} live run{d.spend.week.runs === 1 ? "" : "s"}</span></div>
    </div>
    <label class="credits">
      <input type="checkbox" checked={d.allowCredits} onchange={(e) => control("settings/credits", { on: e.currentTarget.checked })} />
      <span><b>Use paid credits</b><span class="muted small">{d.allowCredits ? "Runs keep going on your extra-usage credits when the plan runs out." : "Off: a run stops the moment the plan runs out, so credits are never spent."}</span></span>
    </label>
    <p class="muted small foot">Usage is your whole Claude plan, your own sessions included. Dollar amounts are what the same use would cost on the API; Pro isn't billed per run.</p>
    {#if d.pause}<div class="note">Paused: {d.pause.reason}, until {time(d.pause.until, d.timezone)}.</div>{/if}
  </div>
</section>

<style>
  .as-of { font-size: 12px; }
  .meter { margin-bottom: 14px; }
  .row { display: flex; justify-content: space-between; font-size: 13px; }
  .row b { font-weight: 500; }
  .bar { position: relative; height: 6px; border-radius: 99px; background: var(--line-2); overflow: hidden; margin: 6px 0 4px; }
  .bar i { position: absolute; inset: 0 auto 0 0; border-radius: 99px; background: var(--ink-2); transition: width .6s; }
  .bar i.warn { background: var(--amber); }
  .bar i.over { background: var(--red); }
  .limit { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--ink); opacity: .5; }
  .small { font-size: 12px; }
  .spend { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; border-top: 1px solid var(--line); padding-top: 12px; }
  .spend div { display: grid; }
  .spend div + div { border-left: 1px solid var(--line); padding-left: 12px; }
  .spend b { font-size: 17px; font-weight: 500; }
  .foot { margin: 10px 0 0; }
  .credits { display: flex; gap: 10px; align-items: flex-start; margin-top: 12px; cursor: pointer; }
  .credits input { margin-top: 3px; accent-color: var(--accent); }
  .credits > span { display: grid; gap: 1px; font-size: 13px; }
  .note { margin-top: 10px; font-size: 12.5px; color: var(--wait); }
</style>
