// This install's own settings: which repos it serves, its machines, its addresses, the checks it treats
// as device tests, the paths auto-merge leaves to the owner and what the reviewer is told about CI. Nothing about any one deployment is built in. Each value comes from, in order:
//   1. Settings › Install on the dashboard (saved in the database),
//   2. the env (FACTORY_PROJECTS, FACTORY_URL, ...),
//   3. DEFAULTS, where an empty value switches the feature off.
// The GitHub App's own slug is the exception: the dispatcher reads it from GitHub, and Settings or the env
// only add former slugs to it.
import type { State } from "./state.ts";

export interface Machine {
  /** The name its reporter and CI guard use: a-z, 0-9 and -. */
  name: string;
  /** One line for its card ("Test box · hardware tests"). */
  role: string;
  /** Always on: alerts when it stops reporting. */
  always: boolean;
  /** Its self-hosted runner's name, if CI runs there ("" when it isn't a CI machine). */
  runner: string;
  /** The runner labels that send a job there (besides self-hosted, windows, linux, x64). */
  labels: string[];
}

export interface UptimeCheck {
  label: string;
  url: string;
}

export interface Install {
  /** owner/name, the primary first. Each runs the lanes of its own .factory.yml. */
  projects: string[];
  /** The dashboard's public address, without a trailing slash ("" when there's none). */
  dashboardUrl: string;
  /** The machine the dispatcher runs on, as Systems names it (its Docker and Proxmox stats go there). */
  host: string;
  /** Machines the Systems and Devices views know, in display order. Others that report still show. */
  machines: Machine[];
  /** Addresses checked every 5 minutes. The first is shown as the site on the overview. */
  uptime: UptimeCheck[];
  /** CI check names that ran on a test machine (a regular expression, case-insensitive; "" for none). */
  deviceChecks: string;
  /** Paths whose change is always the owner's call (globs, automerge.ts), on top of the built-in workflows
   *  and secrets. A glob without a "/" matches a name at any depth; a trailing "/" means a folder's files. */
  riskyPaths: string[];
  /** A line for the reviewer about the project's CI, e.g. which checks only run once it passes ("" for none). */
  reviewerCi: string;
  /** Host of the project's web previews behind Cloudflare Access, e.g. "<project>.pages.dev" ("" for none). */
  previewHost: string;
  /** The dispatcher's own repo, named in agents' notes ("" leaves it out). */
  factoryRepo: string;
  /** The GitHub App's slug (read from GitHub when it answers), then any former slugs: their comments and issues count as agents'. */
  apps: string[];
  /** The issue the dashboard's Stop button labels `factory-stop` (0: none, Stop says so). */
  stopIssue: number;
  /** GlitchTip, for the Reports view and the maintainer's triage ("" url: off). */
  reports: { url: string; org: string };
  /** Older names of the agents' comment marker (`<!-- <name> -->`) that comments already on GitHub carry,
   *  e.g. from before a rename. They count as the agents' marker, as `factory` always does. */
  legacyMarkers: string[];
  /** The Performance view: the fps line of the app's own window, left out when picking a run's main frame
   *  rate ("" for none), and the process lines whose peak memory adds up to the app's memory. */
  perfApp: { ui: string; processes: string[] };
}

export const DEFAULTS: Install = {
  projects: [],
  dashboardUrl: "",
  host: "factory",
  machines: [],
  uptime: [],
  deviceChecks: "",
  riskyPaths: [],
  reviewerCi: "",
  previewHost: "",
  factoryRepo: "",
  apps: [],
  stopIssue: 0,
  reports: { url: "", org: "" },
  legacyMarkers: [],
  perfApp: { ui: "", processes: [] },
};

const REPO = /^[\w.-]+\/[\w.-]+$/;
const NAME = /^[a-z0-9][a-z0-9-]{0,30}$/;
const LABEL = /^[\w.-]{1,40}$/;

const SLUG = /^[a-z0-9][a-z0-9-]{0,38}$/i;
const MARKER_NAME = /^[a-z0-9][\w.-]{0,40}$/i;
const list = (v: unknown): string[] =>
  (Array.isArray(v) ? v.map(String) : typeof v === "string" ? v.split(/[,\n]/) : []).map((s) => s.trim()).filter(Boolean);
