<script>
  // The board: six fixed-height columns that scroll inside, so nothing on the page moves when they fill.
  import { control } from "../lib/api.svelte.js";
  import { buildNow } from "../lib/actions.js";
  import { gh, rel } from "../lib/format.js";
  import { go } from "../lib/ui.svelte.js";
  import TestBuilds from "../components/TestBuilds.svelte";
  import Features from "../components/Features.svelte";
  let { d, open, confirm } = $props();

  const b = $derived(d.board);
  const chains = $derived(d.deps?.chains ?? {});
  const refs = (list) => list.map((r) => "#" + r.number).join(", ");
  const columns = $derived([
    { key: "next", title: "Up next", color: "var(--violet)", items: b.next, empty: "Nothing queued. Queue an idea, or add ready + a priority to a card." },
    { key: "building", title: "Building", color: "var(--amber)", items: b.building, empty: "No card is being built." },
    { key: "review", title: "In review", color: "var(--teal)", items: b.review, empty: "No PRs to review." },
    { key: "needsYou", title: "Needs you", color: "var(--pink)", items: b.needsYou, empty: "No questions waiting." },
    { key: "hold", title: "On hold", color: "var(--muted)", items: b.hold, empty: "Nothing on hold." },
    { key: "done", title: "Done", color: "var(--run)", items: b.done ?? [], empty: "Nothing merged this week." },
  ]);
  // A Done line without its Markdown, for the card.
  const plain = (md) => md.replace(/**/g, "").replace(/^[^A-Za-z#]+/, "");
</script>

<p class="muted small lede">
  {b.next.filter((c) => !c.answered).length} queued · {d.openFactoryPrs}{d.maxOpenPrs > 0 ? ` of ${d.maxOpenPrs}` : ""} factory PRs open{b.blocked.length ? ` · ${b.blocked.length} blocked (${b.blocked.map((c) => "#" + c.number).join(", ")})` : ""}
</p>
{#if d.deps?.features?.length}<Features features={d.deps.features} repo={d.repo} />{/if}
<div class="cols">
  {#each columns as col (col.key)}
    <section class="col" style:--c={col.color} aria-label={col.title}>
      <div class="col-head"><span class="dot"></span>{col.title}<span class="n num">{col.items.length}</span></div>
      <div class="cards">
        {#each col.items as card, i ((card.repo ?? "") + card.number)}
          <div class="card" class:running={card.running} class:answered={card.answered} class:notdone={col.key === "done" && !card.ok}>
            <button class="hit" onclick={() => open(card, card.answered ? "needsYou" : col.key)} aria-label={`Open #${card.number}`}></button>
            <div class="top">
              {#if card.running}<i class="sdot run live" title="Running"></i>{:else if col.key === "next" && !card.answered}<span class="order num">{i + 1}</span>{/if}
              <a class="num-link" href={gh(card.repo ?? d.repo, col.key === "review" ? "pull" : "issues", card.number)} target="_blank" rel="noopener">#{card.number}</a>
              {#if card.repo && card.repo !== d.repo}<span class="chip site" title={card.repo}>{card.repo.split("/")[1].replace(new RegExp("^" + d.repo.split("/")[1] + "-"), "")}</span>{/if}
              {#if card.priority}<span class="chip {card.priority}">{card.priority}</span>{/if}
              {#if card.size}<span class="chip">{card.size}</span>{/if}
              {#if card.starting && !card.running}<span class="chip live">starting</span>{/if}
              {#if card.answered}<span class="chip pink">answered</span>{/if}
              {#if col.key === "done"}<span class="chip" class:live={card.ok} class:p2={!card.ok}>{card.ok ? "done" : "not done"}</span>{/if}
            </div>
            <div class="title">{card.title}</div>
            {#if (card.repo ?? d.repo) === d.repo && chains[card.number]}
              {@const c = chains[card.number]}
              <div class="chain">
                {#if c.waitsOn.length}<span class:blocked={c.waitsOn.some((r) => r.stage !== "done")} title={c.waitsOn.map((r) => `#${r.number} ${r.title} (${r.stage})`).join(" · ")}>waits on {refs(c.waitsOn)}</span>{/if}
                {#if c.unblocks.length}<span title={c.unblocks.map((r) => `#${r.number} ${r.title}`).join(" · ")}>unblocks {refs(c.unblocks)}</span>{/if}
                {#if c.partOf}<span title={c.partOf.title}>part of #{c.partOf.number}</span>{/if}
              </div>
            {/if}
            {#if col.key === "done"}<div class="meta muted line">{plain(card.line)}</div><div class="meta muted">PR #{card.pr} merged · {rel(card.at)}</div>{/if}
            {#if col.key === "review" && card.updatedAt}<div class="meta muted">updated {rel(card.updatedAt)}</div>{/if}
            {#if card.draftPr}<div class="meta muted">continues draft PR #{card.draftPr}</div>{/if}
            {#if card.testBuilds}<TestBuilds tb={card.testBuilds} />{/if}
            {#if card.answered}<div class="meta muted">You answered. Requeue it, or the maintainer will.</div>{/if}
            <div class="actions">
              {#if card.answered}
                <button class="btn sm primary" onclick={() => control(`cards/${card.number}/requeue`, { repo: card.repo }, `#${card.number} requeued`)}>Requeue</button>
              {:else if col.key === "next"}
                <button class="btn sm primary" onclick={() => buildNow(card, confirm)}>Build now</button>
                <button class="btn sm" onclick={() => control(`cards/${card.number}/hold`, { repo: card.repo })}>Hold</button>
              {:else if col.key === "hold"}
                <button class="btn sm" onclick={() => control(`cards/${card.number}/requeue`, { repo: card.repo })}>Requeue</button>
              {:else if col.key === "needsYou"}
                <a class="btn sm" href={gh(card.repo ?? d.repo, "issues", card.number)} target="_blank" rel="noopener">Answer on GitHub</a>
              {:else if col.key === "review"}
                {#if card.verdict === "ready"}<span class="chip live" title="The reviewer lane passed it">Reviewed ✓</span>{:else if card.verdict === "polish"}<span class="chip" title="The reviewer passed it; the builder is doing the small extras first">Polishing</span>{:else if card.verdict === "needs-work"}<span class="chip p2" title="The reviewer lane asked for fixes">Needs work</span>{/if}
                <a class="btn sm" href={gh(card.repo ?? d.repo, "pull", card.number)} target="_blank" rel="noopener">Review on GitHub</a>
              {/if}
              {#if card.run && (col.key === "building" || col.key === "review")}
                <button class="btn sm" class:primary={card.running} onclick={() => go("runs", String(card.run))}>{card.running ? "Watch run" : "See run"}</button>
              {/if}
            </div>
          </div>
        {:else}
          <div class="empty">{col.empty}</div>
        {/each}
      </div>
    </section>
  {/each}
</div>

<style>
  .lede { margin: 0 0 12px; }
  .chain { position: relative; pointer-events: none; display: flex; flex-wrap: wrap; gap: 2px 10px; margin-top: 5px; font-size: 11.5px; color: var(--muted); }
  .chain .blocked { color: var(--wait); }
  .cols { display: grid; grid-template-columns: repeat(6, minmax(190px, 1fr)); gap: 10px; overflow-x: auto; height: calc(100vh - 52px - 96px); min-height: 480px; }
  .col { min-width: 0; display: flex; flex-direction: column; min-height: 0; border-radius: 10px; background: color-mix(in srgb, var(--panel) 55%, transparent); border: 1px solid var(--line); }
  .col-head { display: flex; align-items: center; gap: 8px; font-weight: 500; font-size: 13px; padding: 10px 12px 8px; }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--c); }
  .n { margin-left: auto; color: var(--muted); font-size: 12px; }
  .cards { display: grid; gap: 6px; overflow-y: auto; align-content: start; flex: 1; min-height: 0; padding: 0 8px 8px; scrollbar-gutter: stable; }
  .card { position: relative; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 9px 10px 8px; transition: border-color .12s; }
  .card:hover { border-color: var(--line-2); }
  .card.running { border-color: color-mix(in srgb, var(--run) 45%, var(--line)); }
  .card.notdone { border-color: color-mix(in srgb, var(--wait) 45%, var(--line)); }
  .meta.line { display: -webkit-box; -webkit-line-clamp: 4; line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
  .card.answered { border-color: color-mix(in srgb, var(--wait) 45%, var(--line)); }
  .hit { position: absolute; inset: 0; background: none; border: 0; cursor: pointer; border-radius: 8px; }
  .hit:focus-visible { outline-offset: -2px; }
  .top { position: relative; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; pointer-events: none; }
  .top a, .actions, .actions * { pointer-events: auto; }
  .order { min-width: 14px; font-size: 11.5px; color: var(--muted); }
  .num-link { color: var(--muted); font: 500 12px var(--mono); position: relative; }
  .title { position: relative; pointer-events: none; margin-top: 4px; font-size: 13px; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .meta { position: relative; pointer-events: none; font-size: 12px; margin-top: 4px; }
  .actions { position: relative; display: flex; gap: 4px; margin-top: 8px; flex-wrap: wrap; }
  .actions:empty { display: none; }
  @media (max-width: 860px) { .cols { grid-template-columns: repeat(6, 84vw); height: 70vh; } }
</style>
