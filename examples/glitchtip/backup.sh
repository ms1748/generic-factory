#!/usr/bin/env bash
# Nightly GlitchTip database dump, from cron (03:00 suggested). A host backup that
# skips Docker's storage keeps the database only through these dumps in ./backups next to this file
# (7 kept). Restore: `gunzip -c <dump> | docker compose exec -T postgres psql -U glitchtip glitchtip`
# into an empty database (docs/deploy.md, "Crash reports (GlitchTip)").
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p backups
chmod 700 backups
out="backups/glitchtip-$(date +%F).sql.gz"
docker compose exec -T postgres pg_dump -U glitchtip --no-owner glitchtip | gzip -9 > "$out.part"
# An empty or tiny dump means pg_dump failed partway; keep the old ones and say so.
if [[ $(stat -c %s "$out.part") -lt 1024 ]]; then rm -f "$out.part"; echo "glitchtip backup: dump too small, kept the old ones" >&2; exit 1; fi
mv "$out.part" "$out"
chmod 600 "$out"
ls -1t backups/glitchtip-*.sql.gz | tail -n +8 | xargs -r rm -f
echo "glitchtip backup: $out ($(du -h "$out" | cut -f1))"
