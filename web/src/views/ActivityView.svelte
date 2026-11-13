<script>
  // What the agents did on GitHub lately (labels, closes, renames, comments, issues and PRs opened), each with
  // an Undo. The dispatcher looks the action up again and reverses it itself; the page only names it.
  import { control } from "../lib/api.svelte.js";
  import { gh, rel, time } from "../lib/format.js";
  let { d, confirm } = $props();

  let span = $state("24h");
  let data = $state(null);
  let error = $state("");
  let loading = $state(false);

  async function fetchActivity() {
    loading = true;
    try {
      const res = await fetch(`/api/activity?window=${span}`, { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || res.statusText);
      data = j;
      error = "";
    } catch (e) {
      error = e.message;
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    span;
    fetchActivity();
  });

  function undo(a) {
    confirm({
      title: `Undo this on #${a.n}?`,
      body: `"${a.what}". The factory's GitHub App reverses it now${a.what.startsWith("opened") ? " (it closes it; nothing is deleted)" : ""}.`,
      yes: "Undo it",
      action: async () => {
        if (await control(`activity/${a.id}/undo`)) fetchActivity();
      },
    });
  }
</script>

<section class="panel">
  <div class="panel-head">
    <h2>Agent actions on GitHub</h2>
    <span class="spacer"></span>
    <div class="seg" role="group" aria-label="Time window">
      {#each [["24h", "24 h"], ["3d", "3 days"], ["7d", "Week"]] as [w, label]}
        <button class:on={span === w} aria-pressed={span === w} onclick={() => (span = w)}>{label}</button>
      {/each}
    </div>
    <button class="btn sm ghost" onclick={fetchActivity} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button>
  </div>
  <div class="panel-body">
    {#if error}<p class="err">Couldn't read GitHub: {error}</p>{/if}
    {#if data}
      {#if data.unseen.length}
        <p class="note small">
          Not listed: label changes and closes by cloud runs, which acted as you and can't be told apart. Check by hand:
          {#each data.unseen as n, i}{i ? " " : ""}<a href={gh(d.repo, "issues", n)} target="_blank" rel="noopener">#{n}</a>{/each}
        </p>
      {/if}
      {#if !data.actions.length}
        <p class="muted">No agent actions in this window.</p>
      {:else}
        <ul>
          {#each data.actions as a (a.id)}
            <li class:undone={a.undone}>
              <time class="muted small num" datetime={a.at} title={time(a.at, d.timezone)}>{rel(a.at)}</time>
              <a class="num ref" href={gh(d.repo, a.kind === "pr" ? "pull" : "issues", a.n)} target="_blank" rel="noopener">#{a.n}</a>
              <span class="what">{a.what}</span>
              {#if a.undone}<span class="muted small">Undone</span>
              {:else if a.canUndo}<button class="btn sm" onclick={() => undo(a)}>Undo</button>{/if}
            </li>
          {/each}
        </ul>
        <p class="muted small foot">Merged code isn't undone here: revert it with a PR. Undoing is also an action by the app, so it shows up in this list.</p>
      {/if}
    {:else if !error}
      <p class="muted">Loading…</p>
    {/if}
  </div>
</section>

<style>
  .seg { display: inline-flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
  .seg button { border: 0; background: none; color: var(--muted); padding: 4px 10px; font-size: 12px; font-weight: 600; cursor: pointer; }
  .seg button.on { background: color-mix(in srgb, var(--accent) 16%, transparent); color: var(--ink); }
  ul { list-style: none; margin: 0; padding: 0; display: grid; }
  li { display: grid; grid-template-columns: 74px 52px 1fr auto; align-items: center; gap: 10px; padding: 8px 0; border-top: 1px solid var(--line); font-size: 13.5px; }
  li:first-child { border-top: 0; }
  li.undone .what { text-decoration: line-through; color: var(--muted); }
  .ref { font-weight: 650; }
  .what { min-width: 0; overflow-wrap: anywhere; }
  .note { margin: 0 0 12px; padding: 8px 12px; border-radius: 9px; background: color-mix(in srgb, var(--amber) 12%, transparent); border: 1px solid color-mix(in srgb, var(--amber) 35%, transparent); }
  .err { color: var(--red); }
  .foot { margin: 12px 0 0; }
  @media (max-width: 600px) { li { grid-template-columns: 52px 1fr auto; } li time { display: none; } }
</style>
