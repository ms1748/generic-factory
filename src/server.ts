// The dispatcher's HTTP server: GitHub App webhooks (signed with WEBHOOK_SECRET), the dashboard and its
// API, and a health check. Through the tunnel, Cloudflare Access guards everything but /webhooks/ and
// the app checks the Access token itself too (access.ts); on the tailnet it's reached directly. Without
// Access, the built-in sign-in (auth.ts) serves /login and /logout here.
import { createHmac, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { allowed, signIn } from "./access.ts";
import { dashboardExposure, isLocalHost, sameOrigin, viaHttps, type SignIn } from "./auth.ts";
import { HttpError, type Dashboard } from "./dashboard.ts";
import type { Systems } from "./systems.ts";
import { containers, logs } from "./logs.ts";
import { reports } from "./reports.ts";
import { install } from "./install.ts";
import type { Perf } from "./perf.ts";

const PR_EVENTS = new Set(["issue_comment", "pull_request_review", "pull_request_review_comment"]);
const MAX_BODY = 5 * 1024 * 1024;
// The dashboard page, built by `npm run build:web` (React + Vite) into web/dist.
const WEB = fileURLToPath(new URL("../web/dist/", import.meta.url));
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml",
  ".png": "image/png", ".woff2": "font/woff2", ".json": "application/json", ".webmanifest": "application/manifest+json",
};

export function verifySignature(secret: string, body: Buffer, header: string | undefined): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const want = Buffer.from("sha256=" + createHmac("sha256", secret).update(body).digest("hex"));
  const got = Buffer.from(header);
  return got.length === want.length && timingSafeEqual(got, want);
}

/** The PR or issue a webhook is about, if it's a comment, review or line comment on one of `repos`. An issue may be
 * a card that a PR session is building (the owner answering there). */
export function prFromEvent(event: string, payload: Record<string, any>, repos: string | string[]): number | undefined {
  if (![repos].flat().includes(payload.repository?.full_name)) return undefined;
  // CI finished on a PR (ci.ts): a check suite (Checks permission) or a workflow run (Actions).
  if (event === "check_suite" || event === "workflow_run") {
    const run = payload.check_suite ?? payload.workflow_run;
    return payload.action === "completed" ? run?.pull_requests?.[0]?.number : undefined;
  }
  if (!PR_EVENTS.has(event)) return undefined;
  if (event === "issue_comment") return payload.issue?.number;
  return payload.pull_request?.number;
}

/** Compares two secrets in constant time. */
export function sameSecret(got: string, want: string): boolean {
  const a = Buffer.from(got);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface ServerOptions {
  port: number;
  /** The address to listen on (FACTORY_BIND); every interface when unset. */
  host?: string;
  /** Every repo the factory works on (asked again for each webhook); webhooks for others are ignored. */
  repos: string[] | (() => string[]);
  onPr: (pr: number, repo: string) => void;
  dashboard?: Dashboard;
  systems?: Systems;
  perf?: Perf;
  log: (line: string) => void;
}

export function startServer(o: ServerOptions): Server {
  const secret = process.env.WEBHOOK_SECRET ?? "";
  const server = createServer((req, res) => {
    handle(o, secret, req, res).catch((e: Error) => {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) o.log(`http: ${req.method} ${req.url} failed: ${e.message}`);
      if (!res.headersSent) send(res, status, { error: e.message });
    });
  });
  server.listen(o.port, o.host, () => {
    o.log(`listening on ${o.host ?? ""}:${o.port} (dashboard; webhooks ${secret ? "on" : "off: no WEBHOOK_SECRET"})`);
    if (!o.dashboard) return;
    o.log(dashboardExposure(process.env, o.host).line);
    if (signIn().problem) o.log(`WARNING: dashboard sign-in: ${signIn().problem}`);
  });
  return server;
}

