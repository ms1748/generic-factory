#!/usr/bin/env bash
# Sends this Linux machine's stats to the factory's Systems view (src/systems.ts). Read-only.
# On a Proxmox host it adds what the Proxmox API can't give: temperatures and network.
#
# Install as root (needs bash, curl, awk):
#   install -m 755 report-linux.sh /usr/local/bin/factory-report
#   mkdir -p /etc/factory-report && chmod 700 /etc/factory-report
#   printf 'NAME=<machine>\nURL=http://<factory host>:8080\nTOKEN=<DEVICE_TOKEN>\n' > /etc/factory-report/env
#   (NAME: the machine's name in Settings > Install > Machines; URL: the factory on your private network)
#   chmod 600 /etc/factory-report/env
#   factory-report            # test once
# Then a systemd timer (every minute):
#   factory-report --install-timer
set -euo pipefail

if [[ "${1:-}" == "--install-timer" ]]; then
  cat > /etc/systemd/system/factory-report.service <<'UNIT'
[Unit]
Description=Send stats to the factory dashboard
[Service]
Type=oneshot
ExecStart=/usr/local/bin/factory-report
UNIT
  cat > /etc/systemd/system/factory-report.timer <<'UNIT'
[Unit]
Description=Send stats to the factory dashboard every minute
[Timer]
OnBootSec=30
OnUnitActiveSec=60
AccuracySec=5
[Install]
WantedBy=timers.target
UNIT
  systemctl daemon-reload
  systemctl enable --now factory-report.timer
  echo "factory-report.timer on"
  exit 0
fi

# shellcheck disable=SC1091
source /etc/factory-report/env

# Counters pass 2^31; mawk (Debian's awk) prints those as 1.2e+09 unless told %.0f.
cpu_sample() { awk '/^cpu /{printf "%.0f %.0f\n", $2+$3+$4+$5+$6+$7+$8, $5+$6}' /proc/stat; }
net_sample() { awk -F'[: ]+' 'NR>2 && $2 !~ /^(lo|veth|fwpr|fwln|tap|docker|br-)/ {rx+=$3; tx+=$11} END {printf "%.0f %.0f\n", rx, tx}' /proc/net/dev; }
read -r t1 i1 < <(cpu_sample); read -r rx1 tx1 < <(net_sample)
sleep 1
read -r t2 i2 < <(cpu_sample); read -r rx2 tx2 < <(net_sample)
cpu=$(awk -v t="$((t2 - t1))" -v i="$((i2 - i1))" 'BEGIN { printf "%.4f", (t > 0 ? (t - i) / t : 0) }')

mem_total=$(awk '/^MemTotal:/{print $2 * 1024}' /proc/meminfo)
mem_avail=$(awk '/^MemAvailable:/{print $2 * 1024}' /proc/meminfo)
uptime=$(awk '{print int($1)}' /proc/uptime)
read -r l1 l5 l15 _ < /proc/loadavg

# The hottest sensor: hwmon (coretemp, k10temp, nvme) first, then thermal zones.
temp=$(cat /sys/class/hwmon/hwmon*/temp*_input /sys/class/thermal/thermal_zone*/temp 2>/dev/null | sort -n | tail -1 || true)
temp_json=""
[[ -n "$temp" ]] && temp_json=",\"temp\":$(awk -v t="$temp" 'BEGIN { printf "%.1f", t / 1000 }')"

# Which link the machine is on, if a network switcher of your own writes it (one line, say "ethernet" or
# "wifi (backup)"), shown as a fact on its card.
facts_json=""
if [[ -r /run/netswitch.status ]]; then
  net_status=$(head -c 80 /run/netswitch.status | tr -d '"\\\r\n')
  facts_json=",\"facts\":{\"Network\":\"$net_status\"}"
fi

disks=$(df -B1 -x tmpfs -x devtmpfs -x overlay -x squashfs -x efivarfs --output=target,used,size 2>/dev/null \
  | awk 'NR>1 && $3 > 1e9 { printf "%s{\"mount\":\"%s\",\"used\":%s,\"total\":%s}", (n++ ? "," : ""), $1, $2, $3 }')

os=$(. /etc/os-release && echo "$PRETTY_NAME")
cpu_model=$(awk -F': ' '/model name/{print $2; exit}' /proc/cpuinfo)
cores=$(nproc)

body=$(cat <<JSON
{"os":"$os","cpuModel":"$cpu_model","cores":$cores,"cpu":$cpu,"load":[$l1,$l5,$l15],
"memTotal":$mem_total,"memUsed":$((mem_total - mem_avail)),"uptime":$uptime,
"disks":[$disks],"net":{"rx":$((rx2 - rx1)),"tx":$((tx2 - tx1))}$temp_json$facts_json}
JSON
)

curl -fsS -m 15 -X POST "$URL/ingest/device/$NAME" -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" --data "$body" >/dev/null
[[ -t 1 ]] && echo "sent: cpu $cpu, temp ${temp:-none}"
exit 0
