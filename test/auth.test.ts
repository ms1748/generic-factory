import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { allowed } from "../src/access.ts";
import { dashboardExposure, hashPassword, isPrivateAddress, parseCookies, parseHash, RateLimit, sameOrigin, sameToken, Sessions, SignIn, verifyPassword } from "../src/auth.ts";
import type { Dashboard } from "../src/dashboard.ts";
import { startServer } from "../src/server.ts";

const TOKEN = "made-up-dashboard-token-0123456789";
const req = (headers: Record<string, string>, extra: object = {}) => ({ headers, socket: {}, ...extra }) as any;

test("password hashes verify only the right password, and odd hashes are refused", async () => {
  const h = await hashPassword("correct horse battery");
  assert.match(h, /^scrypt:32768:8:1:[\w-]+:[\w-]+$/);
  assert.notEqual(h, await hashPassword("correct horse battery")); // salted
  assert.equal(await verifyPassword("correct horse battery", h), true);
  assert.equal(await verifyPassword("correct horse batterY", h), false);
  assert.equal(await verifyPassword("", h), false);
  for (const bad of ["", "plain", "bcrypt:1:2:3:a:b", "scrypt:1000:8:1:AAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAAA", "scrypt:32768:8:1:AA:AAAAAAAAAAAAAAAAAAAAAAA", h + ":x"]) {
    assert.equal(parseHash(bad), undefined, bad);
    assert.equal(await verifyPassword("x", bad), false);
  }
});

test("tokens compare whatever their lengths, and never match empty", () => {
  assert.equal(sameToken(TOKEN, TOKEN), true);
  assert.equal(sameToken(TOKEN.slice(1), TOKEN), false);
  assert.equal(sameToken(TOKEN + "x", TOKEN), false);
  assert.equal(sameToken("", ""), false);
});

test("failed sign-ins are limited per address and overall, in a sliding window", () => {
  const l = new RateLimit(3, 5, 1000);
  for (let i = 0; i < 3; i++) {
    assert.equal(l.wait("a", 100), 0);
    l.fail("a", 100 + i);
  }
  assert.equal(l.wait("a", 200), 900);
  assert.equal(l.wait("b", 200), 0);
  assert.equal(l.wait("a", 1099), 1); // the first failure has nearly left the window
  assert.equal(l.wait("a", 1100), 0);
  const all = new RateLimit(3, 5, 1000);
  for (const who of ["a", "a", "b", "b", "c"]) all.fail(who, 100);
  assert.equal(all.wait("d", 400), 700, "five failures in the window lock everyone out");
  all.succeed("b");
  assert.equal(all.wait("d", 400), 700, "a success clears that address only, not the overall count");
  assert.equal(all.wait("d", 1100), 0);
});

test("sessions expire and can be dropped", () => {
  const s = new Sessions(1000);
  const a = s.create(0);
  assert.notEqual(a.id, a.csrf);
  assert.ok(a.id.length >= 40);
  assert.equal(s.get(a.id, 999), a);
  assert.equal(s.get(a.id, 1000), undefined);
  const b = s.create(0);
  s.drop(b.id);
  assert.equal(s.get(b.id, 1), undefined);
  assert.equal(s.get(undefined), undefined);
  assert.equal(s.get("nope"), undefined);
});

test("cookies and origins", () => {
  assert.deepEqual(parseCookies("a=1; b=x%20y;bad; a=2; c=%E0"), { a: "1", b: "x y" });
  assert.deepEqual(parseCookies(undefined), {});
  assert.equal(sameOrigin(req({ host: "f.example.com" })), true); // curl and old browsers
  assert.equal(sameOrigin(req({ host: "f.example.com", origin: "https://f.example.com", "sec-fetch-site": "same-origin" })), true);
  assert.equal(sameOrigin(req({ host: "f.example.com", origin: "https://evil.example.net" })), false);
  assert.equal(sameOrigin(req({ host: "f.example.com", "sec-fetch-site": "cross-site" })), false);
  assert.equal(sameOrigin(req({ host: "f.example.com", "sec-fetch-site": "same-site" })), false);
  assert.equal(sameOrigin(req({ host: "f.example.com", origin: "null" })), false);
  // Referrer-Policy: no-referrer makes the browser's own same-origin POSTs say `Origin: null`.
  assert.equal(sameOrigin(req({ host: "f.example.com", origin: "null", "sec-fetch-site": "same-origin" })), true);
  assert.equal(sameOrigin(req({ host: "f.example.com", origin: "null", "sec-fetch-site": "cross-site" })), false);
  assert.equal(sameOrigin(req({ host: "dispatcher:8080", origin: "https://f.example.com" }), ["f.example.com"]), true);
  assert.equal(sameOrigin(req({ host: "dispatcher:8080", "x-forwarded-host": "f.example.com", origin: "https://f.example.com" })), true);
});