async function handle(o: ServerOptions, secret: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://x");
  if (req.method === "GET" && url.pathname === "/healthz") return send(res, 200, "ok");

  if (url.pathname === "/webhooks/github" && req.method === "POST") {
    if (!secret) return send(res, 503, "webhooks are off (no WEBHOOK_SECRET)");
    const body = await readBody(req);
    if (!verifySignature(secret, body, req.headers["x-hub-signature-256"] as string | undefined)) return send(res, 401, "bad signature");
    const event = String(req.headers["x-github-event"] ?? "");
    let pr: number | undefined;
    let from = "";
    let repos: string[] = [];
    try {
      const payload = JSON.parse(body.toString("utf8"));
      from = payload.repository?.full_name ?? "";
      repos = typeof o.repos === "function" ? o.repos() : o.repos;
      pr = prFromEvent(event, payload, repos);
    } catch {
      return send(res, 400, "bad json");
    }
    if (pr) {
      o.log(`webhook: ${event} on ${from === repos[0] ? "" : from}#${pr}`);
      o.onPr(pr, from);
    }
    return send(res, 202, "ok");
  }

  // A machine's stats reporter (systems.ts). Only on the tailnet: through Cloudflare it would need Access too.
  const ingest = url.pathname.match(/^\/ingest\/device\/([a-z0-9-]{1,31})$/);
  if (ingest && req.method === "POST" && o.systems) {
    const token = process.env.DEVICE_TOKEN ?? "";
    if (!token) return send(res, 503, "stats reporting is off (no DEVICE_TOKEN)");
    if (req.headers["cf-connecting-ip"]) return send(res, 403, "report over the tailnet, not the tunnel");
    if (!sameSecret(String(req.headers.authorization ?? ""), `Bearer ${token}`)) return send(res, 401, "bad token");
    let body: unknown;
    try {
      body = JSON.parse((await readBody(req)).toString("utf8"));
    } catch {
      return send(res, 400, "bad json");
    }
    o.systems.ingest(ingest[1], body, "push");
    return send(res, 202, "ok");
  }

  // A test run's perf.json from anything that reports by itself (perf.ts). CI doesn't: the dispatcher reads
  // its perf-* artifacts, so no token ever reaches a test machine or PR code.
  if (url.pathname === "/ingest/perf" && req.method === "POST" && o.perf) {
    const token = process.env.DEVICE_TOKEN ?? "";
    if (!token) return send(res, 503, "perf reporting is off (no DEVICE_TOKEN)");
    if (req.headers["cf-connecting-ip"]) return send(res, 403, "report over the tailnet, not the tunnel");
    if (!sameSecret(String(req.headers.authorization ?? ""), `Bearer ${token}`)) return send(res, 401, "bad token");
    let body: unknown;
    try {
      body = JSON.parse((await readBody(req, 50 * 1024 * 1024)).toString("utf8"));
    } catch (e) {
      return send(res, e instanceof HttpError ? e.status : 400, "bad json");
    }
    const repo = url.searchParams.get("repo") ?? (typeof o.repos === "function" ? o.repos() : o.repos)[0] ?? "";
    try {
      return send(res, 201, o.perf.ingest(body, { repo }));
    } catch (e) {
      return send(res, 400, { error: (e as Error).message });
    }
  }

  // A CI machine's game guard (machines/windows-runner/setup-game-guard.ps1): its state in, the owner's pause switch and CI build threads out.
  const guard = url.pathname.match(/^\/ingest\/device\/([a-z0-9-]{1,31})\/guard$/);
  if (guard && req.method === "POST" && o.systems) {
    const token = process.env.DEVICE_TOKEN ?? "";
    if (!token) return send(res, 503, "stats reporting is off (no DEVICE_TOKEN)");
    if (req.headers["cf-connecting-ip"]) return send(res, 403, "report over the tailnet, not the tunnel");
    if (!sameSecret(String(req.headers.authorization ?? ""), `Bearer ${token}`)) return send(res, 401, "bad token");
    let body: unknown;
    try {
      body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
    } catch {
      return send(res, 400, "bad json");
    }
    return send(res, 200, o.systems.guard(guard[1], body));
  }

  const dash = o.dashboard;
  if (!dash) return send(res, 404, "not found");
  const local = signIn();
  if (local.enabled && (url.pathname === "/login" || url.pathname === "/logout")) return signInPage(local, url.pathname, req, res);
  const access = await allowed(req, local);
  if (!access.ok) {
    if (!access.signIn) return send(res, 403, { error: access.why });
    if (req.method === "GET" && !url.pathname.startsWith("/api/")) return redirect(res, "/login");
    return send(res, 401, { error: access.why });
  }
  // A signed-in session's controls: the x-factory header, same origin and the session's CSRF token.
  if (access.session && req.method !== "GET" && req.method !== "HEAD") {
    const bad = local.csrfProblem(req, access.session, dashboardHosts());
    if (bad) return send(res, 403, { error: bad });
  }

  if (req.method === "GET" && !url.pathname.startsWith("/api/")) return serveStatic(res, url.pathname);
  if (req.method === "GET" && url.pathname === "/api/state") return send(res, 200, await dash.state());
  const log = url.pathname.match(/^\/api\/runs\/(\d+)\/log$/);
  if (req.method === "GET" && log) return send(res, 200, dash.log(Number(log[1])));
  if (req.method === "GET" && url.pathname === "/api/reports") return send(res, 200, await reports(url.searchParams.has("fresh")));
  if (req.method === "GET" && url.pathname === "/api/logs") return send(res, 200, await containers().catch((e: Error) => ({ error: e.message })));
  const clog = url.pathname.match(/^\/api\/logs\/([A-Za-z0-9][A-Za-z0-9_.-]{0,127})$/);
  if (req.method === "GET" && clog) {
    return send(res, 200, await logs(clog[1], Number(url.searchParams.get("tail") ?? 500), url.searchParams.get("since") ?? undefined));
  }
  if (req.method === "GET" && url.pathname === "/api/systems") return send(res, 200, o.systems ? o.systems.view(Date.now(), url.searchParams.get("range") ?? "24h") : { devices: [], checks: [], site: null, configured: {} });
  if (req.method === "POST" && o.systems && (url.pathname === "/api/alerts/settings" || url.pathname === "/api/alerts/test" || url.pathname === "/api/alerts/discord")) {
    if (req.headers["x-factory"] !== "1") return send(res, 403, { error: "missing x-factory header" });
    if (url.pathname.endsWith("/test")) return send(res, 200, { message: await o.systems.testAlert() });
    const raw = (await readBody(req)).toString("utf8");
    if (url.pathname.endsWith("/discord")) {
      try {
        return send(res, 200, { message: await o.systems.setWebhook((raw ? JSON.parse(raw) : {}).url) });
      } catch (e) {
        return send(res, 400, { error: (e as Error).message });
      }
    }
    o.systems.setAlertSettings(raw ? JSON.parse(raw) : {});
    return send(res, 200, { message: "Alert limits saved" });
  }
  const forget = url.pathname.match(/^\/api\/devices\/([a-z0-9-]{1,31})\/forget$/);
  if (req.method === "POST" && forget && o.systems && req.headers["x-factory"] === "1") {
    o.systems.forget(forget[1]);
    return send(res, 200, { message: `Forgot ${forget[1]}` });
  }
  const ci = url.pathname.match(/^\/api\/devices\/([a-z0-9-]{1,31})\/ci$/);
  if (req.method === "POST" && ci && o.systems && req.headers["x-factory"] === "1") {
    const raw = (await readBody(req)).toString("utf8");
    return send(res, 200, { message: o.systems.setCiPaused(ci[1], (raw ? JSON.parse(raw) : {}).paused === true) });
  }
  if (req.method === "GET" && url.pathname === "/api/perf" && o.perf) {
    const q = url.searchParams;
    return send(res, 200, o.perf.view({ kind: q.get("kind") ?? undefined, machine: q.get("machine") ?? undefined, build: q.get("build") ?? undefined }));
  }
  const perfRun = url.pathname.match(/^\/api\/perf\/runs\/(\d+)$/);
  if (req.method === "GET" && perfRun && o.perf) {
    const v = o.perf.run(Number(perfRun[1]));
    return v ? send(res, 200, v) : send(res, 404, { error: "no such run" });
  }
  if (req.method === "POST" && o.perf && (url.pathname === "/api/perf/settings" || url.pathname === "/api/perf/pull")) {
    if (req.headers["x-factory"] !== "1") return send(res, 403, { error: "missing x-factory header" });
    if (url.pathname.endsWith("/pull")) return send(res, 200, { message: await o.perf.pullAll() });
    const raw = (await readBody(req)).toString("utf8");
    const s = o.perf.setSettings(raw ? JSON.parse(raw) : {});
    return send(res, 200, { message: `Saved: series kept ${s.keepDays ? `${s.keepDays} days` : "forever"}` });
  }
  const threads = url.pathname.match(/^\/api\/devices\/([a-z0-9-]{1,31})\/threads$/);
  if (req.method === "POST" && threads && o.systems && req.headers["x-factory"] === "1") {
    const raw = (await readBody(req)).toString("utf8");
    return send(res, 200, { message: o.systems.setCiThreads(threads[1], raw ? JSON.parse(raw) : {}) });
  }
  if (req.method === "GET" && url.pathname === "/api/data") return send(res, 200, await dash.data());
  if (req.method === "GET" && url.pathname === "/api/prompt") return send(res, 200, { text: await dash.prompt(url.searchParams.get("path") ?? "", url.searchParams.get("repo")) });
  const trial = url.pathname.match(/^\/api\/trials\/(\d+)$/);
  if (req.method === "GET" && trial) return send(res, 200, { text: dash.trial(trial[1]) });
  if (req.method === "GET" && url.pathname === "/api/devices") return send(res, 200, await dash.devices());
  if (req.method === "GET" && url.pathname === "/api/gaming") return send(res, 200, await dash.gaming());
  if (req.method === "GET" && url.pathname === "/api/activity") return send(res, 200, await dash.activity(url.searchParams.get("window") ?? "24h"));
  const issue = url.pathname.match(/^\/api\/issues\/(\d+)$/);
  if (req.method === "GET" && issue) return send(res, 200, await dash.issue(Number(issue[1]), url.searchParams.get("repo") ?? undefined));

  if (req.method === "POST" && url.pathname.startsWith("/api/")) {
    // A custom header can't be sent cross-site without a CORS preflight, which this server never grants.
    if (req.headers["x-factory"] !== "1") return send(res, 403, { error: "missing x-factory header" });
    const raw = (await readBody(req)).toString("utf8");
    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const message = await dash.control(url.pathname.slice(5).split("/").filter(Boolean), body);
    return send(res, 200, { message });
  }
  send(res, 404, "not found");
}

