// Who may use the dashboard and its controls. Two ways in:
//   - Cloudflare Access: requests through the tunnel carry a valid Access token for this app, i.e. the owner at
//     the dashboard's address (Settings › Install). Used whenever CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD are set.
//   - The built-in sign-in (auth.ts): when FACTORY_PASSWORD_HASH or FACTORY_DASHBOARD_TOKEN is set, a session
//     cookie from /login, on any port and through a tunnel that has no Access.
// Without either, direct requests are refused: the port is also reachable from the agent containers and any CI
// runner nearby, which run code the owner hasn't read, so "not through Cloudflare" doesn't mean "the owner"
// (security review, 2026-11-07). FACTORY_LAN_OPEN=1 restores the old open port, for a local preview only, and
// is ignored once a password or token is set.
// Machine reports (/ingest, DEVICE_TOKEN), GitHub webhooks (signed) and /healthz are checked in server.ts.
import { createPublicKey, createVerify, type JsonWebKey } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { SignIn, type Session } from "./auth.ts";
import { install } from "./install.ts";

let certs: { keys: (JsonWebKey & { kid: string })[]; fetched: number } | undefined;
let builtIn: SignIn | undefined;

/** The built-in sign-in from the env, made once. */
export function signIn(): SignIn {
  return (builtIn ??= new SignIn());
}

export interface Access {
  ok: boolean;
  why?: string;
  /** Allowed by a built-in sign-in session (its POSTs need the CSRF token too). */
  session?: Session;
  /** Refused, but signing in at /login would help. */
  signIn?: boolean;
}

export async function allowed(req: IncomingMessage, local: SignIn = signIn()): Promise<Access> {
  const team = process.env.CF_ACCESS_TEAM_DOMAIN; // e.g. yourteam.cloudflareaccess.com
  const aud = process.env.CF_ACCESS_AUD;
  const viaCloudflare = !!(req.headers["cf-connecting-ip"] || req.headers["cf-access-jwt-assertion"]);
  if (local.enabled && !(viaCloudflare && team && aud)) {
    const session = local.session(req);
    return session ? { ok: true, session } : { ok: false, signIn: true, why: "sign in at /login" };
  }
  if (!viaCloudflare) {
    if (process.env.FACTORY_LAN_OPEN === "1") return { ok: true };
    const at = install().dashboardUrl;
    return { ok: false, why: `open the dashboard ${at ? `at ${at} ` : "through its Cloudflare Tunnel "}(Cloudflare Access); this port only takes machine reports and GitHub webhooks` };
  }
  if (!team || !aud) return { ok: false, why: "Cloudflare Access isn't configured (CF_ACCESS_TEAM_DOMAIN, CF_ACCESS_AUD)" };
  const token = req.headers["cf-access-jwt-assertion"];
  if (typeof token !== "string") return { ok: false, why: "no Cloudflare Access token" };
  try {
    return (await verifyAccessJwt(token, team, aud)) ? { ok: true } : { ok: false, why: "invalid Cloudflare Access token" };
  } catch (e) {
    return { ok: false, why: `Cloudflare Access check failed: ${(e as Error).message}` };
  }
}

export async function verifyAccessJwt(token: string, team: string, aud: string, now = Date.now()): Promise<boolean> {
  const [h, p, s] = token.split(".");
  if (!h || !p || !s) return false;
  const header = JSON.parse(Buffer.from(h, "base64url").toString()) as { alg: string; kid: string };
  const claims = JSON.parse(Buffer.from(p, "base64url").toString()) as { aud: string | string[]; exp: number; iss: string };
  if (header.alg !== "RS256") return false;
  const key = (await keys(team)).find((k) => k.kid === header.kid);
  if (!key) return false;
  const ok = createVerify("RSA-SHA256").update(`${h}.${p}`).verify(createPublicKey({ key, format: "jwk" }), Buffer.from(s, "base64url"));
  const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  return ok && auds.includes(aud) && claims.exp * 1000 > now && claims.iss === `https://${team}`;
}

async function keys(team: string) {
  if (!certs || Date.now() - certs.fetched > 60 * 60_000) {
    const res = await fetch(`https://${team}/cdn-cgi/access/certs`);
    if (!res.ok) throw new Error(`certs ${res.status}`);
    certs = { keys: ((await res.json()) as { keys: (JsonWebKey & { kid: string })[] }).keys, fetched: Date.now() };
  }
  return certs.keys;
}
