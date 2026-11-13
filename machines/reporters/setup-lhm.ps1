<#
  CPU temperature, power, clocks and fan speeds for the stats reporter (report-windows.ps1), from
  LibreHardwareMonitor (MPL-2.0, https://github.com/LibreHardwareMonitor/LibreHardwareMonitor). Windows itself
  has no CPU temperature reading on many PCs (no ACPI thermal zone, or one that is a board sensor, not the
  CPU).

  What it installs (an elevated PowerShell, once per PC):
    - LibreHardwareMonitor v0.9.6's .NET Framework build, the official GitHub release zip
      (LibreHardwareMonitor.zip, 6,632,626 bytes, SHA-256 086d9f1b...c001, checked before anything is
      unpacked), into C:\Program Files\LibreHardwareMonitor. Only its library is used: the reporter (the
      "Factory stats" task, as SYSTEM) loads LibreHardwareMonitorLib.dll. The LHM app is never started, so
      its web server, update check and tray icon never run, and nothing starts with Windows.
    - Reading the sensors needs a kernel driver. v0.9.5 and later use PawnIO (namazso, signed, with small
      reviewed modules; https://pawnio.eu), not the old WinRing0 driver that Windows Defender flags as
      vulnerable. This script only checks that PawnIO is installed; if it isn't, it says how to install it
      (`winget install --id namazso.PawnIO -e`), which the owner does by hand.
  Nothing is sent anywhere: the readings go into the reporter's report to the factory's own address, and
  once a second into C:\ProgramData\FactorySensors\sensors.json for the project's test runs on the PC.

    .\setup-lhm.ps1              install (or update) and print one reading
    .\setup-lhm.ps1 -Check       print one reading only
    .\setup-lhm.ps1 -Uninstall   remove C:\Program Files\LibreHardwareMonitor and C:\ProgramData\FactorySensors
                                 (PawnIO stays: remove it in Settings > Apps if nothing else uses it)
#>
param([switch]$Check, [switch]$Uninstall)
$ErrorActionPreference = "Stop"
$version = "v0.9.6"
$url = "https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/releases/download/$version/LibreHardwareMonitor.zip"
$sha256 = "086d9f1b5a99e643edc2cfaaac16051685b551e4c5ac0b32a57c58c0e529c001"
$dir = Join-Path $env:ProgramFiles "LibreHardwareMonitor"
$sensors = Join-Path $env:ProgramData "FactorySensors"

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw "Run this from an elevated PowerShell (Run as administrator)" }

if ($Uninstall) {
  Remove-Item -Recurse -Force $dir, $sensors -ErrorAction SilentlyContinue
  "Removed $dir and $sensors. The reporter goes back to no CPU temperature on its next run."
  return
}

if (-not $Check) {
  $zip = Join-Path $env:TEMP "LibreHardwareMonitor-$version.zip"
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $zip
  $got = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
  if ($got -ne $sha256) { Remove-Item $zip; throw "The download's SHA-256 is $got, not $sha256; nothing was installed" }
  $stage = Join-Path $env:TEMP "lhm-$version"
  Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
  Expand-Archive $zip $stage
  $lib = Get-ChildItem $stage -Recurse -Filter LibreHardwareMonitorLib.dll | Select-Object -First 1
  if (-not $lib) { throw "No LibreHardwareMonitorLib.dll in the release zip" }
  # The library and what it loads, flat in one folder (Program Files: only administrators can change it).
  Remove-Item -Recurse -Force $dir -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force $dir | Out-Null
  Copy-Item -Recurse -Force (Join-Path $lib.DirectoryName "*") $dir
  Remove-Item -Recurse -Force $stage, $zip
  "Installed LibreHardwareMonitor $version's library in $dir"
}

$pawn = Get-Service PawnIO -ErrorAction SilentlyContinue
if (-not $pawn) {
  "PawnIO isn't installed, so the CPU sensors can't be read yet. Install it (signed driver, ~1 MB):"
  "  winget install --id namazso.PawnIO -e"
  return
}
"PawnIO: $($pawn.Status)"

Add-Type -Path (Join-Path $dir "LibreHardwareMonitorLib.dll")
$c = New-Object LibreHardwareMonitor.Hardware.Computer
$c.IsCpuEnabled = $true
$c.IsMotherboardEnabled = $true
$c.Open()
foreach ($hw in $c.Hardware) {
  $hw.Update()
  foreach ($sub in $hw.SubHardware) { $sub.Update() }
  foreach ($s in @($hw.Sensors) + @($hw.SubHardware | ForEach-Object { $_.Sensors })) {
    if ($s -and $null -ne $s.Value -and "$($s.SensorType)" -in "Temperature", "Power", "Clock", "Fan") { "{0,-12} {1,-28} {2,8:N1}" -f $s.SensorType, $s.Name, $s.Value }
  }
}
$c.Close()
"The stats reporter picks these up on its next run (within a minute)."
