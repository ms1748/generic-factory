<script>
  // History from the factory's own database and GitHub: cards, PRs, runs, cost and plan usage, by day,
  // week or month (the last 180 days at most).
  import BarChart from "../components/BarChart.svelte";
  import { money } from "../lib/format.js";
  let { d } = $props();

  let data = $state(null);
  let error = $state("");
  let period = $state("week");
  $effect(() => {
    fetch("/api/data").then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.statusText)))).then((j) => (data = j)).catch((e) => (error = e.message));
  });

  const PERIODS = { day: { n: 30, label: "30 days" }, week: { n: 12, label: "12 weeks" }, month: { n: 6, label: "6 months" } };
  const tz = $derived(d.timezone);
  /** The start of the bucket a time falls in, as a key, in the project's time zone. */
  function key(iso, p) {
    const t = new Date(new Date(iso).toLocaleString("en-US", { timeZone: tz }));
    t.setHours(0, 0, 0, 0);
    if (p === "week") t.setDate(t.getDate() - ((t.getDay() + 6) % 7));
    if (p === "month") t.setDate(1);
    return t.getTime();
  }
  const buckets = $derived.by(() => {
    const now = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
    const out = [];
    for (let i = PERIODS[period].n - 1; i >= 0; i--) {
      const t = new Date(now);
      t.setHours(0, 0, 0, 0);
      if (period === "day") t.setDate(t.getDate() - i);
      if (period === "week") t.setDate(t.getDate() - ((t.getDay() + 6) % 7) - i * 7);
      if (period === "month") { t.setDate(1); t.setMonth(t.getMonth() - i); }
      out.push(t.getTime());
    }
    return out;
  });
  const label = (k) => new Date(k).toLocaleDateString("en-US", period === "month" ? { month: "short", year: "2-digit" } : { month: "short", day: "numeric" });
  const labels = $derived(buckets.map(label));
  function count(list, field, pred = () => true) {
    const idx = new Map(buckets.map((b, i) => [b, i]));
    const v = buckets.map(() => 0);
    for (const x of list) if (x[field] && pred(x)) { const i = idx.get(key(x[field], period)); if (i !== undefined) v[i]++; }
    return v;
  }
  function sum(list, field, val) {
    const idx = new Map(buckets.map((b, i) => [b, i]));
    const v = buckets.map(() => 0);
    for (const x of list) { const i = idx.get(key(x[field], period)); if (i !== undefined) v[i] += val(x); }
    return v;
  }
  function peak(list, field, val) {
    const idx = new Map(buckets.map((b, i) => [b, i]));
    const v = buckets.map(() => 0);
    for (const x of list) { const i = idx.get(key(x[field], period)); if (i !== undefined) v[i] = Math.max(v[i], val(x) ?? 0); }
    return v;
  }
  const from = $derived(buckets[0] ?? 0);
  const inRange = (iso) => iso && key(iso, period) >= from;
  const live = $derived(data ? data.runs.filter((r) => r.mode === "live") : []);
  const totals = $derived.by(() => {
    if (!data) return null;
    const runs = live.filter((r) => inRange(r.at));
    const done = runs.filter((r) => r.status === "done").length;
    const took = runs.filter((r) => r.minutes != null).map((r) => r.minutes);
    return {
      opened: data.issues.filter((i) => inRange(i.created)).length,
      closed: data.issues.filter((i) => inRange(i.closed)).length,
      mergedFactory: data.pulls.filter((p) => inRange(p.merged) && p.factory).length,
      mergedYou: data.pulls.filter((p) => inRange(p.merged) && !p.factory).length,
      runs: runs.length,
      doneRate: runs.length ? Math.round((done / runs.length) * 100) : null,
      cost: runs.reduce((a, r) => a + r.cost, 0),
      minutes: took.length ? Math.round(took.reduce((a, b) => a + b, 0) / took.length) : null,
    };
  });
  // PR scores (src/scores.ts): all time, every repo the factory serves.
  const sc = $derived(data?.scores ?? null);
  const avgScore = $derived(sc?.rows.length ? Math.round(sc.rows.reduce((a, r) => a + r.score, 0) / sc.rows.length) : null);
  const sizeLabel = (s) => (s === "none" ? "unsized" : s);
  const C1 = "var(--chart-1)";
  const C2 = "var(--chart-2)";
</script>

