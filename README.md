# Factory

The factory runs Claude Code against your GitHub repo's issue queue, from a machine you own. You write
cards and label them `ready`; builder agents pick them up and open pull requests, a reviewer agent checks
each one, and a dashboard shows it all and lets you steer. Agents act as your own GitHub App. MIT licensed
(LICENSE).

- **Builders** take `ready` cards in priority order, one fresh container per run, and open PRs. Card sizes
  go to different lanes and models; oversized cards are split into smaller ones.
- **A reviewer** reads every factory PR against its card, CI and the preview deploy, and says "ready" or
  "needs work". Needs-work goes back to the builder by itself.
- **Your replies continue the work:** comment on a factory PR and the same agent session picks it up.
- **Auto-merge** (optional) merges what the reviewer passed, once CI is green.
- **A dashboard:** live transcripts, the queue as a board, lanes with live/dry switches, your Claude
  plan's usage, recent runs, an Activity log with Undo, and settings.
- **Machines and tests** (optional): your CI and test machines' health, their jobs, and each build's
  performance on real hardware.
- **Safe by default:** every lane starts dry, usage stops leave room for your own Claude use, a
  `factory-stop` label on any issue stops everything, and agents never push to `main` or merge.

**What you need:**

- A Linux machine with Docker that stays on (a home server, a VPS, a Proxmox LXC): about 5 CPUs and 8 GB
  of memory per agent run.
- A Claude plan that includes Claude Code.
- A GitHub repo with issues, and a GitHub App of your own installed on it (a personal access token works
  to try it out).
- Optional: a domain on Cloudflare (free plan) for reaching the dashboard and webhooks; self-hosted CI
  and test machines.

**Start here:**

- [Quick start](docs/quickstart.md): what you need, the env keys, pointing it at your repo, lanes and labels.
- [Deploy](docs/deploy.md): any Linux host with Docker; reaching the dashboard safely, updates, backups.
- [Machines](machines/README.md): setup scripts for CI runners, test machines and the stats reporters.
- [Starter kit](templates/project/README.md): `init-project <owner/repo>` creates the factory's labels on your
  repo and opens a PR with starter prompt files and a `.factory.yml`, for you to fill in.
- [Example: a homelab install](examples/homelab/README.md): one Proxmox host with the factory and a CI
  runner, a shared Windows build PC and a test box, Cloudflare Tunnel and Access, GlitchTip.
- [Security](SECURITY.md) and [Contributing](CONTRIBUTING.md).

Everything about your own setup (repos, machines, addresses, check names) lives in the dashboard's
Settings › Install or the env, never in the code (src/install.ts). The GitHub App's own slug is read from
GitHub at startup; Settings › Install › GitHub App only adds former slugs.

**Status: every lane is dry until the owner switches it on.** `serve` fires lanes on their schedules, one
run at a time, and records each run in SQLite (`data/factory.db`). A dry lane only records what it would
have done. A live lane starts a fresh agent container that runs `claude -p` with the project's prompt
file, and keeps the transcript in `data/transcripts/<run>.jsonl`. When a run hits a Claude usage limit,
every lane pauses until the limit resets (or for 5 hours).

```bash
docker compose exec dispatcher node src/main.ts status              # lanes, pause, last runs
docker compose exec dispatcher node src/main.ts lane small-builder on   # live from its next slot, in every repo with that lane
docker compose exec dispatcher node src/main.ts lane small-builder off owner/site  # back to dry, in one repo
docker compose exec dispatcher node src/main.ts run small-builder   # run it now
docker compose exec dispatcher node src/main.ts doctor              # a tiny live check of the agent image
```

