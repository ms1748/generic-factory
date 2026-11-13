<script>
  // Mission control: what happened since you last looked (top), what's running and what's next (middle),
  // what needs you (the rail), and one filter for all three. "Last looked" is remembered on this browser.
  import { buildNow } from "../lib/actions.js";
  import { go } from "../lib/ui.svelte.js";
  import { dur, gh, money, rel, time } from "../lib/format.js";
  import Budget from "../components/Budget.svelte";
  import Timeline from "../components/Timeline.svelte";
  import SystemsStrip from "../components/SystemsStrip.svelte";
  let { d, open, confirm } = $props();

  const KEY = "factory.lastLooked";
  const read = () => {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  };
  // The previous visit's time; this visit counts as "looked" once it's been open a little while.
  const since = read() ?? new Date(Date.now() - 24 * 3600_000).toISOString();
  $effect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(KEY, new Date().toISOString());
      } catch {
        // private mode: every visit shows the last day
      }
    }, 20_000);
    return () => clearTimeout(t);
  });

  // Open crash reports, from GlitchTip (the Reports view has the list).
  let crashes = $state(null);
  $effect(() => {
    fetch("/api/reports", { cache: "no-store" }).then((r) => r.json()).then((j) => (crashes = j.configured ? j.issues.filter((x) => x.status === "unresolved" && x.kind === "crash") : null)).catch(() => {});
  });

  let filter = $state("all");
  const FILTERS = [
    ["all", "All"],
    ["running", "Running"],
    ["waiting", "Waiting on you"],
    ["failed", "Failed"],
  ];
  const show = (what) => filter === "all" || filter === what;

  let tick = $state(0);
  $effect(() => {
    const t = setInterval(() => tick++, 1000);
    return () => clearInterval(t);
  });

  const cards = $derived([...d.board.building, ...d.board.next, ...d.board.review, ...d.board.needsYou]);
  const titleOf = (n) => cards.find((c) => c.number === n || c.issue === n)?.title;
  const running = $derived(d.runningAll ?? (d.running ? [d.running] : []));
  const finished = $derived(d.runs.filter((r) => r.mode === "live" && r.ended_at && r.ended_at > since));
  const failed = $derived(finished.filter((r) => r.status === "failed" || r.status === "limited"));
  const prs = $derived(new Set(finished.filter((r) => r.pr && r.lane !== "reviewer").map((r) => r.pr)));
  const spent = $derived(finished.reduce((s, r) => s + (r.cost_usd ?? 0), 0));
  const feed = $derived((filter === "failed" ? failed : finished).slice(0, 8));
  const needs = $derived([
    ...d.board.needsYou.map((c) => ({ ...c, col: "needsYou", why: c.answered ? "You answered: requeue it" : "Question for you", kind: "issues" })),
    ...d.board.review.map((c) => ({ ...c, col: "review", why: c.verdict === "ready" ? "Reviewed: ready to merge" : c.verdict === "needs-work" ? "Reviewer asked for fixes" : c.verdict === "polish" ? "Being polished" : "PR to review", kind: "pull" })),
  ]);
  const next = $derived(d.board.next.filter((c) => !c.answered).slice(0, 5));
  const statusOf = (r) => (r.status === "done" ? "run" : r.status === "failed" || r.status === "limited" ? "fail" : "");
  const firstLine = (s) => (s ?? "").split("\n").find((l) => l.trim()) ?? "";
</script>