/** The dashboard's own address (Settings › Install), also accepted as a request's origin. */
function dashboardHosts(): string[] {
  try {
    const at = install().dashboardUrl;
    return at ? [new URL(at).host] : [];
  } catch {
    return [];
  }
}

/** /login (the form, and checking it) and /logout, for the built-in sign-in. */
async function signInPage(local: SignIn, path: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const session = local.session(req);
  if (path === "/logout") {
    if (req.method !== "POST") return redirect(res, "/login");
    const form = new URLSearchParams((await readBody(req, 4096)).toString("utf8"));
    if (session && sameOrigin(req, dashboardHosts()) && form.get("csrf") === session.csrf) local.sessions.drop(session.id);
    else if (session) return html(res, 403, loginHtml("That sign-out didn't come from this page. Try again.", session.csrf));
    return redirect(res, "/login", local.cookies());
  }
  if (req.method === "GET") return html(res, 200, loginHtml(undefined, session?.csrf));
  if (req.method !== "POST") return send(res, 405, "method not allowed");
  if (!sameOrigin(req, dashboardHosts())) return html(res, 403, loginHtml("That sign-in didn't come from this page."));
  // A Secure cookie over plain HTTP is dropped by the browser: say so instead of signing in in a loop.
  if (local.secure && !viaHttps(req) && !isLocalHost(req.headers.host)) {
    return html(res, 400, loginHtml("This address is plain HTTP, so the browser would drop the secure session cookie. Open the dashboard over HTTPS, or set FACTORY_COOKIE_SECURE=0 on a network that encrypts by itself (a tailnet)."));
  }
  const who = req.socket.remoteAddress ?? "?";
  const wait = local.limit.wait(who);
  if (wait > 0) {
    res.setHeader("retry-after", String(Math.ceil(wait / 1000)));
    return html(res, 429, loginHtml(`Too many tries. Wait ${Math.ceil(wait / 60_000)} minute(s).`));
  }
  const secret = new URLSearchParams((await readBody(req, 4096)).toString("utf8")).get("secret") ?? "";
  if (!(await local.check(secret))) {
    local.limit.fail(who);
    return html(res, 401, loginHtml("Wrong password or token."));
  }
  local.limit.succeed(who);
  if (session) local.sessions.drop(session.id);
  return redirect(res, "/", local.cookies(local.sessions.create()));
}