test("the built-in sign-in: secrets, cookies and CSRF", async () => {
  assert.equal(new SignIn({}).enabled, false);
  const local = new SignIn({ FACTORY_PASSWORD_HASH: await hashPassword("correct horse battery"), FACTORY_DASHBOARD_TOKEN: TOKEN });
  assert.equal(local.enabled, true);
  assert.equal(local.problem, undefined);
  assert.equal(await local.check("correct horse battery"), true);
  assert.equal(await local.check(TOKEN), true);
  assert.equal(await local.check("wrong"), false);
  assert.equal(await local.check(""), false);

  const s = local.sessions.create();
  const [session, csrf] = local.cookies(s);
  assert.match(session, new RegExp(`^__Host-factory_session=${s.id}; Path=/; SameSite=Strict; Secure; HttpOnly; Max-Age=(604799|604800)$`));
  assert.match(csrf, /^factory_csrf=[\w-]+; Path=\/; SameSite=Strict; Secure; Max-Age=\d+$/);
  assert.doesNotMatch(csrf, /HttpOnly/); // the page reads it to echo it back
  assert.match(local.cookies()[0], /^__Host-factory_session=; .*Max-Age=0$/);
  assert.equal(local.session(req({ cookie: `__Host-factory_session=${s.id}` }))?.id, s.id);
  assert.equal(local.session(req({ cookie: `factory_session=${s.id}` })), undefined);

  const good = { host: "f.example.com", origin: "https://f.example.com", "x-factory": "1", "x-factory-csrf": s.csrf };
  assert.equal(local.csrfProblem(req(good), s), undefined);
  assert.match(local.csrfProblem(req({ ...good, "x-factory": "" }), s) ?? "", /x-factory/);
  assert.match(local.csrfProblem(req({ ...good, "x-factory-csrf": "guess" }), s) ?? "", /CSRF/);
  assert.match(local.csrfProblem(req({ ...good, origin: "https://evil.example.net" }), s) ?? "", /cross-site/);

  const plain = new SignIn({ FACTORY_DASHBOARD_TOKEN: TOKEN, FACTORY_COOKIE_SECURE: "0" });
  assert.match(plain.cookies(plain.sessions.create())[0], /^factory_session=[\w-]+; Path=\/; SameSite=Strict; HttpOnly;/);
  const weak = new SignIn({ FACTORY_PASSWORD_HASH: "letmein", FACTORY_DASHBOARD_TOKEN: "short" });
  assert.equal(weak.enabled, true); // fails closed: on, and nothing gets in
  assert.match(weak.problem ?? "", /FACTORY_PASSWORD_HASH.*FACTORY_DASHBOARD_TOKEN/);
  assert.equal(await weak.check("short"), false);
  assert.equal(await weak.check("letmein"), false);
});

test("which way in: Access through the tunnel, else the sign-in, else refused", async () => {
  const local = new SignIn({ FACTORY_DASHBOARD_TOKEN: TOKEN });
  const s = local.sessions.create();
  const cookie = `__Host-factory_session=${s.id}`;
  const was = { ...process.env };
  try {
    delete process.env.CF_ACCESS_TEAM_DOMAIN;
    delete process.env.CF_ACCESS_AUD;
    process.env.FACTORY_LAN_OPEN = "1";
    // With a password or token set, the open switch no longer opens the port.
    assert.deepEqual(await allowed(req({}), local), { ok: false, signIn: true, why: "sign in at /login" });
    assert.equal((await allowed(req({ cookie }), local)).session, s);
    // A tunnel without Access uses the sign-in too.
    assert.equal((await allowed(req({ cookie, "cf-connecting-ip": "1.2.3.4" }), local)).ok, true);
    // With Access set, a tunnel request needs its token: a session cookie doesn't stand in for it.
    process.env.CF_ACCESS_TEAM_DOMAIN = "team.cloudflareaccess.com";
    process.env.CF_ACCESS_AUD = "AUD";
    const viaTunnel = await allowed(req({ cookie, "cf-connecting-ip": "1.2.3.4" }), local);
    assert.equal(viaTunnel.ok, false);
    assert.equal(viaTunnel.signIn, undefined);
    // ...while the private port takes the session.
    assert.equal((await allowed(req({ cookie }), local)).ok, true);
    // Without a password or token, nothing changes.
    const none = new SignIn({});
    assert.equal((await allowed(req({}), none)).ok, true); // FACTORY_LAN_OPEN=1
    delete process.env.FACTORY_LAN_OPEN;
    assert.equal((await allowed(req({ cookie }), none)).ok, false);
  } finally {
    process.env = was;
  }
});

