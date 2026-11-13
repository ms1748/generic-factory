# Example: a homelab install

A real, working setup of the factory, with everything personal replaced by placeholders. One Proxmox
host runs the factory and a Linux CI runner in separate containers, a Windows PC someone also games on builds
Windows CI and runs the tests that wait on a person, and a spare PC is the test box. Cloudflare Tunnel and Access put the dashboard (and
GlitchTip) on the internet behind a sign-in. Use it as a map: [quickstart.md](../../docs/quickstart.md),
[deploy.md](../../docs/deploy.md) and [machines/](../../machines/README.md) are the steps; this page is
how they fit together on real hardware.

Placeholders: `example.com` is your domain, `you@example.com` your email, `<owner>/<app>` your project's
repo. The addresses are one possible layout; pick your own.

```
                         internet
                            │  Cloudflare Tunnel (outbound only)
┌───────────────────────────┼────────────────────────────── Proxmox host ──┐
│ vmbr0, a NAT bridge 10.20.0.0/24 (host 10.20.0.1), Tailscale subnet route │
│                                                                          │
│  LXC "factory" 10.20.0.10        LXC "ci-runner" 10.20.0.11              │
│   dispatcher + dashboard :8080    Linux CI runners, no secrets, no Docker│
│   agent containers               ─────────────────────────────────────── │
│   cloudflared, GlitchTip          test box, DHCP 10.20.0.50-69 on vmbr0  │
└──────────────────────────────────────────────────────────────────────────┘
   home LAN: build PC (Windows CI build runner, manual-test runner, game guard)
   tailnet: your laptop and phone reach everything; the test box reaches only :8080
```

## The Proxmox host

- One bridge, `vmbr0`, with no physical port: a NAT network for the containers (`10.20.0.0/24`, the host
  is `10.20.0.1`). The host advertises it as a Tailscale subnet route, so your laptop reaches the
  containers by their `10.20.0.x` addresses and nothing listens on the home LAN.
- The test box is plugged into a port bridged into `vmbr0` and gets an address from `dnsmasq` on the host
  (`10.20.0.50-69`). [box-isolation.sh](box-isolation.sh) keeps it there: the internet and `vmbr0`, nothing
  on the home LAN, the tailnet or the host.
- A read-only Proxmox API token for the dashboard's Systems view, and the Linux stats reporter for the
  host's temperatures and network (below).

## The factory: LXC `factory`

Debian 13, unprivileged, `nesting=1,keyctl=1` (Docker inside), 6 cores, 10 GB RAM + 4 GB swap, 80 GB:

```bash
pct create 110 local:vztmpl/debian-13-standard_13.6-1_amd64.tar.zst --hostname factory \
  --cores 6 --memory 10240 --swap 4096 --rootfs local-lvm:80 \
  --net0 name=eth0,bridge=vmbr0,ip=10.20.0.10/24,gw=10.20.0.1,type=veth \
  --unprivileged 1 --features nesting=1,keyctl=1 --onboot 1 --ostype debian
```

Inside it: Docker CE with the compose plugin, git, and automatic security updates. One user, `factory`,
in the `docker` group, runs everything. Its secrets live in `~/.config/factory/env` (mode 600) and the
checkout's `.env` is a link to that file, so a fresh copy of the code never loses them. Then
[deploy.md](../../docs/deploy.md) from "Install" on.

Getting a shell: `ssh root@<host>`, then `pct exec 110 -- su - factory`.

**Updates** are copied in from a laptop (`git pull` in the checkout works too):

```bash
git archive --format=tar.gz -o factory.tgz HEAD
scp factory.tgz root@<host>:/root/
ssh root@<host> "pct push 110 /root/factory.tgz /home/factory/factory.tgz --user 1000 --group 1000"
# then, as factory: tar -xzf ~/factory.tgz -C ~/factory && cd ~/factory && docker compose up -d --build
```

Pause on the dashboard first, as deploy.md's "Update" says.

## Linux CI: LXC `ci-runner`

