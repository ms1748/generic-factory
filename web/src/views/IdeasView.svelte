<script>
  // Every untriaged idea: searchable, filterable, paged. The table keeps its height on every page,
  // so Previous and Next stay under your mouse.
  import { control } from "../lib/api.svelte.js";
  import { buildNow } from "../lib/actions.js";
  import { gh } from "../lib/format.js";
  let { d, open, confirm } = $props();

  const PAGE = 12;
  let query = $state("");
  let size = $state("all");
  let page = $state(0);
  const type = (labels) => ["feature", "fix", "chore", "security"].find((t) => labels.includes(t)) ?? "";
  const ideas = $derived(
    d.board.ideas.filter((i) => (size === "all" || (i.size ?? "none") === size) && (!query.trim() || `#${i.number} ${i.title}`.toLowerCase().includes(query.trim().toLowerCase()))),
  );
  const pages = $derived(Math.max(1, Math.ceil(ideas.length / PAGE)));
  const shown = $derived(ideas.slice(page * PAGE, page * PAGE + PAGE));
  $effect(() => {
    query;
    size;
    page = 0;
  });
</script>

<section class="panel">
  <div class="panel-head">
    <span class="muted small">{d.board.ideas.length} ideas waiting for you to queue, build or drop. Click one to read it.</span>
    <span class="spacer"></span>
    <input class="field search" type="search" placeholder="Search ideas" aria-label="Search ideas" bind:value={query} />
    <select class="field" aria-label="Size" bind:value={size}>
      <option value="all">All sizes</option>
      {#each ["S", "M", "L", "XL", "none"] as s}<option value={s}>{s === "none" ? "Unsized" : `Size ${s}`}</option>{/each}
    </select>
  </div>
  <div class="panel-body">
    <div class="rows">
      {#each shown as idea ((idea.repo ?? "") + idea.number)}
        <div class="row">
          <a class="num muted" href={gh(idea.repo ?? d.repo, "issues", idea.number)} target="_blank" rel="noopener">#{idea.number}</a>
          <span class="chips">
            {#if idea.size}<span class="chip">{idea.size}</span>{/if}
            {#if type(idea.labels)}<span class="chip">{type(idea.labels)}</span>{/if}
            {#if idea.labels.includes("factory")}<span class="chip bot">factory</span>{/if}
          </span>
          <button class="title" onclick={() => open(idea, "ideas")}>{idea.title}</button>
          <span class="acts">
            <button class="btn sm" onclick={() => control(`cards/${idea.number}/requeue`, { repo: idea.repo }, `#${idea.number} queued`)}>Queue</button>
            <button class="btn sm primary" onclick={() => buildNow(idea, confirm)}>Build now</button>
          </span>
        </div>
      {:else}
        <div class="empty">{d.board.ideas.length ? "No idea matches." : "No untriaged ideas."}</div>
      {/each}
      {#each Array(Math.max(0, PAGE - Math.max(shown.length, 1))) as _}<div class="row ghost" aria-hidden="true"></div>{/each}
    </div>
    <div class="pager">
      <button class="btn sm" disabled={page === 0} onclick={() => page--}>Previous</button>
      <span class="muted small num">Page {page + 1} of {pages}</span>
      <button class="btn sm" disabled={page >= pages - 1} onclick={() => page++}>Next</button>
    </div>
  </div>
</section>

<style>
  .search { width: 220px; }
  .rows { display: grid; grid-auto-rows: 46px; }
  .row { display: grid; grid-template-columns: 56px 150px 1fr auto; gap: 10px; align-items: center; border-bottom: 1px solid var(--line); min-width: 0; }
  .row.ghost { border-bottom-color: transparent; }
  .num { font-weight: 600; font-size: 12.5px; }
  .chips { display: flex; gap: 5px; overflow: hidden; }
  .title { background: none; border: 0; padding: 0; text-align: left; cursor: pointer; font-size: 13.5px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .title:hover { color: var(--accent); }
  .acts { display: flex; gap: 6px; }
  .pager { display: flex; align-items: center; justify-content: center; gap: 14px; padding-top: 14px; }
  .pager .num { min-width: 90px; text-align: center; }
  @media (max-width: 860px) { .row { grid-template-columns: 48px 1fr auto; } .chips { display: none; } .acts .btn:not(.primary) { display: none; } .search { width: 140px; } }
</style>
