<script>
  // Devices: each test machine as CI sees it (src/devices.ts). What it's running now with every step live,
  // what's queued for it, and its last results with their artifacts, so checking a test never needs
  // Sunshine. Online and the CI pause come from Systems (its reporter or its CI guard).
  import { control } from "../lib/api.svelte.js";
  import { rel } from "../lib/format.js";
  import { pull as pullSystems, systems, watchSystems } from "../lib/systems.svelte.js";
  $effect(() => watchSystems());

  let data = $state(null);
  let error = $state("");
  let timer = 0;
  async function load() {
    clearTimeout(timer);
    try {
      const res = await fetch("/api/devices", { cache: "no-store" });
      if (!res.ok) throw new Error(res.statusText);
      data = await res.json();
      error = data.error ?? "";
    } catch (e) {
      error = e.message;
    }
    if (!document.hidden) timer = setTimeout(load, 10_000);
  }
  $effect(() => {
    load();
    const vis = () => !document.hidden && load();
    document.addEventListener("visibilitychange", vis);
    return () => (clearTimeout(timer), document.removeEventListener("visibilitychange", vis));
  });

  const sys = (name) => systems.data?.devices?.find((m) => m.name === name);
  const mark = (s) => (s.status === "completed" ? (s.conclusion === "success" ? "✓" : s.conclusion === "skipped" ? "–" : "✗") : s.status === "in_progress" ? "▶" : "·");
  const cls = (s) => (s.status === "in_progress" ? "run" : s.status !== "completed" ? "wait" : s.conclusion === "success" ? "ok" : s.conclusion === "skipped" ? "skip" : "bad");
  const secs = (n) => (n == null ? "" : n < 60 ? `${n}s` : `${Math.floor(n / 60)}m ${n % 60}s`);
  const size = (b) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);
  const ciPause = (name, paused) => control(`devices/${name}/ci`, { paused }).then(pullSystems);
</script>

<p class="muted small lede">
  Each test machine as CI sees it: the job it's running, every step live, what's waiting for it, and the last results with their files. Refreshes every 10 s.
  {#if error}<span class="err">Couldn't read CI: {error}</span>{/if}
</p>

{#if !data}
  <div class="empty">Loading…</div>
{:else}
  <div class="machines">
    {#each data.machines as m (m.name)}
      {@const s = sys(m.name)}
      {@const busy = m.now.length > 0}
      <section class="panel machine" aria-label={m.name}>
        <header>
          <span class="dot" class:on={s?.online || busy} title={s?.online || busy ? "Online" : s?.lastSeen ? `Last seen ${rel(s.lastSeen)}` : "No reports"}></span>
          <div class="id"><h3>{m.name}</h3><span class="muted small">{m.role}</span></div>
          <span class="spacer"></span>
          <span class="chip" class:live={busy}>{busy ? "running a job" : m.queue.length ? `${m.queue.length} waiting` : "idle"}</span>
          {#if s?.ci}
            <button class="btn sm" class:primary={s.ci.owner} onclick={() => ciPause(m.name, !s.ci.owner)}>{s.ci.owner ? "Resume CI" : "Pause CI"}</button>
          {/if}
        </header>
        {#if s?.ci?.guard?.state === "paused"}
          <div class="note">CI paused {s.ci.guard.why === "owner" ? "by you" : s.ci.guard.game ? `while ${s.ci.guard.game} runs` : "while a game runs"}: new jobs wait at their first step.</div>
        {/if}

        {#each m.now as j (j.id)}
          <div class="job now">
            <div class="jhead"><b>{j.name}</b><span class="muted small">{j.branch ?? ""} · started {rel(j.at)}</span><a class="small" href={j.url} target="_blank" rel="noopener">Log</a></div>
            <ol class="steps">
              {#each j.steps as st}
                <li class={cls(st)}><span class="m">{mark(st)}</span><span class="n">{st.name}</span><span class="t muted">{secs(st.seconds)}</span></li>
              {/each}
            </ol>
          </div>
        {/each}

        {#if m.queue.length}
          <div class="sub">Waiting for it</div>
          <ul class="list">
            {#each m.queue as j (j.id)}<li><span class="m wait">·</span> {j.name} <span class="muted small">{j.branch ?? ""} · queued {rel(j.at)}</span></li>{/each}
          </ul>
        {/if}

        <div class="sub">Last results</div>
        {#if m.recent.length}
          <ul class="list">
            {#each m.recent as j (j.id)}
              <li>
                <span class="m {j.conclusion === 'success' ? 'ok' : 'bad'}">{j.conclusion === "success" ? "✓" : "✗"}</span>
                <a href={j.url} target="_blank" rel="noopener">{j.name}</a>
                <span class="muted small">{j.branch ?? ""} · {rel(j.at)}</span>
                {#if j.conclusion !== "success"}
                  {@const bad = j.steps.find((x) => x.status === "completed" && x.conclusion === "failure")}
                  {#if bad}<div class="why small">Failed at <b>{bad.name}</b></div>{/if}
                {/if}
                {#if j.artifacts.length}
                  <div class="arts small">
                    {#each j.artifacts as a}
                      {#if a.expired}<span class="muted">{a.name} (expired)</span>{:else}<a href={a.url} target="_blank" rel="noopener">{a.name}</a> <span class="muted">{size(a.size)}</span>{/if}
                    {/each}
                  </div>
                {/if}
              </li>
            {/each}
          </ul>
        {:else}
          <div class="empty small">No finished jobs in the last runs.</div>
        {/if}
      </section>
    {/each}
  </div>
{/if}

<style>
  .lede { margin: 0 0 12px; }
  .err { color: var(--red); margin-left: 8px; }
  .machines { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 12px; }
  .machine { padding: 16px; display: grid; gap: 10px; align-content: start; }
  header { display: flex; align-items: center; gap: 10px; }
  .id { display: grid; }
  h3 { margin: 0; font-size: 15px; }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--muted); }
  .dot.on { background: var(--run); }
  .note { font-size: 12.5px; padding: 7px 10px; border-radius: 8px; border: 1px solid color-mix(in srgb, var(--wait) 45%, var(--line)); }
  .job { border: 1px solid var(--line); border-radius: 8px; padding: 10px; }
  .job.now { border-color: color-mix(in srgb, var(--run) 45%, var(--line)); }
  .jhead { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
  .jhead a { margin-left: auto; }
  .steps { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 3px; font-size: 12.5px; }
  .steps li { display: grid; grid-template-columns: 16px 1fr auto; gap: 6px; }
  .sub { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; margin-top: 4px; }
  .list { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; font-size: 13px; }
  .m { display: inline-block; width: 14px; }
  .ok { color: var(--run); }
  .bad { color: var(--red); }
  .run { color: var(--amber); }
  .wait, .skip { color: var(--muted); }
  .why { margin: 2px 0 0 20px; color: var(--muted); }
  .arts { margin: 2px 0 0 20px; display: flex; flex-wrap: wrap; gap: 4px 10px; }
  .empty { color: var(--muted); }
</style>
