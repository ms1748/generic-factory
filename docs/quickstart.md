# Quick start

The factory runs Claude Code "lanes" against your GitHub repo's issue queue: builders pick `ready` cards
and open PRs, a reviewer checks each PR, and a dashboard shows it all. This page gets one repo going on one
machine. Every lane starts **dry** (it only records what it would do) until you switch it on.

## What you need

- **A machine with Docker** (Linux, or anything that runs Docker Compose) that stays on. Each agent run is
  its own container; give it about 5 CPUs and 8 GB of memory per run.
- **A Claude plan** that includes Claude Code. Run `claude setup-token` once and keep the token
  (`CLAUDE_CODE_OAUTH_TOKEN`). The factory stops starting runs at 80% of the 5-hour window and 90% of the
  week, so you keep some for yourself (change both on Settings › Limits).
- **GitHub access to your repo**, one of:
  - a **GitHub App** (recommended): agents' PRs and comments show as `<app>[bot]`, tokens are short-lived
    and scoped to the repo. Permissions: Contents, Issues, Pull requests (read and write), Checks and
    Actions (read), Commit statuses (read and write), Workflows (write) only if agents may change CI.
    Install it on your repo, download its private key, and note the App ID and installation ID.
  - or a fine-grained **personal access token** (`GH_TOKEN`) with the same access, to try it out.
- **Your repo's prompt files**: what each lane does, in `docs/factory/prompts/` (`builder.md`, `common.md`,
  `maintainer.md`, `security.md`, `reviewer.md`). They're your project's rules for agents: how to pick up a
  card, the checks to run, how to write the PR. You don't write them from scratch: `init-project` (below)
  opens a PR with a starter set. Another folder works too (`prompt_dir` below).

## Set it up

```bash
git clone <this repo> factory && cd factory
cp .env.example .env && chmod 600 .env   # fill in the required block
mkdir -p data
docker compose build agent               # the image each run uses (agent/Dockerfile)
docker compose up -d --build             # the dispatcher and its dashboard on port 8080
docker compose exec dispatcher node src/main.ts dry-run   # the queue and what each lane would do
docker compose exec dispatcher node src/main.ts doctor    # a tiny live run: image, token, clone, Claude
```

The required `.env` keys are `FACTORY_PROJECTS` (your `owner/repo`), the GitHub App's three keys (or
`GH_TOKEN`), `CLAUDE_CODE_OAUTH_TOKEN`, and the git name and email for commits. Everything else is optional.

### Your project's tools

The agent image has Node 22, git, gh and Claude Code, and nothing else your project might build with. Two
ways to add more:

- **Rust or Tauri:** for projects that need them, put `FACTORY_AGENT_TAURI=1` in `.env` and run
  `docker compose build agent` again. It adds Rust with clippy and rustfmt, and Tauri's Linux build libraries.
- **Anything else:** build your own image on top of the factory's, and point the dispatcher at it. Keep
  the file outside `agent/`, so updating the factory never touches it:

  ```dockerfile
  # tools/agent.Dockerfile
  FROM factory-agent
  USER root
  RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv \
   && rm -rf /var/lib/apt/lists/*
  USER agent
  # Tools that install per user (rustup, uv, ...) go here, as agent.
  ```

  ```bash
  docker compose build agent
  docker build -t my-agent -f tools/agent.Dockerfile tools
  ```

  Then set `FACTORY_AGENT_IMAGE=my-agent` in `.env` and `docker compose up -d` again. Rebuild both images
  together whenever you update the factory. End on `USER agent`: agents never run as root.

## Point it at your repo

Install the GitHub App on the repo, then make it factory-ready in one command:

```bash
docker compose exec dispatcher node src/main.ts init-project <owner/repo>           # labels + a starter PR
docker compose exec dispatcher node src/main.ts init-project <owner/repo> --print   # only show what it would do
```

It creates the labels below (any it already has stay as they are) and opens a PR with the starter prompts
and a `.factory.yml` holding the default lanes ([templates/project](../templates/project/README.md)).
Before you merge it, search its files for `[FILL IN:` and put in your project's details: what it is, the
checks that must pass, its conventions. Keep the parts marked "(the dispatcher relies on this)".

The queue is your repo's labels:

- `ready`: a card agents may build. `p1` > `p2` > `p3` sets the order, then the lowest number.
- `size:S`, `size:M`, `size:L` (or none): which builder lane takes it. `size:XL` cards are split instead.
- `building`, `review`, `hold`, `needs-owner`: skipped. `idea`: not built until you make it `ready`.
- `factory`: on every PR the factory opens. `factory-stop` on any open issue or PR stops new runs.

Lanes, models and schedules come from each repo's own `.factory.yml`, else the built-in defaults
(src/config.ts):

