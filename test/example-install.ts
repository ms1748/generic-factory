// A made-up install for tests that need machines, checks or an app name (src/install.ts). Importing this
// binds an in-memory database with these settings saved, as Settings › Install would.
import { bindInstall, saveInstall, type Install } from "../src/install.ts";
import { State } from "../src/state.ts";

export const EXAMPLE: Install = {
  projects: ["owner/app", "owner/site"],
  dashboardUrl: "https://factory.example.com",
  host: "homelab",
  machines: [
    { name: "homelab", role: "Homelab · runs the factory", always: true, runner: "", labels: [] },
    { name: "test-box", role: "Test box · hardware tests", always: true, runner: "runner-test-box", labels: ["hardware"] },
    { name: "build-pc", role: "Build PC · Windows builds, manual tests", always: false, runner: "runner-build", labels: ["windows-build", "manual"] },
  ],
  uptime: [
    { label: "example.com", url: "https://example.com/" },
    { label: "Factory tunnel", url: "https://factory.example.com/healthz" },
  ],
  deviceChecks: "test box|manual|device",
  riskyPaths: ["updater.rs", "latest.json", "sign*", "app.conf.json", "app.*.conf.json", "capabilities/"],
  reviewerCi: "The Windows build and tests don't run on a factory PR until you pass it, so judge without them and don't wait for them.",
  previewHost: "app-previews.pages.dev",
  factoryRepo: "owner/factory",
  apps: ["example-factory", "old-factory"],
  stopIssue: 7,
  reports: { url: "https://crash.example.com", org: "example" },
  legacyMarkers: ["old-factory"],
  perfApp: { ui: "App UI", processes: ["App", "WebView2"] },
  gamingTest: { workflow: "game-test.yml", askStep: "Ask", start: "factory/game-test/start", later: "factory/game-test/later", skip: "" },
};

export function useExample(over: Partial<Install> = {}): State {
  const state = new State(":memory:");
  bindInstall(state);
  saveInstall({ ...EXAMPLE, ...over });
  return state;
}
