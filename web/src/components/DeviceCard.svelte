<script>
  // One machine: live gauges, the last 24 hours, its disks, its containers (the factory's host) and facts.
  import Spark from "./Spark.svelte";
  import { bytes, level, systems, tempLevel, uptime } from "../lib/systems.svelte.js";
  import { rel } from "../lib/format.js";
  let { m, compact = false, onforget = null, onci = null, onthreads = null, host = "" } = $props();
  // CI on this machine (its game guard): what it's doing now, and the owner's pause switch.
  const ciText = $derived.by(() => {
    const c = m.ci;
    if (!c) return "";
    const g = c.guard;
    if (!g) return c.owner ? "CI paused by you (the guard hasn't checked in lately)" : `CI guard not checking in${c.lastCheck ? ` · last ${rel(c.lastCheck)}` : ""}`;
    if (g.state === "running" && g.game) return `CI: ${g.busy ? "running a job" : "ready for jobs"} with ${c.threads?.gaming ?? "fewer"} threads while ${g.game} runs`;
    if (g.state === "running") return g.busy ? "CI: running a job" : "CI: ready for jobs";
    const why = g.why === "owner" ? "paused by you" : g.game ? `paused while ${g.game} runs` : "paused while a game runs";
    return `CI ${why}${g.busy ? " · the current job finishes at idle priority" : ""}`;
  });

  // CI build threads (CARGO_BUILD_JOBS) the guard hands each job: a default, while gaming, and what a PR may ask for.
  let editing = $state(false);
  let form = $state({ default: 6, gaming: "pause", max: 12 });
  const threadsText = $derived.by(() => {
    const t = m.ci?.threads;
    if (!t) return "";
    return `Builds use ${t.default} threads · PRs may ask for up to ${t.max} · while you play: ${t.gaming == null ? "paused" : t.gaming}`;
  });
  function edit() {
    const t = m.ci.threads;
    form = { default: t.default, gaming: t.gaming == null ? "pause" : String(t.gaming), max: t.max };
    editing = !editing;
  }
  async function save(e) {
    e.preventDefault();
    if (await onthreads(m.name, { default: Number(form.default), gaming: form.gaming === "pause" ? null : Number(form.gaming), max: Number(form.max) })) editing = false;
  }

  const mem = $derived(m.memTotal ? m.memUsed / m.memTotal : null);
  const disk = $derived(m.disks?.length ? Math.max(...m.disks.map((x) => x.used / x.total)) : null);
  let metric = $state("cpu");
  const pctFmt = (v) => Math.round(v * 100) + "%";
  const metrics = [
    { key: "cpu", label: "CPU", color: "var(--violet)", max: 1, fmt: pctFmt },
    { key: "mem", label: "Memory", color: "var(--teal)", max: 1, fmt: pctFmt },
    { key: "disk", label: "Disk", color: "var(--amber)", max: 1, fmt: pctFmt },
    { key: "temp", label: "Temp", color: "var(--pink)", max: 100, fmt: (v) => Math.round(v) + " °C" },
    { key: "net", label: "Network", color: "var(--chart-2)", max: 0, fmt: (v) => bytes(v) + "/s" },
    { key: "gpu", label: "GPU", color: "var(--red)", max: 1, fmt: pctFmt },
    { key: "gpuTemp", label: "GPU temp", color: "var(--pink)", max: 100, fmt: (v) => Math.round(v) + " °C" },
    { key: "gpuPower", label: "GPU W", color: "var(--amber)", max: 0, fmt: (v) => Math.round(v) + " W" },
    { key: "cpuPower", label: "CPU W", color: "var(--amber)", max: 0, fmt: (v) => Math.round(v) + " W" },
    { key: "fan", label: "Fans", color: "var(--chart-2)", max: 0, fmt: (v) => Math.round(v) + " RPM" },
  ];
  // A tab only for what this machine has reported in the range.
  const shown = $derived(metrics.filter((x) => ["cpu", "mem"].includes(x.key) || (m.history ?? []).some((h) => h[x.key] != null)));
  const cur = $derived(metrics.find((x) => x.key === metric) ?? metrics[0]);
  const pts = $derived((m.history ?? []).map((h) => ({ at: h.at, v: h[cur.key] })));
  const rangeWords = { "1h": "last hour", "24h": "last 24 hours", "7d": "last 7 days", "30d": "last 30 days" };
  const containers = $derived([...(m.containers ?? [])].sort((a, b) => (b.cpu ?? 0) - (a.cpu ?? 0)));
  const running = $derived((m.guests ?? []).filter((g) => g.status === "running").length);
  // One row each: a bar, the number, and a short note. Temperatures in °C, not as a percentage.
  const p = (v) => (v == null ? "–" : Math.round(v * 100) + "%");
  const gauges = $derived([
    { label: "CPU", value: m.cpu, color: level(m.cpu), text: p(m.cpu), sub: m.cores ? `${m.cores} threads` : "" },
    { label: "Memory", value: mem, color: level(mem, 0.8, 0.92), text: p(mem), sub: m.memTotal ? `${bytes(m.memUsed)} / ${bytes(m.memTotal, 0)}` : "" },
    { label: "Disk", value: disk, color: level(disk, 0.8, 0.92), text: p(disk), sub: m.disks?.length === 1 ? `${bytes(m.disks[0].total - m.disks[0].used)} free` : m.disks?.length ? `${m.disks.length} volumes` : "" },
    ...(m.gpu?.util != null ? [{ label: "GPU", value: m.gpu.util, color: level(m.gpu.util), text: p(m.gpu.util), sub: m.gpu.memTotal ? `${bytes(m.gpu.memUsed)} / ${bytes(m.gpu.memTotal, 0)}` : "" }] : []),
    ...(m.sensors?.cpuTemp != null
      ? [{ label: "CPU temp", value: m.sensors.cpuTemp / 100, color: tempLevel(m.sensors.cpuTemp), text: `${Math.round(m.sensors.cpuTemp)} °C`, sub: [m.sensors.cpuPower != null ? `${Math.round(m.sensors.cpuPower)} W` : "", m.sensors.cpuClock != null ? `${(m.sensors.cpuClock / 1000).toFixed(2)} GHz` : ""].filter(Boolean).join(" · ") }]
      : m.temp != null ? [{ label: "Temp", value: m.temp / 100, color: tempLevel(m.temp), text: `${Math.round(m.temp)} °C`, sub: "" }] : []),
    ...(m.gpu?.temp != null ? [{ label: "GPU temp", value: m.gpu.temp / 100, color: tempLevel(m.gpu.temp), text: `${Math.round(m.gpu.temp)} °C`, sub: [m.gpu.fan != null ? `fan ${Math.round(m.gpu.fan)}%` : m.facts?.["GPU fan"] ? `fan ${m.facts["GPU fan"]}` : "", m.gpu.power != null ? `${Math.round(m.gpu.power)} W` : ""].filter(Boolean).join(" · ") }] : []),
  ]);
  // The rest folds away: specs, disks, containers, facts.
  const extra = $derived(Object.entries(m.facts ?? {}).filter(([k]) => k !== "GPU fan"));
  const warnings = $derived(extra.filter(([, v]) => /not installed|pending/.test(v)).length);