<div class="bar">
  <div class="seg" role="radiogroup" aria-label="Show">
    {#each FILTERS as [key, label]}
      <button role="radio" aria-checked={filter === key} class:on={filter === key} onclick={() => (filter = key)}>
        {label}
        {#if key === "running" && running.length}<span class="num">{running.length}</span>{/if}
        {#if key === "waiting" && needs.length}<span class="num">{needs.length}</span>{/if}
        {#if key === "failed" && failed.length}<span class="num bad">{failed.length}</span>{/if}
      </button>
    {/each}
  </div>
  {#if d.budgetBlock}<span class="hold"><i class="sdot wait"></i>New runs wait: {d.budgetBlock}</span>{/if}
</div>

<div class="mc">
  <div class="center">
    {#if show("all") || show("failed")}
      <section class="panel">
        <div class="panel-head">
          <h2>Since you last looked</h2>
          <span class="muted small">{rel(since)}</span>
          <span class="spacer"></span>
          <button class="btn ghost sm" onclick={() => go("runs")}>All runs</button>
        </div>
        <div class="panel-body">
          <p class="sum">
            {#if finished.length}
              <b class="num">{finished.length}</b> run{finished.length === 1 ? "" : "s"} finished{#if failed.length}, <b class="num bad">{failed.length}</b> failed{/if}{#if prs.size}, <b class="num">{prs.size}</b> PR{prs.size === 1 ? "" : "s"} touched{/if}{#if spent}, <span class="num">{money(spent)}</span> API-equivalent{/if}.
            {:else}
              Nothing finished since then.
            {/if}
          </p>
          {#each feed as r (r.id)}
            <button class="line" onclick={() => go("runs", String(r.id))}>
              <i class="sdot {statusOf(r)}"></i>
              <span class="who"><span class="lane">{r.lane}</span>{#if r.card}<span class="num">#{r.card}</span>{/if}</span>
              <span class="say">{firstLine(r.summary)}</span>
              <span class="num muted when">{time(r.ended_at, d.timezone)}</span>
            </button>
          {:else}
            {#if filter === "failed"}<div class="empty">No failed runs since then.</div>{/if}
          {/each}
        </div>
      </section>
    {/if}

    {#if show("running")}
      <section class="panel">
        <div class="panel-head"><h2>Running now</h2><span class="muted small num">{running.length} of {d.settings?.parallelRuns ?? 1}</span></div>
        <div class="panel-body">
          {#each running as r (r.id)}
            {@const log = r.id === d.running?.id ? [...(d.running.log ?? [])].reverse().find((e) => e.kind === "text" || e.kind === "tool") : null}
            <div class="job">
              <i class="sdot run live"></i>
              <div class="job-main">
                <div class="job-title">{#if r.card}<a class="num" href={gh(r.repo ?? d.repo, "issues", r.card)} target="_blank" rel="noopener">#{r.card}</a> {titleOf(r.card) ?? ""}{:else}{r.lane}{r.action ? ` · ${r.action}` : ""}{/if}</div>
                <div class="muted small">{r.lane}{r.action ? ` · ${r.action}` : ""} · run <span class="num">{r.id}</span> · <span class="num">{(tick, dur(r.started_at))}</span></div>
                {#if log}<div class="tail mono">{log.kind === "tool" ? `${log.name}: ${log.text}` : log.text.split("\n")[0]}</div>{/if}
              </div>
              <button class="btn sm" onclick={() => go("runs", String(r.id))}>Watch</button>
            </div>
          {:else}
            <p class="idle">
              Nothing running.
              {#if d.queuedRuns.length}Starting next: {d.queuedRuns.map((q) => (q.card ? `#${q.card}` : q.lane)).join(", ")}.
              {:else if d.upcoming?.[0]}Next is <b>{d.upcoming[0].lane}</b> at {time(d.upcoming[0].at, d.timezone)} ({rel(d.upcoming[0].at)}){d.upcoming[0].live ? "" : ", dry"}.{/if}
            </p>
          {/each}
        </div>
      </section>
    {/if}

    {#if filter === "all"}
      <div class="pair">
        <section class="panel">
          <div class="panel-head"><h2>Up next</h2><span class="spacer"></span><button class="btn ghost sm" onclick={() => go("board")}>Board</button></div>
          <div class="panel-body">
            {#each next as c, i ((c.repo ?? "") + c.number)}
              <div class="q">
                <span class="num muted">{i + 1}</span>
                <button class="q-title" onclick={() => open(c, "next")}><span class="num">#{c.number}</span> {c.title}</button>
                {#if c.priority}<span class="chip {c.priority}">{c.priority}</span>{/if}
                <button class="btn sm" onclick={() => buildNow(c, confirm)}>Build now</button>
              </div>
            {:else}
              <div class="empty">Nothing queued. Mark a card ready, or queue an idea.</div>
            {/each}
          </div>
        </section>
        <section class="panel">
          <div class="panel-head"><h2>Schedule</h2><span class="spacer"></span><button class="btn ghost sm" onclick={() => go("lanes")}>Lanes</button></div>
          <div class="panel-body"><Timeline {d} limit={5} /></div>
        </section>
      </div>
    {/if}
  </div>

  <aside class="rail">
    {#if show("waiting")}
      <section class="panel needs">
        <div class="panel-head"><h2>Needs you</h2><span class="num muted small">{needs.length}</span></div>
        <div class="panel-body">
          {#each needs as c (c.col + (c.repo ?? "") + c.number)}
            <div class="need">
              <button class="need-title" onclick={() => open(c, c.col)}><span class="num">#{c.number}</span> {c.title}</button>
              <div class="need-foot">
                <span class="why" class:ok={c.verdict === "ready"}>{c.why}</span>
                <a class="btn sm" href={gh(c.repo ?? d.repo, c.kind, c.number)} target="_blank" rel="noopener">{c.kind === "pull" ? "Review" : "Answer"}</a>
              </div>
            </div>
          {:else}
            {#if !crashes?.length}<div class="empty">Nothing waits on you.</div>{/if}
          {/each}
          {#if crashes?.length}
            <div class="need">
              <button class="need-title" onclick={() => go("reports")}><span class="num">{crashes.length}</span> open crash report{crashes.length === 1 ? "" : "s"}: {crashes[0].title}</button>
              <div class="need-foot"><span class="why bad">Players hit this</span><button class="btn sm" onclick={() => go("reports")}>Reports</button></div>
            </div>
          {/if}
        </div>
      </section>
    {/if}
    {#if filter === "all"}<Budget {d} />{/if}
  </aside>
</div>

{#if filter === "all"}<div class="sys"><SystemsStrip /></div>{/if}

<style>
  .bar { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-bottom: 14px; }
  .seg { display: inline-flex; padding: 2px; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); }
  .seg button { display: inline-flex; align-items: center; gap: 6px; border: 0; background: none; color: var(--muted); padding: 4px 11px; border-radius: 6px; cursor: pointer; font-size: 12.5px; }
  .seg button:hover { color: var(--ink); }
  .seg button.on { background: var(--panel-2); color: var(--ink); }
  .seg .num { font-size: 11.5px; color: var(--muted); }
  .seg .num.bad, b.bad { color: var(--fail); }
  .hold { display: inline-flex; align-items: center; gap: 7px; font-size: 12.5px; color: var(--wait); }

  .mc { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 14px; align-items: start; }
  .center, .rail { display: grid; gap: 14px; min-width: 0; }
  .rail { position: sticky; top: 66px; }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  @media (max-width: 1100px) { .mc { grid-template-columns: 1fr; } .rail { position: static; } }
  @media (max-width: 760px) { .pair { grid-template-columns: 1fr; } .pair > section:last-child { display: none; } .seg { max-width: 100%; overflow-x: auto; scrollbar-width: none; } .seg button { white-space: nowrap; padding: 4px 9px; } }

  .sum { margin: 0 0 8px; color: var(--ink-2); }
  .sum b { color: var(--ink); font-weight: 500; }
  .line { display: grid; grid-template-columns: 8px 150px minmax(0, 1fr) auto; align-items: center; gap: 10px; width: 100%; padding: 7px 4px; border: 0; border-top: 1px solid var(--line); background: none; text-align: left; cursor: pointer; font-size: 13px; color: var(--ink); }
  .line:hover { background: var(--panel-2); }
  .who { display: flex; gap: 8px; align-items: baseline; min-width: 0; }
  .lane { color: var(--ink-2); }
  .who .num { font-size: 12px; color: var(--muted); }
  .say { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink-2); }
  .when { font-size: 12px; }
  @media (max-width: 760px) { .line { grid-template-columns: 8px minmax(0, 1fr) auto; } .say { display: none; } }

  .job { display: flex; align-items: flex-start; gap: 11px; padding: 10px 0; border-top: 1px solid var(--line); }
  .job:first-child { border-top: 0; padding-top: 2px; }
  .job .sdot { margin-top: 7px; }
  .job-main { flex: 1; min-width: 0; display: grid; gap: 2px; }
  .job-title { font-size: 14px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .job-title a { font-size: 13px; color: var(--muted); }
  .tail { margin-top: 4px; font-size: 12px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .idle { margin: 0; color: var(--ink-2); }

  .q { display: flex; align-items: center; gap: 9px; padding: 6px 0; border-top: 1px solid var(--line); min-width: 0; }
  .q:first-child { border-top: 0; }
  .q .num.muted { width: 14px; font-size: 12px; }
  .q-title { flex: 1; min-width: 0; border: 0; background: none; padding: 0; text-align: left; cursor: pointer; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink); }
  .q-title .num { font-size: 12px; color: var(--muted); }
  .q-title:hover { color: var(--queue); }

  .needs { border-color: color-mix(in srgb, var(--wait) 30%, var(--line)); }
  .need { padding: 9px 0; border-top: 1px solid var(--line); display: grid; gap: 5px; }
  .need:first-child { border-top: 0; padding-top: 2px; }
  .need-title { border: 0; background: none; padding: 0; text-align: left; cursor: pointer; font-size: 13px; color: var(--ink); line-height: 1.4; }
  .need-title .num { font-size: 12px; color: var(--muted); }
  .need-title:hover { color: var(--queue); }
  .need-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .why { font-size: 12px; color: var(--wait); }
  .why.ok { color: var(--run); }
  .why.bad { color: var(--fail); }
  .sys { margin-top: 14px; }
</style>
