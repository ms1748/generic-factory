# Deploying the factory

How to run the factory on any Linux machine with Docker: a VPS, a home server, a Proxmox LXC, a NAS. Read
[quickstart.md](quickstart.md) first for what the factory needs from you (a Claude plan, a GitHub App,
your repo's prompt files). This page is the machine side: install, reach the dashboard safely, update and
back up. An example install on a Proxmox host, with CI and test machines, is in
[examples/homelab/](../examples/homelab/README.md).

Every lane starts **dry**: it only records what it would have done, until you switch it on from the
dashboard's Lanes view.

## The machine

- **Linux with Docker Engine and the compose plugin** (`docker compose version` works). Docker Desktop on
  macOS or Windows isn't tested.
- **Room for the runs:** each agent run is a fresh container with 5 CPUs and 8 GB of memory by default
  (`FACTORY_AGENT_CPUS`, `FACTORY_AGENT_MEMORY`), plus about 1 GB for the dispatcher. 40 GB of disk is
  plenty for the images, caches and a few months of transcripts.
- **Outbound HTTPS** to GitHub and Anthropic. Nothing needs to come in, unless you want webhooks (below).
- **A Proxmox LXC:** unprivileged is fine, with `nesting=1,keyctl=1` so Docker runs inside it.
- **A NAS:** anything that runs Docker Compose from a shell and lets the dispatcher use the Docker socket.

The dispatcher starts the agent containers through the host's Docker socket, so whoever can change the
factory's files or `.env` controls the host's Docker. Give it a machine (or LXC, or VM) of its own, and
don't put self-hosted CI runners for this project on it: CI runs code from PRs, and this host holds the
factory's secrets.

Use a plain user in the `docker` group, not root. The dispatcher's container runs as uid 1000, so `data/`
must be writable by uid 1000 (it is already if your user is the first one on the machine).

## Install

```bash
git clone <your copy of the factory> factory && cd factory
cp .env.example .env && chmod 600 .env
mkdir -p data                       # before compose, so it's yours, not root's
```

Fill in `.env`. The required block at the top is enough to start; [quickstart.md](quickstart.md) explains
each key. Two more depend on the machine:

- `DOCKER_GID`: the host's docker group id, from `getent group docker | cut -d: -f3`. The dispatcher joins
  it to use the socket. Without it, 991 is assumed.
- `FACTORY_AGENT_TAURI=1` if your project builds Rust or Tauri (quickstart, "Your project's tools").

Then build and start:

```bash
docker compose build agent          # the image each run uses
docker compose up -d --build        # the dispatcher and its dashboard, on port 8080
docker compose logs -f dispatcher   # "serving <your repo>; live lanes: none (all dry)"
docker compose exec dispatcher node src/main.ts dry-run   # the queue and what each lane would do
docker compose exec dispatcher node src/main.ts doctor    # one tiny live run: image, tokens, clone, Claude
```

Always run `docker compose` from the factory's folder: the dispatcher tells Docker where `data/` is on the
host (`FACTORY_HOST_DATA`, from the folder you start it in), so agent containers can read their token.

`doctor` passing means the factory works. Next, give yourself a way to reach the dashboard.

## Reach the dashboard

The dashboard can switch lanes live and start runs, so it must only open for you. The port (8080) is also
reachable by the agent containers on this host, and by anything else on your network, and agents run code
nobody has read yet. So the dashboard checks who's asking itself; it doesn't trust "came from the LAN".

The port always takes machine reports (`/ingest`, with `DEVICE_TOKEN`), signed GitHub webhooks and
`/healthz`. Pick one way in for the dashboard:

### Cloudflare Tunnel with Access (recommended)

No open ports, a sign-in in front, and webhooks work. You need a domain on Cloudflare (the free plan is
enough).

1. **Tunnel.** Cloudflare dashboard › Zero Trust › Networks › Tunnels › *Create a tunnel* › Cloudflared.
   Copy the token from the install command (don't run the command). Under *Public hostname*, add your
   dashboard address (say `factory.example.com`) → service `HTTP`, URL `dispatcher:8080`.
2. **Access.** Zero Trust › Access › Applications:
   - A self-hosted app for `factory.example.com` with an *Allow* policy for your email (one-time PIN).
   - A second app for `factory.example.com/webhooks/` with a *Bypass* policy whose Include rule is *IP
     ranges*: GitHub's webhook ranges (`curl -s https://api.github.com/meta`, the `hooks` list). The webhook
     secret still guards the path.
3. **`.env`:**
   ```
   CLOUDFLARE_TUNNEL_TOKEN=<from step 1>
   COMPOSE_PROFILES=tunnel
   CF_ACCESS_TEAM_DOMAIN=<team>.cloudflareaccess.com
   CF_ACCESS_AUD=<the dashboard app's Application Audience (AUD) Tag>
   FACTORY_URL=https://factory.example.com
   ```
   Then `docker compose up -d`. The `tunnel` service starts next to the dispatcher.
4. Open `https://factory.example.com`, sign in, and check Settings › Install.

### A VPN, your own network, or a reverse proxy: the built-in sign-in

Tailscale, WireGuard, a LAN, or HTTPS through a reverse proxy (Caddy, nginx, Traefik) or `tailscale
serve`. Set `FACTORY_PASSWORD_HASH` and/or `FACTORY_DASHBOARD_TOKEN` in `.env` and sign in on `/login`;
[quickstart.md, "Securing the dashboard"](quickstart.md#securing-the-dashboard) has the commands and the
details (HTTPS and `FACTORY_COOKIE_SECURE`, rate limits). The sign-in is needed even on a private
network: the agents' containers can reach the port.

`FACTORY_LAN_OPEN=1` (no sign-in at all) is only for a machine only you can reach, such as a local
preview. It's ignored once a password or token is set.

### Webhooks

Without webhooks, the factory notices owner replies and red CI by polling every 5 minutes. With them it's
instant, but GitHub must reach `https://<your address>/webhooks/github`: the tunnel above does that. Set
`WEBHOOK_SECRET` (`openssl rand -hex 32`) in `.env`, `docker compose up -d`, then
`docker compose exec dispatcher node src/main.ts webhook-config` sets the URL and secret on your GitHub
App. In the App's settings, tick **Active** under Webhook and subscribe to **Issue comment**, **Pull
request review**, **Pull request review comment**, **Check suite** and **Workflow run**.

## Update

1. On the dashboard, **Pause** (so no run starts) and wait until *Running now* is empty. A run that's
   cut off by the restart is lost.
2. On the host:
   ```bash
   cd factory && git pull
   docker compose build agent      # the agent image, for changes under agent/
   docker compose up -d --build
   docker compose exec dispatcher node src/main.ts doctor
   ```
3. On the dashboard, **Resume**.

If you run your own agent image (`FACTORY_AGENT_IMAGE`), rebuild it after `docker compose build agent`.
Old databases keep working: the factory only adds tables and columns.

## Back up

Everything the factory knows is in `data/`: the SQLite database (`factory.db`: runs, sessions, settings,
history), the run transcripts and trial reports. The secrets are in `.env`. The images and caches can be
rebuilt.

A copy of the database while the dispatcher runs (SQLite's own backup, safe while it writes):

```bash
docker compose exec dispatcher node -e "const s = require('node:sqlite'); s.backup(new s.DatabaseSync('/app/data/factory.db'), '/app/data/factory-backup.db').then(() => console.log('ok'))"
tar -czf factory-data-$(date +%F).tgz --exclude='data/factory.db*' data
```

The archive holds the fresh `factory-backup.db` and everything else in `data/`. Keep `.env` in a password
manager or an encrypted backup; never next to the archive in plain text.

**Restore:** stop the dispatcher (`docker compose down`), unpack the archive into the factory's folder,
rename `data/factory-backup.db` to `data/factory.db`, put `.env` back, and `docker compose up -d`.

## Optional extras

- **Your machines on the Systems view:** `DEVICE_TOKEN` in `.env` and a reporter on each machine
  ([machines/README.md](../machines/README.md), "Stats reporters"). They send to
  `http://<this host>:8080`, so the port must be reachable from them.
- **Crash reports (GlitchTip):** [examples/glitchtip/](../examples/glitchtip/) runs GlitchTip next to the
  factory, as its own compose project. Copy the folder somewhere outside the factory's checkout, run `bash setup.sh` there
  (it makes the secrets and asks for your GlitchTip address and sender email), and add a public
  hostname for that address to the tunnel → HTTP `glitchtip-web:8000`, behind its own Access app (plus a Bypass app for the paths
  `api/*/envelope` and `api/*/store`, so your app can send reports without signing in). It joins
  the factory's network `factory_default`; if your factory's folder isn't called `factory`, change that
  name in its `compose.yml` to `<folder>_default`. `backup.sh` there dumps its database each night from
  cron. Then put a read-only `GLITCHTIP_TOKEN` in the factory's `.env`, and the address and organization
  on Settings › Install › Reports.

## Check it

- `docker compose ps` shows `dispatcher` running (and `tunnel`, if you set it up).
- `docker compose exec dispatcher node src/main.ts status` lists every lane as `dry`, with its next run.
- `curl -s localhost:8080/healthz` on the host prints `ok`.
- The dashboard opens at your address, and Settings › Install shows your repo.
