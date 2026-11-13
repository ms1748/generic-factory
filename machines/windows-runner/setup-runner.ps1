<#
  Runs a registered Actions runner (register-runner.ps1) inside one Windows account's signed-in session,
  with no console window, so jobs can open windows, take screenshots and see controllers. Run in an
  elevated PowerShell, after register-runner.ps1 (and setup-ci.ps1, if this is a CI build machine):
    powershell -ExecutionPolicy Bypass -File setup-runner.ps1 -User <account> [-Dir C:\actions-runner] `
      [-Task <name>] [-Priority Normal|BelowNormal] [-KeepUnlocked]

  -User          the local account the runner runs as. Use an account of its own (a "tester" account) on
                 a PC someone also uses: the runner then never runs in their session, and the game guard
                 (setup-game-guard.ps1) can tell their games from the tests'. It gets Modify on the runner's
                 folder only.
  -Dir           the runner's folder (default C:\actions-runner).
  -Task          the scheduled task's name (default "Actions runner (<folder name>)").
  -Priority      BelowNormal for a CI build runner on a PC someone uses (the runner and everything it
                 starts); Normal (the default) for a test runner: the apps and games a test starts inherit it.
  -KeepUnlocked  for a test machine: the account's screen never locks (screenshots of a locked desktop are
                 black). Turns off its screen saver and the lock after the display wakes; the display may
                 still switch off.

  - The runner starts when the account signs in (a task "only when signed in", so no password is stored)
    and restarts if it stops; one copy at a time. After a reboot it waits for that sign-in: Sysinternals
    Autologon signs the account in at boot (it keeps the password encrypted).
  - A runner installed as a Windows service (config.cmd's --runasservice) runs in session 0 with no
    desktop: this stops and disables that service (kept, for the undo).
  - Run it again to change the priority or switch an older runner to no console window; it waits for a job
    in progress to finish, then restarts the runner.
  Undo: Unregister-ScheduledTask "<task>" -Confirm:$false
#>
param(
  [Parameter(Mandatory)] [string] $User,
  [string] $Dir = "C:\actions-runner",
  [string] $Task,
  [ValidateSet("Normal", "BelowNormal")] [string] $Priority = "Normal",
  [switch] $KeepUnlocked
)
$ErrorActionPreference = "Stop"
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw "Run this from an elevated PowerShell (Run as administrator)" }
if (-not (Test-Path "$Dir\.runner")) { throw "No registered runner in $Dir (register-runner.ps1 first)." }
$local = Get-LocalUser $User -ErrorAction SilentlyContinue
if (-not $local) { throw "No local account $User on this PC." }
if (-not $Task) { $Task = "Actions runner ($(Split-Path $Dir -Leaf))" }
$account = "$env:COMPUTERNAME\$User"
$mine = { Get-Process Runner.Listener -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$Dir\*" } }

# Wait for a job in progress to finish, so it isn't cut off.
while (Get-Process Runner.Worker -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$Dir\*" }) { "A job is running; waiting for it to finish..."; Start-Sleep 20 }

# A runner service for this folder (session 0, no desktop): stop and disable it.
Get-CimInstance Win32_Service | Where-Object { $_.Name -like "actions.runner.*" -and $_.PathName -like "*$Dir\*" } | ForEach-Object {
  Stop-Service $_.Name -ErrorAction SilentlyContinue
  Set-Service $_.Name -StartupType Disabled
  "Runner service $($_.Name) stopped and disabled (kept, for the undo: set it back to Automatic)."
}

icacls $Dir /grant "${account}:(OI)(CI)M" /T /Q | Out-Null
"$User can use $Dir."

# conhost --headless: no console window in the session (a minimized one ended up in front of a test's app).
# The priority is set on the PowerShell that starts run.cmd; Windows passes it on to everything it starts.
$start = if ($Priority -eq "Normal") { "& '$Dir\run.cmd'" } else { "(Get-Process -Id `$PID).PriorityClass = '$Priority'; & '$Dir\run.cmd'" }
$action = New-ScheduledTaskAction -Execute "conhost.exe" -WorkingDirectory $Dir `
  -Argument "--headless powershell.exe -NoProfile -Command `"$start`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $account
$principal = New-ScheduledTaskPrincipal -UserId $account -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $Task -Description "The Actions runner in $Dir, inside $User's session only" `
  -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
"Task '$Task' registered ($Priority priority, no console window)."

if ($KeepUnlocked) {
  # The account's own settings: its registry hive (loaded here if it isn't signed in).
  $sid = $local.SID.Value
  $loaded = $false
  if (-not (Test-Path "Registry::HKEY_USERS\$sid")) {
    $profileDir = (Get-CimInstance Win32_UserProfile | Where-Object SID -eq $sid).LocalPath
    if (-not $profileDir) { throw "$User has never signed in, so it has no settings yet: sign in once, then run this again." }
    reg load "HKU\$sid" "$profileDir\NTUSER.DAT" | Out-Null
    $loaded = $true
  }
  try {
    Set-ItemProperty "Registry::HKEY_USERS\$sid\Control Panel\Desktop" -Name ScreenSaveActive -Value "0"
  } finally {
    if ($loaded) { [GC]::Collect(); reg unload "HKU\$sid" | Out-Null }
  }
  powercfg /SETACVALUEINDEX SCHEME_CURRENT SUB_NONE CONSOLELOCK 0
  powercfg /SETACTIVE SCHEME_CURRENT
  "No screen saver or lock after the display wakes, for $User."
}

# (Re)start the runner if the account is signed in (quser isn't on Windows Home; its explorer.exe is).
Stop-ScheduledTask -TaskName $Task -ErrorAction SilentlyContinue
& $mine | Stop-Process -Force
if (Get-Process explorer -IncludeUserName -ErrorAction SilentlyContinue | Where-Object UserName -like "*\$User") {
  Start-Sleep 3
  Start-ScheduledTask -TaskName $Task
  Start-Sleep 15
  $l = & $mine
  if ($l) { "OK: the runner is listening in $User's session, at $($l.PriorityClass) priority." }
  else { "Started; it may take a minute to show as online (or check the task's history)." }
} else {
  "$User isn't signed in right now; the runner starts the next time it is (Autologon does that at boot)."
}
