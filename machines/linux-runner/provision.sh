#!/bin/bash
# Provisions a Linux machine for self-hosted GitHub Actions runners: any Debian or Ubuntu host, VM or
# Proxmox LXC. Installs the toolchains, a `runner` user without sudo, and the Actions runner's program
# (pinned version, checksum checked). Registering a runner for a repo is register.sh, once per repo.
# Run as root on the machine. Safe to run again: what is already there is left alone.
#
#   provision.sh [--rust] [--tauri] [--awscli]
#
#   (nothing)  git, curl, jq, build tools, unattended security upgrades, GitHub CLI, Node 22.
#   --rust     Rust for the runner user (rustup, minimal profile, clippy and rustfmt).
#   --tauri    The Linux libraries a Tauri app builds against (WebKitGTK 4.1 and friends). Implies --rust.
#              The runner user has no sudo, so a workflow's own `apt-get install` step can't run here:
#              skip it on self-hosted runners and rely on these.
#   --awscli   The AWS CLI (for workflows that talk to S3 or R2; GitHub's hosted runners have it).
#
# Keep the runner apart from anything that holds secrets: it runs code from pull requests. On Proxmox,
# its own unprivileged LXC with no host mounts and no Docker. Created on the host with, for example:
#   pct create <id> local:vztmpl/debian-13-standard_13.6-1_amd64.tar.zst --hostname ci-runner \
#     --cores 4 --memory 6144 --swap 2048 --rootfs local-lvm:40 \
#     --net0 name=eth0,bridge=<bridge>,ip=dhcp,type=veth \
#     --unprivileged 1 --features nesting=1 --onboot 1 --ostype debian
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
RUNNER_VERSION=2.338.2
RUNNER_SHA256=baebf204307bac6193480852732f0aba2ae97b6c5597c244f4d5558390147c40

rust=0 tauri=0 awscli=0
for arg in "$@"; do
  case "$arg" in
    --rust) rust=1 ;;
    --tauri) tauri=1; rust=1 ;;
    --awscli) awscli=1 ;;
    *) echo "unknown option: $arg (use --rust, --tauri, --awscli)" >&2; exit 2 ;;
  esac
done
[ "$(id -u)" = 0 ] || { echo "run as root" >&2; exit 1; }
step() { echo; echo "=== $* ==="; }

step "Base packages"
apt-get update
apt-get -y -o Dpkg::Options::=--force-confold full-upgrade
apt-get install -y git curl wget ca-certificates gnupg unzip zstd jq locales \
  build-essential pkg-config file unattended-upgrades
if [ "$tauri" = 1 ]; then
  apt-get install -y libwebkit2gtk-4.1-dev libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
fi
if [ "$awscli" = 1 ]; then
  apt-get install -y awscli || echo "awscli isn't available from apt on this release; install it by hand if a workflow needs it"
fi
if [ -f /etc/locale.gen ]; then
  sed -i 's/^# *en_US.UTF-8 UTF-8/en_US.UTF-8 UTF-8/' /etc/locale.gen
  locale-gen >/dev/null && update-locale LANG=en_US.UTF-8
fi
echo 'unattended-upgrades unattended-upgrades/enable_auto_updates boolean true' | debconf-set-selections
dpkg-reconfigure -f noninteractive unattended-upgrades

step "GitHub CLI and Node 22"
install -d -m 755 /etc/apt/keyrings
wget -nv -O /etc/apt/keyrings/githubcli-archive-keyring.gpg https://cli.github.com/packages/githubcli-archive-keyring.gpg
chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
  > /etc/apt/sources.list.d/github-cli.list
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
  > /etc/apt/sources.list.d/nodesource.list
apt-get update
apt-get install -y gh nodejs

step "User runner (no sudo)"
id runner >/dev/null 2>&1 || adduser --disabled-password --gecos "" runner
if [ "$rust" = 1 ]; then
  su - runner -c '[ -x ~/.cargo/bin/cargo ] || curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal -c clippy,rustfmt'
fi

step "Actions runner $RUNNER_VERSION"
tarball=/home/runner/actions-runner-linux-x64-$RUNNER_VERSION.tar.gz
if [ ! -f "$tarball" ]; then
  su - runner -c "curl -fsSL -o $tarball https://github.com/actions/runner/releases/download/v$RUNNER_VERSION/actions-runner-linux-x64-$RUNNER_VERSION.tar.gz"
fi
if ! echo "$RUNNER_SHA256  $tarball" | sha256sum -c -; then
  rm -f "$tarball"; echo "the runner download's checksum is wrong; deleted it, nothing unpacked" >&2; exit 1
fi
# The runner's own system dependencies (ICU and friends), from a scratch copy of the program.
scratch=$(mktemp -d)
tar -xzf "$tarball" -C "$scratch"
"$scratch/bin/installdependencies.sh"
rm -rf "$scratch"

step "Report"
[ "$tauri" = 1 ] && echo "webkit2gtk: $(pkg-config --modversion webkit2gtk-4.1)"
echo "gh:         $(gh --version | head -n1)"
echo "node:       $(node -v)  npm $(npm -v)"
[ "$awscli" = 1 ] && echo "aws:        $(aws --version 2>&1 || true)"
[ "$rust" = 1 ] && echo "cargo:      $(su - runner -c '~/.cargo/bin/cargo clippy --version')"
id runner
echo "PROVISION DONE. Next: register.sh, once per repo."
