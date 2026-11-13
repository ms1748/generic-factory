#!/bin/bash
# One agent run: sign git in through the dispatcher's token file, clone the project, start Claude Code.
# stdout is Claude's stream-json only; everything else goes to stderr.
set -euo pipefail
: "${FACTORY_REPO:?}" "${FACTORY_MODEL:?}" "${FACTORY_PROMPT:?}"

git config --global user.name "${FACTORY_GIT_NAME:-factory}"
git config --global user.email "${FACTORY_GIT_EMAIL:-factory@users.noreply.github.com}"
git config --global credential.helper '!f() { echo username=x-access-token; echo "password=$(cat /run/factory/token)"; }; f'
git config --global init.defaultBranch main

if [ -n "${FACTORY_BARE:-}" ]; then cd /work && exec claude -p "$FACTORY_PROMPT" --model "$FACTORY_MODEL" --output-format stream-json --verbose; fi

git clone --quiet "https://github.com/$FACTORY_REPO.git" /work/repo >&2
cd /work/repo
if [ -n "${FACTORY_BASE:-}" ]; then
  git checkout --quiet -b "$FACTORY_BRANCH" "$FACTORY_BASE" >&2   # a new branch from an old commit (quality trials)
elif [ -n "${FACTORY_BRANCH:-}" ]; then
  git checkout --quiet "$FACTORY_BRANCH" >&2
fi
for b in ${FACTORY_FETCH:-}; do git fetch --quiet origin "$b:$b" >&2; done   # extra branches to compare

args=(-p "$FACTORY_PROMPT" --model "$FACTORY_MODEL" --output-format stream-json --verbose --dangerously-skip-permissions)
[ -n "${FACTORY_RESUME:-}" ] && args+=(--resume "$FACTORY_RESUME")
exec claude "${args[@]}"
