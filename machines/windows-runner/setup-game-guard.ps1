<#
  The game guard, for a Windows CI runner on a PC someone also plays on: CI gets out of the way of games
  and follows the dashboard's Pause CI and Build threads (Systems > the machine's card).
  A SYSTEM task runs it every minute:
    - While a game runs in any account but the runner's (Steam, Epic, EA, Ubisoft, GOG, Riot and Xbox
      game folders), it writes <Data>\ci-paused. Each CI job should wait at its first step while that file
      is there (the project's CI does that); a job already going drops to idle priority. When the game
      closes, the file goes and jobs go on. The runner itself keeps running.
    - It checks in with the factory every minute (POST /ingest/device/<name>/guard), using the stats
      reporter's settings (C:\ProgramData\FactoryReport, from report-windows.ps1 -Install). The answer
      says whether the owner paused CI on the dashboard, and the card's Build threads, which it writes to
      <Data>\ci-jobs (JSON: default, max, using) for the project's CI to read at its build step
      (CARGO_BUILD_JOBS; 6 without the file). With "while you play" set to a number there, a game no longer
      pauses CI: jobs go on with that many threads at idle priority.
      Without the reporter it still pauses for games; it just can't hear the dashboard.
    - If the runner isn't running, it starts the runner's task.
  The runner must run in an account of its own (setup-runner.ps1 -User): games in that account aren't seen.
  Run in an elevated PowerShell, after setup-runner.ps1 (and report-windows.ps1 -Install):
    powershell -ExecutionPolicy Bypass -File setup-game-guard.ps1 -User <runner's account> `
      [-Dir C:\actions-runner] [-Task <runner's task>] [-Data C:\ProgramData\FactoryCI] [-GuardTask "CI game guard"]
  -Task is the runner's task from setup-runner.ps1 (its default, "Actions runner (<folder name>)", if not
  given). -Data is where ci-paused and ci-jobs go: the project's CI must read the same folder.
  To update only the guard (no task changes), run this again; the task picks it up within a minute.
  Undo: Unregister-ScheduledTask "<guard task>" -Confirm:$false, and delete <Data>.
#>
param(
  [Parameter(Mandatory)] [string] $User,
  [string] $Dir = "C:\actions-runner",
  [string] $Task,
  [string] $Data = "C:\ProgramData\FactoryCI",
  [string] $GuardTask = "CI game guard"
)
$ErrorActionPreference = "Stop"
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw "Run this from an elevated PowerShell (Run as administrator)" }
if (-not (Test-Path "$Dir\run.cmd")) { throw "No runner in $Dir." }
if (-not (Get-LocalUser $User -ErrorAction SilentlyContinue)) { throw "No local account $User on this PC." }
if (-not $Task) { $Task = "Actions runner ($(Split-Path $Dir -Leaf))" }
if (-not (Get-ScheduledTask -TaskName $Task -ErrorAction SilentlyContinue)) { throw "No task '$Task' (setup-runner.ps1 first, or give -Task)." }
# Paths and names go into the guard inside single quotes.
foreach ($v in $User, $Dir, $Task, $Data) { if ($v -match "'") { throw "No ' in names or paths, please: $v" } }
New-Item -ItemType Directory -Force $Data | Out-Null

$guard = "$Data\game-guard.ps1"
@'
# Runs as SYSTEM every minute (task "__GUARD__", from setup-game-guard.ps1). CI pauses while a
# game runs in any account but __USER__'s, or while the owner paused it on the factory dashboard (Systems >
# this PC > Pause CI). Paused: new jobs wait at their first step (the ci-paused flag) and a job already
# going runs at idle priority. Each check tells the dashboard what it did.
# CI build threads (the card's Build threads): the guard writes them to ci-jobs, which each job's build step
# reads: { default, max (the most a PR may ask for), using (while a game runs: that many, or null) }. Set
# "while you play" to a number on the card and CI keeps building while a game runs, with that many threads
# at idle priority, instead of pausing.
$games = '\steamapps\common\|\SteamLibrary\|\Riot Games\|\XboxGames\|\Epic Games\|\EA Games\|\Ubisoft Game Launcher\games\|\GOG Galaxy\Games\'
$mine = (Get-CimInstance Win32_Process -Filter "Name='explorer.exe'" | Where-Object { (Invoke-CimMethod -InputObject $_ -MethodName GetOwner).User -eq '__USER__' }).SessionId
$playing = Get-Process | Where-Object { $_.SessionId -ne 0 -and $_.SessionId -notin $mine -and $_.Path -match $games } | Select-Object -First 1
$worker = Get-Process Runner.Worker -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '__DIR__\*' }
$listener = Get-Process Runner.Listener -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '__DIR__\*' }

