<script>
  // A PR's numbered test builds (newest first): the hosted build and the 7-day GitHub artifact.
  // Once the cleanup workflow has run they're listed as deleted, without links.
  import { rel } from "../lib/format.js";
  let { tb } = $props();
  const hostOf = (url) => {
    try {
      return new URL(url).host;
    } catch {
      return "Build";
    }
  };
</script>

{#if tb && tb.versions.length}
  <details class="tb" open={tb.versions.length <= 3}>
    <summary>
      Test builds <span class="num">{tb.versions.length}</span>
      {#if tb.deleted}<span class="chip">deleted</span>{/if}
    </summary>
    <ul>
      {#each tb.versions as x (x.v)}
        <li class:gone={tb.deleted}>
          <b class="num">v{x.v}</b>
          <span class="muted" title={new Date(x.at).toLocaleString()}>{x.sha ? x.sha + " · " : ""}{rel(x.at)}</span>
          {#if tb.deleted}
            <span class="muted">deleted</span>
          {:else}
            {#if x.site}<a href={x.site} target="_blank" rel="noopener">{hostOf(x.site)}</a>{/if}
            {#if x.artifact}<a href={x.artifact} target="_blank" rel="noopener" title={`Expires ${new Date(x.artifactExpires).toLocaleString()}`}>GitHub</a>
            {:else}<span class="muted" title="GitHub keeps artifacts for 7 days">GitHub expired</span>{/if}
          {/if}
        </li>
      {/each}
    </ul>
  </details>
{/if}

<style>
  .tb { position: relative; margin-top: 6px; font-size: 12px; }
  summary { cursor: pointer; color: var(--ink-2); font-weight: 600; display: flex; gap: 6px; align-items: center; }
  summary .num { color: var(--muted); }
  ul { list-style: none; margin: 4px 0 0; padding: 0; display: grid; gap: 2px; max-height: 140px; overflow-y: auto; }
  li { display: flex; gap: 6px; flex-wrap: wrap; align-items: baseline; }
  li.gone b { text-decoration: line-through; color: var(--muted); }
  a { color: var(--accent); }
</style>
