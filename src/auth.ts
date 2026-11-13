// Built-in dashboard sign-in, for installs without Cloudflare Access (access.ts decides which applies).
// The owner sets FACTORY_PASSWORD_HASH (made by `node src/hash-password.ts`) and/or FACTORY_DASHBOARD_TOKEN;
// either one, typed on /login, starts a session: a random id in a Secure, HttpOnly, SameSite=Strict cookie,
// kept in memory (a restart signs you out). Failed sign-ins are rate limited per address and overall.
// Control POSTs from a session also need the x-factory header, a same-origin request and the session's
// CSRF token (the factory_csrf cookie, echoed by the page in x-factory-csrf).
import { createHash, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { isIP } from "node:net";

const SCRYPT = { N: 1 << 15, r: 8, p: 1, keylen: 32 };
/** A failed sign-in counts against its address for this long. */
const WINDOW_MS = 15 * 60_000;
const PER_ADDRESS = 5;
const OVERALL = 50;
const MAX_SESSIONS = 50;

function derive(secret: string, salt: Buffer, o: { N: number; r: number; p: number; keylen: number }): Promise<Buffer> {
  const opts: ScryptOptions = { N: o.N, r: o.r, p: o.p, maxmem: 256 * o.N * o.r };
  return new Promise((resolve, reject) => scrypt(secret, salt, o.keylen, opts, (e, key) => (e ? reject(e) : resolve(key))));
}

/** `scrypt:N:r:p:salt:hash` (base64url). No `$`, so it survives .env files and compose interpolation. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, SCRYPT);
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64url"), key.toString("base64url")].join(":");
}

interface Parsed { N: number; r: number; p: number; salt: Buffer; key: Buffer }

export function parseHash(encoded: string): Parsed | undefined {
  const [kind, n, r, p, salt, key, ...extra] = encoded.trim().split(":");
  if (kind !== "scrypt" || extra.length || !salt || !key) return undefined;
  const N = Number(n), R = Number(r), P = Number(p);
  const pow2 = Number.isInteger(N) && N >= 1024 && N <= 1 << 20 && (N & (N - 1)) === 0;
  if (!pow2 || !Number.isInteger(R) || R < 1 || R > 32 || !Number.isInteger(P) || P < 1 || P > 16) return undefined;
  const s = Buffer.from(salt, "base64url"), k = Buffer.from(key, "base64url");
  return s.length >= 8 && k.length >= 16 ? { N, r: R, p: P, salt: s, key: k } : undefined;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const h = parseHash(encoded);
  if (!h) return false;
  const got = await derive(password, h.salt, { N: h.N, r: h.r, p: h.p, keylen: h.key.length });
  return timingSafeEqual(got, h.key);
}

/** Constant time whatever the lengths: both sides are hashed first. */
export function sameToken(got: string, want: string): boolean {
  const a = createHash("sha256").update(got).digest();
  const b = createHash("sha256").update(want).digest();
  return timingSafeEqual(a, b) && want.length > 0;
}

/** Failed sign-ins in a sliding window: a few per address, and a cap over all addresses together. */
export class RateLimit {
  private fails = new Map<string, number[]>();
  private all: number[] = [];
  private perAddress: number;
  private overall: number;
  private windowMs: number;
  constructor(perAddress = PER_ADDRESS, overall = OVERALL, windowMs = WINDOW_MS) {
    this.perAddress = perAddress;
    this.overall = overall;
    this.windowMs = windowMs;
  }

  /** Milliseconds until `key` may try again, or 0. */
  wait(key: string, now = Date.now()): number {
    const mine = this.prune(key, now);
    this.all = this.all.filter((t) => now - t < this.windowMs);
    const waits = [mine.length >= this.perAddress ? mine[0] + this.windowMs - now : 0, this.all.length >= this.overall ? this.all[0] + this.windowMs - now : 0];
    return Math.max(...waits);
  }

  fail(key: string, now = Date.now()): void {
    this.fails.set(key, [...this.prune(key, now), now]);
    this.all.push(now);
  }

  succeed(key: string): void {
    this.fails.delete(key);
  }

  private prune(key: string, now: number): number[] {
    const kept = (this.fails.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (kept.length) this.fails.set(key, kept);
    else this.fails.delete(key);
    return kept;
  }
}

export interface Session { id: string; csrf: string; expires: number }

export class Sessions {
  private map = new Map<string, Session>();
  private ttlMs: number;
  constructor(ttlMs: number) {
    this.ttlMs = ttlMs;
  }

  create(now = Date.now()): Session {
    for (const [id, s] of this.map) if (s.expires <= now) this.map.delete(id);
    while (this.map.size >= MAX_SESSIONS) this.map.delete(this.map.keys().next().value as string);
    const s = { id: randomBytes(32).toString("base64url"), csrf: randomBytes(32).toString("base64url"), expires: now + this.ttlMs };
    this.map.set(s.id, s);
    return s;
  }

  get(id: string | undefined, now = Date.now()): Session | undefined {
    const s = id ? this.map.get(id) : undefined;
    if (s && s.expires <= now) this.map.delete(s.id);
    return s && s.expires > now ? s : undefined;
  }

  drop(id: string): void {
    this.map.delete(id);
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i < 1) continue;
    const name = part.slice(0, i).trim();
    if (!(name in out)) {
      try {
        out[name] = decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        // a malformed value is ignored
      }
    }
  }
  return out;
}

/** True unless the browser says the request came from another site. Requests without Origin (old browsers,
 * curl) pass; they still need the session cookie, the x-factory header and the CSRF token. */
export function sameOrigin(req: IncomingMessage, extraHosts: string[] = []): boolean {
  const site = req.headers["sec-fetch-site"];
  if (typeof site === "string" && site !== "same-origin" && site !== "none") return false;
  const origin = req.headers.origin;
  // Our pages send no referrer, so browsers say `Origin: null` on their own POSTs; Sec-Fetch-Site then decides.
  if (origin === undefined || (origin === "null" && typeof site === "string")) return true;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  const hosts = [req.headers.host, firstValue(req.headers["x-forwarded-host"]), ...extraHosts].filter(Boolean);
  return hosts.includes(host);
}

function firstValue(h: string | string[] | undefined): string | undefined {
  return (Array.isArray(h) ? h[0] : h)?.split(",")[0].trim() || undefined;
}

export interface SignInEnv { FACTORY_PASSWORD_HASH?: string; FACTORY_DASHBOARD_TOKEN?: string; FACTORY_COOKIE_SECURE?: string; FACTORY_SESSION_HOURS?: string }

/** The built-in sign-in, from the env. `enabled` is false when neither secret is set. */
export class SignIn {
  readonly enabled: boolean;
  /** A setting that's wrong; sign-in stays on (nobody gets in with a bad hash) and startup says so. */
  readonly problem?: string;
  readonly secure: boolean;
  readonly sessions: Sessions;
  readonly limit = new RateLimit();
  private hash?: string;
  private token?: string;

  constructor(env: SignInEnv = process.env) {
    this.hash = env.FACTORY_PASSWORD_HASH?.trim() || undefined;
    this.token = env.FACTORY_DASHBOARD_TOKEN?.trim() || undefined;
    this.enabled = !!(this.hash || this.token);
    this.secure = env.FACTORY_COOKIE_SECURE !== "0";
    const hours = Number(env.FACTORY_SESSION_HOURS || 168);
    this.sessions = new Sessions((hours > 0 ? hours : 168) * 3600_000);
    const problems: string[] = [];
    if (this.hash && !parseHash(this.hash)) problems.push("FACTORY_PASSWORD_HASH isn't a hash from `node src/hash-password.ts`");
    if (this.token && this.token.length < 24) problems.push("FACTORY_DASHBOARD_TOKEN is shorter than 24 characters (`node src/hash-password.ts --token` makes one)");
    if (problems.length) this.problem = problems.join("; ");
  }

  /** The session cookie's name: `__Host-` pins it to this exact host over HTTPS. */
  get cookie(): string {
    return this.secure ? "__Host-factory_session" : "factory_session";
  }

  async check(secret: string): Promise<boolean> {
    if (!secret || secret.length > 1024) return false;
    // Both are always tried, so the time taken doesn't say which is set.
    const byToken = this.token !== undefined && this.token.length >= 24 && sameToken(secret, this.token);
    const byPassword = this.hash ? await verifyPassword(secret, this.hash) : false;
    return byToken || byPassword;
  }

  session(req: IncomingMessage, now = Date.now()): Session | undefined {
    return this.sessions.get(parseCookies(req.headers.cookie)[this.cookie], now);
  }

  /** Set-Cookie headers for a new session, or (no session) to clear them. */
  cookies(s?: Session): string[] {
    const attrs = `Path=/; SameSite=Strict${this.secure ? "; Secure" : ""}`;
    const age = s ? Math.floor((s.expires - Date.now()) / 1000) : 0;
    return [
      `${this.cookie}=${s?.id ?? ""}; ${attrs}; HttpOnly; Max-Age=${age}`,
      `factory_csrf=${s?.csrf ?? ""}; ${attrs}; Max-Age=${age}`,
    ];
  }

  /** Why a POST from this session isn't allowed, or undefined. */
  csrfProblem(req: IncomingMessage, s: Session, extraHosts: string[] = []): string | undefined {
    if (req.headers["x-factory"] !== "1") return "missing x-factory header";
    if (!sameOrigin(req, extraHosts)) return "cross-site request";
    const got = req.headers["x-factory-csrf"];
    if (typeof got !== "string" || !sameToken(got, s.csrf)) return "missing or wrong CSRF token (reload the page)";
    return undefined;
  }
}

/** Whether the request reached us over HTTPS (directly, or through a proxy that says so). */
export function viaHttps(req: IncomingMessage): boolean {
  return (req.socket as { encrypted?: boolean }).encrypted === true || firstValue(req.headers["x-forwarded-proto"]) === "https";
}

export function isLocalHost(hostHeader: string | undefined): boolean {
  const host = (hostHeader ?? "").replace(/:\d+$/, "").replace(/^\[|\]$/g, "").toLowerCase();
  return host === "localhost" || host.endsWith(".localhost") || isLoopback(host);
}

export function isLoopback(addr: string): boolean {
  const a = addr.replace(/^::ffff:/i, "");
  return a === "::1" || (isIP(a) === 4 && a.startsWith("127."));
}

/** Loopback, RFC 1918, CGNAT (Tailscale's 100.64/10), link-local, and IPv6 ULA / link-local. */
export function isPrivateAddress(addr: string): boolean {
  const a = addr.replace(/^::ffff:/i, "").replace(/%.*$/, "").toLowerCase();
  if (isLoopback(a)) return true;
  if (isIP(a) === 4) {
    const [x, y] = a.split(".").map(Number);
    return x === 10 || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168) || (x === 100 && y >= 64 && y <= 127) || (x === 169 && y === 254);
  }
  if (isIP(a) === 6) return /^f[cd]/.test(a) || /^fe[89ab]/.test(a);
  return false;
}