```yaml
timezone: Europe/London         # schedules' time zone (default: FACTORY_TIMEZONE, else UTC)
prompt_dir: docs/factory/prompts
max_open_prs: 0                 # 0: no limit
lanes:
  - { name: builder,       kind: builder,    model: opus,   sizes: [M, L, none], splits: [XL], schedule: ["09:00", "14:00"] }
  - { name: small-builder, kind: builder,    model: sonnet, sizes: [S],                       schedule: ["11:00", "16:00"] }
  - { name: maintainer,    kind: maintainer, model: opus,                                     schedule: ["08:00"] }
  - { name: reviewer,      kind: reviewer,   model: sonnet }   # no schedule: reviews each ready factory PR
```

The built-in lanes read `<prompt_dir>/builder.md` (both builders), `maintainer.md`, `security.md` and
`ideas.md`; a lane with another name sets its own `prompt`. With `lanes` in the file, the list replaces the
built-in one.

**Several repos.** Each repo the factory serves (Settings › Install) has its own `.factory.yml` and its
own lanes: its builders take its cards, on its schedule, up to its `max_open_prs`. A repo without the file
gets the built-in lanes. The Lanes view groups lanes by repo, and each switch is for one repo's lane.

**Switching a lane on.** Every lane is dry until you switch it on, on the dashboard's Lanes view or with
`node src/main.ts lane <name> on [owner/name]` (without a repo, every repo that has the lane). A dry lane only records what it would have done. Try one lane, read its
PRs, then decide.

## The dashboard

The dispatcher serves the dashboard on port 8080. Its controls switch lanes on and start agents, so it
never opens without a sign-in: agents and CI runners on the same network run code you haven't read.

### Securing the dashboard

Pick one. Startup logs which one is on (`dashboard: ...`), and warns if none is set and the dashboard
listens beyond localhost or a private network.

| Way in | Set in `.env` | Good for |
| --- | --- | --- |
| **Built-in sign-in** | `FACTORY_PASSWORD_HASH` and/or `FACTORY_DASHBOARD_TOKEN` | Most installs: a tailnet, a LAN, or HTTPS through a reverse proxy or a tunnel |
| **Cloudflare Access** | `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` and a Cloudflare Tunnel | A public address with Cloudflare's login in front |
| **No sign-in** | `FACTORY_LAN_OPEN=1` | A machine only you can reach (a local preview). Ignored once a password or token is set |

**The built-in sign-in.** Make a password hash, or a random token, and put the line it prints in `.env`:

```bash
docker compose run --rm dispatcher node src/hash-password.ts           # asks for a password (12+ characters)
docker compose run --rm dispatcher node src/hash-password.ts --token   # or: a random token
docker compose up -d                                                   # restart to pick it up
```

Then open the dashboard: it sends you to `/login`, where the password or the token signs you in (either,
if both are set). `/login` also has **Sign out**.

- **The session** is a random id in a `Secure`, `HttpOnly`, `SameSite=Strict` cookie, kept in memory for
  `FACTORY_SESSION_HOURS` (default 168, a week). A restart signs you out.
- **Wrong tries** are limited: 5 per address and 50 overall in 15 minutes, then sign-in waits. Passwords
  are checked against an scrypt hash, tokens in constant time.
- **Controls** (every POST) also need the page's `x-factory` header, a same-origin request and the
  session's CSRF token, which the page sends by itself.
- **HTTPS.** A `Secure` cookie is only kept over HTTPS or on `localhost`. On a network that encrypts by
  itself, such as a tailnet, `FACTORY_COOKIE_SECURE=0` lets it work over plain HTTP; `/login` says so when
  it's needed. Anywhere else, put HTTPS in front (a reverse proxy, `tailscale serve`, a tunnel).
- **Where it listens.** `FACTORY_BIND` sets the address (default: every interface), e.g. your tailnet IP
  when the dispatcher runs outside Docker. Agents' containers can still reach the port, which is why
  the sign-in is needed even on a private network.

With Cloudflare Access set, requests through the tunnel still need its token, and a session cookie
doesn't stand in for it; the built-in sign-in then only applies to the private port.

**Settings › Install** holds everything about your setup that isn't a secret: the repos it serves (add and
remove them there; the first, the primary, stays), its machines, the dashboard's address, uptime checks,
which CI checks count as device tests, which paths auto-merge leaves to you (workflows and secrets always are), a note for the reviewer about your CI, PR previews, the app's name, the stop-switch issue, older names of the agents' comment marker (for
comments made before a rename), and which fps line and processes are your app in the Performance view. The env keys
in `.env.example` give the first values; once saved on the dashboard, the dashboard wins.

## Optional parts

Each is off until you set it, and says what it needs where it would show.

