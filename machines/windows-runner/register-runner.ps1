<#
  Registers one GitHub Actions runner for one repo on a Windows PC. It doesn't start it: setup-runner.ps1
  does that next (inside a signed-in account, with no console window), so a job can open windows.
  Run in an elevated PowerShell:
    powershell -ExecutionPolicy Bypass -File register-runner.ps1 -Repo <owner/repo> -Name <runner name> `
      -Labels <label>[,<label>...] -TokenFile <file> [-Dir C:\actions-runner] [-CopyFrom <runner folder>]

  -Repo       the repo the runner takes jobs from.
  -Name       how it shows in the repo's Settings > Actions > Runners.
  -Labels     what workflows pick it with, on top of GitHub's own (self-hosted, Windows, X64): e.g.
              windows-build for CI builds, or one label of its own for a test machine's jobs.
  -TokenFile  a file holding only a registration token (Settings > Actions > Runners > New self-hosted
              runner shows one; it lasts an hour). It is read once and deleted, and never printed.
  -Dir        where the runner goes (default C:\actions-runner). One folder per runner.
  -CopyFrom   a second runner on the same PC (a game-test runner next to a build runner): copy the first
              runner's program files from that folder instead of downloading, never its registration,
              credentials or work folder.

  Downloads the pinned runner release and checks its SHA-256 before unpacking.
  Undo: delete the scheduled task setup-runner.ps1 made, then in the folder `.\config.cmd remove` (it asks
  for a removal token from the same settings page), and delete the folder.
#>
param(
  [Parameter(Mandatory)] [string] $Repo,
  [Parameter(Mandatory)] [string] $Name,
  [Parameter(Mandatory)] [string] $Labels,
  [Parameter(Mandatory)] [string] $TokenFile,
  [string] $Dir = "C:\actions-runner",
  [string] $CopyFrom
)
$ErrorActionPreference = "Stop"
$version = "2.338.2"
$sha256 = "a1f17aa987fc8158bc7521d284912267a0d01b7c2c4684b33c86783b5e8221cc"

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw "Run this from an elevated PowerShell (Run as administrator)" }
if ($Repo -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$') { throw "-Repo: owner/name" }
if ($Name -notmatch '^[A-Za-z0-9_-]+$') { throw "-Name: letters, digits, - and _" }
if ($Labels -notmatch '^[A-Za-z0-9_.-]+(,[A-Za-z0-9_.-]+)*$') { throw "-Labels: a comma-separated list (letters, digits, -, _ and .)" }
if (-not (Test-Path $TokenFile)) { throw "No token file at $TokenFile" }
$token = (Get-Content $TokenFile -Raw).Trim()
Remove-Item -Force $TokenFile
if (-not $token) { throw "The token file was empty." }

if (Test-Path "$Dir\.runner") {
  "$Dir is already registered; leaving its registration alone."
  return
}
New-Item -ItemType Directory -Force $Dir | Out-Null
if ($CopyFrom) {
  if (-not (Test-Path "$CopyFrom\config.cmd")) { throw "No runner in $CopyFrom to copy." }
  Get-ChildItem $CopyFrom -Force | Where-Object { $_.Name -notin ".runner", ".runner_migrated", ".credentials", ".credentials_migrated", ".credentials_rsaparams", ".env", ".path", "_work", "_diag" } |
    Copy-Item -Destination $Dir -Recurse -Force
} elseif (-not (Test-Path "$Dir\config.cmd")) {
  $zip = Join-Path $env:TEMP "actions-runner-win-x64-$version.zip"
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -UseBasicParsing "https://github.com/actions/runner/releases/download/v$version/actions-runner-win-x64-$version.zip" -OutFile $zip
  $got = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
  if ($got -ne $sha256) { Remove-Item $zip; throw "The runner download's SHA-256 is $got, not $sha256; nothing was unpacked." }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [IO.Compression.ZipFile]::ExtractToDirectory($zip, $Dir)
  Remove-Item $zip
}

# The runner reads its arguments from ACTIONS_RUNNER_INPUT_<NAME> variables too: the token goes that way,
# so it never shows in the process list.
Push-Location $Dir
try {
  $env:ACTIONS_RUNNER_INPUT_TOKEN = $token
  & .\config.cmd --unattended --url "https://github.com/$Repo" --name $Name --labels $Labels --work _work --replace |
    Where-Object { $_ -notmatch 'token' }
  if ($LASTEXITCODE -ne 0) { throw "config.cmd failed ($LASTEXITCODE): an expired token? They last an hour." }
} finally {
  Remove-Item Env:ACTIONS_RUNNER_INPUT_TOKEN -ErrorAction SilentlyContinue
  $token = $null
  Pop-Location
}
"OK: $Name is registered for $Repo in $Dir (labels self-hosted, Windows, X64, $Labels). Next: setup-runner.ps1."
