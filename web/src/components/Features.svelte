<script>
  // One tree per feature: its parts in the order they can be built (left to right), each with where it
  // stands. A feature is an issue its parts point at with "Part of #n"; arrows follow "Blocked by #n".
  import { gh } from "../lib/format.js";
  let { features, repo } = $props();

  const LABEL = { done: "done", building: "building", review: "in review", queued: "queued", waiting: "waiting", idea: "idea", hold: "on hold", open: "open" };
  const levels = (f) => {
    const out = [];
    for (const p of f.parts) (out[p.level] ??= []).push(p);
    return out.filter(Boolean);
  };
  let shown = $state(true);
</script>

<section class="features" aria-label="Features and what depends on what">
  <button class="head" onclick={() => (shown = !shown)} aria-expanded={shown}>
    <span class="caret" class:open={shown}>▸</span>
    <b>Features</b>
    <span class="muted small">what depends on what · {features.length} in progress</span>
  </button>
  {#if shown}
    <div class="list">
      {#each features as f (f.number)}
        <div class="feature">
          <div class="f-head">
            <a class="num-link" href={gh(repo, "issues", f.number)} target="_blank" rel="noopener">#{f.number}</a>
            <span class="f-title">{f.title}</span>
            <span class="progress" title="{f.done} of {f.parts.length} parts done">
              <span class="bar"><i style:width="{(f.done / f.parts.length) * 100}%"></i></span>
              <span class="num small">{f.done}/{f.parts.length}</span>
            </span>
          </div>
          <div class="tree">
            {#each levels(f) as level, li}
              {#if li > 0}<span class="arrow" aria-hidden="true">→</span>{/if}
              <div class="level">
                {#each level as p (p.number)}
                  <a class="part {p.stage}" href={gh(repo, "issues", p.number)} target="_blank" rel="noopener"
                    title={p.waitsOn.length ? `Waits on ${p.waitsOn.map((n) => "#" + n).join(", ")}` : "Can start now"}>
                    <span class="p-top"><span class="num">#{p.number}</span><span class="stage">{LABEL[p.stage]}</span></span>
                    <span class="p-title">{p.title.replace(/^[^:]+:\s*/, "")}</span>
                  </a>
                {/each}
              </div>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</section>

<style>
  .features { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 8px 10px; margin-bottom: 12px; }
  .head { all: unset; cursor: pointer; display: flex; align-items: center; gap: 8px; padding: 2px 4px; width: 100%; }
  .head:focus-visible { outline: 2px solid var(--violet); border-radius: 6px; }
  .caret { display: inline-block; transition: transform .15s; color: var(--muted); }
  .caret.open { transform: rotate(90deg); }
  .list { display: grid; gap: 10px; margin-top: 8px; max-height: 40vh; overflow-y: auto; }
  .feature { background: var(--panel-2); border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; }
  .f-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .f-title { font-weight: 650; font-size: 13.5px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .progress { margin-left: auto; display: flex; align-items: center; gap: 6px; color: var(--muted); }
  .bar { width: 70px; height: 6px; border-radius: 3px; background: var(--line); overflow: hidden; }
  .bar i { display: block; height: 100%; background: var(--teal); }
  .tree { display: flex; align-items: center; gap: 8px; overflow-x: auto; padding-bottom: 2px; }
  .level { display: grid; gap: 6px; }
  .arrow { color: var(--muted); font-size: 18px; }
  .part { display: grid; gap: 2px; min-width: 170px; max-width: 240px; text-decoration: none; color: var(--text); border: 1px solid var(--line); border-left: 3px solid var(--c, var(--muted)); border-radius: 8px; padding: 5px 8px; background: var(--panel); }
  .part:hover { border-color: var(--c, var(--muted)); }
  .p-top { display: flex; justify-content: space-between; gap: 8px; font-size: 11.5px; }
  .stage { color: var(--c, var(--muted)); font-weight: 650; }
  .p-title { font-size: 12.5px; line-height: 1.3; }
  .part.done { --c: var(--teal); opacity: .7; }
  .part.done .p-title { text-decoration: line-through; }
  .part.building { --c: var(--amber); }
  .part.review { --c: var(--teal); }
  .part.queued { --c: var(--violet); }
  .part.waiting, .part.idea, .part.open, .part.hold { --c: var(--muted); }
</style>