const text = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : undefined);

function url(v: unknown, field: string): string | undefined {
  const s = text(v, 300);
  if (s === undefined || s === "") return s;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw new Error(`${field}: "${s}" isn't a web address`);
  }
  if (!["https:", "http:"].includes(u.protocol)) throw new Error(`${field}: only http and https`);
  return s.replace(/\/+$/, "");
}

/**
 * Checks a saved or submitted settings object and keeps only the fields it sets. Throws with a plain
 * message on a bad value; unknown keys are dropped.
 */
export function parseInstall(raw: unknown): Partial<Install> {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: Partial<Install> = {};
  if (r.projects !== undefined) {
    const p = [...new Set(list(r.projects))];
    for (const x of p) if (!REPO.test(x)) throw new Error(`projects: "${x}" isn't owner/name`);
    if (!p.length) throw new Error("projects: list at least one repo");
    out.projects = p;
  }
  if (r.dashboardUrl !== undefined) out.dashboardUrl = url(r.dashboardUrl, "dashboardUrl") ?? "";
  if (r.host !== undefined) {
    const h = text(r.host, 31) ?? "";
    if (!NAME.test(h)) throw new Error("host: a-z, 0-9 and -, up to 31 characters");
    out.host = h;
  }
  if (r.machines !== undefined) {
    if (!Array.isArray(r.machines)) throw new Error("machines: a list");
    const seen = new Set<string>();
    out.machines = r.machines.map((m: Record<string, unknown>) => {
      const name = text(m?.name, 31) ?? "";
      if (!NAME.test(name)) throw new Error(`machines: "${name}" isn't a machine name (a-z, 0-9 and -, up to 31 characters)`);
      if (seen.has(name)) throw new Error(`machines: ${name} is listed twice`);
      seen.add(name);
      const labels = list(m.labels).map((l) => l.toLowerCase());
      for (const l of labels) if (!LABEL.test(l)) throw new Error(`machines: ${name}'s label "${l}" isn't a runner label`);
      return { name, role: text(m.role, 80) ?? "", always: m.always === true, runner: text(m.runner, 80) ?? "", labels };
    });
  }
  if (r.uptime !== undefined) {
    if (!Array.isArray(r.uptime)) throw new Error("uptime: a list");
    out.uptime = r.uptime.map((c: Record<string, unknown>) => {
      const u = url(c?.url, "uptime");
      if (!u) throw new Error("uptime: every check needs an address");
      return { label: text(c.label, 60) || new URL(u).host, url: String(c.url).trim() };
    });
  }
  if (r.deviceChecks !== undefined) {
    const d = text(r.deviceChecks, 300) ?? "";
    try {
      new RegExp(d, "i");
    } catch {
      throw new Error(`deviceChecks: "${d}" isn't a valid pattern`);
    }
    out.deviceChecks = d;
  }
  if (r.riskyPaths !== undefined) {
    // One per line: a comma can be part of a glob ({a,b}).
    const g = [...new Set(list(typeof r.riskyPaths === "string" ? r.riskyPaths.split("\n") : r.riskyPaths))];
    if (g.length > 50) throw new Error("riskyPaths: at most 50");
    for (const x of g) {
      if (x.length > 200) throw new Error(`riskyPaths: "${x.slice(0, 40)}..." is too long`);
      riskyPath(x); // throws with what's wrong
    }
    out.riskyPaths = g;
  }
  if (r.reviewerCi !== undefined) out.reviewerCi = (text(r.reviewerCi, 500) ?? "").replace(/\s+/g, " ");
  if (r.previewHost !== undefined) {
    const h = (text(r.previewHost, 120) ?? "").replace(/^\*\./, "");
    if (h && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(h)) throw new Error(`previewHost: "${h}" isn't a host name`);
    out.previewHost = h;
  }
  if (r.factoryRepo !== undefined) {
    const f = text(r.factoryRepo, 120) ?? "";
    if (f && !REPO.test(f)) throw new Error(`factoryRepo: "${f}" isn't owner/name`);
    out.factoryRepo = f;
  }
  if (r.apps !== undefined) {
    const a = list(r.apps).map((s) => s.replace(/\[bot\]$/, ""));
    for (const x of a) if (!SLUG.test(x)) throw new Error(`apps: "${x}" isn't a GitHub App slug`);
    out.apps = a;
  }
  if (r.stopIssue !== undefined) {
    const n = Number(r.stopIssue || 0);
    if (!Number.isInteger(n) || n < 0) throw new Error("stopIssue: an issue number, or 0 for none");
    out.stopIssue = n;
  }
  if (r.reports !== undefined) {
    const rep = (r.reports ?? {}) as Record<string, unknown>;
    out.reports = { url: url(rep.url, "reports.url") ?? "", org: text(rep.org, 80) ?? "" };
  }
  if (r.legacyMarkers !== undefined) {
    const m = [...new Set(list(r.legacyMarkers))];
    if (m.length > 10) throw new Error("legacyMarkers: at most 10");
    for (const x of m) if (!MARKER_NAME.test(x)) throw new Error(`legacyMarkers: "${x}" isn't a marker name (letters, digits, -, _ and .)`);
    out.legacyMarkers = m;
  }
  if (r.perfApp !== undefined) {
    const a = (r.perfApp ?? {}) as Record<string, unknown>;
    const processes = [...new Set(list(a.processes))];
    if (processes.length > 20) throw new Error("perfApp: at most 20 processes");
    for (const x of processes) if (x.length > 80) throw new Error(`perfApp: "${x.slice(0, 40)}..." is too long`);
    out.perfApp = { ui: text(a.ui, 80) ?? "", processes };
  }
  return out;
}

