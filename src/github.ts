// GitHub REST access as the factory's GitHub App (comments and PRs show as `<app>[bot]`).
// Falls back to GH_TOKEN for read-only use when the app isn't configured.
import { createSign } from "node:crypto";

const API = "https://api.github.com";

export class GitHub {
  private cached: { token: string; expires: number } | undefined;
  readonly identity: string;

  constructor() {
    this.identity = appConfigured() ? "GitHub App" : process.env.GH_TOKEN ? "GH_TOKEN" : "none";
    if (this.identity === "none") throw new Error("Set GH_APP_ID, GH_APP_INSTALLATION_ID and GH_APP_PRIVATE_KEY_B64 (or GH_TOKEN).");
  }

  /** An installation token, minted with the app's key and reused until 5 minutes before it expires. */
  async token(): Promise<string> {
    if (!appConfigured()) return process.env.GH_TOKEN!;
    if (this.cached && this.cached.expires - Date.now() > 5 * 60_000) return this.cached.token;
    const res = await fetch(`${API}/app/installations/${process.env.GH_APP_INSTALLATION_ID}/access_tokens`, {
      method: "POST",
      headers: { ...HEADERS, Authorization: `Bearer ${appJwt()}` },
    });
    if (!res.ok) throw new Error(`GitHub App token: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { token: string; expires_at: string };
    this.cached = { token: body.token, expires: Date.parse(body.expires_at) };
    return body.token;
  }

  /**
   * A one-hour token for one repo only, with just what agents need (no admin): reading CI (checks,
   * statuses) and changing workflow files too, as far as the installation has those permissions. Release
   * secrets live in a protected GitHub environment, so a workflow on an agent's branch can't read them.
   */
  async repoToken(repo: string): Promise<string> {
    if (!appConfigured()) throw new Error("Live runs need the GitHub App (GH_APP_* variables).");
    const base = { contents: "write", pull_requests: "write", issues: "write", metadata: "read" };
    const mint = (permissions: Record<string, string>) =>
      fetch(`${API}/app/installations/${process.env.GH_APP_INSTALLATION_ID}/access_tokens`, {
        method: "POST",
        headers: { ...HEADERS, Authorization: `Bearer ${appJwt()}` },
        body: JSON.stringify({ repositories: [repo.split("/")[1]], permissions }),
      });
    // The richest set the installation has accepted (422 means it lacks one of them).
    let res = await mint({ ...base, checks: "read", statuses: "read", workflows: "write" });
    if (res.status === 422) res = await mint({ ...base, checks: "read", statuses: "read" });
    if (res.status === 422) res = await mint(base);
    if (!res.ok) throw new Error(`GitHub App repo token: ${res.status} ${await res.text()}`);
    return ((await res.json()) as { token: string }).token;
  }

  /** Sets the app's own webhook URL and secret (app-level endpoint, signed with the app's JWT). */
  async setAppWebhook(url: string, secret: string): Promise<void> {
    if (!appConfigured()) throw new Error("Needs the GitHub App (GH_APP_* variables).");
    const res = await fetch(`${API}/app/hook/config`, {
      method: "PATCH",
      headers: { ...HEADERS, Authorization: `Bearer ${appJwt()}` },
      body: JSON.stringify({ url, secret, content_type: "json", insecure_ssl: "0" }),
    });
    if (!res.ok) throw new Error(`GitHub App webhook config: ${res.status} ${await res.text()}`);
  }

  async get<T>(path: string): Promise<T> {
    const res = await this.fetch(path);
    return (await res.json()) as T;
  }

  /** Like get, but undefined on 404 (missing file, feature not enabled). */
  async maybe<T>(path: string): Promise<T | undefined> {
    const res = await this.fetch(path, true);
    return res.status === 404 ? undefined : ((await res.json()) as T);
  }

  /** A text download (a job log), or undefined when it isn't there or the app may not read it. */
  async text(path: string): Promise<string | undefined> {
    const res = await fetch(API + path, { headers: { ...HEADERS, Authorization: `Bearer ${await this.token()}` } });
    return res.ok ? await res.text() : undefined;
  }

  /** A binary download (an artifact's zip; GitHub redirects to its storage, which gets no token), or undefined. */
  async bytes(path: string): Promise<Buffer | undefined> {
    let res = await fetch(API + path, { headers: { ...HEADERS, Authorization: `Bearer ${await this.token()}` }, redirect: "manual" });
    const to = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (to) res = await fetch(to, { signal: AbortSignal.timeout(120_000) });
    return res.ok ? Buffer.from(await res.arrayBuffer()) : undefined;
  }

  /** A write (POST, PATCH, PUT, DELETE) as the app. */
  async send(method: string, path: string, body?: unknown): Promise<void> {
    const res = await fetch(API + path, {
      method,
      headers: { ...HEADERS, Authorization: `Bearer ${await this.token()}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok && res.status !== 404) throw new Error(`GitHub ${res.status} on ${method} ${path}: ${(await res.text()).slice(0, 200)}`);
  }