**The dashboard** is at your dashboard address, behind Cloudflare Access or the built-in sign-in (a password or token
at `/login`; see [Securing the dashboard](docs/quickstart.md#securing-the-dashboard)). Without either, the port refuses
it (agents and the CI runner can reach that port). It has these panels:

- **Running now:** the run's live transcript (Claude's words, tool calls, results).
- **Budget:** the plan's real 5-hour and weekly usage from Claude Code's own reports, with the reset
  times and where the factory stops starting runs (80% and 90% by default, Settings › Limits), plus API-equivalent spend.
- **Board:** Up next, Building, In review, Needs you, On hold, Done (the last week's Done lines), and Ideas. Each card opens a drawer; queued cards and ideas have **Build now**. It runs that card right away, live, with the builder lane for its size, even if the lane is dry, after a confirmation.
- **Usage:** a tiny Haiku call about every 30 minutes keeps the meters fresh while no run reports usage (Settings › Limits, 0 turns it off).
- **Lanes:** each repo's lanes, grouped by repo: an off/dry/live switch, the next run, what the lane would do, and *Run now*.
- **Next up:** the queue in build order, with Hold and Requeue.
- **Waiting on you:** questions (`needs-owner`), PRs to review, and ideas to triage.
- **Recent runs:** each one opens its transcript.
- **Answer** (`#/answer`, the phone's second tab): each card waiting on you (`needs-owner`), the agent's latest question (details folded), and a reply box. **Send** posts your answer on the card as the app, ending "<owner>'s answer, sent from the factory dashboard". The dispatcher saves that comment's id, so it counts as yours and only that comment does: the PR's session resumes (webhook, or the next poll). A card without a PR shows as answered, and the maintainer requeues it. Drafts stay on the phone until sent. `#/answer/<n>` (or `#/answer/<owner>/<repo>/<n>`) puts that card first, for notification links.
- **Install on a phone:** the dashboard is a PWA (`web/public/manifest.webmanifest`, icons, and `sw.js`, which keeps the page shell so the app opens offline with the last state it saw; `/api/` is never cached). Open the dashboard in the phone's browser and use *Add to Home screen* / *Install app*; it opens on Answer.
- **Pause:** a 24-hour pause, or resume.
- **Devices:** each self-hosted CI machine (Settings › Install › Machines) as CI sees it: the job it's running with every step live, the jobs waiting for it, and its last results with their artifacts and where they failed, plus Pause CI. `node src/main.ts devices --watch` shows the same in a terminal.
- **Build threads** (Systems, on a CI machine's card, under Pause CI): how many threads CI builds there may use (`CARGO_BUILD_JOBS`). *Every build* (default 6), *Most a PR may ask for* (default 12; a PR asks with a `build-threads:N` label or a "Build threads: N" line in its body), and *While you play*: **Paused** (the default: a game pauses CI, as before) or a number, with which builds go on during a game with that many threads at idle priority. Saved per machine in the factory's state; the machine's game guard picks them up at its next check-in (`/ingest/device/<name>/guard` answers `{paused, jobs}`) and writes them to `ci-jobs` in its data folder (`-Data` in `machines/windows-runner/setup-game-guard.ps1`), which the project's CI reads at its build step, logging the count and why.

- **Performance:** how each build did in the project's hardware tests (a test box, a build PC), kept in the database: startup and shutdown times, frame rates (average and 1% low), CPU, GPU, memory, temperatures, clocks, power and fans, with charts over each run and what got worse or better than the build before (below).

The page polls `/api/state`. Controls are POSTs that need an `x-factory` header (no cross-site requests), and with the
built-in sign-in also the session's CSRF token. Through the tunnel, the app checks the Access token itself as well as Cloudflare's own check.

**Replying on a PR continues the build.** A live builder's PR is linked to the Claude session that made it.
When the owner comments, reviews or leaves a line comment there, the dispatcher resumes that same session
(`claude --resume`) in a fresh container on the PR's branch. Claude makes the change, pushes, and replies
on the PR as the bot.

- **How it notices:** instantly by GitHub App webhook (`POST /webhooks/github`, signed with
  `WEBHOOK_SECRET`), or within 5 minutes by polling.
- **What counts:** only the repo owner's items count, and only those no agent reply follows.
- **Failures:** a failed resume isn't retried until the owner says something new. A usage limit waits
  for the reset.
- **Dry lanes:** a session from a dry lane only records "would resume".

**The reviewer lane checks every factory PR first.** When a factory PR is marked ready, and after each
new push, a Sonnet run reviews it. It reads the card, the whole diff, CI, and the Cloudflare Pages
preview for website changes (through the Access service token). The agent only reads; the dispatcher
posts its verdict as one comment, **Ready for you** or **Needs work**, and sets the `factory/review`
commit status.

- **Needs work:** the dispatcher resumes the PR's builder session with the must-fix list. After 2 rounds
  it stops and leaves the PR to the owner.
- **Polish, once:** the reviewer splits extras into *polish* (small and in the card's scope: an edge case,
  a missing test, a clearer message) and *later* (bigger, for a follow-up card). On a "ready" verdict with
  polish, the dispatcher hands the polish list to the builder session once (status "Polishing"), then the
  reviewer checks again and that verdict goes to the owner. Each *later* item becomes an `idea` issue (src/followups.ts): not when an open issue or a closed idea already has the same title, at most 5 per PR, linked from the verdict comment, and listed in Activity with Undo.
- **Short comments:** the verdict comment is a summary line and the lists; the full review is folded
  away. Agents' own replies open with a few lines and fold the detail too.
- **Trial reviews:** `review <pr>... ` runs the reviewer on any PR (merged ones too) and prints the verdict
  without posting anything. Add `--post` to post it.
- **Its guide** is built in (`src/review.ts`), not a prompt file in the project, and shows in the
  dashboard's Lanes view. Settings › Install › Reviewer CI note adds a line about the project's CI to it
  (say, which checks only run once the reviewer passes a PR and adds `reviewed`).

**Before/after screenshots** (src/shots.ts, Settings › Budget › Before/after screenshots, off by default). When the reviewer hands the owner a PR that touches `website/` or UI files under `src/`, a script in the agent image (`agent/shots.mjs`, Playwright's Chromium) shoots the pages the reviewer named (up to 3, else the home page) on production (`https://<preview host>`) and on the PR's preview, at desktop and phone width. It runs in its own short container with no GitHub token and no model, and sends the Access service token only to those two hosts. The dispatcher uploads the images to one pre-release in the project repo, `factory-screenshots` (GitHub has no API for comment attachments; release assets aren't in git or any clone), and posts one before/after comment. Only while the reviewer lane is live; a failure is logged and the review goes on.

**Auto-merge** (src/automerge.ts, Settings › Auto-merge, on by default). The owner doesn't review or merge factory PRs: the dispatcher merges one, as the app, once the reviewer passed its latest commit and said it's safe to merge by itself (`"merge": "ok"`), CI is green with the device tests and nothing still running, GitHub says it merges cleanly, and nothing has `needs-owner`, `hold` or `factory-stop`. A PR that is ready apart from a `needs-owner` (on it or its card, often an older question) gets the owner's-call line below instead of waiting silently. Workflows and secrets (`.env` files, key files, anything named secret) are always the owner's call, and so are the paths listed on Settings › Install › Risky paths (globs: a name like `updater.rs` matches at any depth, a trailing `/` means a folder's files; an app might list its updater, signing scripts and permissions there), and so is anything the reviewer flags (it deletes user data, removes a feature, or the reviewer is unsure): the PR gets one line saying why and its card gets `needs-owner`. It only runs while the reviewer lane is live.

**Auto-queue ideas** (src/autoqueue.ts, Settings › Budget › Auto-queue ideas, off by default). The serve loop looks at each served project's queue every 5 minutes. When it's on and fewer than 3 cards (Settings) are buildable `ready` (after the queue rules' skips), one short Sonnet run, at most once per project every 3 hours (Settings › Limits), reads the open `idea` issues (title, labels, the start of the body) and picks up to 5 (Settings) as JSON, each with a one-line reason. The dispatcher drops `hold`, `needs-owner`, `p3`, `size:XL` and someday ideas before the run; the agent skips anything that needs the owner's hardware, accounts or judgement (checks on a real PC or pad, releases, billing) and duplicates. The agent only reads: the dispatcher adds `ready` and one comment, "Queued by auto-queue: <reason>", so both show in Activity with Undo, and the run is in Recent runs (lane `auto-queue`). It waits while the factory is paused, stopped (`factory-stop`), over the plan's usage stops, or out of run slots. Its prompt is `autoQueuePrompt` in src/prompt.ts.

**Nothing ready to build** (an alert, Settings › Alerts). When a served project has had no buildable `ready` card for 30 minutes (Settings), the alert "<repo>: nothing ready to build" opens on Systems and goes to Discord if that's set up. With auto-queue on, it opens only once auto-queue's last attempt found nothing to add, and says so: "auto-queue found nothing to add; queue an idea or file a card". It clears by itself when a card is ready again. It follows the Alerts on switch and has its own on/off.

**A Done line on every merged card** (src/done.ts). When a factory PR merges, the dispatcher checks CI on its last commit, the device tests among those checks (Settings › Install › Device checks), the reviewer's last verdict and the ideas filed from it, then posts one line on the card. **Done** closes the card. **Not done yet** names what's missing (no CI, a failed or unfinished check, a device test that didn't pass, no passing review) and leaves the card open with `needs-owner`. Once per PR, for merges since it first ran; it posts only while the reviewer lane is live, else it only records the line for the board.

**PR scores** (src/scores.ts, the Data view). Every merged factory PR gets a score from 0 to 100, so the owner can see which lane and model does best on which card size. Every 5 minutes the dispatcher scores up to 5 merged factory PRs that have none yet (old ones too, a few at a time), reading GitHub and the runs table only; it writes nothing to GitHub. It stores the facts in `pr_scores` and works the score out when it's shown, so the formula below is always the one in use:

- Start at 100, never below 0.
- **Review rounds:** −10 for each "needs work" from the reviewer and each comment or review from the owner on the PR (bare approvals don't count), at most −30.
- **The owner's changes:** −5 if the owner committed to the PR themselves (merges left out). A commit is the factory's only when it has the Claude co-author line and the agents' git email (`FACTORY_GIT_EMAIL`): agents commit under the owner's GitHub account, and the owner's own Claude sessions add the co-author line too. Where the owner commits with that same email, only the co-author line tells them apart, plus −1 per 10 lines they changed, at most −25.
- **CI failures:** −5 per commit whose CI went red, at most −15.
- **Time to merge:** free for 24 hours after the PR opened, then −2 a day, at most −10.
- **Reverted:** −40, when a merged PR (GitHub's Revert button, or a `Revert "<title>"` title) or a revert commit on the default branch undoes it. A revert found later lowers the score then.
- **Cost:** −1 per $5 API-equivalent of the live runs on the PR and its card, at most −10. PRs built outside the dispatcher have no cost recorded.

The lane is the builder run's lane (else the lane that builds the card's size), the model is the commits' `Co-Authored-By: Claude <model>` line (else the lane's model), and the size is the card's `size:` label. The Data view shows the averages by lane × model × size, each PR's points off, the formula, and one line of advice per size: once two models each have 3 merged PRs on a size, a cheaper one within 5 points of the best is suggested for it ("Sonnet 5.5 matches Opus 5.5 on size:S at 25% of the cost, so consider moving size:S cards to the small-builder lane"), and one 10 points ahead is kept. The advice only reads; moving cards between lanes stays the owner's call (`.factory.yml`).

**Performance monitoring** (src/perf.ts, the Performance view). Every hardware test run of the served project records itself about once a second (the project's own collector script): the PC's CPU, memory, disk, network and GPU, each test process's CPU, memory, GPU and video memory, the NVIDIA card's temperature, clocks, power and fan, the CPU's temperature, power, clocks and fans where the PC has LibreHardwareMonitor (`machines/reporters/setup-lhm.ps1`), frame rates (PresentMon where it may trace, the app's own page otherwise), and the run's events and timings (start to window up, the game windows, shutdown, a clean exit, crashes from the Application log). The run writes `perf.json` (version 1) and its workflow uploads it alone as an artifact named `perf-*`.

- **How it gets here:** every 5 minutes the dispatcher lists the project's newest artifacts and downloads each new `perf-*` one as the GitHub App (Actions: read). No test machine or workflow needs a factory token, so PR code never holds one. `POST /ingest/perf` (`DEVICE_TOKEN`, private network only, up to 50 MB) takes the same JSON from anything that reports by itself. `node src/main.ts perf` checks now and lists the last runs.
- **Where it's kept:** `perf_runs` (one row per run: repo, kind, machine, PR, sha, build, version, game, start and finish, outcome, startup and shutdown ms, clean exit, crashes, a summary and the events), `perf_samples` (one row per second: the machine's series as columns, the processes' and frame rates as JSON) and `perf_sources` (each artifact read once). Runs are kept forever; Settings on the view can drop the per-second series after some days (forever by default).
- **Comparison:** each run against the previous run of the same kind, machine and game for another commit. Flagged: startup or shutdown 20% slower (and at least 250 ms), frame rate or 1% low 10% lower, the app's memory or CPU 20% higher, a new crash, a lost clean exit (limits on the view's Settings).
- **On the PR:** a `factory/perf` commit status, always success so it never blocks, says the numbers and what got worse and links the run's page (needs the dashboard address in Settings › Install; can be switched off). The project's test comment links `#/perf/<build>` too.

**Machines between tests** (src/systems.ts). The Windows reporter also sends the NVIDIA card's fan, power and clock (kept as history with the GPU temperature and video memory), the last two days' starts, shutdowns and crashes from the System log (6005, 6006, 6008, 41, 1074 with its reason; kept in `device_events`, listed on the machine's card), and with LibreHardwareMonitor the CPU's package temperature, per-CCD temperatures, package power, average core clock and fan speeds.

**The stop switch.** While the `factory-stop` label is on any open issue or PR (it can be added from the
phone app), the dispatcher starts no live run: no builds, resumes or reviews. Agents already running check
the label themselves at their next checkpoint. Remove the label to start again. The dashboard's **Stop** button adds it to the stop-switch issue
(Settings › Install, or `FACTORY_STOP_ISSUE`), and **Start** removes it from everywhere it was put.

**Activity** (dashboard view) lists what the agents did on GitHub in the last day, 3 days or week: labels,
closes, renames, comments, and issues and PRs opened, each with an **Undo**. The page only sends the
action's id; the dispatcher looks it up on GitHub again and reverses it as the app. Merged code is undone
with a revert PR instead.

**Paid credits are off by default.** If the plan's usage window runs out in the middle of a run, Claude
Code moves on to paid extra-usage credits. Unless the owner turns on **Use paid credits** (dashboard ›
Budget), the dispatcher stops that run at once, starts no new one, and pauses until the window resets.
New runs also stop at 80% of the 5-hour window and 90% of the week, to leave room for the owner's own use.

**Settings › Limits** (src/limits.ts) holds those two usage stops, the run time limit (3 hours), how often usage is refreshed (30 minutes) and how often auto-queue may try (3 hours). Until the owner saves them there, each falls back to its old env var (`FACTORY_MAX_FIVE_HOUR`, `FACTORY_MAX_SEVEN_DAY`, `FACTORY_RUN_TIMEOUT_MIN`, `FACTORY_USAGE_REFRESH_MIN`, `FACTORY_AUTOQUEUE_EVERY_H`), then the default.

**What an agent can touch:**

- One project repo, through a one-hour App token scoped to it: contents, PRs, issues, checks (read) and
  commit statuses, and workflow files (since 2026-10-29, for release CI), never admin. Because a workflow on
  an agent's branch runs with the repo's secrets, release secrets must live in a protected GitHub
  environment (owner approval, tags only), never as plain repo secrets. The dispatcher refreshes the token
  in a read-only file every 30 minutes. Answers on a PR's card resume the PR's session too, and so does a merge conflict with main (once per commit: the session merges main and resolves it).
- Shared cargo, npm and Claude caches.
- 5 CPUs and 8 GB of memory.
- Nothing else: no Docker socket, no host files, no Linux capabilities, a 3-hour limit.

The app's private key stays with the dispatcher. Commits are the owner's, with the Claude co-author line;
PRs and comments come from your app (`<app>[bot]`).

## How it decides

A project's queue is its labels, exactly as its builder prompt describes (the starter kit's is
`templates/project/prompts/builder.md`):

- **Which cards:** open issues labelled `ready`, minus `building`, `review`, `hold` and `needs-owner`,
  minus **blocked** cards (GitHub's "blocked by", or an owner line like `Blocked by #55`), minus cards
  with an open non-draft PR.
- **Order:** `p1` > `p2` > `p3` > none, then the lowest issue number.
- **Lanes:** each builder lane takes the first card whose `size:` it handles. `size:XL` cards are split,
  not built. A card with a draft PR on `claude/issue-<n>-*` is continued.
- **PR limit:** none by default. Set `max_open_prs` to make builders stop at that many open PRs carrying the
  `factory` label (0 means no limit).

Lanes, models, schedules and prompt files come from each served repo's own `.factory.yml`, if it has one,
else the built-in defaults in [src/config.ts](src/config.ts) (see **Several repos** below):

```yaml
timezone: UTC            # default: FACTORY_TIMEZONE, else UTC
prompt_dir: docs/factory/prompts
max_open_prs: 0   # no limit
test_builds:      # PR test builds (docs/quickstart.md#test-builds): the CI's comment marker and cleanup workflow
  marker: factory-test-builds
  cleanup_workflow: test-builds-cleanup.yml
lanes:
  - { name: builder,       kind: builder,    model: opus,   sizes: [M, L, none], splits: [XL], schedule: ["09:00", "14:00", "19:00"], prompt: docs/factory/prompts/builder.md }
  - { name: small-builder, kind: builder,    model: sonnet, sizes: [S],                       schedule: ["11:00", "16:00"],          prompt: docs/factory/prompts/builder.md }
  - { name: maintainer,    kind: maintainer, model: opus,                                     schedule: ["08:00", "17:00"],          prompt: docs/factory/prompts/maintainer.md }
  - { name: ideas,         kind: ideas,      model: opus,   enabled: false,                   schedule: ["mon,thu 08:00"],           prompt: docs/factory/prompts/ideas.md }
  - { name: security,      kind: security,   model: sonnet,                                   schedule: ["thu 08:00"],               prompt: docs/factory/prompts/security.md }
  - { name: reviewer,      kind: reviewer,   model: sonnet }   # no schedule: reviews each ready factory PR
```

**Several repos.** Each repo in Settings › Install › Projects reads its own `.factory.yml` (lanes,
schedules, `timezone`, `prompt_dir`, `max_open_prs`), falling back to the built-in lanes. Its lanes run on
its own schedule, and its builders take its own cards up to its own PR limit; Parallel runs and the plan's
usage stops are shared. Lane switches (off/dry/live) are per repo plus lane. A database from before this
kept its name-only switches: the primary keeps them as they were, and every other repo follows them for a
lane it has until its own switch is set, so nothing turned on or off by itself. `lane <name> on|off`
without a repo switches every repo that has the lane.

## Run it

Node 22.18 or newer runs the TypeScript directly; there's no build step.

```bash
npm ci
cp .env.example .env              # fill in the app key; chmod 600 .env
set -a; . ./.env; set +a
npm run dry-run                   # or: node src/main.ts dry-run --json
npm test && npm run check
```

CI (`.github/workflows/ci.yml`) runs `npm test`, `npm run check` and `npm run build:web` on Node 22 for every PR and push to main, on `ubuntu-latest`, or on the homelab runner when the repo variable `LINUX_ON_HOMELAB` is `true` (never for fork PRs).

With Docker: `docker compose up -d --build`, then `docker compose logs -f dispatcher`. A new install:
[docs/quickstart.md](docs/quickstart.md), then [docs/deploy.md](docs/deploy.md) for the machine side. An
example deployment (a Proxmox LXC with Cloudflare Tunnel and two CI machines) is in
[examples/homelab/](examples/homelab/README.md).

**A public copy:** `scripts/publish-snapshot.sh <out-dir>` builds a single-commit copy of the committed
tree for a public repo. It leaves out the paths in `scripts/private-paths.txt`, scans for secrets (its
own patterns, and gitleaks when installed) and for every value in `scripts/private-values.txt` (local,
git-ignored: your email, addresses, host names, account IDs), and refuses if it finds any. It lists what
it would publish and never pushes; set `FACTORY_PUBLIC_REPO` to your public repo's URL for the push line it
suggests.

## Layout

| File | What |
| --- | --- |
| `src/main.ts` | The CLI: `dry-run`, `serve`, `run`, `lane`, `status`, `unpause`, `test-builds`, `perf`, `review`, `trial`, `init-project`, `doctor` |
| `src/starter.ts`, `src/labels.ts`, `templates/project/` | The starter kit: `init-project <owner/repo>` creates the factory's labels (the one list in `src/labels.ts`) and opens a PR with the template prompts and `.factory.yml`; tested against the queue's conventions |
| `src/perf.ts` | The Performance view: reading `perf-*` artifacts, checking and storing perf.json, summaries, the comparison with the build before, the `factory/perf` status |
| `src/review.ts` | The reviewer lane: its guide, the verdict, posting it, handing "needs work" back to the builder |
| `src/devices.ts` | The Devices view: each test machine's job now, its queue and last results, from the project's CI jobs |
| `src/gaming.ts` | Game tests: a waiting run of the project's game-test workflow on its Devices card with **Start** / **Later** / **Skip** (a commit status on the tested PR's head, names from Settings › Install › Game tests) and **Stop** (cancels the run); Settings › Game tests edits the workflow's repository variables (`GAMING_TEST_ON`, `GAMING_AUTO_HOURS`, `GAMING_TEST_LIMIT_MIN`, `GAMING_TEST_GAMES`; the app needs Variables read and write) |
| `src/automerge.ts` | Auto-merge: when a factory PR merges by itself, and when it's the owner's call |
| `src/autoqueue.ts` | Auto-queue: refilling a low queue from its ideas, and when nothing is ready to build (the alert's facts) |
| `src/done.ts` | The Done line for a merged factory PR, and the board's Done column |
| `src/shots.ts`, `agent/shots.mjs` | Before/after screenshots on website PRs: which PRs and pages, the comment, and the script that shoots them |
| `src/scores.ts` | PR scores: the facts of each merged factory PR, the 0-100 formula, the lane × model × size table and its advice |
| `src/followups.ts` | The reviewer's "later" items as `idea` issues: titles, duplicate checks, the per-PR cap |
| `src/resume.ts`, `src/feedback.ts` | Owner replies on factory PRs → resume that PR's session; the Answer view's replies (posted as the app) count as the owner's by their saved ids |
| `src/server.ts` | HTTP: the dashboard and its API, signed GitHub App webhooks, `/healthz` |
| `src/ci.ts` | CI results back to the agent: a factory PR whose latest commit goes red resumes its session with the failed checks and error lines (once per commit, twice per PR) |
| `src/systems.ts` | The Systems view: machines (pushed by `machines/reporters/`, plus the Proxmox API), Cloudflare traffic and free-tier use, uptime checks, and CI on a shared Windows PC: its game guard checks in each minute and the card has **Pause CI** / **Resume CI** and **Build threads** (`ciThreadsFrom`, handed on in the guard's answer) |
| `src/dashboard.ts` | The dashboard's API: state, board, transcripts, controls (lanes, Build now, hold, pause) |
| `web/` | The dashboard page: React 19 + Tailwind v4 + shadcn-style components (Radix), Vite, built to `web/dist` (`web/README.md`: layout and patterns) (`npm run build:web`, or `npm run dev:web` against a running dispatcher) |
| `src/access.ts` | Who may use the dashboard: Cloudflare Access through the tunnel, else the built-in sign-in |
| `src/auth.ts`, `src/hash-password.ts` | The built-in sign-in: password hashes and tokens, sessions, rate limits, CSRF, the startup warning; the CLI that makes the hash |
| `src/dispatch.ts` | The scheduler: due slots, dry vs live, usage-limit pause, PR ↔ session links |
| `src/runner.ts` | One agent container per run; follows Claude's stream-json |
| `src/prompt.ts` | A lane's starting prompt: the project's prompt file plus the homelab notes |
| `src/state.ts` | SQLite: lanes (live, last slot), runs, sessions, reviews, settings (paid credits), usage, pause, machines' history and boot events, test runs' performance, merged PRs' score facts, the owner's replies sent from the dashboard |
| `src/testbuilds.ts` | PR test builds: reads each PR's Test builds comment for the board, and an hour-by-hour check that dispatches the project's cleanup workflow once a merged or closed PR passes the Settings delay (24 h by default). The marker and workflow names are `.factory.yml`'s `test_builds:` (default `factory-test-builds`, `test-builds-cleanup.yml`). The factory deletes nothing itself |
| `src/queue.ts` | The queue rules (pure, tested in `test/queue.test.ts`), and the marker agents end their comments with (`<!-- factory -->`; older names listed on Settings › Install › Older comment markers still count) |
| `src/project.ts` | Loads a project's config, issues, comments and PRs from GitHub |
| `src/github.ts` | GitHub REST as the app (installation tokens minted with `node:crypto`) |
| `src/state.ts` `for(repo)` | One database for every repo: runs, usage, pause and settings are shared; lane switches, PR sessions, reviews and retries belong to a repo (`FACTORY_PROJECTS`) |
| `src/slots.ts` | Parallel runs: how many go at once (Settings, or `parallel <1-3>`; 1 by default), which card or PR each holds, and each run's share of CPUs and memory |
| `src/config.ts` | `.factory.yml`, the default lanes, schedules |
| `src/limits.ts` | Settings › Limits: the usage stops, run time limit, usage refresh and auto-queue interval (dashboard, then env, then defaults) |
| `src/install.ts` | Settings › Install: the repos, machines, addresses, device checks, previews, app, stop issue, older comment markers, the Performance view's app names and the game-test workflow (dashboard, then env, then empty defaults) |
| `scripts/publish-snapshot.sh` | A public, single-commit copy: leaves out `scripts/private-paths.txt`, refuses on secrets or private values (tested in `test/publish-snapshot.test.ts`) |
| `machines/` | Setup scripts for the machines around the factory: Linux and Windows CI runners, test machines, the game guard and the stats reporters (machines/README.md: which script for which role) |
| `examples/homelab/` | A worked example install with placeholders: a Proxmox host with the factory and a CI runner LXC, a shared Windows build PC, a test box (its firewall script and tailnet policy), Cloudflare, GlitchTip |
| `examples/glitchtip/` | GlitchTip next to the factory, for crash reports |
| `agent/Dockerfile` | The image each agent run will use: Node, git, gh and Claude Code; `TAURI=1` adds Rust and Tauri build deps for projects that need them |

Rules that never change: never GitHub Copilot, agents never push to `main`, merge, or
force-push. Only the dispatcher merges, by the auto-merge rules above.
