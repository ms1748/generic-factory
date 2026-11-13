<script>
  import { control } from "../lib/api.svelte.js";
  import { md } from "../lib/md.js";
  import { buildNow } from "../lib/actions.js";
  import { gh, time } from "../lib/format.js";
  import { go } from "../lib/ui.svelte.js";
  let { d, view = $bindable(), confirm } = $props();

  let issue = $state(null);
  $effect(() => {
    if (view?.type !== "card") return;
    const n = view.card.number;
    const repo = view.card.repo;
    let stop = false;
    issue = null;
    fetch(`/api/issues/${n}${repo && repo !== d.repo ? `?repo=${encodeURIComponent(repo)}` : ""}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { body: "", error: true }))
      .then((j) => !stop && (issue = j))
      .catch(() => !stop && (issue = { body: "", error: true }));
    return () => (stop = true);
  });

  let prompt = $state("");
  $effect(() => {
    if (view?.type !== "prompt") return;
    prompt = "";
    fetch(`/api/prompt?path=${encodeURIComponent(view.path)}${view.repo ? `&repo=${encodeURIComponent(view.repo)}` : ""}`).then((r) => r.json()).then((j) => (prompt = j.text ?? j.error ?? "")).catch(() => (prompt = "Couldn't load it."));
  });

  let report = $state("");
  $effect(() => {
    if (view?.type !== "trial") return;
    report = "";
    fetch(`/api/trials/${view.trial.name}`).then((r) => r.json()).then((j) => (report = j.text ?? "")).catch(() => (report = "Couldn't load the report."));
  });

  const close = () => (view = null);
  const where = { next: "Up next", building: "Building", review: "In review", needsYou: "Needs you", hold: "On hold", ideas: "Idea" };
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && view && close()} />

{#if view}
  <div class="scrim" onclick={close} role="presentation"></div>
  <aside class="drawer" aria-label="Details">
    <div class="head">
      {#if view.type === "card"}
        <div class="t">
          <div class="muted small">{where[view.column] ?? ""}</div>
          <strong>#{view.card.number} {view.card.title}</strong>
        </div>
      {:else if view.type === "prompt"}
        <div class="t"><div class="muted small">Prompt the agents follow · <a href={`https://github.com/${d.repo}/blob/main/${view.path}`} target="_blank" rel="noopener">on GitHub</a></div><strong>{view.path.split("/").pop()}</strong></div>
      {:else}
        <div class="t"><div class="muted small">Quality trial</div><strong>{view.trial.title} · {view.trial.wins}</strong></div>
      {/if}
      <button class="btn ghost" onclick={close} aria-label="Close">✕</button>
    </div>

    <div class="body">
      {#if view.type === "card"}
        {@const c = view.card}
        <div class="chips">
          {#if c.priority}<span class="chip {c.priority}">{c.priority}</span>{/if}
          {#if c.size}<span class="chip">size {c.size}</span>{/if}
          {#each (c.labels ?? []).filter((l) => !/^(p\d|size:)/.test(l)) as l}<span class="chip">{l}</span>{/each}
        </div>
        {#if c.reason}<p class="muted">Skipped: {c.reason}</p>{/if}
        {#if c.blockers?.length}<p class="muted">Blocked by {c.blockers.map((b) => `#${b}`).join(", ")}</p>{/if}
        <div class="links">
          <a class="btn" href={gh(c.repo ?? d.repo, view.column === "review" ? "pull" : "issues", c.number)} target="_blank" rel="noopener">Open on GitHub</a>
          {#if c.pr}<a class="btn" href={gh(c.repo ?? d.repo, "pull", c.pr)} target="_blank" rel="noopener">PR #{c.pr}</a>{/if}
          {#if c.issue}<a class="btn" href={gh(c.repo ?? d.repo, "issues", c.issue)} target="_blank" rel="noopener">Card #{c.issue}</a>{/if}
          {#if c.draftPr}<a class="btn" href={gh(c.repo ?? d.repo, "pull", c.draftPr)} target="_blank" rel="noopener">Draft PR #{c.draftPr}</a>{/if}
          {#if c.run}<button class="btn" class:primary={c.running} onclick={() => { go("runs", String(c.run)); close(); }}>{c.running ? "Watch the run" : "See its run"}</button>{/if}
        </div>
        <div class="desc prose">
          {#if !issue}<p class="muted">Loading the description…</p>
          {:else if issue.error}<p class="muted">Couldn't load the description.</p>
          {:else if !issue.body.trim()}<p class="muted">No description.</p>
          {:else}
            <p class="muted small">{issue.pr ? "PR" : "Issue"} by {issue.author} · {time(issue.created, d.timezone, { month: "short", day: "numeric" })} · {issue.state}</p>
            {@html md(issue.body, d.repo)}
          {/if}
        </div>
        {#if issue?.comments?.length}
          <div class="thread">
            <div class="muted small">{issue.comments.length} comment{issue.comments.length === 1 ? "" : "s"}</div>
            {#each issue.comments as c}
              <div class="comment prose" class:bot={c.bot}>
                <div class="who"><b>{c.author}</b> <span class="muted">{c.kind === "comment" ? "" : c.kind + " · "}{time(c.at, d.timezone, { month: "short", day: "numeric" })}</span></div>
                {#if c.body.trim()}{@html md(c.body, d.repo)}{:else}<p class="muted">(no text)</p>{/if}
              </div>
            {/each}
          </div>
        {/if}
        <div class="links">
          {#if view.column === "next" || view.column === "ideas"}<button class="btn primary" onclick={() => buildNow(c, confirm)}>Build now</button>{/if}
          {#if view.column === "next"}<button class="btn" onclick={() => { control(`cards/${c.number}/hold`, { repo: c.repo }); close(); }}>Hold</button>{/if}
          {#if view.column === "hold" || view.column === "ideas" || c.answered}<button class="btn" onclick={() => { control(`cards/${c.number}/requeue`); close(); }}>{view.column === "ideas" ? "Queue" : "Requeue"}</button>{/if}
          {#if view.column === "needsYou" && !c.answered}<a class="btn" href={gh(c.repo ?? d.repo, "issues", c.number)} target="_blank" rel="noopener">Answer on GitHub</a>{/if}
        </div>
      {:else if view.type === "prompt"}
        <div class="desc prose">{#if prompt}{@html md(prompt, d.repo)}{:else}<p class="muted">Loading…</p>{/if}</div>
      {:else}
        <div class="desc prose">{#if report}{@html md(report, d.repo)}{:else}<p class="muted">Loading…</p>{/if}</div>
      {/if}
    </div>
  </aside>
{/if}

<style>
  .scrim { position: fixed; inset: 0; background: rgb(0 0 0 / .45); z-index: 30; animation: fade .15s; }
  .drawer {
    position: fixed; top: 0; right: 0; bottom: 0; z-index: 31; width: min(720px, 100vw);
    background: var(--panel); border-left: 1px solid var(--line); display: flex; flex-direction: column;
    box-shadow: -20px 0 40px rgb(0 0 0 / .3); animation: slide .2s ease;
  }
  @keyframes slide { from { transform: translateX(30px); opacity: 0; } }
  @keyframes fade { from { opacity: 0; } }
  .head { display: flex; gap: 12px; align-items: flex-start; padding: 16px 18px; border-bottom: 1px solid var(--line); }
  .t { flex: 1; min-width: 0; }
  .t strong { font-size: 15px; line-height: 1.4; display: block; }
  .small { font-size: 12px; }
  .body { padding: 16px 18px; overflow: auto; flex: 1; }
  .chips, .links { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
  .summary { margin: 0 0 12px; font-weight: 600; }
  .thread { display: grid; gap: 10px; margin-bottom: 16px; }
  .comment { border: 1px solid var(--line); border-radius: 10px; padding: 8px 12px; background: var(--bg-2); font-size: 13px; }
  .comment.bot { border-left: 3px solid var(--violet); }
  .comment .who { font-size: 12.5px; margin-bottom: 2px; }
  .desc { border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); padding: 4px 0 8px; margin-bottom: 14px; }
</style>