  /** A write whose outcome the caller handles: never throws on an HTTP error. */
  async request(method: string, path: string, body?: unknown): Promise<{ ok: boolean; status: number; text: string }> {
    const res = await fetch(API + path, {
      method,
      headers: { ...HEADERS, Authorization: `Bearer ${await this.token()}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { ok: res.ok, status: res.status, text: await res.text() };
  }

  /** The app's own slug (`<slug>[bot]` is its login), or undefined without the app or when GitHub doesn't answer. */
  async appSlug(): Promise<string | undefined> {
    if (!appConfigured()) return undefined;
    const res = await fetch(`${API}/app`, { headers: { ...HEADERS, Authorization: `Bearer ${appJwt()}` }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`GitHub App: ${res.status} ${(await res.text()).slice(0, 200)}`);
    return ((await res.json()) as { slug?: string }).slug || undefined;
  }

  /** The permissions the app's installation has (e.g. `actions: "write"`), or undefined without the app. */
  async appPermissions(): Promise<Record<string, string> | undefined> {
    if (!appConfigured()) return undefined;
    const res = await fetch(`${API}/app/installations/${process.env.GH_APP_INSTALLATION_ID}`, { headers: { ...HEADERS, Authorization: `Bearer ${appJwt()}` } });
    if (!res.ok) return undefined;
    return ((await res.json()) as { permissions?: Record<string, string> }).permissions;
  }

  /** Every page of a list endpoint. */
  async all<T>(path: string): Promise<T[]> {
    const out: T[] = [];
    let url: string | undefined = path + (path.includes("?") ? "&" : "?") + "per_page=100";
    while (url) {
      const res = await this.fetch(url);
      out.push(...((await res.json()) as T[]));
      url = res.headers.get("link")?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
    }
    return out;
  }

  private async fetch(path: string, allow404 = false): Promise<Response> {
    const url = path.startsWith("http") ? path : API + path;
    const res = await fetch(url, { headers: { ...HEADERS, Authorization: `Bearer ${await this.token()}` } });
    if (!res.ok && !(allow404 && res.status === 404)) throw new Error(`GitHub ${res.status} on ${path}: ${(await res.text()).slice(0, 200)}`);
    return res;
  }
}

const HEADERS = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "factory" };

function appConfigured(): boolean {
  return Boolean(process.env.GH_APP_ID && process.env.GH_APP_INSTALLATION_ID && process.env.GH_APP_PRIVATE_KEY_B64);
}

function appJwt(): string {
  const now = Math.floor(Date.now() / 1000);
  // Backdated a minute for clock drift; GitHub allows at most 10 minutes.
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: process.env.GH_APP_ID }));
  const key = Buffer.from(process.env.GH_APP_PRIVATE_KEY_B64!, "base64").toString("utf8");
  const sig = createSign("RSA-SHA256").update(`${head}.${body}`).sign(key).toString("base64url");
  return `${head}.${body}.${sig}`;
}

const b64url = (s: string) => Buffer.from(s).toString("base64url");
