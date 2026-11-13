<#
  Sends this PC's stats to the factory's Systems view once a minute (src/systems.ts).
  Read-only: it only reads counters and posts them. Windows PowerShell 5.1 or later.

  Install (an elevated PowerShell, once):
    .\report-windows.ps1 -Install -Name <machine> -Url <factory address> [-App <process>] [-Builds <folder>]
  It asks for the factory's DEVICE_TOKEN, saves it in C:\ProgramData\FactoryReport\token (readable by
  Administrators and SYSTEM only) and adds the scheduled task "Factory stats" (as SYSTEM, every minute,
  hidden). Remove with -Uninstall. Run once by hand with no switches to test it.

  -Name: the machine's name on the dashboard (Settings > Install > Machines; a-z, 0-9 and -).
  -Url: the factory's address on your private network (http://<host>:8080), never the public one.
  -App (optional): the project's process name; the card then says whether it's running.
  -Builds (optional): a test machine's folder of downloaded test builds (pr*\v* folders); the card then
  says how many there are and the newest.

  Also sent: the NVIDIA card's fan, power and clock (nvidia-smi), and the last two days' starts, shutdowns
  and crashes from the System event log (IDs 6005, 6006, 6008, 41, 1074, with the reason given).

  CPU temperature, power, clocks and fans: Windows has no reading for them, so they come from
  LibreHardwareMonitor's library when the PC has it (setup-lhm.ps1 installs it; nothing else is
  started: no LHM app, web server or update check). Then this script also stays for the rest of its minute
  writing those sensors once a second to C:\ProgramData\FactorySensors\sensors.json (readable by users,
  no token in it), which the project's test runs read for their per-second performance record.
  Nothing leaves the PC except this report to the factory's address.
#>
param(
  [switch]$Install,
  [switch]$Uninstall,
  [string]$Name,
  [string]$Url,
  [string]$App,
  [string]$Builds
)
$ErrorActionPreference = "Stop"
$started = Get-Date
$dir = Join-Path $env:ProgramData "FactoryReport"
$conf = Join-Path $dir "config.json"
$tokenFile = Join-Path $dir "token"
$task = "Factory stats"

if ($Uninstall) {
  Unregister-ScheduledTask -TaskName $task -Confirm:$false -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force $dir -ErrorAction SilentlyContinue
  "Removed the task and $dir"
  return
}

