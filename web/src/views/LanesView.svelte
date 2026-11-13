<script>
  // Lanes: one row per lane, grouped by repo (each repo's own .factory.yml). Who it is, a 24-hour strip of when it runs (with now marked), what it would
  // take next and how it has done, and Off / Dry / Live plus Run now. The next two days are below.
  import { control } from "../lib/api.svelte.js";
  import { gh, rel, time } from "../lib/format.js";
  import Timeline from "../components/Timeline.svelte";
  let { d, confirm, openPrompt } = $props();
  const pct = (x) => Math.round(x * 100) + "%";

  const modeOf = (l) => (!l.enabled ? "off" : l.live ? "live" : "dry");
  const repoOf = (l) => l.repo ?? d.repo;
  // Each repo's lanes together, the primary's first.
  const groups = $derived.by(() => {
    const out = [];
    for (const l of d.lanes) {
      const r = repoOf(l);
      if (out.at(-1)?.repo !== r) out.push({ repo: r, source: l.configSource ?? d.configSource, lanes: [] });
      out.at(-1).lanes.push(l);
    }
    return out;
  });
  // The lane's name, with its repo when the factory serves more than one.
  const label = (l) => (groups.length > 1 ? `${repoOf(l).split("/").pop()} ${l.name}` : l.name);
  function setMode(l, mode) {
    if (mode === modeOf(l)) return;
    const body = { mode, repo: repoOf(l) };
    if (mode !== "live") return control(`lanes/${l.name}/mode`, body);
    confirm({
      title: `Switch ${label(l)} to live?`,
      body: "Its scheduled runs start Claude for real and use your Claude plan.",
      yes: "Go live",
      action: () => control(`lanes/${l.name}/mode`, body),
    });
  }
  function runNow(l) {
    const body = { repo: repoOf(l) };
    if (!l.live) return control(`lanes/${l.name}/run`, body, `${label(l)}: dry run queued`);
    confirm({ title: `Run ${label(l)} now?`, body: "It's live: this starts Claude and uses your Claude plan.", yes: "Run now", action: () => control(`lanes/${l.name}/run`, body, `${label(l)} starts next`) });
  }

  const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  // The lane's times as minutes of the day for today (in the factory's time zone), and a short summary.
  function parse(schedule) {
    return schedule
      .map((e) => e.trim().toLowerCase().match(/^(?:([a-z,]+)\s+)?(\d{1,2}):(\d{2})$/))
      .filter(Boolean)
      .map((m) => ({ days: m[1] ? m[1].split(",").map((x) => DAYS.indexOf(x.slice(0, 3))) : null, min: Number(m[2]) * 60 + Number(m[3]) }));
  }
  function summary(schedule) {
    const s = parse(schedule);
    if (!s.length) return "on demand";
    const every = s.every((x) => !x.days) && s.length >= 12;
    if (every && s.length === 24) {
      const mm = String(s[0].min % 60).padStart(2, "0");
      return s.every((x) => x.min % 60 === s[0].min % 60) ? `every hour at :${mm}` : `${s.length} times a day`;
    }
    if (every) return `${s.length} times a day`;
    return schedule.join(", ");
  }
  const zoned = $derived(new Date(new Date(d.now).toLocaleString("en-US", { timeZone: d.timezone })));
  const nowMin = $derived(zoned.getHours() * 60 + zoned.getMinutes());
  const today = $derived(zoned.getDay());
  const ticks = (schedule) => parse(schedule).filter((x) => !x.days || x.days.includes(today)).map((x) => x.min);
</script>

