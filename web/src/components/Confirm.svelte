<script>
  // A calm confirmation dialog for anything that spends the Claude plan or changes the factory.
  let { ask = $bindable() } = $props();
  let dialog = $state();
  $effect(() => {
    if (ask && dialog && !dialog.open) dialog.showModal();
    if (!ask && dialog?.open) dialog.close();
  });
  function yes() {
    const a = ask.action;
    ask = null;
    a();
  }
</script>

<dialog bind:this={dialog} onclose={() => (ask = null)} aria-labelledby="confirm-title">
  {#if ask}
    <h3 id="confirm-title">{ask.title}</h3>
    <p>{ask.body}</p>
    <div class="row">
      <button class="btn" onclick={() => (ask = null)}>Cancel</button>
      <button class="btn primary" onclick={yes}>{ask.yes}</button>
    </div>
  {/if}
</dialog>

<style>
  dialog { border: 1px solid var(--line-2); border-radius: 16px; background: var(--panel); color: var(--ink); padding: 20px 22px; width: min(440px, calc(100vw - 32px)); box-shadow: 0 30px 60px rgb(0 0 0 / .4); }
  dialog::backdrop { background: rgb(0 0 0 / .5); }
  h3 { margin: 0 0 8px; font-size: 16px; }
  p { margin: 0 0 18px; color: var(--ink-2); }
  .row { display: flex; justify-content: flex-end; gap: 8px; }
</style>
