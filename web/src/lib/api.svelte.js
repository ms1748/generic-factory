// The page's one source of truth: /api/state, polled (faster while a run is going, never while hidden),
// plus the controls (POSTs with the x-factory header the server requires).

function cached() {
  try {
    return JSON.parse(localStorage.getItem("factory.state") ?? "null");
  } catch {
    return null;
  }
}

/** The last state this browser saw paints at once; the live one replaces it a moment later. */
export const store = $state({ data: cached(), error: "", loadedAt: 0 });
export const toast = $state({ text: "", bad: false, key: 0 });

let timer = 0;

export async function load() {
  clearTimeout(timer);
  try {
    const res = await fetch("/api/state", { cache: "no-store" });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
    store.data = await res.json();
    try {
      localStorage.setItem("factory.state", JSON.stringify(store.data));
    } catch {
      // full or private: no cache, just slower first paint
    }
    store.error = "";
    store.loadedAt = Date.now();
  } catch (e) {
    store.error = e.message;
  }
  if (!document.hidden) timer = setTimeout(load, store.data?.running ? 4000 : 15000);
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) load();
  else clearTimeout(timer);
});

export function say(text, bad = false) {
  toast.text = text;
  toast.bad = bad;
  toast.key++;
}

/** POSTs a control; says how it went. Returns whether it worked. */
export async function control(path, body = {}, ok) {
  let worked = false;
  try {
    const res = await fetch("/api/" + path, {
      method: "POST",
      headers: { "content-type": "application/json", "x-factory": "1" },
      body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || res.statusText);
    say(ok || j.message);
    worked = true;
  } catch (e) {
    say(e.message, true);
  }
  load();
  setTimeout(load, 2500); // queued runs land a moment later
  return worked;
}

export async function runLog(id) {
  const res = await fetch(`/api/runs/${id}/log`, { cache: "no-store" });
  return res.ok ? res.json() : [];
}