test("startup says who can open the dashboard, and warns when it's exposed", () => {
  assert.equal(isPrivateAddress("100.101.102.103"), true);
  assert.equal(isPrivateAddress("172.20.0.5"), true);
  assert.equal(isPrivateAddress("::ffff:192.168.1.4"), true);
  assert.equal(isPrivateAddress("fd7a:115c:a1e0::1"), true);
  assert.equal(isPrivateAddress("172.32.0.1"), false);
  assert.equal(isPrivateAddress("203.0.113.9"), false);
  const access = { CF_ACCESS_TEAM_DOMAIN: "t.cloudflareaccess.com", CF_ACCESS_AUD: "AUD" };
  assert.deepEqual(dashboardExposure(access, undefined), { warn: false, line: "dashboard: Cloudflare Access (through the tunnel)" });
  assert.equal(dashboardExposure({ FACTORY_DASHBOARD_TOKEN: TOKEN }, "203.0.113.9").warn, false);
  assert.match(dashboardExposure({ FACTORY_DASHBOARD_TOKEN: TOKEN, FACTORY_LAN_OPEN: "1" }, undefined).line, /FACTORY_LAN_OPEN is ignored/);
  assert.equal(dashboardExposure({ FACTORY_LAN_OPEN: "1" }, "127.0.0.1").warn, false);
  assert.equal(dashboardExposure({ FACTORY_LAN_OPEN: "1" }, "100.64.0.7").warn, false);
  const open = dashboardExposure({ FACTORY_LAN_OPEN: "1" }, undefined);
  assert.equal(open.warn, true);
  assert.match(open.line, /^WARNING: .*every interface.*anyone/);
  assert.match(dashboardExposure({ FACTORY_LAN_OPEN: "1" }, "203.0.113.9").line, /^WARNING: .*203\.0\.113\.9, which isn't localhost/);
  assert.match(dashboardExposure({}, "0.0.0.0").line, /^WARNING: .*refuses every request/);
});

test("the server: sign in, use the controls with the CSRF token, rate limits, sign out", async () => {
  const was = { ...process.env };
  for (const k of ["CF_ACCESS_TEAM_DOMAIN", "CF_ACCESS_AUD", "FACTORY_LAN_OPEN", "FACTORY_PASSWORD_HASH"]) delete process.env[k];
  process.env.FACTORY_DASHBOARD_TOKEN = TOKEN;
  const calls: string[][] = [];
  const dashboard = { state: async () => ({ ok: true }), control: async (path: string[]) => (calls.push(path), "done") } as unknown as Dashboard;
  const lines: string[] = [];
  const server = startServer({ port: 0, host: "127.0.0.1", repos: [], onPr: () => {}, dashboard, log: (l) => lines.push(l) });
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: string, headers: Record<string, string> = {}) =>
    fetch(base + path, { method: "POST", body, redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", ...headers } });
  try {
    await new Promise((r) => setTimeout(r, 10));
    assert.ok(lines.some((l) => l.startsWith("dashboard: the built-in sign-in")), lines.join("\n"));

    assert.equal((await fetch(base + "/", { redirect: "manual" })).headers.get("location"), "/login");
    assert.equal((await fetch(base + "/api/state")).status, 401);
    assert.match(await (await fetch(base + "/login")).text(), /name="secret"/);
    assert.equal((await post("/login", "secret=x", { origin: "https://evil.example.net" })).status, 403);

    const ok = await post("/login", `secret=${TOKEN}`, { origin: base });
    assert.equal(ok.status, 303);
    const set = ok.headers.getSetCookie();
    const cookie = set.map((c) => c.split(";")[0]).join("; ");
    const csrf = set.find((c) => c.startsWith("factory_csrf="))!.split(";")[0].slice("factory_csrf=".length);
    assert.match(set[0], /HttpOnly/);
    assert.deepEqual(await (await fetch(base + "/api/state", { headers: { cookie } })).json(), { ok: true });

    const control = { cookie, "x-factory": "1", "content-type": "application/json" };
    assert.equal((await post("/api/pause", "{}", control)).status, 403); // no CSRF token
    assert.equal((await post("/api/pause", "{}", { ...control, "x-factory-csrf": csrf, origin: "https://evil.example.net" })).status, 403);
    assert.equal((await post("/api/pause", "{}", { cookie, "x-factory-csrf": csrf })).status, 403); // no x-factory
    const done = await post("/api/pause", "{}", { ...control, "x-factory-csrf": csrf, origin: base });
    assert.equal(done.status, 200);
    assert.deepEqual(calls, [["pause"]]);

    // Five wrong tries from one address, then even the right token waits.
    for (let i = 0; i < 5; i++) assert.equal((await post("/login", "secret=wrong")).status, 401);
    const locked = await post("/login", `secret=${TOKEN}`);
    assert.equal(locked.status, 429);
    assert.ok(Number(locked.headers.get("retry-after")) > 0);

    // Signing out needs the session's token in the form; afterwards the cookie is dead.
    assert.equal((await post("/logout", "csrf=guess", { cookie })).status, 403);
    const out = await post("/logout", `csrf=${csrf}`, { cookie, origin: base });
    assert.equal(out.status, 303);
    assert.match(out.headers.getSetCookie()[0], /Max-Age=0/);
    assert.equal((await fetch(base + "/api/state", { headers: { cookie } })).status, 401);
  } finally {
    server.close();
    process.env = was;
  }
});
