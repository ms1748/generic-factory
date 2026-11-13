# Machines

Scripts that set up the machines around the factory: self-hosted CI runners, test machines and the
stats reporters that feed the dashboard's Systems view. Every name, address, account and repo is a
parameter; nothing here is tied to one setup. How they fit together in one real setup (a Proxmox host, a shared Windows build PC, a test box) is in
[`examples/homelab/`](../examples/homelab/README.md).

| Role | What it is | Scripts, in order |
| --- | --- | --- |
| [Linux CI runner](#linux-ci-runner) | A Debian/Ubuntu host, VM or Proxmox LXC that runs Linux CI jobs | `linux-runner/provision.sh`, then `linux-runner/register.sh` per repo |
| [Windows CI runner](#windows-ci-runner) | A Windows PC that runs Windows CI builds, out of the way of whoever uses it | `windows-runner/register-runner.ps1`, `setup-ci.ps1`, `setup-runner.ps1`, `setup-game-guard.ps1` |
| [Windows test machine](#windows-test-machine) | A PC whose jobs open the app's window, take screenshots, drive controllers | `windows-runner/register-runner.ps1`, `setup-runner.ps1 -KeepUnlocked` |
| [Game-test runner](#game-test-runner) | A second runner on a shared Windows PC, for tests that wait on a person | `windows-runner/register-runner.ps1 -CopyFrom`, `setup-runner.ps1` |
| [Stats reporters](#stats-reporters) | Any machine on the Systems view | `reporters/report-linux.sh` or `reporters/report-windows.ps1`, optionally `reporters/setup-lhm.ps1` |

Every script is safe to run again, says what it did, and has its undo in its header.

## Before you start

- **A runner registration token** for each runner: in the repo on GitHub, **Settings › Actions ›
  Runners › New self-hosted runner**; the token is in the "Configure" step and lasts an hour. Save it in a
  file on the machine (only the token, nothing else); the script reads it once and deletes it. It is never
  printed or put on a command line. On Linux make the file mode 600 (`install -m 600 /dev/null token`,
  then paste into it).
- **The machine on the dashboard:** add it on **Settings › Install › Machines** (its name, and the
  runner names CI sees, for the Devices view).
- **Runners run code from pull requests.** Keep them on machines without the factory's secrets, and
  release secrets in a protected GitHub environment, never as plain repo secrets.

## Linux CI runner

Any Debian or Ubuntu machine. On Proxmox, give it its own unprivileged LXC with no host mounts and no
Docker (`provision.sh`'s header has a `pct create` line).

1. As root on the machine: `provision.sh` installs git, gh, Node 22, build tools and the Actions
   runner, and a `runner` user without sudo. Options: `--rust` (Rust for the runner user), `--tauri` (the
   WebKitGTK libraries a Tauri app builds against; implies `--rust`), `--awscli`.
2. For each repo: `register.sh <owner/repo> <runner name> <label> <token file> [--cargo-target]`.
   The runner's labels are `self-hosted, linux, <label>`; it runs as a systemd service as `runner`, from
   `/home/runner/<repo name>`. `--cargo-target` keeps one Rust build cache outside the checkout.

**Admin step:** the registration token (above). Workflows pick the runner with
`runs-on: [self-hosted, linux, <label>]`. The runner user has no sudo, so a workflow's `apt-get install`
step must be skipped on it (`provision.sh --tauri` installs the usual libraries instead).

## Windows CI runner

A Windows PC someone also uses (to play games on, say): CI builds there instead of GitHub's machines, without
getting in their way. Make a local account of its own for the runner first (a "tester" account, a
standard user), so it never runs in the main user's session. Each script runs in an elevated PowerShell
(`powershell -ExecutionPolicy Bypass -File <script> ...`).

1. `register-runner.ps1 -Repo <owner/repo> -Name <runner name> -Labels windows-build -TokenFile <file>`
   downloads the pinned runner (SHA-256 checked) to `C:\actions-runner` (`-Dir` to change) and registers
   it. Labels: `self-hosted, Windows, X64` plus yours.
2. `setup-ci.ps1 -User <account>` installs Git for Windows and PowerShell 7 if missing, Rust in
   `C:\rust` for the runner only (`-NoRust` to skip, `-Rust` to move it), and writes the runner's own PATH
   with **Git Bash first** (so `shell: bash` is never WSL's `bash.exe`).
3. `setup-runner.ps1 -User <account> -Priority BelowNormal` runs the runner in that account's session
   with no console window, at below-normal priority (everything it starts inherits it), restarting it if it
   stops.
4. Stats reporter (below), then `setup-game-guard.ps1 -User <account>`: a SYSTEM task that pauses CI
   while a game runs in any other account, follows the dashboard's **Pause CI** and **Build threads**
   (Systems › the machine's card), and restarts the runner if it stopped. Your CI's jobs should wait at
   their first step while `C:\ProgramData\FactoryCI\ci-paused` exists, and read `ci-jobs` there for the
   build thread count (`-Data` moves the folder).

**Admin step:** the registration token, and Sysinternals **Autologon** for the runner's account (so it
signs in at boot and the runner comes back by itself; Autologon keeps the password encrypted). Without
it the runner waits for someone to sign that account in.

## Windows test machine

A PC (a spare desktop, a test box) whose jobs open the app's window, take screenshots and use virtual
controllers. The runner must run in a signed-in desktop, never as a Windows service (session 0 has no
desktop).

1. `register-runner.ps1 -Repo <owner/repo> -Name <runner name> -Labels <test label> -TokenFile <file>`.
2. `setup-runner.ps1 -User <account> -KeepUnlocked` runs it in that account's desktop at normal
   priority and turns off the account's screen saver and the lock after the display wakes (screenshots of a
   locked desktop are black). A runner already installed as a service is stopped and disabled.
3. Stats reporter (below), with `-App <process name>` and `-Builds <folder>` so the machine's card shows
   whether the app is running and which test builds are there.

**Virtual controllers** (tests that press buttons): install **ViGEmBus** (the virtual gamepad bus) and,
if the tests must hide real controllers from the app, **HidHide**, both from Nefarius Software Solutions'
releases on GitHub, signed installers. Both need an elevated install and a reboot. The stats reporter
shows on the card whether each is installed and how many controllers are plugged in.

**Admin step:** the registration token, and Autologon for the account, as above. Run one runner per
test machine: jobs for it queue on GitHub instead of running side by side.

## Game-test runner

A second runner on a shared Windows PC for tests that wait on a person (pressing a button, up to hours),
so they never block CI on the build runner. Same account as the build runner.

1. `register-runner.ps1 -Repo <owner/repo> -Name <runner name> -Labels <game-test label> -TokenFile <file>
   -Dir C:\actions-runner-gametest -CopyFrom C:\actions-runner` copies the build runner's program files (not
   its registration) and registers a new runner with only that label.
2. `setup-runner.ps1 -User <account> -Dir C:\actions-runner-gametest` at **normal** priority (the
   games a test starts inherit the runner's priority).
3. Take the game-test label off the build runner (repo Settings › Actions › Runners › the runner), so
   it keeps only `windows-build`.

**Admin step:** the registration token.

## Stats reporters

Each machine sends its CPU, memory, disks, network, temperatures (and on Windows the GPU, recent
starts and crashes, controllers) to the factory once a minute. They read only; they need the factory's
`DEVICE_TOKEN` (`openssl rand -hex 32` in the factory's env) and its address on your private network (never
the public one: the tunnel refuses `/ingest`).

- **Linux** (`reporters/report-linux.sh`, as root): its header has the install steps: copy it to
  `/usr/local/bin/factory-report`, put `NAME`, `URL` and `TOKEN` in `/etc/factory-report/env` (mode 600),
  then `factory-report --install-timer`.
- **Windows** (`reporters/report-windows.ps1`, elevated):
  `.\report-windows.ps1 -Install -Name <machine> -Url http://<factory host>:8080 [-App <process>] [-Builds <folder>]`,
  then paste the token when asked. It saves it where only Administrators and SYSTEM can read it, and runs
  every minute as the hidden SYSTEM task "Factory stats". Run the same line again to update the script (it
  keeps the token). `-Uninstall` removes it.
- **CPU temperatures on Windows** (optional; Windows has no reading on many PCs):
  `reporters/setup-lhm.ps1` installs LibreHardwareMonitor's library (open source, SHA-256 checked; the
  app, its web server and update check never run) and checks for the PawnIO driver it needs. Nothing
  leaves the PC except the report to your factory. `-Uninstall` removes it.

**Admin step:** the PawnIO driver for CPU temperatures, if you want them
(`winget install --id namazso.PawnIO -e`, or its signed installer from pawnio.eu).