</script>

<article class="dev panel" class:off={!m.online} class:compact>
  <header>
    <span class="state" class:on={m.online} title={m.online ? "Reporting" : m.lastSeen ? `Last report ${rel(m.lastSeen)}` : "Never reported"}></span>
    <div class="id">
      <h3>{m.name}</h3>
      <span class="muted small">{m.role ?? m.model ?? ""}</span>
    </div>
    <span class="spacer"></span>
    <span class="chip" class:live={m.online}>{m.online ? `up ${uptime(m.uptime)}` : m.lastSeen ? `offline · ${rel(m.lastSeen)}` : "not set up"}</span>
  </header>

  {#if m.ci}
    <div class="ci" class:paused={m.ci.owner || m.ci.guard?.state === "paused"}>
      <span>{ciText}</span>
      <span class="spacer"></span>
      {#if onci}<button class="btn sm" class:primary={m.ci.owner} onclick={() => onci(m.name, !m.ci.owner)}>{m.ci.owner ? "Resume CI" : "Pause CI"}</button>{/if}
    </div>
    {#if m.ci.threads}
      <div class="threads small">
        <span class="muted">{threadsText}</span>
        <span class="spacer"></span>
        {#if onthreads}<button class="btn sm" onclick={edit}>{editing ? "Close" : "Build threads"}</button>{/if}
      </div>
      {#if editing}
        <form class="tform small" onsubmit={save}>
          <label>Every build <input class="field" type="number" min="1" max="64" bind:value={form.default} required /></label>
          <label>While you play
            <select class="field" bind:value={form.gaming}>
              <option value="pause">Paused</option>
              {#each Array.from({ length: Math.max(m.cores ?? 16, 1) }, (_, i) => String(i + 1)) as n}<option value={n}>{n} threads</option>{/each}
            </select>
          </label>
          <label>Most a PR may ask for <input class="field" type="number" min="1" max="64" bind:value={form.max} required /></label>
          <button class="btn sm primary" type="submit">Save</button>
          <span class="muted">{m.cores ? `This PC has ${m.cores} threads. ` : ""}A PR asks with a <code>build-threads:N</code> label or a "Build threads: N" line; it gets no more than the most above (or the while-you-play number). Takes effect from the next job.</span>
        </form>
      {/if}
    {/if}
  {/if}

  {#if m.lastSeen}
    <div class="meters">
      {#each gauges as g (g.label)}
        <span class="ml">{g.label}</span>
        <span class="track"><i style:width={Math.min(100, (g.value ?? 0) * 100) + "%"} style:background={g.color}></i></span>
        <span class="mv num">{g.text}</span>
        <span class="ms num muted">{g.sub}</span>
      {/each}
    </div>

    {#if !compact}
      <div class="trend">
        <div class="tabs" role="tablist" aria-label="History">
          {#each shown as x (x.key)}
            <button role="tab" aria-selected={cur.key === x.key} class:on={cur.key === x.key} onclick={() => (metric = x.key)}>{x.label}</button>
          {/each}
          <span class="spacer"></span>
          <span class="muted small">{systems.range}</span>
        </div>
        {#if pts.filter((p) => p.v != null).length > 1}
          <Spark points={pts} color={cur.color} max={cur.max} format={cur.fmt} label={`${m.name} ${cur.label}, ${rangeWords[systems.range] ?? ""}`} />
        {:else}
          <div class="muted small nohist">History fills in as reports arrive.</div>
        {/if}
      </div>

      <details class="more">
      <summary><span>Details</span>{#if warnings}<span class="warnc">{warnings} to check</span>{/if}<span class="spacer"></span><span class="muted small">{rel(m.lastSeen)}</span></summary>
      <div class="more-body">
      <dl class="specs">
        {#if m.cpuModel}<dt>CPU</dt><dd>{m.cpuModel}</dd>{/if}
        {#if m.gpu}<dt>GPU</dt><dd>{m.gpu.name}{m.gpu.memTotal ? ` · ${bytes(m.gpu.memUsed)} / ${bytes(m.gpu.memTotal, 0)}` : ""}</dd>{/if}
        {#if m.os}<dt>OS</dt><dd>{m.os}</dd>{/if}
        {#if m.load?.length}<dt>Load</dt><dd class="num">{m.load.map((x) => x.toFixed(2)).join(" · ")}</dd>{/if}
        {#if m.net}<dt>Network</dt><dd class="num">↓ {bytes(m.net.rx)}/s · ↑ {bytes(m.net.tx)}/s</dd>{/if}
        {#if m.sensors?.ccdTemps?.length}<dt>CCDs</dt><dd class="num">{m.sensors.ccdTemps.map((t) => Math.round(t) + " °C").join(" · ")}</dd>{/if}
        {#if m.sensors?.fans?.length}<dt>Fans</dt><dd class="num">{m.sensors.fans.map((f) => `${f.name} ${Math.round(f.rpm)}`).join(" · ")} RPM</dd>{/if}
      </dl>

      {#if m.events?.length}
        <div class="boots">
          <b class="small">Starts and stops</b>
          {#each m.events as e (e.at + e.id)}
            <div class="boot" class:bad={e.id === 6008 || e.id === 41}><span class="num muted small">{rel(e.at)}</span> <span class="small">{e.kind}{e.reason ? `: ${e.reason}` : ""}</span></div>
          {/each}
        </div>
      {/if}

      {#if m.disks?.length}
        <div class="bars">
          {#each m.disks as x (x.mount)}
            {@const f = x.used / x.total}
            <div class="bar-row">
              <span class="mono small">{x.mount}</span>
              <span class="track"><i style:width={f * 100 + "%"} style:background={level(f, 0.8, 0.92)}></i></span>
              <span class="num small muted">{bytes(x.used)} / {bytes(x.total, 0)}</span>
            </div>
          {/each}
        </div>
      {/if}

      {#if containers.length}
        <details class="guests">
          <summary><b>Docker</b> <span class="muted small">{containers.length} container{containers.length === 1 ? "" : "s"} in the factory's LXC</span></summary>
          <div class="glist">
            {#each containers as c (c.name)}
              <div class="g ctr" class:agent={c.name.startsWith("factory-run-")}>
                <span class="gname mono small" title={c.name}>{c.name.replace(/^factory-/, "").replace(/-1$/, "")}</span>
                <span class="track sm" title={`CPU ${Math.round((c.cpu ?? 0) * 100)}%`}><i style:width={Math.min(100, (c.cpu ?? 0) * 100) + "%"} style:background="var(--violet)"></i></span>
                <span class="num small muted gm">{Math.round((c.cpu ?? 0) * 100)}% · {bytes(c.mem)}</span>
              </div>
            {/each}
          </div>
        </details>
      {/if}

      {#if m.guests?.length}
        <details class="guests" open>
          <summary><b>Containers and VMs</b> <span class="muted small">{running} of {m.guests.length} running</span></summary>
          <div class="glist">
            {#each m.guests as g (g.id)}
              <div class="g" class:stopped={g.status !== "running"}>
                <span class="gid mono">{g.id}</span>
                <span class="gname">{g.name}<span class="muted small"> · {g.type === "qemu" ? "VM" : "LXC"}</span></span>
                <span class="track sm" title="CPU"><i style:width={(g.cpu ?? 0) * 100 + "%"} style:background="var(--violet)"></i></span>
                <span class="num small muted gm">{g.memTotal ? `${bytes(g.mem)} / ${bytes(g.memTotal, 0)}` : g.status}</span>
              </div>
            {/each}
          </div>
        </details>
      {/if}

      {#if extra.length}
        <div class="facts">
          {#each extra as [k, v]}
            <span class="fact" class:warn={/not installed|pending/.test(v)}><span class="muted">{k}</span> <b>{v}</b></span>
          {/each}
        </div>
      {/if}

      <footer class="muted small">
        {m.sources?.length ? `From ${m.sources.map((s) => (s === "pve" ? "the Proxmox API" : "its reporter")).join(" and ")}` : "Saved report"} · {rel(m.lastSeen)}
        {#if onforget && !m.online && !m.role}<button class="btn ghost sm" onclick={() => onforget(m.name)}>Forget</button>{/if}
      </footer>
      </div>
      </details>
    {/if}
  {:else}
    <p class="muted small setup">
      {#if m.name === host}Set <code>PVE_URL</code> and <code>PVE_TOKEN</code> in the factory's env (a read-only PVEAuditor token), and run <code>machines/reporters/report-linux.sh</code> on the host for temperatures.
      {:else}On this PC, in an elevated PowerShell: <code>reporters\report-windows.ps1 -Install -Name {m.name} -Url http://&lt;factory-host&gt;:8080</code> (the dispatcher's address on your network){/if}
    </p>
  {/if}
</article>

<style>
  .ci { display: flex; align-items: center; gap: 8px; font-size: 12.5px; padding: 7px 10px; border-radius: 8px; border: 1px solid var(--line); }
  .ci.paused { border-color: color-mix(in srgb, var(--wait) 45%, var(--line)); }
  .threads { display: flex; align-items: center; gap: 8px; margin-top: -4px; padding: 0 10px; }
  .tform { display: flex; flex-wrap: wrap; align-items: end; gap: 8px 12px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; }
  .tform label { display: grid; gap: 3px; color: var(--muted); }
  .tform input { width: 70px; }
  .tform code { font-family: var(--mono); font-size: 11.5px; }
  .dev { padding: 14px; display: grid; gap: 11px; align-content: start; position: relative; overflow: hidden; }
  .dev::before { content: ""; position: absolute; inset: 0 0 auto 0; height: 2px; background: linear-gradient(90deg, var(--teal), var(--violet), transparent); opacity: .8; }
  .dev.off::before { background: linear-gradient(90deg, var(--line-2), transparent); }
  header { display: flex; align-items: center; gap: 10px; }
  .id { display: grid; min-width: 0; }
  h3 { margin: 0; font-size: 16px; letter-spacing: -.01em; }
  .spacer { flex: 1; }
  .state { width: 10px; height: 10px; border-radius: 50%; background: var(--line-2); flex: none; }
  .state.on { background: var(--teal); box-shadow: 0 0 0 0 color-mix(in srgb, var(--teal) 50%, transparent); animation: beat 2.4s infinite; }
  @keyframes beat { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--teal) 50%, transparent); } 70% { box-shadow: 0 0 0 8px transparent; } 100% { box-shadow: 0 0 0 0 transparent; } }
  .meters { display: grid; grid-template-columns: 64px minmax(40px, 1fr) 44px auto; gap: 6px 10px; align-items: center; font-size: 12.5px; }
  .ml { color: var(--muted); white-space: nowrap; }
  .mv { text-align: right; }
  .ms { font-size: 11.5px; white-space: nowrap; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .dev.off .meters { opacity: .55; }
  .more { border-top: 1px solid var(--line); padding-top: 8px; }
  .more summary { display: flex; align-items: center; gap: 8px; cursor: pointer; list-style: none; font-size: 12.5px; color: var(--ink-2); }
  .more summary::-webkit-details-marker { display: none; }
  .more summary::before { content: "▸"; color: var(--muted); font-size: 10px; transition: transform .15s; }
  .more[open] summary::before { transform: rotate(90deg); }
  .warnc { color: var(--wait); font-size: 12px; }
  .more-body { display: grid; gap: 12px; margin-top: 10px; }
  .trend { display: grid; gap: 6px; }
  .tabs { display: flex; gap: 2px; align-items: center; min-width: 0; overflow-x: auto; scrollbar-width: none; }
  .trend { min-width: 0; }
  .tabs button { border: 1px solid transparent; background: none; color: var(--muted); font-size: 12px; font-weight: 650; padding: 2px 8px; flex: none; border-radius: 99px; cursor: pointer; }
  .tabs button.on { color: var(--ink); background: var(--panel-2); border-color: var(--line-2); }
  .nohist { height: 44px; display: grid; place-items: center; border: 1px dashed var(--line); border-radius: 9px; }
  .specs { display: grid; grid-template-columns: auto 1fr; gap: 3px 12px; margin: 0; font-size: 12.5px; }
  .specs dt { color: var(--muted); }
  .specs dd { margin: 0; color: var(--ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bars, .glist { display: grid; gap: 6px; }
  .bar-row { display: grid; grid-template-columns: 70px 1fr auto; gap: 10px; align-items: center; }
  .track { height: 6px; border-radius: 99px; background: var(--line); overflow: hidden; display: block; }
  .track.sm { height: 4px; }
  .track i { display: block; height: 100%; border-radius: 99px; transition: width .6s; }
  .guests summary { cursor: pointer; font-size: 13px; list-style: none; display: flex; gap: 8px; align-items: baseline; }
  .guests summary::-webkit-details-marker { display: none; }
  .glist { margin-top: 8px; }
  .g { display: grid; grid-template-columns: 34px 1fr 60px 110px; gap: 10px; align-items: center; font-size: 12.5px; }
  .g.ctr { grid-template-columns: 1fr 60px 120px; }
  .g.agent .gname { color: var(--violet); font-weight: 650; }
  .g.stopped { opacity: .5; }
  .gid { color: var(--muted); font-size: 11.5px; }
  .gname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .gm { text-align: right; }
  .facts { display: flex; flex-wrap: wrap; gap: 6px; }
  .fact { font-size: 12px; padding: 2px 9px; border-radius: 8px; background: var(--bg-2); border: 1px solid var(--line); }
  .fact.warn b { color: var(--amber); }
  footer { display: flex; align-items: center; gap: 8px; justify-content: space-between; }
  .setup code { font-family: var(--mono); font-size: 11.5px; background: var(--bg-2); border: 1px solid var(--line); border-radius: 5px; padding: 0 4px; overflow-wrap: anywhere; }
  @media (max-width: 520px) {
    .g { grid-template-columns: 34px 1fr 90px; } .g .track { display: none; }
    .meters { grid-template-columns: 58px minmax(30px, 1fr) 40px; } .ms { display: none; }
    .ci { flex-wrap: wrap; }
  }
  .boots { display: grid; gap: 2px; margin: 8px 0; }
  .boot { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .boot.bad .small:last-child { color: var(--fail); }
</style>
