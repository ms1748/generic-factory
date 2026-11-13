<script>
  // Crash and problem reports from GlitchTip: what broke for players, how often, and when last. Each row
  // opens the issue in GlitchTip (behind your Access sign-in), where you resolve or comment on it.
  import { rel, time } from "../lib/format.js";
  let { d } = $props();

  let data = $state(null);
  let failed = $state("");
  let kind = $state("all");
  let status = $state("unresolved");

  async function pull(fresh = false) {
    try {
      const res = await fetch(`/api/reports${fresh ? "?fresh=1" : ""}`, { cache: "no-store" });
      data = await res.json();
      failed = "";
    } catch (e) {
      failed = e.message;
    }
  }
  $effect(() => {
    pull();
    const t = setInterval(() => document.hidden || pull(), 120_000);
    return () => clearInterval(t);
  });

  const list = $derived((data?.issues ?? []).filter((r) => (kind === "all" || r.kind === kind) && (status === "all" || r.status === status)));
  const open = $derived((data?.issues ?? []).filter((r) => r.status === "unresolved"));
  const crashes = $derived(open.filter((r) => r.kind === "crash").length);
  const problems = $derived(open.filter((r) => r.kind === "problem").length);
  const week = $derived(open.filter((r) => Date.now() - Date.parse(r.lastSeen) < 7 * 86_400_000).length);
</script>

<div class="head">
  <div class="stats">
    <div><b class="num" class:bad={crashes}>{crashes}</b><span>open crashes</span></div>
    <div><b class="num">{problems}</b><span>open problem reports</span></div>
    <div><b class="num">{week}</b><span>seen this week</span></div>
  </div>
  <span class="spacer"></span>
  <button class="btn ghost" onclick={() => pull(true)}>Refresh</button>
  {#if data?.url}<a class="btn primary" href={data.url} target="_blank" rel="noopener">Open GlitchTip</a>{/if}
</div>

<section class="panel">
  <div class="panel-head">
    <div class="seg" role="radiogroup" aria-label="Kind">
      {#each [["all", "All"], ["crash", "Crashes"], ["problem", "Problem reports"]] as [k, label]}
        <button role="radio" aria-checked={kind === k} class:on={kind === k} onclick={() => (kind = k)}>{label}</button>
      {/each}
    </div>
    <div class="seg" role="radiogroup" aria-label="Status">
      {#each [["unresolved", "Open"], ["resolved", "Resolved"], ["all", "Any"]] as [k, label]}
        <button role="radio" aria-checked={status === k} class:on={status === k} onclick={() => (status = k)}>{label}</button>
      {/each}
    </div>
    <span class="spacer"></span>
    {#if data?.at}<span class="muted small">checked {rel(data.at)}</span>{/if}
  </div>
  <div class="panel-body">
    {#if failed || data?.error}
      <p class="err">Couldn't read GlitchTip: {failed || data.error}. The list below may be old.</p>
    {/if}
    {#if data && !data.configured}
      <div class="empty">Reports are off. Set GlitchTip's address and organization in Settings › Install, and <code>GLITCHTIP_TOKEN</code> (a read-only token) in the factory's env.</div>
    {:else if !data}
      <div class="empty">Reading GlitchTip…</div>
    {:else}
      {#each list as r (r.id)}
        <a class="row" href={r.link} target="_blank" rel="noopener">
          <i class="sdot" class:fail={r.kind === "crash" && r.status === "unresolved"} class:wait={r.kind === "problem" && r.status === "unresolved"}></i>
          <span class="main">
            <span class="title">{r.title}</span>
            <span class="muted small">{r.shortId}{r.culprit ? ` · ${r.culprit}` : ""}</span>
          </span>
          <span class="kind">{r.kind === "crash" ? "crash" : "problem report"}</span>
          <span class="num count" title="Times it happened">{r.count}×</span>
          <span class="muted small when" title={`First seen ${time(r.firstSeen, d.timezone)}`}>{rel(r.lastSeen)}</span>
        </a>
      {:else}
        <div class="empty">{kind === "all" && status === "unresolved" ? "No open reports. Nothing has crashed lately." : "Nothing matches."}</div>
      {/each}
    {/if}
  </div>
</section>
<p class="muted small foot">Crash reports come from players who turned them on; problem reports only when someone presses Send. Both have keys, folders and names taken out before they leave the PC, and GlitchTip deletes them after 90 days. The maintainer lane reads the same list to file cards.</p>

<style>
  .head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 14px; }
  .stats { display: flex; gap: 28px; }
  .stats div { display: grid; }
  .stats b { font-size: 22px; font-weight: 500; }
  .stats b.bad { color: var(--fail); }
  .stats span { font-size: 12px; color: var(--muted); }
  .spacer { flex: 1; }
  .seg { display: inline-flex; padding: 2px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg-2); }
  .seg button { border: 0; background: none; color: var(--muted); padding: 3px 10px; border-radius: 6px; cursor: pointer; font-size: 12.5px; }
  .seg button.on { background: var(--panel-2); color: var(--ink); }
  .row { display: grid; grid-template-columns: 8px minmax(0, 1fr) auto 48px 80px; align-items: center; gap: 12px; padding: 9px 4px; border-top: 1px solid var(--line); color: var(--ink); }
  .row:first-child { border-top: 0; }
  .row:hover { background: var(--panel-2); color: var(--ink); }
  .main { display: grid; min-width: 0; }
  .title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .main .small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--mono); font-size: 11.5px; }
  .kind { font-size: 12px; color: var(--muted); }
  .count { text-align: right; font-size: 12.5px; }
  .when { text-align: right; }
  .err { color: var(--fail); font-size: 12.5px; margin: 0 0 8px; }
  .foot { margin: 10px 2px 0; max-width: 760px; }
  code { font-family: var(--mono); font-size: 12px; }
  @media (max-width: 760px) { .row { grid-template-columns: 8px minmax(0, 1fr) 48px; } .kind, .when { display: none; } .stats { gap: 18px; } }
</style>
