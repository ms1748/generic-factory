// The Reports view: the project's crash and problem reports from GlitchTip, read over the factory's own
// Docker network with the read-only GLITCHTIP_TOKEN the maintainer lane already has. Optional: it's on once
// the token, GlitchTip's address and its organization are set (Settings › Install › Reports, or GLITCHTIP_*).
// Read-only: it lists issues and links to GlitchTip; resolving and commenting happen there.
import { install } from "./install.ts";

/** Where the dispatcher reaches GlitchTip (inside Docker); install().reports.url is where your browser does. */
const API = process.env.GLITCHTIP_API ?? "http://glitchtip-web:8000";

export interface Report {
  id: string;
  shortId: string;
  title: string;
  culprit: string;
  /** "error" and "fatal" are crashes; "info" is a problem report someone sent. */
  level: string;
  kind: "crash" | "problem";
  status: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
  link: string;
}

export interface Reports {
  configured: boolean;
  url: string;
  issues: Report[];
  error?: string;
  at: string;
}

interface ApiIssue {
  id: string;
  shortId?: string;
  title?: string;
  culprit?: string;
  level?: string;
  status?: string;
  count?: string | number;
  firstSeen?: string;
  lastSeen?: string;
  permalink?: string;
}

/** GlitchTip's issue list, trimmed to what the page shows, newest activity first. */
export function parseIssues(list: ApiIssue[], publicUrl = install().reports.url, org = install().reports.org): Report[] {
  return list
    .map((i): Report => {
      const level = i.level ?? "error";
      return {
        id: String(i.id),
        shortId: i.shortId ?? `#${i.id}`,
        title: (i.title ?? "(no title)").slice(0, 300),
        culprit: (i.culprit ?? "").slice(0, 200),
        level,
        kind: level === "info" || level === "warning" ? "problem" : "crash",
        status: i.status ?? "unresolved",
        count: Number(i.count ?? 0) || 0,
        firstSeen: i.firstSeen ?? "",
        lastSeen: i.lastSeen ?? "",
        // Always point the browser at the public address, whatever GlitchTip thinks its own URL is.
        link: `${publicUrl.replace(/\/$/, "")}/${org}/issues/${encodeURIComponent(String(i.id))}`,
      };
    })
    .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
}

let cache: Reports | undefined;
const FRESH_MS = 2 * 60_000;

/** The last 100 issues (open and resolved), cached for two minutes. Never throws. */
export async function reports(fresh = false): Promise<Reports> {
  const token = process.env.GLITCHTIP_TOKEN;
  const { url: PUBLIC_URL, org: ORG } = install().reports;
  if (!token || !PUBLIC_URL || !ORG) return { configured: false, url: PUBLIC_URL, issues: [], at: new Date().toISOString() };
  if (!fresh && cache && Date.now() - Date.parse(cache.at) < FRESH_MS) return cache;
  try {
    const res = await fetch(`${API}/api/0/organizations/${encodeURIComponent(ORG)}/issues/?limit=100&query=`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`GlitchTip answered ${res.status}`);
    cache = { configured: true, url: PUBLIC_URL, issues: parseIssues((await res.json()) as ApiIssue[]), at: new Date().toISOString() };
  } catch (e) {
    cache = { configured: true, url: PUBLIC_URL, issues: cache?.issues ?? [], error: (e as Error).message, at: new Date().toISOString() };
  }
  return cache;
}
