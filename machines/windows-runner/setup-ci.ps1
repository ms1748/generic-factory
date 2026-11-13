<#
  Gives a registered Windows runner (register-runner.ps1) what a CI build expects from GitHub's own
  windows-latest machines, without changing anything for the PC's other accounts:
    1. Git for Windows and PowerShell 7 (windows-latest's default shell), machine-wide, if missing.
    2. Optionally Rust in its own folder (-Rust, default C:\rust), for the runner only: nobody's own Rust
       (~\.cargo) changes. The runner's account may write there (the cargo registry and the build cache),
       and CARGO_TARGET_DIR is outside the checkout, so builds stay warm between jobs.
    3. The runner's own PATH (its .path file): Git's bin first, so `shell: bash` is Git Bash and never
       WSL's bash.exe from System32; then Rust and PowerShell 7; then the machine's PATH.
  Run in an elevated PowerShell, after register-runner.ps1 and before setup-runner.ps1:
    powershell -ExecutionPolicy Bypass -File setup-ci.ps1 -User <account> [-Dir C:\actions-runner] `
      [-Rust C:\rust | -NoRust]
  The runner reads .env and .path when it starts: setup-runner.ps1 (re)starts it.
  Undo: delete the runner folder's .env and .path, and the Rust folder.
#>
param(
  [Parameter(Mandatory)] [string] $User,
  [string] $Dir = "C:\actions-runner",
  [string] $Rust = "C:\rust",
  [switch] $NoRust
)
$ErrorActionPreference = "Stop"
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw "Run this from an elevated PowerShell (Run as administrator)" }
if (-not (Test-Path "$Dir\run.cmd")) { throw "No runner in $Dir (register-runner.ps1 first)." }
if (-not (Get-LocalUser $User -ErrorAction SilentlyContinue)) { throw "No local account $User on this PC." }
$account = "$env:COMPUTERNAME\$User"

function Install-Winget([string]$id, [string]$check) {
  if (Test-Path $check) { return }
  winget install --id $id -e --scope machine --silent --accept-package-agreements --accept-source-agreements --disable-interactivity | Out-Null
  if (-not (Test-Path $check)) { throw "$id didn't install (winget install --id $id)." }
}

# 1. Git and PowerShell 7.
$git = "C:\Program Files\Git"
Install-Winget "Git.Git" "$git\bin\bash.exe"
"Git: $((& "$git\bin\git.exe" --version))"
$pwsh = "C:\Program Files\PowerShell\7"
Install-Winget "Microsoft.PowerShell" "$pwsh\pwsh.exe"
"PowerShell 7: $((& "$pwsh\pwsh.exe" -NoProfile -Command '$PSVersionTable.PSVersion.ToString()'))"

# 2. Rust, for the runner only.
$runnerEnv = @()
$path = @("$git\bin")
if (-not $NoRust) {
  $env:RUSTUP_HOME = "$Rust\rustup"; $env:CARGO_HOME = "$Rust\cargo"
  if (-not (Test-Path "$Rust\cargo\bin\rustup.exe")) {
    New-Item -ItemType Directory -Force $Rust | Out-Null
    $init = Join-Path $env:TEMP "rustup-init.exe"
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -UseBasicParsing https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe -OutFile $init
    & $init -y --no-modify-path --profile minimal --default-toolchain stable -c clippy | Out-Null
    Remove-Item $init
  }
  & "$Rust\cargo\bin\rustup.exe" component add clippy | Out-Null
  icacls $Rust /grant "${account}:(OI)(CI)M" /T /Q | Out-Null
  "Rust: $((& "$Rust\cargo\bin\rustc.exe" --version))"
  $runnerEnv += "RUSTUP_HOME=$Rust\rustup", "CARGO_HOME=$Rust\cargo", "CARGO_TARGET_DIR=$Rust\target-ci", "CARGO_INCREMENTAL=0"
  $path += "$Rust\cargo\bin"
}

# 3. The runner's own environment, read when it starts.
$path += $pwsh
$machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
($path -join ";") + ";$machinePath" | Set-Content "$Dir\.path" -Encoding ASCII -NoNewline
if ($runnerEnv.Count) { $runnerEnv | Set-Content "$Dir\.env" -Encoding ASCII }
elseif (Test-Path "$Dir\.env") { "Left $Dir\.env as it was." }
"Runner .path written (Git Bash first). Next: setup-runner.ps1 (it restarts the runner, which reads these)."
