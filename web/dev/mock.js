// `FACTORY_FIXTURE=web/dev/state.json npm run dev:web`: the dashboard against a saved /api/state, for
// working on the look without a dispatcher. Controls answer "ok" and change nothing. Save a snapshot from
// the dispatcher container (Dashboard.state()) as the JSON file; it holds private data, so it's git-ignored.
import { readFileSync } from "node:fs";

export function fixture(file) {
  const state = JSON.parse(readFileSync(file, "utf8"));
  const json = (res, body) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(body));
  };
  return {
    name: "factory-fixture",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith("/api/")) return next();
        if (req.url.startsWith("/api/state")) return json(res, { ...state, now: new Date().toISOString() });
        if (req.url.startsWith("/api/runs/")) return json(res, []);
        // A saved /api/systems next to the state file (systems.json, also git-ignored), if there is one.
        if (req.url.startsWith("/api/systems")) {
          try {
            return json(res, JSON.parse(readFileSync(file.replace(/[^/\\]+$/, "systems.json"), "utf8")));
          } catch {
            return json(res, { devices: [], sites: [], alerts: { open: [], settings: {} }, docker: [] });
          }
        }
        if (req.url.startsWith("/api/reports")) return json(res, { configured: true, url: "https://crash.example.com", at: new Date().toISOString(), issues: [
          { id: "1", shortId: "APP-1", title: "Test report from the setup check", culprit: "", level: "info", kind: "problem", status: "unresolved", count: 1, firstSeen: "2026-11-07T16:31:14Z", lastSeen: "2026-11-07T16:31:14Z", link: "#" },
          { id: "2", shortId: "APP-2", title: "panicked at src/launch.rs:812: index out of bounds", culprit: "app::launch::place", level: "fatal", kind: "crash", status: "unresolved", count: 3, firstSeen: "2026-11-08T10:00:00Z", lastSeen: "2026-11-08T20:00:00Z", link: "#" },
        ] });
        // A card's thread (the drawer, and the agent's question in the Answer view): made-up words.
        if (req.url.startsWith("/api/issues/")) return json(res, { number: Number(req.url.match(/\d+/)?.[0]), title: "A card", body: "What the card asks for.", state: "open", labels: ["needs-owner"], pr: false, comments: [
          { author: "example-factory[bot]", at: new Date(Date.now() - 3 * 3600_000).toISOString(), kind: "comment", body: "🤖 **Factory:** Should the new setting start **on** or **off**?\n\n- On (recommended): it works from the first deploy.\n- Off: nothing changes until you switch it on.\n\n<details><summary>Details</summary>\n\nThe draft PR has both paths built; only the default differs.\n</details>\n\n<!-- factory -->" },
        ] });
        if (req.url.startsWith("/api/data")) return json(res, sampleData());
        if (req.method === "GET" && req.url.startsWith("/api/devices")) return json(res, sampleDevices());
        if (req.method === "GET" && req.url.startsWith("/api/gaming")) return json(res, { workflow: "game-test.yml", repo: "owner/app", vars: { on: true, autoHours: "1-7", limitMin: 60, games: "Example Game" }, error: null });
        if (req.url.startsWith("/api/logs")) return json(res, { containers: [], lines: [] });
        if (req.method === "POST") return json(res, { message: "ok (fixture: nothing changed)" });
        return json(res, {});
      });
    },
  };
}

/** A made-up Devices view: one machine with a game test waiting for Start (src/gaming.ts's shape). */
function sampleDevices() {
  const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();
  return {
    machines: [{ name: "test-pc", role: "Test PC · game tests", now: [], queue: [], recent: [] }],
    games: [{ run: 1, machine: "test-pc", state: "waiting", step: "Ask", pr: 81, title: "Faster loading", sha: "abc1234", url: "#", at: ago(4), answers: ["start", "later", "skip"] }],
    error: null,
  };
}

/** Made-up history for the Data view, with a few scored PRs (src/scores.ts's shape). */
function sampleData() {
  const day = (n) => new Date(Date.now() - n * 864e5).toISOString();
  const row = (pr, title, size, lane, model, score, cost, parts) => ({
    repo: "owner/app", pr, card: pr - 40, title, size, lane, model, score, cost, parts,
    reviewerRounds: parts.some((p) => p.why.includes("review")) ? 1 : 0, ownerRounds: 0, ownerCommits: 0, ownerLines: 0, ciFailures: 0, hours: 5, reverted: null, merged: day(pr % 20),
  });
  const rows = [
    row(81, "Settings page for limits", "M", "builder", "Opus 5.5", 96, 21.4, [{ why: "$21.40 API-equivalent", points: 4 }]),
    row(79, "Fix the stuck run", "S", "small-builder", "Sonnet 5.5", 95, 3.1, []),
    row(77, "Performance view", "L", "builder", "Opus 5.5", 72, 48.0, [{ why: "1 review round (1 reviewer, 0 you)", points: 10 }, { why: "CI red on 2 commits", points: 10 }, { why: "$48.00 API-equivalent", points: 9 }]),
    row(74, "Rename a label", "S", "small-builder", "Sonnet 5.5", 100, 1.9, []),
    row(70, "Visual proof on PRs", "M", "builder", "Opus 5.5", 80, 25.0, [{ why: "1 review round (1 reviewer, 0 you)", points: 10 }, { why: "$25.00 API-equivalent", points: 5 }]),
  ];
  return {
    issues: [{ created: day(3), closed: day(1), type: "feature", factory: false }],
    pulls: rows.map((r) => ({ created: day(r.pr % 20 + 1), merged: r.merged, closed: r.merged, factory: true })),
    runs: rows.map((r) => ({ at: r.merged, lane: r.lane, mode: "live", status: "done", cost: r.cost, minutes: 40 })),
    usage: [],
    scores: {
      rows,
      groups: [
        { lane: "small-builder", model: "Sonnet 5.5", size: "S", prs: 2, score: 98, cost: 2.5, rounds: 0, reverted: 0 },
        { lane: "builder", model: "Opus 5.5", size: "M", prs: 2, score: 88, cost: 23.2, rounds: 0.5, reverted: 0 },
        { lane: "builder", model: "Opus 5.5", size: "L", prs: 1, score: 72, cost: 48, rounds: 1, reverted: 0 },
      ],
      advice: [
        "size:S: only Sonnet 5.5 has built these (2 PRs, average 98), so there's nothing to compare yet.",
        "size:M: only Opus 5.5 has built these (2 PRs, average 88), so there's nothing to compare yet.",
        "size:L: only Opus 5.5 has built these (1 PR, average 72), so there's nothing to compare yet.",
      ],
      formula: ["Every merged factory PR starts at 100 and loses points for what went less than right (never below 0):", "Review rounds: 10 per \"needs work\" …"],
    },
  };
}