<div class="bar">
  <div class="seg" role="radiogroup" aria-label="Period">
    {#each Object.entries(PERIODS) as [p, info]}<button role="radio" aria-checked={period === p} class:on={period === p} onclick={() => (period = p)}>{p === "day" ? "Days" : p === "week" ? "Weeks" : "Months"}</button>{/each}
  </div>
  <span class="muted small">Last {PERIODS[period].label}. Cards and PRs from GitHub; runs, cost and plan usage from the factory's own database.</span>
</div>

{#if error}<p class="muted">Couldn't load the history: {error}</p>
{:else if !data || !totals}<p class="muted">Loading…</p>
{:else}
  <div class="tiles">
    <div class="tile"><b class="num">{totals.opened}</b><span>cards opened</span></div>
    <div class="tile"><b class="num">{totals.closed}</b><span>cards closed</span></div>
    <div class="tile"><b class="num">{totals.mergedFactory}</b><span>factory PRs merged</span></div>
    <div class="tile"><b class="num">{totals.mergedYou}</b><span>your PRs merged</span></div>
    <div class="tile"><b class="num">{totals.runs}</b><span>live runs{totals.doneRate != null ? ` · ${totals.doneRate}% done` : ""}</span></div>
    <div class="tile"><b class="num">{money(totals.cost)}</b><span>API-equivalent{totals.minutes != null ? ` · ~${totals.minutes} min a run` : ""}</span></div>
  </div>
  <div class="charts">
    <section class="panel"><div class="panel-body"><BarChart title="Cards opened and closed" {labels} series={[{ name: "Opened", color: C1, values: count(data.issues, "created") }, { name: "Closed", color: C2, values: count(data.issues, "closed") }]} /></div></section>
    <section class="panel"><div class="panel-body"><BarChart title="PRs merged" {labels} series={[{ name: "Factory", color: C1, values: count(data.pulls, "merged", (p) => p.factory) }, { name: "You", color: C2, values: count(data.pulls, "merged", (p) => !p.factory) }]} /></div></section>
    <section class="panel"><div class="panel-body"><BarChart title="Live runs" {labels} series={[{ name: "Done", color: C1, values: count(live, "at", (r) => r.status === "done") }, { name: "Not done", color: C2, values: count(live, "at", (r) => r.status !== "done") }]} /></div></section>
    <section class="panel"><div class="panel-body"><BarChart title="API-equivalent cost of live runs" {labels} format={(v) => "$" + v.toFixed(v >= 10 ? 0 : 2)} series={[{ name: "Cost", color: C1, values: sum(live, "at", (r) => r.cost) }]} /></div></section>
    <section class="panel wide"><div class="panel-body"><BarChart title="Peak plan usage (week window), %" {labels} format={(v) => Math.round(v) + "%"} series={[{ name: "Week", color: C1, values: peak(data.usage, "at", (u) => (u.week ?? 0) * 100) }]} /></div></section>
  </div>
  {#if sc}
    <section class="panel scores">
      <div class="panel-head"><h2>PR scores by lane, model and size</h2><span class="spacer"></span><span class="muted small">All time · {sc.rows.length} merged factory PR{sc.rows.length === 1 ? "" : "s"}{avgScore != null ? ` · average ${avgScore}` : ""}</span></div>
      <div class="panel-body">
        {#if !sc.rows.length}<p class="muted">No merged factory PRs scored yet. The dispatcher scores them a few at a time, every 5 minutes.</p>
        {:else}
          {#if sc.advice.length}<ul class="advice">{#each sc.advice as a}<li>{a}</li>{/each}</ul>{/if}
          <div class="tbl"><table>
            <thead><tr><th>Size</th><th>Lane</th><th>Model</th><th class="r">PRs</th><th class="r">Score</th><th class="r">Cost a PR</th><th class="r">Review rounds</th><th class="r">Reverted</th></tr></thead>
            <tbody>{#each sc.groups as g}<tr><td>{sizeLabel(g.size)}</td><td>{g.lane}</td><td>{g.model}</td><td class="r num">{g.prs}</td><td class="r num"><b>{g.score}</b></td><td class="r num">{g.cost != null ? money(g.cost) : "–"}</td><td class="r num">{g.rounds}</td><td class="r num">{g.reverted || "–"}</td></tr>{/each}</tbody>
          </table></div>
          <details>
            <summary>Every PR ({sc.rows.length})</summary>
            <div class="tbl"><table>
              <thead><tr><th>PR</th><th>Size</th><th>Model</th><th class="r">Score</th><th>Points off</th></tr></thead>
              <tbody>{#each sc.rows as r}<tr><td>{d.repos?.length > 1 ? `${r.repo.split("/")[1]} ` : ""}#{r.pr} {r.title}</td><td>{sizeLabel(r.size)}</td><td>{r.model}</td><td class="r num"><b>{r.score}</b></td><td class="muted">{r.parts.length ? r.parts.map((p) => `−${p.points} ${p.why}`).join(" · ") : "none"}</td></tr>{/each}</tbody>
            </table></div>
          </details>
        {/if}
        <details>
          <summary>How the score works</summary>
          <ul class="formula">{#each sc.formula as line}<li>{line}</li>{/each}</ul>
        </details>
      </div>
    </section>
  {/if}
{/if}

<style>
  .bar { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-bottom: 14px; }
  .seg { display: inline-flex; border: 1px solid var(--line-2); border-radius: 9px; overflow: hidden; }
  .seg button { background: none; border: 0; padding: 5px 14px; font-size: 12.5px; font-weight: 650; color: var(--muted); cursor: pointer; }
  .seg button + button { border-left: 1px solid var(--line-2); }
  .seg button.on { background: var(--accent); color: #fff; }
  .tiles { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
  .tile { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; display: grid; gap: 2px; }
  .tile b { font-size: 24px; letter-spacing: -.01em; }
  .tile span { font-size: 12px; color: var(--muted); }
  .charts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
  .wide { grid-column: 1 / -1; }
  .scores { margin-top: 16px; }
  .scores .r { text-align: right; padding-left: 10px; }
  .scores details { margin-top: 10px; }
  .scores summary { cursor: pointer; font-size: 12.5px; font-weight: 650; color: var(--muted); }
  .advice, .formula { margin: 0 0 8px; padding-left: 18px; font-size: 13px; display: grid; gap: 4px; }
  .formula { margin-top: 8px; color: var(--muted); }
  @media (max-width: 1100px) { .tiles { grid-template-columns: repeat(3, 1fr); } }
  @media (max-width: 860px) { .charts { grid-template-columns: 1fr; } .tiles { grid-template-columns: repeat(2, 1fr); } }
</style>