function loginHtml(error?: string, signedInCsrf?: string): string {
  const esc = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const body = signedInCsrf
    ? `<p>You're signed in.</p><p><a href="/">Open the dashboard</a></p>
<form method="post" action="/logout"><input type="hidden" name="csrf" value="${esc(signedInCsrf)}"><button>Sign out</button></form>`
    : `<form method="post" action="/login"><label for="secret">Password or token</label>
<input id="secret" name="secret" type="password" autocomplete="current-password" autofocus required maxlength="1024"><button>Sign in</button></form>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Factory sign-in</title><style>
body{font:16px system-ui,sans-serif;background:#f6f6f4;color:#1c1c1a;display:grid;place-items:center;min-height:100vh;margin:0}
main{background:#fff;border:1px solid #ddd;border-radius:8px;padding:24px;width:min(320px,calc(100vw - 32px))}
h1{font-size:18px;margin:0 0 16px}label{display:block;margin-bottom:6px}input{box-sizing:border-box;width:100%;padding:8px;font:inherit;margin-bottom:12px}
button{padding:8px 14px;font:inherit;cursor:pointer}.err{color:#b3261e}
@media (prefers-color-scheme:dark){body{background:#151514;color:#eee}main{background:#1f1f1d;border-color:#333}a{color:#9cf}input,button{background:#2a2a28;color:#eee;border:1px solid #555}.err{color:#f2b8b5}}
</style></head><body><main><h1>Factory</h1>${error ? `<p class="err">${esc(error)}</p>` : ""}${body}</main></body></html>`;
}

