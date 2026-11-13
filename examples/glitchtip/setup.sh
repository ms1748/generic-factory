#!/usr/bin/env bash
# First start of GlitchTip next to the factory: makes .env with random secrets (never printed), asks once
# for your GlitchTip address and sender email, pulls and starts it. Safe to run again.
# Docs: docs/deploy.md, "Crash reports (GlitchTip)".
set -euo pipefail
cd "$(dirname "$0")"
if [[ ! -f .env ]]; then
  ( umask 077
    printf 'SECRET_KEY=%s\nPOSTGRES_PASSWORD=%s\nENABLE_USER_REGISTRATION=True\n' "$(openssl rand -hex 32)" "$(openssl rand -hex 24)" > .env )
  echo ".env: made (sign-up is on until your account exists; then set ENABLE_USER_REGISTRATION=False)"
fi
# Your own values, asked once: where GlitchTip is reached (https://..., no trailing slash), and the
# address its emails come from.
ask() { # key, question, example
  grep -q "^$1=." .env && return
  local value=""
  while [[ -z "$value" ]]; do read -r -p "$2 (e.g. $3): " value; done
  printf '%s=%s\n' "$1" "$value" >> .env
}
ask GLITCHTIP_DOMAIN "GlitchTip's public address" "https://crash.example.com"
ask GLITCHTIP_FROM_EMAIL "The email GlitchTip sends from" "crash@example.com"
docker compose pull -q
docker compose up -d
for i in $(seq 1 60); do
  if curl -sf -o /dev/null http://127.0.0.1:8001/_health/ || curl -sf -o /dev/null http://127.0.0.1:8001/; then echo "GlitchTip is up on 127.0.0.1:8001"; exit 0; fi
  sleep 3
done
echo "GlitchTip didn't answer in 3 minutes: docker compose logs web" >&2
exit 1
