#!/bin/bash
# Registers one GitHub Actions runner for one repo on a machine set up with provision.sh, and starts it
# as a systemd service running as the `runner` user. Run as root, once per repo:
#
#   register.sh <owner/repo> <runner name> <label> <token file> [--cargo-target]
#
#   <runner name>   how it shows in the repo's Settings > Actions > Runners (a-z, 0-9, - and _).
#   <label>         the label workflows pick it with: its labels are self-hosted, linux, <label>
#                   (`runs-on: [self-hosted, linux, <label>]`).
#   <token file>    a file holding only the registration token (the repo's Settings > Actions > Runners >
#                   New self-hosted runner shows one; it lasts an hour). Make it mode 600. It is read once
#                   and deleted here, whatever happens. The token is never printed or put on a command line.
#   --cargo-target  give Rust builds one cache outside the checkout (~runner/cargo-target), so builds
#                   stay warm between jobs.
#
# The runner lives in /home/runner/<repo name>. Safe to run again: a registered runner is left alone.
# Undo: in that folder, ./svc.sh stop && ./svc.sh uninstall, then remove the runner in the repo's settings.
set -euo pipefail
usage() { echo "usage: register.sh <owner/repo> <runner name> <label> <token file> [--cargo-target]" >&2; exit 2; }
[ $# -ge 4 ] && [ $# -le 5 ] || usage
repo=$1 name=$2 label=$3 tokfile=$4 cargo_target=0
if [ $# -eq 5 ]; then [ "$5" = --cargo-target ] && cargo_target=1 || usage; fi
trap 'rm -f "$tokfile"' EXIT
[ "$(id -u)" = 0 ] || { echo "run as root" >&2; exit 1; }
[[ "$repo" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { echo "repo: owner/name" >&2; exit 1; }
[[ "$name" =~ ^[A-Za-z0-9_-]+$ ]] || { echo "runner name: letters, digits, - and _" >&2; exit 1; }
[[ "$label" =~ ^[A-Za-z0-9_.-]+$ ]] || { echo "label: letters, digits, -, _ and ." >&2; exit 1; }
[ -f "$tokfile" ] || { echo "no token file at $tokfile" >&2; exit 1; }
token=$(tr -d '[:space:]' < "$tokfile"); rm -f "$tokfile"
[ -n "$token" ] || { echo "the token file was empty" >&2; exit 1; }

dir=/home/runner/${repo#*/}
tarball=$(ls /home/runner/actions-runner-linux-x64-*.tar.gz 2>/dev/null | sort -V | tail -n1 || true)
[ -n "$tarball" ] || { echo "no runner download in /home/runner: run provision.sh first" >&2; exit 1; }
if [ -f "$dir/.runner" ]; then echo "$dir is already registered; leaving it alone"; exit 0; fi
if [ ! -x "$dir/config.sh" ]; then
  su - runner -c "mkdir -p '$dir' && tar -xzf '$tarball' -C '$dir'"
fi

# The runner reads its arguments from ACTIONS_RUNNER_INPUT_<NAME> variables too: the token goes that way,
# so it never shows in the process list.
cd "$dir"
ACTIONS_RUNNER_INPUT_TOKEN=$token runuser -u runner -- env HOME=/home/runner \
  PATH=/home/runner/.cargo/bin:/usr/local/bin:/usr/bin:/bin \
  ./config.sh --unattended --url "https://github.com/$repo" --name "$name" --labels "linux,$label" \
  --work _work --replace | grep -v -i token || true
unset token
[ -f "$dir/.runner" ] || { echo "registration failed (an expired token? they last an hour)" >&2; exit 1; }

if [ "$cargo_target" = 1 ]; then
  su - runner -c "mkdir -p ~/cargo-target && (grep -q CARGO_TARGET_DIR '$dir/.env' 2>/dev/null || echo CARGO_TARGET_DIR=/home/runner/cargo-target >> '$dir/.env')"
fi
./svc.sh install runner
./svc.sh start
./svc.sh status | head -5
echo "OK: $name is registered for $repo with labels self-hosted, linux, $label."