function html(res: ServerResponse, status: number, page: string): void {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...SECURITY_HEADERS });
  res.end(page);
}

function redirect(res: ServerResponse, to: string, cookies: string[] = []): void {
  res.writeHead(303, { location: to, "cache-control": "no-store", ...(cookies.length ? { "set-cookie": cookies } : {}), ...SECURITY_HEADERS });
  res.end();
}

/** Files from web/dist; hashed assets cache for a year, the page itself never. */
function serveStatic(res: ServerResponse, path: string): void {
  const file = normalize(join(WEB, path === "/" ? "index.html" : decodeURIComponent(path)));
  if (!file.startsWith(WEB) || !existsSync(file) || !statSync(file).isFile()) {
    if (!existsSync(join(WEB, "index.html"))) return send(res, 503, "dashboard not built: npm run build:web");
    return send(res, 404, "not found");
  }
  const hashed = path.startsWith("/assets/");
  res.writeHead(200, {
    "content-type": TYPES[extname(file)] ?? "application/octet-stream",
    "cache-control": hashed ? "public, max-age=31536000, immutable" : "no-store",
    ...SECURITY_HEADERS,
  });
  res.end(readFileSync(file));
}

const SECURITY_HEADERS = {
  "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = typeof body !== "string";
  res.writeHead(status, { "content-type": json ? "application/json" : "text/plain", "cache-control": "no-store", ...SECURITY_HEADERS });
  res.end(json ? JSON.stringify(body) : body + "\n");
}

function readBody(req: IncomingMessage, max = MAX_BODY): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > max) {
        reject(new HttpError(413, "too big"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
