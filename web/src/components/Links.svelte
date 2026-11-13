<script>
  // Bookmarks, grouped. Edit adds and removes them (saved on the factory, so every browser sees them).
  import { control } from "../lib/api.svelte.js";
  let { d, editable = false } = $props();

  let editing = $state(false);
  let title = $state("");
  let url = $state("");
  let group = $state("");
  const groups = $derived([...new Set(d.links.map((l) => l.grp))]);
  const byGroup = $derived(groups.map((g) => ({ g, links: d.links.filter((l) => l.grp === g) })));
  const host = (u) => {
    try {
      return new URL(u).host.replace(/^www\./, "");
    } catch {
      return u;
    }
  };

  async function add(e) {
    e.preventDefault();
    if (!url.trim()) return;
    await control("links", { title, url, group: group || "Other" });
    title = "";
    url = "";
  }
</script>

<div class="links">
  {#if editable}
    <div class="bar">
      <span class="muted small">{d.links.length} links</span>
      <span class="spacer"></span>
      <button class="btn sm" onclick={() => (editing = !editing)}>{editing ? "Done" : "Edit"}</button>
    </div>
  {/if}
  <div class="groups">
    {#each byGroup as { g, links } (g)}
      <div class="group">
        <div class="g muted">{g}</div>
        {#each links as l (l.id)}
          <div class="row">
            <a href={l.url} target="_blank" rel="noopener" title={l.url}>
              <span class="badge" aria-hidden="true">{l.title.slice(0, 1).toUpperCase()}</span>
              <span class="t">{l.title}</span>
              <span class="h muted">{host(l.url)}</span>
            </a>
            {#if editing}<button class="x" aria-label={`Remove ${l.title}`} onclick={() => control(`links/${l.id}/remove`)}>✕</button>{/if}
          </div>
        {/each}
      </div>
    {:else}
      <div class="empty">No links yet.{#if editable} Press Edit to add one.{/if}</div>
    {/each}
  </div>
  {#if editing}
    <form class="add" onsubmit={add}>
      <input class="field" placeholder="Name" aria-label="Name" bind:value={title} />
      <input class="field url" placeholder="https://…" aria-label="Address" bind:value={url} required />
      <input class="field" placeholder="Group" aria-label="Group" list="link-groups" bind:value={group} />
      <datalist id="link-groups">{#each groups as g}<option value={g}></option>{/each}</datalist>
      <button class="btn primary sm" type="submit">Add link</button>
    </form>
  {/if}
</div>

<style>
  .bar { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
  .bar .spacer { flex: 1; }
  .groups { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 14px 18px; }
  .g { font-size: 11px; font-weight: 750; letter-spacing: .08em; text-transform: uppercase; margin-bottom: 4px; }
  .row { display: flex; align-items: center; gap: 4px; }
  a { display: grid; grid-template-columns: 22px 1fr; grid-template-rows: auto auto; column-gap: 8px; align-items: center; padding: 5px 6px; border-radius: 8px; flex: 1; min-width: 0; }
  a:hover { background: var(--panel-2); color: var(--ink); }
  .badge { grid-row: 1 / 3; width: 22px; height: 22px; border-radius: 6px; display: grid; place-items: center; font-size: 11px; font-weight: 750; background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--accent); }
  .t { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .h { font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .x { border: 0; background: none; color: var(--muted); cursor: pointer; padding: 4px 6px; border-radius: 6px; }
  .x:hover { color: var(--red); background: var(--panel-2); }
  .add { display: grid; grid-template-columns: 1fr 2fr 1fr auto; gap: 8px; margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--line); }
  @media (max-width: 860px) { .add { grid-template-columns: 1fr; } }
</style>