if ($Install) {
  if (-not $Name -or -not $Url) { throw "Give -Name and -Url, e.g. -Name test-box -Url http://192.0.2.10:8080" }
  if ($App -and $App -notmatch '^[A-Za-z0-9_.-]{1,60}$') { throw "-App: a process name, without .exe" }
  if ($Name -notmatch '^[a-z0-9][a-z0-9-]{0,30}$') { throw "Name: a-z, 0-9 and -, up to 31 characters" }
  $admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if (-not $admin) { throw "Run this from an elevated PowerShell (Run as administrator)" }
  New-Item -ItemType Directory -Force $dir | Out-Null
  # A PC that already has the token (reinstalling, to change -App or -Builds) keeps it: no paste.
  $have = if (Test-Path $tokenFile) { (Get-Content $tokenFile -Raw).Trim() } else { "" }
  if ($have -match '^[0-9a-f]{64}$') {
    "Using the DEVICE_TOKEN already saved in $tokenFile"
  } else {
    $secure = Read-Host "DEVICE_TOKEN from the factory's .env" -AsSecureString
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
    # Pasting the whole env line, or a space or quote with it, still works.
    $plain = ($plain.Trim() -replace '^DEVICE_TOKEN=', '').Trim().Trim('"', "'")
    if ($plain -notmatch '^[0-9a-f]{64}$') { throw "That doesn't look like the factory's DEVICE_TOKEN (64 letters and digits, 0-9 and a-f). Nothing was saved." }
    Set-Content -Path $tokenFile -Value $plain -NoNewline -Encoding ascii
  }
  $c = @{ name = $Name; url = $Url.TrimEnd("/") }
  if ($App) { $c.app = $App -replace '\.exe$', '' }
  if ($Builds) { $c.builds = $Builds.TrimEnd("\") }
  $c | ConvertTo-Json | Set-Content -Path $conf -Encoding utf8
  # Only Administrators and SYSTEM may read the token.
  icacls $dir /inheritance:r /grant:r "*S-1-5-32-544:(OI)(CI)F" "*S-1-5-18:(OI)(CI)F" | Out-Null
  $script = Join-Path $dir "report-windows.ps1"
  Copy-Item -Force $PSCommandPath $script
  $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`""
  $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 1)
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 2) -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName $task -Action $action -Trigger $trigger -Settings $settings -User "SYSTEM" -RunLevel Highest -Force | Out-Null
  "Installed: $Name reports to $Url every minute. Sending one now..."
}

$cfg = Get-Content $conf -Raw | ConvertFrom-Json
$token = (Get-Content $tokenFile -Raw).Trim()

function Try-Get([scriptblock]$f) { try { & $f } catch { $null } }

$os = Get-CimInstance Win32_OperatingSystem
$cpu = Get-CimInstance Win32_Processor
$sys = Get-CimInstance Win32_ComputerSystem
$load = (Get-Counter '\Processor(_Total)\% Processor Time' -SampleInterval 1 -MaxSamples 2).CounterSamples | Measure-Object CookedValue -Average
$disks = @(Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object { @{ mount = $_.DeviceID; used = [double]($_.Size - $_.FreeSpace); total = [double]$_.Size } })
$net = Try-Get {
  $s = (Get-Counter '\Network Interface(*)\Bytes Received/sec', '\Network Interface(*)\Bytes Sent/sec').CounterSamples
  @{ rx = [double](($s | Where-Object Path -like '*received*' | Measure-Object CookedValue -Sum).Sum); tx = [double](($s | Where-Object Path -like '*sent*' | Measure-Object CookedValue -Sum).Sum) }
}

# The hottest ACPI thermal zone (not every PC exposes one).
$temp = Try-Get {
  $z = Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature
  [math]::Round((($z | Measure-Object CurrentTemperature -Maximum).Maximum / 10) - 273.15, 1)
}

$video = Get-CimInstance Win32_VideoController | Where-Object { $_.Name -notmatch 'Basic|Virtual|Remote|Parsec' } | Select-Object -First 1
$gpu = $null
if ($video) { $gpu = @{ name = $video.Name } }
$smi = Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue
if ($smi) {
  # Without admin rights nvidia-smi prints an error instead; only a full five-field answer counts.
  # All its output, then the first line: `| Select-Object -First 1` stops nvidia-smi early, and its
  # exit code then reads as a failure (a PC reported its integrated Radeon instead of its GeForce).
  $line = Try-Get { @(& $smi.Source --query-gpu=name,utilization.gpu,temperature.gpu,memory.used,memory.total --format=csv,noheader,nounits 2>$null)[0] }
  $q = if ($line -and "$line".Split(",").Count -eq 5) { @("$line".Split(",") | ForEach-Object { $_.Trim() }) } else { @() }
  # Each field on its own: run as SYSTEM some come back [N/A] (memory on some GeForce cards), and the
  # others still count. The NVIDIA card wins over integrated graphics listed first (a Ryzen's Radeon).
  $n = { param($i, $scale) if ($q.Count -eq 5 -and $q[$i] -match '^[\d.]+$') { [double]$q[$i] * $scale } else { $null } }
  if ($q.Count -eq 5 -and $q[0]) { $gpu = @{ name = $q[0]; util = & $n 1 0.01; temp = & $n 2 1; memUsed = & $n 3 1MB; memTotal = & $n 4 1MB } }
}

# Facts for the card: controllers plugged in, the virtual-controller drivers, test builds downloaded, the app.
$facts = @{}
if ($smi) {
  # The GPU's fan, power draw and clock (the loudest part of a PC under load); [N/A] on cards without a reading.
  # Sent as metrics (the dashboard keeps their history) and still as facts, for an older dispatcher.
  $fp = Try-Get { @(& $smi.Source --query-gpu=fan.speed,power.draw,clocks.gr --format=csv,noheader,nounits 2>$null)[0] }
  $f = if ($fp) { @("$fp".Split(",") | ForEach-Object { $_.Trim() }) } else { @() }
  if ($f.Count -eq 3 -and $f[0] -match '^[\d.]+$') { $facts["GPU fan"] = "$([math]::Round([double]$f[0]))%"; if ($gpu) { $gpu.fan = [double]$f[0] } }
  if ($f.Count -eq 3 -and $f[1] -match '^[\d.]+$') { $facts["GPU power"] = "$([math]::Round([double]$f[1])) W"; if ($gpu) { $gpu.power = [double]$f[1] } }
  if ($f.Count -eq 3 -and $f[2] -match '^[\d.]+$' -and $gpu) { $gpu.clock = [double]$f[2] }
}

# Starts, shutdowns and crashes in the last two days (the dispatcher keeps each one once).
$events = @(Try-Get {
  Get-WinEvent -FilterHashtable @{ LogName = "System"; Id = 6005, 6006, 6008, 41, 1074; StartTime = (Get-Date).AddDays(-2) } -MaxEvents 30 -ErrorAction Stop | ForEach-Object {
    $why = ""
    if ($_.Id -eq 1074) {
      # Who asked (the process), the kind (restart, power off), the reason and any comment.
      $p = $_.Properties
      $who = [IO.Path]::GetFileName("$($p[0].Value)".Split(" ")[0])
      $why = "$($p[4].Value) by ${who}: $($p[2].Value)"
      if ("$($p[5].Value)".Trim()) { $why += " ($($p[5].Value))" }
    }
    elseif ($_.Id -eq 41) { $why = "bugcheck 0x{0:X}" -f [int64]$_.Properties[0].Value }
    @{ at = $_.TimeCreated.ToUniversalTime().ToString("o"); id = $_.Id; reason = $why.Trim() }
  }
} | Where-Object { $_ })

# CPU and board sensors from LibreHardwareMonitor's library (setup-lhm.ps1), when the PC has it.
$lhmDll = Join-Path $env:ProgramFiles "LibreHardwareMonitor\LibreHardwareMonitorLib.dll"
$lhm = $null
$sensors = $null
function Read-Lhm($computer) {
  $o = @{ cpuTemp = $null; ccdTemps = @(); cpuPower = $null; cpuClock = $null; fans = @() }
  $clocks = @()
  foreach ($hw in $computer.Hardware) {
    $hw.Update()
    foreach ($sub in $hw.SubHardware) { $sub.Update() }
    $isCpu = "$($hw.HardwareType)" -eq "Cpu"
    foreach ($s in @($hw.Sensors) + @($hw.SubHardware | ForEach-Object { $_.Sensors })) {
      if ($null -eq $s -or $null -eq $s.Value) { continue }
      $t = "$($s.SensorType)"; $n = "$($s.Name)"; $v = [math]::Round([double]$s.Value, 1)
      if ($isCpu -and $t -eq "Temperature") {
        # AMD: "Core (Tctl/Tdie)" and "CCD1 (Tdie)"...; Intel: "CPU Package".
        if ($n -match '^CCD\d') { $o.ccdTemps += $v }
        elseif ($n -match 'Tctl|Tdie|Package') { if ($null -eq $o.cpuTemp -or $n -match 'Tctl/Tdie|CPU Package') { $o.cpuTemp = $v } }
      }
      elseif ($isCpu -and $t -eq "Power" -and $n -match 'Package') { $o.cpuPower = $v }
      elseif ($isCpu -and $t -eq "Clock" -and $n -match '^Core #\d+$') { $clocks += $v }
      elseif ($t -eq "Fan" -and $v -gt 0) { $o.fans += @{ name = $n; rpm = [math]::Round($v) } }
    }
  }
  if ($clocks.Count) { $o.cpuClock = [math]::Round(($clocks | Measure-Object -Average).Average) }
  $o
}
if (Test-Path $lhmDll) {
  # Only the CPU and the board's sensor chip: never controllers or other USB devices.
  $lhm = Try-Get {
    Add-Type -Path $lhmDll
    $c = New-Object LibreHardwareMonitor.Hardware.Computer
    $c.IsCpuEnabled = $true
    $c.IsMotherboardEnabled = $true
    $c.Open()
    $c
  }
  if ($lhm) { $sensors = Try-Get { Read-Lhm $lhm } }
}

$pads = Try-Get { @(Get-PnpDevice -PresentOnly -ErrorAction Stop | Where-Object { $_.FriendlyName -match 'Xbox|game controller|Gamepad|DualSense|DualShock|8BitDo|Pro Controller' -and $_.Status -eq 'OK' }).Count }
if ($null -ne $pads) { $facts["Controllers"] = "$pads" }
$vigem = Try-Get { (Get-PnpDevice -FriendlyName "*Virtual Gamepad Emulation Bus*" -ErrorAction Stop | Select-Object -First 1).Status }
$facts["ViGEmBus"] = if ($vigem) { "$vigem" } else { "not installed" }
$facts["HidHide"] = if (Test-Path "C:\Program Files\Nefarius Software Solutions\HidHide") { "installed" } else { "not installed" }
if ($cfg.builds -and (Test-Path $cfg.builds)) {
  $builds = @(Get-ChildItem $cfg.builds -Directory -Filter "pr*" | ForEach-Object { Get-ChildItem $_.FullName -Directory -Filter "v*" })
  $facts["Test builds"] = "$($builds.Count)"
  $newest = $builds | Sort-Object LastWriteTime | Select-Object -Last 1
  if ($newest) { $facts["Newest build"] = "$($newest.Parent.Name) $($newest.Name)" }
}
if ($cfg.app) {
  $running = Get-Process $cfg.app -ErrorAction SilentlyContinue
  $facts[$cfg.app] = if ($running) { "running" } else { "not running" }
}
# The Windows Update search takes ~30 s, so it runs at most every 6 hours; the answer is kept in between.
$wuFile = Join-Path $dir "updates.txt"
$wu = if (Test-Path $wuFile) { Get-Item $wuFile } else { $null }
if (-not $wu -or $wu.LastWriteTime -lt (Get-Date).AddHours(-6)) {
  $pending = Try-Get { (New-Object -ComObject Microsoft.Update.Session).CreateUpdateSearcher().Search("IsInstalled=0 and IsHidden=0").Updates.Count }
  if ($null -ne $pending) { Set-Content -Path $wuFile -Value $(if ($pending) { "$pending pending" } else { "up to date" }) }
}
if (Test-Path $wuFile) { $facts["Windows updates"] = (Get-Content $wuFile -Raw).Trim() }

$report = @{
  os = "$($os.Caption) $($os.Version)".Replace("Microsoft ", "")
  model = "$($sys.Manufacturer) $($sys.Model)"
  cpuModel = ($cpu | Select-Object -First 1).Name.Trim()
  cores = [int](($cpu | Measure-Object NumberOfLogicalProcessors -Sum).Sum)
  cpu = [math]::Round($load.Average / 100, 4)
  memTotal = [double]$os.TotalVisibleMemorySize * 1KB
  memUsed = [double]($os.TotalVisibleMemorySize - $os.FreePhysicalMemory) * 1KB
  uptime = [int]((Get-Date) - $os.LastBootUpTime).TotalSeconds
  disks = $disks
  facts = $facts
}
if ($sensors -and $null -ne $sensors.cpuTemp) { $temp = $sensors.cpuTemp }
if ($null -ne $temp) { $report.temp = $temp }
if ($sensors) { $report.sensors = $sensors }
if ($events.Count) { $report.events = $events }
if ($gpu) { $report.gpu = $gpu }
if ($net) { $report.net = $net }

$body = $report | ConvertTo-Json -Depth 5 -Compress
Invoke-RestMethod -Method Post -Uri "$($cfg.url)/ingest/device/$($cfg.name)" -Headers @{ Authorization = "Bearer $token" } -ContentType "application/json" -Body $body -TimeoutSec 15 | Out-Null
if ($Install -or [Environment]::UserInteractive) { "Sent: cpu $([math]::Round($load.Average))%, $($disks.Count) disk(s)$(if ($sensors) { ", CPU $($sensors.cpuTemp) C" })" }

# The rest of the minute: the sensors once a second, for test runs on this PC (the project's scripts/ci/perf).
if ($lhm) {
  $out = Join-Path $env:ProgramData "FactorySensors"
  if (-not (Test-Path $out)) {
    New-Item -ItemType Directory -Force $out | Out-Null
    # Administrators and SYSTEM write; signed-in users (the CI runner's account too) only read.
    icacls $out /inheritance:r /grant:r "*S-1-5-32-544:(OI)(CI)F" "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-545:(OI)(CI)RX" | Out-Null
  }
  $file = Join-Path $out "sensors.json"
  while (((Get-Date) - $started).TotalSeconds -lt 56) {
    $r = Try-Get { Read-Lhm $lhm }
    if ($r) {
      $r.at = (Get-Date).ToUniversalTime().ToString("o")
      [IO.File]::WriteAllText("$file.tmp", ($r | ConvertTo-Json -Compress -Depth 4), (New-Object Text.UTF8Encoding $false))
      Move-Item -Force "$file.tmp" $file
    }
    Start-Sleep -Milliseconds 1000
  }
  Try-Get { $lhm.Close() } | Out-Null
}
exit 0