# The dashboard's switch, from the last check-in (the dashboard may be unreachable for a minute).
$ownerFile = '__DATA__\owner-paused.txt'
$owner = (Get-Content $ownerFile -ErrorAction SilentlyContinue) -eq 'paused'
# The card's build threads, from the last check-in too; until the first, 6 and paused while gaming.
$threadsFile = '__DATA__\ci-threads.json'
$threads = $null
try { $threads = Get-Content $threadsFile -Raw -ErrorAction Stop | ConvertFrom-Json } catch {}
if (-not $threads) { $threads = [pscustomobject]@{ default = 6; gaming = $null; max = 12 } }
$gamingOn = { [bool]$playing -and $null -ne $threads.gaming }
$pause = ([bool]$playing -and -not (& $gamingOn)) -or $owner
$report = 'C:\ProgramData\FactoryReport'
if ((Test-Path "$report\config.json") -and (Test-Path "$report\token")) {
  try {
    $cfg = Get-Content "$report\config.json" -Raw | ConvertFrom-Json
    $token = (Get-Content "$report\token" -Raw).Trim()
    $body = @{ state = $(if ($pause) { 'paused' } else { 'running' }); why = $(if (-not $pause) { '' } elseif ($playing -and -not (& $gamingOn)) { 'game' } else { 'owner' }); game = $(if ($playing) { $playing.Name } else { $null }); busy = [bool]$worker } | ConvertTo-Json -Compress
    $r = Invoke-RestMethod -Method Post -Uri "$($cfg.url)/ingest/device/$($cfg.name)/guard" -Headers @{ Authorization = "Bearer $token" } -ContentType 'application/json' -Body $body -TimeoutSec 10
    $owner = $r.paused -eq $true
    $(if ($owner) { 'paused' } else { 'running' }) | Set-Content $ownerFile
    if ($r.jobs -and $r.jobs.default) { $threads = $r.jobs; $threads | ConvertTo-Json -Compress | Set-Content $threadsFile -Encoding ASCII }
    $pause = ([bool]$playing -and -not (& $gamingOn)) -or $owner
  } catch {}
}
# What the next job's build step reads (the project's CI; without this file it uses 6).
[ordered]@{ default = [int]$threads.default; max = [int]$threads.max; using = $(if (& $gamingOn) { [int]$threads.gaming } else { $null }); game = $(if ($playing) { $playing.Name } else { $null }); at = (Get-Date).ToUniversalTime().ToString('o') } |
  ConvertTo-Json -Compress | Set-Content '__DATA__\ci-jobs' -Encoding ASCII

if ($pause -or $playing) {
  if ($worker) {
    # A job is going: let it finish, slowly. Its children (cargo, rustc, tests) too. (While a game runs with
    # "while you play" threads set, jobs go on at idle priority too: the game comes first.)
    $all = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId)
    $seen = @{}; $todo = [Collections.Generic.Queue[int]]::new(); foreach ($w in @($worker)) { $todo.Enqueue([int]$w.Id) }
    while ($todo.Count -and $seen.Count -lt 500) {
      $id = $todo.Dequeue(); if ($seen.ContainsKey($id)) { continue }; $seen[$id] = $true
      foreach ($c in $all) { if ($c.ParentProcessId -eq $id -and $c.ProcessId -ne $id -and $c.ProcessId) { $todo.Enqueue([int]$c.ProcessId) } }
    }
    foreach ($id in $seen.Keys) { try { (Get-Process -Id $id -ErrorAction Stop).PriorityClass = 'Idle' } catch {} }
  }
}
if ($pause) {
  # The flag new jobs wait on (their first step, in the project's CI). The runner itself keeps running:
  # stopping it left the jobs that queued meanwhile stuck on GitHub.
  $(if ($playing -and -not (& $gamingOn)) { "a game is running ($($playing.Name))" } else { 'paused on the factory dashboard' }) | Set-Content '__DATA__\ci-paused'
} else {
  Remove-Item '__DATA__\ci-paused' -ErrorAction SilentlyContinue
}
if (-not $listener) { Start-ScheduledTask -TaskName '__TASK__' }
'@.Replace('__USER__', $User).Replace('__DIR__', $Dir).Replace('__TASK__', $Task).Replace('__DATA__', $Data).Replace('__GUARD__', $GuardTask) | Set-Content -Path $guard -Encoding UTF8
if (-not (Test-Path "C:\ProgramData\FactoryReport\token")) { "Note: no stats reporter here yet, so the guard can't hear the dashboard's Pause CI. Install it with report-windows.ps1 -Install." }
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $GuardTask -Description "No CI on this PC while someone plays; follows the factory dashboard's Pause CI" `
  -Action (New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$guard`"") `
  -Trigger $trigger -Principal (New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest) `
  -Settings (New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 2)) -Force | Out-Null
"Task '$GuardTask' registered (every minute). CI jobs should wait while $Data\ci-paused exists."