| Part | What it adds | What it needs |
| --- | --- | --- |
| Webhooks | Owner replies on a PR resume its session at once (else within 5 minutes) | `WEBHOOK_SECRET`, then `node src/main.ts webhook-config` |
| Reviewer and auto-merge | A Sonnet review of every factory PR; merges what passes | The `reviewer` lane switched on; auto-merge is on Settings |
| Systems view | Your machines' CPU, memory, disks, temperatures, containers | `DEVICE_TOKEN` and a reporter on each machine (`machines/reporters/`, machines/README.md); machines on Settings › Install |
| Proxmox | The factory host's guests and storage | `PVE_URL`, `PVE_TOKEN` (read-only), `PVE_CA_FILE` |
| Performance view | Each build's test runs: startup, shutdown, fps, CPU/GPU/memory, temperatures, against the build before | The project's test workflows uploading `perf-*` artifacts (a perf.json each); the app needs Actions: read. Settings › Install › Performance: the app names your app's own fps line and processes |
| CPU temperatures | CPU temperature, power, clocks and fans on a Windows PC | `machines/reporters/setup-lhm.ps1` there (LibreHardwareMonitor's library and the PawnIO driver) |
| Devices view | Each self-hosted CI runner's job now, its queue and results | Machines with a runner name or labels on Settings › Install |
| Self-hosted CI | Your own Linux and Windows CI runners and test machines; Pause CI and Build threads on a Windows PC someone also games on | The scripts in `machines/` (machines/README.md: which for which role, in order) |
| Device tests in the Done line | Says which device tests passed on each merged card | Settings › Install › Device checks |
| Cloudflare | Site traffic, Functions and R2 use against the free tier | `CF_API_TOKEN`, `CF_ACCOUNT_ID`, `CF_ZONE_ID` (read-only) |
| Uptime | Your site and the dashboard checked every 5 minutes | Settings › Install › Uptime checks |
| PR previews | The reviewer opens the PR's preview deploy | Settings › Install › Preview host, `CF_ACCESS_CLIENT_ID`/`SECRET` |
| Test builds | Lists each PR's test builds; asks the project's cleanup workflow to delete them after merge | The project's CI posting a Test builds comment and a cleanup workflow ([below](#test-builds)) |
| Reports | Crash and problem reports from GlitchTip | `GLITCHTIP_TOKEN`; address and org on Settings › Install |
| Alerts | Discord messages when a machine is down, hot or full | A Discord webhook on Settings › Alerts |

## Test builds

For a project whose CI builds something testable on each PR push. The factory only reads and asks; your
CI makes, hosts and deletes the builds.

**The comment.** One comment on the PR by `github-actions[bot]` (the workflow's own `GITHUB_TOKEN`),
edited on each push, with the marker somewhere in its body:

```html
<!-- factory-test-builds {"pr": 174, "versions": [
  {"v": 2, "sha": "<full commit sha>", "at": "2026-11-04T12:00:00Z",
   "artifact": "https://github.com/<owner>/<repo>/actions/runs/<run>/artifacts/<id>",
   "site": "https://<where you host it>/pr174/v2/"}
], "deleted": null} -->
```

- `pr` and each version's `v` (a number) and `at` (an ISO time) are required; `sha`, `artifact` and `site`
  may be left out or `null`. Links must be `https://`. Artifact links are hidden 7 days after `at`.
- A comment whose JSON doesn't read is ignored, so nothing is ever cleaned up on a misread.

**The cleanup workflow.** `.github/workflows/test-builds-cleanup.yml` on `main`, with
`on: workflow_dispatch` and a string input `pr`. Once a PR has been merged or closed for the time on
Settings (24 hours by default), the factory dispatches it on `main` with that PR's number. It deletes the
builds wherever they're hosted, then edits the comment's JSON to say `"deleted": "<time>"` (or `true`):
until it does, the factory tries again every 6 hours. The GitHub App needs Actions: write.

**Other names.** Both names are your project's to choose; set them in the primary repo's `.factory.yml`
(letters, digits, `-` and `_` for the marker; a `.yml` or `.yaml` file name for the workflow):

```yaml
test_builds:
  marker: factory-test-builds             # the default
  cleanup_workflow: test-builds-cleanup.yml   # the default
```

## Upgrading a factory from before Settings › Install

Older versions had one deployment's addresses, machines and checks built in. A database from before then
starts with all of those off, and the dashboard's Settings › Install says so. Paste your values there once
(Edit as JSON), and they stay in the database.

The machine side (any Docker host, reaching the dashboard, updates, backups) is [deploy.md](deploy.md). An
example deployment, on a Proxmox host with two CI machines, is in
[examples/homelab/](../examples/homelab/README.md).
