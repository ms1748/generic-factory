// The dashboard's offline shell. The page and its hashed assets are kept so the app opens without a network
// (it then shows the last state it saw); /api/ is never cached or touched. Only plain same-origin answers are
// kept: a redirect to the Cloudflare Access login passes straight through.
const CACHE = "factory-shell-v1";
const MAX_ASSETS = 80;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/"]).catch(() => {})).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const keep = (res) => res.ok && res.type === "basic";

async function put(req, res) {
  const c = await caches.open(CACHE);
  await c.put(req, res);
  const keys = await c.keys();
  // Old builds' assets go first (the oldest entries); the page itself stays.
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_ASSETS))) if (new URL(k.url).pathname !== "/") await c.delete(k);
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  // The page: the network first (the newest build), the kept copy when offline.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (keep(res)) e.waitUntil(put("/", res.clone()));
          return res;
        })
        .catch(() => caches.match("/").then((hit) => hit ?? Response.error())),
    );
    return;
  }

  // Hashed assets never change: the kept copy first. Icons and the manifest: the network, else the kept copy.
  const hashed = url.pathname.startsWith("/assets/");
  e.respondWith(
    (hashed ? caches.match(req) : Promise.resolve(undefined)).then(
      (hit) =>
        hit ??
        fetch(req)
          .then((res) => {
            if (keep(res)) e.waitUntil(put(req, res.clone()));
            return res;
          })
          .catch(() => caches.match(req).then((kept) => kept ?? Response.error())),
    ),
  );
});