<section class="panel lanes">
  <div class="hours" aria-hidden="true">
    <span></span>
    <div class="scale">{#each [0, 6, 12, 18] as h}<span style:left="{(h / 24) * 100}%">{String(h).padStart(2, "0")}:00</span>{/each}</div>
    <span></span>
  </div>
  {#each groups as g (g.repo)}
  {#if groups.length > 1}
    <div class="repo"><a href={`https://github.com/${g.repo}`} target="_blank" rel="noopener">{g.repo}</a><span class="muted small">{g.source}</span></div>
  {/if}
  {#each g.lanes as l (l.name)}
    {@const queued = d.queuedRuns.some((q) => q.lane === l.name && !q.card && (q.repo ?? d.repo) === g.repo)}
    {@const mode = modeOf(l)}
    {@const running = (d.runningAll ?? []).filter((r) => r.lane === l.name && (r.repo ?? d.repo) === g.repo)}
    <div class="lane" class:off={mode === "off"}>
      <div class="who">
        <div class="name"><i class="sdot" class:run={running.length} class:live={running.length} class:queue={!running.length && mode === "live"}></i>{l.name}</div>
        <div class="muted small">{l.kind} · {l.model}{running.length ? ` · running ${running.map((r) => (r.card ? "#" + r.card : r.action ?? "")).join(", ")}` : ""}</div>
      </div>

      <div class="strip" title={l.schedule.length ? `Runs ${summary(l.schedule)}` : "Runs when there's something to do"}>
        <div class="track">
          {#each ticks(l.schedule) as m}<i class="tick" class:past={m < nowMin} style:left="{(m / 1440) * 100}%"></i>{/each}
          <i class="now" style:left="{(nowMin / 1440) * 100}%"></i>
        </div>
        <div class="when small">
          <span class="muted">{summary(l.schedule)}</span>
          {#if mode !== "off" && l.nextRun}<span>next <span class="num">{time(l.nextRun, d.timezone)}</span> <span class="muted">({rel(l.nextRun)})</span></span>{/if}
        </div>
      </div>

      <div class="ctl">
        <div class="seg" role="radiogroup" aria-label={`${label(l)} mode`}>
          {#each [["off", "Off", "Doesn't run"], ["dry", "Dry", "Only records what it would do"], ["live", "Live", "Runs start Claude for real"]] as [m, label, tip]}
            <button role="radio" aria-checked={mode === m} class:on={mode === m} class={m} title={tip} onclick={() => setMode(l, m)}>{label}</button>
          {/each}
        </div>
        <button class="btn sm" disabled={mode === "off" || queued} onclick={() => runNow(l)}>{queued ? "Queued" : "Run now"}</button>
      </div>

      <div class="facts">
        <div>
          <span class="k">Next</span>
          {#if mode === "off"}<span class="muted">Nothing while it's off.</span>
          {:else if !l.pick}<span class="muted">Runs its prompt and decides what needs doing.</span>
          {:else if !l.pick.card}<span class="muted">Nothing to take: {l.pick.idle}.</span>
          {:else}<span>{l.pick.action} <a class="num" href={gh(l.pick.card.repo ?? d.repo, "issues", l.pick.card.number)} target="_blank" rel="noopener">#{l.pick.card.number}</a> {l.pick.card.title}</span>{/if}
        </div>
        <div>
          <span class="k">Track record</span>
          {#if l.quality}
            <span><span class="num">{l.quality.done}</span>/<span class="num">{l.quality.runs}</span> done{#if l.quality.failed}, <span class="num bad">{l.quality.failed}</span> failed{/if} · <span class="num">{pct(l.quality.stepErrorRate)}</span> of steps errored · ~<span class="num">{l.quality.avgMinutes ?? "?"}</span> min · ~<span class="num">${l.quality.avgCost.toFixed(2)}</span> a run</span>
          {:else}<span class="muted">No live runs yet.</span>{/if}
        </div>
        <div>
          <span class="k">Does</span>
          <span class="muted">{l.about} Follows <button class="link" onclick={() => openPrompt(l.prompt, g.repo)}>{l.prompt.split("/").pop()}</button>.</span>
        </div>
      </div>
    </div>
  {/each}
  {/each}
</section>

<section class="panel tl">
  <div class="panel-head"><h2>Next two days</h2><span class="muted small">{d.configSource}</span></div>
  <div class="panel-body"><Timeline {d} limit={24} /></div>
</section>

<style>
  .lanes { padding: 4px 0; margin-bottom: 14px; }
  .hours, .lane { display: grid; grid-template-columns: 190px minmax(0, 1fr) 210px; gap: 18px; padding: 0 16px; }
  .hours { padding-top: 8px; }
  .scale { position: relative; height: 16px; font: 500 10.5px var(--mono); color: var(--muted); }
  .scale span { position: absolute; transform: translateX(-1px); }
  .lane { padding-top: 14px; padding-bottom: 14px; border-top: 1px solid var(--line); align-items: start; }
  .lane:first-of-type { border-top: 0; }
  .repo { display: flex; gap: 10px; align-items: baseline; padding: 14px 16px 2px; border-top: 1px solid var(--line); font-weight: 600; font-size: 13px; }
  .repo:first-of-type { border-top: 0; }
  .repo a { color: var(--ink); }
  .repo + .lane { border-top: 0; }
  .lane.off { opacity: .6; }
  .name { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 14px; }
  .who .small { margin-left: 15px; }
  .strip { display: grid; gap: 6px; padding-top: 4px; }
  .track { position: relative; height: 18px; border-radius: 4px; background: var(--bg-2); border: 1px solid var(--line); }
  .tick { position: absolute; top: 3px; bottom: 3px; width: 2px; border-radius: 1px; background: var(--queue); }
  .tick.past { background: var(--line-2); }
  .now { position: absolute; top: -3px; bottom: -3px; width: 2px; background: var(--wait); }
  .when { display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
  .ctl { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
  .facts { grid-column: 2 / 4; display: grid; gap: 4px; font-size: 13px; }
  .facts > div { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 10px; }
  .k { color: var(--muted); font-size: 12px; padding-top: 1px; }
  .facts a, .link { color: var(--queue); }
  .link { background: none; border: 0; padding: 0; cursor: pointer; font: inherit; text-decoration: underline; text-underline-offset: 2px; }
  .bad { color: var(--fail); }
  .seg { display: inline-flex; padding: 2px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg-2); }
  .seg button { background: none; border: 0; padding: 3px 10px; font-size: 12px; color: var(--muted); cursor: pointer; border-radius: 6px; }
  .seg button:hover { color: var(--ink); }
  .seg button.on { background: var(--panel-2); color: var(--ink); }
  .seg button.on.dry { color: var(--queue); }
  .seg button.on.live { color: var(--run); }
  @media (max-width: 980px) {
    .hours { display: none; }
    .lane { grid-template-columns: 1fr; gap: 10px; }
    .ctl { justify-content: flex-start; }
    .facts { grid-column: 1; }
    .facts > div { grid-template-columns: 1fr; gap: 0; }
  }
</style>