/** The env's say, for the keys that have one (an unset or empty variable says nothing). */
export function fromEnv(env: NodeJS.ProcessEnv): Partial<Install> {
  const out: Partial<Install> = {};
  const projects = env.FACTORY_PROJECTS || env.FACTORY_PROJECT;
  if (projects) out.projects = list(projects);
  if (env.FACTORY_URL) out.dashboardUrl = env.FACTORY_URL.replace(/\/+$/, "");
  if (env.PVE_NAME) out.host = env.PVE_NAME;
  if (env.FACTORY_DEVICE_CHECKS !== undefined && env.FACTORY_DEVICE_CHECKS !== "") out.deviceChecks = env.FACTORY_DEVICE_CHECKS;
  if (env.FACTORY_PREVIEW_HOST) out.previewHost = env.FACTORY_PREVIEW_HOST;
  if (env.FACTORY_APP_SLUG) out.apps = list(env.FACTORY_APP_SLUG);
  if (env.FACTORY_STOP_ISSUE) out.stopIssue = Number(env.FACTORY_STOP_ISSUE) || 0;
  if (env.GLITCHTIP_URL || env.GLITCHTIP_ORG) out.reports = { url: env.GLITCHTIP_URL ?? "", org: env.GLITCHTIP_ORG ?? "" };
  if (env.FACTORY_LEGACY_MARKERS) out.legacyMarkers = list(env.FACTORY_LEGACY_MARKERS);
  return out;
}

/**
 * Saved settings over the env over the defaults. `app` is the slug GitHub gave for the app ("" when it
 * hasn't answered): it goes first in `apps`, and the configured slugs follow as former ones. Pure.
 */
export function resolve(saved: Partial<Install>, env: NodeJS.ProcessEnv, app = ""): Install {
  const out = { ...DEFAULTS, ...fromEnv(env), ...saved };
  return app ? { ...out, apps: [app, ...out.apps.filter((a) => a.toLowerCase() !== app.toLowerCase())] } : out;
}

let bound: State | undefined;
let cached: Install | undefined;
let appSlug = "";

/** The app's slug as GitHub gives it (main.ts, at startup). Leads `apps` from now on. */
export function setAppSlug(slug: string): void {
  if (!SLUG.test(slug)) throw new Error(`GitHub gave "${slug}" as the app's slug`);
  appSlug = slug;
  cached = undefined;
}