CI runs code from pull requests, so it never shares a machine with the factory's secrets. Its own
unprivileged LXC on `vmbr0` (`10.20.0.11`): Debian 13, 4 cores, 6 GB RAM + 2 GB swap, 40 GB, no Docker, no
host mounts (the `pct create` line is in `machines/linux-runner/provision.sh`'s header). One runner
service per repo, as the `runner` user without sudo:

```bash
provision.sh --tauri                 # for a Tauri app; --rust for Rust alone, neither otherwise
register.sh <owner>/<app> homelab-app homelab <token file> --cargo-target
register.sh <owner>/<site> homelab-site homelab <token file>
```

Workflows use `runs-on: [self-hosted, linux, homelab]`. A repo variable (say `LINUX_ON_HOMELAB`) lets the
workflow fall back to GitHub's runners when the box is off. Add `homelab-app` and `homelab-site` as
runner names on Settings › Install › Machines to see them on the Devices view.

## The build PC

A Windows PC someone also plays games on. CI builds there in a separate standard account, `tester`, signed in at
boot with Sysinternals Autologon, so it never touches the player's session:

```powershell
.\register-runner.ps1 -Repo <owner>/<app> -Name build-pc -Labels windows-build -TokenFile <file> -Dir C:\actions-runner-build
.\setup-ci.ps1 -User tester -Dir C:\actions-runner-build
.\setup-runner.ps1 -User tester -Dir C:\actions-runner-build -Priority BelowNormal
.\report-windows.ps1 -Install -Name build-pc -Url http://10.20.0.10:8080
.\setup-game-guard.ps1 -User tester -Dir C:\actions-runner-build
```

- **The game guard** pauses CI while a game runs in the player's account, follows the dashboard's
  **Pause CI** and **Build threads** (Systems › the build PC's card), and restarts the runner if it
  stops. The project's CI waits at its first step while `C:\ProgramData\FactoryCI\ci-paused` exists, and
  reads `ci-jobs` there for its thread count.
- **A manual-test runner** next to it, for tests that wait on a person (up to hours), so they never
  hold up builds:
  ```powershell
  .\register-runner.ps1 -Repo <owner>/<app> -Name build-pc-manual -Labels manual -TokenFile <file> `
    -Dir C:\actions-runner-manual -CopyFrom C:\actions-runner-build
  .\setup-runner.ps1 -User tester -Dir C:\actions-runner-manual
  ```
- The PC reaches the factory's `10.20.0.10:8080` over Tailscale (the host's subnet route).
- `setup-lhm.ps1` for CPU temperatures on the Systems view.

## The test box

A spare desktop whose jobs open the app's window, take screenshots and drive it with simulated input
(machines/README.md has the drivers for virtual controllers, if the app needs them). It runs PR code with a desktop signed in, so it's the least trusted machine here:

- **Network:** on `vmbr0` behind the host's NAT, kept off the home LAN and the host by
  [box-isolation.sh](box-isolation.sh), and on the tailnet as `tag:testbox`, which
  [tailnet-policy.hujson](tailnet-policy.hujson) limits to the factory's stats port.
- **Runner:** `register-runner.ps1 -Repo <owner>/<app> -Name testbox -Labels testbox -TokenFile <file>`, then
  `setup-runner.ps1 -User <account> -KeepUnlocked` (a locked desktop screenshots black).
- **Reporter:** `report-windows.ps1 -Install -Name testbox -Url http://10.20.0.10:8080 -App <app process> -Builds C:\AppTest`,
  so its card shows whether the app is running and which test builds are there.
- **Admin access:** Windows' OpenSSH Server, your laptop's key only, firewalled to the tailnet
  (`100.64.0.0/10`) and `vmbr0`.

## Cloudflare

The domain is on Cloudflare's free plan. One tunnel, `factory`, run by the `tunnel` service in the
factory's compose file (`COMPOSE_PROFILES=tunnel`), with these public hostnames and Access apps:

| Hostname | Tunnel service | Access |
| --- | --- | --- |
| `factory.example.com` | HTTP `dispatcher:8080` | *Allow* `you@example.com` (one-time PIN); set `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` |
| `factory.example.com/webhooks/` | (same) | *Bypass*, Include: GitHub's webhook IP ranges (`hooks` in `https://api.github.com/meta`) |
| `crash.example.com` | HTTP `glitchtip-web:8000` | *Allow* `you@example.com` |
| `crash.example.com/api/*/envelope`, `/api/*/store` | (same) | *Bypass*, Everyone: the app sends crash reports without signing in |

Add the Access apps before the hostnames, so nothing is ever open. The website's analytics on the
Systems view use a separate API token with only *Account Analytics: Read* and *Zone Analytics: Read*
(`CF_API_TOKEN`, `CF_ACCOUNT_ID`, `CF_ZONE_ID`). Webhooks: deploy.md, "Webhooks".

## GlitchTip

Crash reports for the app, on the factory LXC as its own compose project in `~/glitchtip`, from
[examples/glitchtip/](../glitchtip/): `setup.sh` asks for `https://crash.example.com` and a sender
address, and makes the secrets. It joins the factory's Docker network, so the tunnel reaches it as
`glitchtip-web:8000`; nothing is published but `127.0.0.1:8001`. About 250 MB of RAM. `backup.sh` runs
nightly from `factory`'s crontab. After signing up, set `ENABLE_USER_REGISTRATION=False`. The
dashboard's Logs view reads it with a read-only `GLITCHTIP_TOKEN` in the env, and its address and
organization on Settings › Install › Reports.

## The Systems view

All of these go in `~/.config/factory/env`, then `docker compose up -d`:

- `DEVICE_TOKEN` (`openssl rand -hex 32`), which every reporter is given once. Reporters send to
  `http://10.20.0.10:8080`, never through the tunnel (it refuses `/ingest`).
- **The Proxmox host:** a read-only user and token, on the host as root:
  ```bash
  pveum user add factory@pve --comment "factory dashboard, read-only"
  pveum acl modify / --users factory@pve --roles PVEAuditor
  pveum user token add factory@pve dashboard --privsep 0     # prints the secret once
  cp /etc/pve/pve-root-ca.pem /var/lib/lxc/110/rootfs/home/factory/factory/data/
  ```
  then `PVE_URL=https://10.20.0.1:8006`, `PVE_TOKEN=factory@pve!dashboard=<secret>`,
  `PVE_CA_FILE=/app/data/pve-root-ca.pem`. Plus `machines/reporters/report-linux.sh` on the host with
  `NAME=proxmox`, for temperatures and network.
- `DISCORD_WEBHOOK_URL` for alerts (limits on Settings › Alerts).
- The machines' names, runner names and checks on **Settings › Install**, not in any file.
