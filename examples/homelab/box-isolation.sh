#!/bin/bash
# Keeps a test box (anything that gets a DHCP address in BOX on the Proxmox host's NAT bridge) off the
# home network and away from the host. A test box runs code from pull requests, so it gets the internet
# and nothing else:
#   - no home LAN (192.168.0.0/16, 172.16.0.0/12, other 10.x): no file shares, no router admin page, no
#     Proxmox web UI on its LAN address;
#   - no tailnet addresses (the tailnet policy already blocks it; this is a second lock);
#   - nothing on this host except DHCP and ping (no Proxmox UI, no SSH).
# Still allowed: the internet (GitHub, downloads), the rest of the bridge (the factory's stats port is
# there), and replies to connections made *to* the box (your SSH or remote desktop over Tailscale).
#
# Edit BOX and BRIDGE_NET below for your network, then run once on the Proxmox host as root:
#   bash box-isolation.sh
# It installs itself as box-isolation.service so the rules come back after a reboot.
# Undo: systemctl disable --now box-isolation; bash box-isolation.sh --remove
set -euo pipefail
BOX=10.20.0.50-10.20.0.69     # the DHCP range the test box gets its address from
BRIDGE_NET=10.20.0.0/24       # the NAT bridge the factory and the box share

remove() {
  iptables -D FORWARD -m iprange --src-range "$BOX" -j box-isolate 2>/dev/null || true
  iptables -D INPUT -m iprange --src-range "$BOX" -j box-isolate-in 2>/dev/null || true
  iptables -F box-isolate 2>/dev/null || true; iptables -X box-isolate 2>/dev/null || true
  iptables -F box-isolate-in 2>/dev/null || true; iptables -X box-isolate-in 2>/dev/null || true
}

apply() {
  remove
  iptables -N box-isolate
  iptables -A box-isolate -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
  iptables -A box-isolate -d "$BRIDGE_NET" -j RETURN
  # Tailscale's direct (WireGuard) path to peers on the home network; the tailnet policy still decides
  # what the box may reach inside it. Without this, remote desktop to the box falls back to a slow relay.
  iptables -A box-isolate -p udp --dport 41641 -d 192.168.0.0/16 -j RETURN
  for net in 192.168.0.0/16 172.16.0.0/12 10.0.0.0/8 100.64.0.0/10 169.254.0.0/16; do
    iptables -A box-isolate -d "$net" -j DROP
  done
  iptables -I FORWARD 1 -m iprange --src-range "$BOX" -j box-isolate

  iptables -N box-isolate-in
  iptables -A box-isolate-in -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
  iptables -A box-isolate-in -p udp --dport 67 -j RETURN
  iptables -A box-isolate-in -p icmp -j RETURN
  iptables -A box-isolate-in -j DROP
  iptables -I INPUT 1 -m iprange --src-range "$BOX" -j box-isolate-in
}

case "${1:-}" in
  --remove) remove; echo "Box isolation rules removed."; exit 0 ;;
  --apply) apply; exit 0 ;;
esac

[ "$(id -u)" = 0 ] || { echo "Run as root."; exit 1; }
install -m 755 "$0" /usr/local/sbin/box-isolation
cat > /etc/systemd/system/box-isolation.service <<'UNIT'
[Unit]
Description=Keep the test box off the home network
After=network-online.target pve-firewall.service tailscaled.service
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/sbin/box-isolation --apply
ExecStop=/usr/local/sbin/box-isolation --remove

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now box-isolation.service
systemctl restart box-isolation.service
echo "Done. Box isolation is on and comes back after reboots."
iptables -S box-isolate