/** Reads this install's settings from `state` from now on (main.ts, once). */
export function bindInstall(state: State): void {
  bound = state;
  cached = undefined;
}

/** This install's settings now. Without a database (tests, one-off scripts): the env over the defaults. */
export function install(): Install {
  if (cached) return cached;
  let saved: Partial<Install> = {};
  try {
    saved = parseInstall(bound?.installSaved() ?? {});
  } catch {
    // a bad saved value can't happen through the API; ignore it rather than stop the dispatcher
  }
  const now = resolve(saved, process.env, appSlug);
  if (bound) cached = now; // without a database (tests), the env is read each time
  return now;
}

/**
 * Saves a change from the dashboard. The primary repo can't change here: its rows in the database have no
 * repo name, so a different first repo would inherit them. Returns the new settings.
 */
export function saveInstall(patch: unknown): Install {
  if (!bound) throw new Error("no database");
  const p = parseInstall(patch);
  const now = install();
  if (p.projects && now.projects[0] && p.projects[0] !== now.projects[0]) {
    throw new Error(`projects: the first repo stays ${now.projects[0]} (it owns the existing history); add or remove the others`);
  }
  bound.setInstallSaved({ ...parseInstall(bound.installSaved() ?? {}), ...p });
  cached = undefined;
  return install();
}

/**
 * A database from before these settings existed, with none saved yet: that deployment had its values built
 * in, and now has to enter them once on Settings › Install (main.ts and the dashboard say so).
 */
export const needsSetup = (): boolean => Boolean(bound?.installPredates() && !Object.keys(parseQuiet(bound.installSaved())).length);

function parseQuiet(v: unknown): Partial<Install> {
  try {
    return parseInstall(v);
  } catch {
    return {};
  }
}

/** The primary repo ("" when none is set yet). */
export const primary = (): string => install().projects[0] ?? "";

/** The device-check pattern, or null when no check counts as a device test. */
export function deviceCheck(source = install().deviceChecks): RegExp | null {
  if (!source) return null;
  try {
    return new RegExp(source, "i");
  } catch {
    return null;
  }
}

const escape = (s: string) => s.replace(/[.+^$()|[\]\\]/g, "\\$&");

/** One glob segment run: `**` (with its "/") is any folders, `*` anything but "/", `?` one character. */
function globPart(g: string): string {
  let re = "";
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === "*" && g[i + 1] === "*") {
      if (g[i + 2] === "/") (re += "(?:.*/)?"), (i += 2);
      else (re += ".*"), (i += 1);
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += escape(c);
  }
  return re;
}

/**
 * A risky-path glob (Settings › Install) as a case-insensitive pattern for a repo path. A glob without a "/"
 * (apart from a trailing one) matches a file or folder name at any depth, like .gitignore; one with a "/" is
 * from the repo's root. A trailing "/" matches only what's inside that folder; otherwise a folder's name
 * also matches its files. `{a,b}` is either. Throws with a plain message on a glob it can't read.
 */
export function riskyPath(glob: string): RegExp {
  const g = glob.trim();
  const dir = g.endsWith("/");
  const body = g.replace(/\/+$/, "");
  const anchored = body.includes("/");
  const path = body.replace(/^\/+/, "");
  if (!path) throw new Error(`riskyPaths: "${glob}" names no path`);
  let re = "";
  for (let i = 0; i < path.length; i++) {
    const end = path[i] === "{" ? path.indexOf("}", i) : -1;
    if (path[i] === "}" || (path[i] === "{" && (end < 0 || path.slice(i + 1, end).includes("{")))) throw new Error(`riskyPaths: "${glob}" has an unmatched brace`);
    if (end < 0) {
      const next = path.slice(i).search(/[{}]/);
      const run = next < 0 ? path.slice(i) : path.slice(i, i + next);
      re += globPart(run);
      i += run.length - 1;
      continue;
    }
    re += `(?:${path.slice(i + 1, end).split(",").map(globPart).join("|")})`;
    i = end;
  }
  return new RegExp(`^${anchored ? "" : "(?:.*/)?"}${re}${dir ? "/" : "(?:/|$)"}`, "i");
}