export interface Exposure { warn: boolean; line: string }

/** What startup says about who can open the dashboard. `bind` is FACTORY_BIND (empty: every interface). */
export function dashboardExposure(env: Record<string, string | undefined>, bind: string | undefined): Exposure {
  const access = !!(env.CF_ACCESS_TEAM_DOMAIN && env.CF_ACCESS_AUD);
  const signIn = !!(env.FACTORY_PASSWORD_HASH?.trim() || env.FACTORY_DASHBOARD_TOKEN?.trim());
  const open = env.FACTORY_LAN_OPEN === "1";
  if (access || signIn) {
    const how = [access && "Cloudflare Access (through the tunnel)", signIn && "the built-in sign-in (/login)"].filter(Boolean).join(", and ");
    return { warn: false, line: `dashboard: ${how}${signIn && open ? "; FACTORY_LAN_OPEN is ignored while a password or token is set" : ""}` };
  }
  const where = bind && bind !== "0.0.0.0" && bind !== "::" ? bind : "";
  const fix = "set FACTORY_PASSWORD_HASH (node src/hash-password.ts) or FACTORY_DASHBOARD_TOKEN, or Cloudflare Access; README › Securing the dashboard";
  if (where && (isPrivateAddress(where) || where === "localhost")) {
    return { warn: false, line: open ? `dashboard: open without sign-in on ${where} (FACTORY_LAN_OPEN=1)` : `dashboard: no sign-in set, so it refuses every request (${fix})` };
  }
  const on = where ? `listens on ${where}, which isn't localhost or a private network` : "listens on every interface (FACTORY_BIND isn't set)";
  return open
    ? { warn: true, line: `WARNING: the dashboard has no sign-in (FACTORY_LAN_OPEN=1) and ${on}: anyone who can reach this port can switch lanes on and run agents. ${fix}` }
    : { warn: true, line: `WARNING: the dashboard has no sign-in and ${on}; it refuses every request until you ${fix}` };
}
