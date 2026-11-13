<script>
  // A run's transcript as a conversation: Claude's messages as readable blocks, each tool step as
  // one compact row (open it for the command and its output), errors in red and opened, and the
  // outcome pinned at the top. Follows new lines while you're at the bottom.
  import { md } from "../lib/md.js";
  let { entries, repo = "", live = false } = $props();

  let stepsShown = $state(true);
  let openAll = $state(false);
  let box = $state();
  let pinned = true;

  const ICONS = { Bash: "›_", Read: "◫", Edit: "✎", Write: "✚", MultiEdit: "✎", Grep: "⌕", Glob: "⌕", WebFetch: "⇣", WebSearch: "⌕", Task: "◇", TodoWrite: "☑" };

  /** Pair each tool call with the result that follows it; keep Claude's words and the outcome. */
  const items = $derived.by(() => {
    const out = [];
    let outcome = null;
    for (const e of entries) {
      if (e.kind === "tool") out.push({ type: "step", name: e.name, text: e.text, result: null, error: false });
      else if (e.kind === "result" || e.kind === "error") {
        const step = [...out].reverse().find((x) => x.type === "step" && x.result === null);
        if (step) {
          step.result = e.text;
          step.error = e.kind === "error";
        } else out.push({ type: "note", text: e.text, error: e.kind === "error" });
      } else if (e.kind === "text") out.push({ type: "say", text: e.text });
      else if (e.kind === "done") outcome = e.text;
      else if (e.kind === "stderr") out.push({ type: "note", text: e.text, error: true });
    }
    return { list: out, outcome, steps: out.filter((x) => x.type === "step").length, errors: out.filter((x) => x.error).length };
  });

  $effect.pre(() => {
    entries;
    if (box) pinned = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
  });
  $effect(() => {
    entries;
    if (box && pinned && live) box.scrollTop = box.scrollHeight;
  });
</script>

<div class="tr">
  <div class="bar">
    <span class="muted small">{items.steps} step{items.steps === 1 ? "" : "s"}{items.errors ? ` · ${items.errors} error${items.errors === 1 ? "" : "s"}` : ""}</span>
    <span class="spacer"></span>
    <label class="small"><input type="checkbox" bind:checked={stepsShown} /> Show steps</label>
    <button class="btn ghost sm" onclick={() => (openAll = !openAll)}>{openAll ? "Collapse steps" : "Expand steps"}</button>
  </div>

  <div class="scroll" bind:this={box}>
    {#if items.outcome}
      <div class="outcome prose"><div class="label">Outcome</div>{@html md(items.outcome, repo)}</div>
    {/if}
    {#if !items.list.length && !items.outcome}
      <div class="empty">{live ? "Starting…" : "No transcript."}</div>
    {/if}
    {#each items.list as it, i (i)}
      {#if it.type === "say"}
        <div class="say prose"><span class="who">Claude</span>{@html md(it.text, repo)}</div>
      {:else if it.type === "step" && stepsShown}
        <details class="step" class:error={it.error} open={openAll || it.error}>
          <summary>
            <span class="icon mono" aria-hidden="true">{ICONS[it.name] ?? "•"}</span>
            <b>{it.name}</b>
            <span class="what">{it.text}</span>
            {#if it.result === null}<span class="pending" title="Waiting for the result"></span>{/if}
          </summary>
          <pre class="cmd">{it.text}</pre>
          {#if it.result !== null}<pre class="out">{it.result || "(no output)"}</pre>{/if}
        </details>
      {:else if it.type === "note" && stepsShown}
        <div class="note mono" class:error={it.error}>{it.text}</div>
      {/if}
    {/each}
  </div>
</div>

<style>
  .tr { display: flex; flex-direction: column; min-height: 0; height: 100%; }
  .bar { display: flex; align-items: center; gap: 10px; padding: 0 0 10px; border-bottom: 1px solid var(--line); }
  .bar .spacer { flex: 1; }
  .bar label { display: inline-flex; gap: 6px; align-items: center; color: var(--muted); cursor: pointer; }
  .scroll { overflow-y: auto; flex: 1; min-height: 0; padding: 12px 4px 12px 0; display: grid; gap: 8px; align-content: start; }
  .outcome { border: 1px solid color-mix(in srgb, var(--teal) 40%, var(--line)); background: color-mix(in srgb, var(--teal) 7%, var(--panel)); border-radius: 12px; padding: 10px 14px; }
  .label { font-size: 11px; font-weight: 750; letter-spacing: .08em; text-transform: uppercase; color: var(--teal); }
  .say { background: var(--panel-2); border: 1px solid var(--line); border-radius: 12px; padding: 8px 14px; }
  .say .who { display: block; font-size: 11px; font-weight: 750; letter-spacing: .08em; text-transform: uppercase; color: var(--violet); margin-top: 4px; }
  .step { border-radius: 8px; border: 1px solid transparent; }
  .step[open] { border-color: var(--line); background: var(--bg-2); }
  .step.error { border-color: color-mix(in srgb, var(--red) 45%, var(--line)); }
  summary { display: flex; align-items: center; gap: 8px; padding: 4px 8px; cursor: pointer; list-style: none; font-size: 12.5px; color: var(--ink-2); border-radius: 8px; min-width: 0; }
  summary::-webkit-details-marker { display: none; }
  summary:hover { background: var(--panel-2); }
  .icon { width: 22px; height: 20px; display: grid; place-items: center; border-radius: 5px; background: var(--panel-2); border: 1px solid var(--line); color: var(--muted); font-size: 11px; flex: none; }
  .error .icon { color: var(--red); border-color: color-mix(in srgb, var(--red) 40%, var(--line)); }
  summary b { font-weight: 650; color: var(--ink); flex: none; }
  .what { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; color: var(--muted); font-family: var(--mono); font-size: 12px; }
  .pending { width: 7px; height: 7px; border-radius: 50%; background: var(--violet); margin-left: auto; flex: none; animation: blink 1s infinite alternate; }
  @keyframes blink { to { opacity: .3; } }
  pre { margin: 0 8px 8px; padding: 8px 10px; border-radius: 7px; font-family: var(--mono); font-size: 12px; white-space: pre-wrap; word-break: break-word; max-height: 280px; overflow: auto; }
  .cmd { background: var(--panel); color: var(--ink-2); border: 1px solid var(--line); }
  .out { background: var(--panel); color: var(--muted); border: 1px solid var(--line); }
  .error .out { color: var(--red); }
  .note { font-size: 12px; color: var(--muted); padding: 4px 8px; white-space: pre-wrap; }
  .note.error { color: var(--red); }
</style>
