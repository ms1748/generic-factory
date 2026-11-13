#!/usr/bin/env bash
# Builds a clean, single-commit copy of this repo's committed tree (HEAD) for a public repo, and refuses
# if anything private is left in it. It never pushes.
#
#   scripts/publish-snapshot.sh <out-dir>
#
# - Leaves out the paths in scripts/private-paths.txt (one per line, relative to the repo, globs allowed).
# - Refuses if the copy has secret-looking files or lines (its own patterns, plus gitleaks when it's
#   installed), or any value from scripts/private-values.txt: a local, git-ignored file, one value per
#   line (your email, IP addresses, host names, account IDs). Matching ignores case.
# - Also refuses if the commit's author or committer matches a private value. Set GIT_AUTHOR_NAME,
#   GIT_AUTHOR_EMAIL, GIT_COMMITTER_NAME and GIT_COMMITTER_EMAIL for the public identity.
# - On success <out-dir> is a new git repo with one commit, and the script lists what it holds. Pushing it
#   is up to you.
# - The push line it suggests uses FACTORY_PUBLIC_REPO (your public repo's URL) when that's set.
#
# Problems are reported as file:line and which rule or private value (by its line number in the values
# file), never the matched text, so the output is safe to paste.
set -euo pipefail

die() { echo "publish-snapshot: $*" >&2; exit 1; }
[[ $# -eq 1 && "$1" != -* ]] || die "usage: scripts/publish-snapshot.sh <out-dir>"

repo=$(git rev-parse --show-toplevel 2>/dev/null) || die "run it inside the factory's git checkout"
cd "$repo"
paths_file=scripts/private-paths.txt
values_file=scripts/private-values.txt

out=$(realpath -m -- "$1")
case "$out/" in "$repo"/*) die "<out-dir> must be outside this repo" ;; esac
if [[ -e "$out" ]] && [[ ! -d "$out" || -n "$(ls -A -- "$out")" ]]; then die "$out already exists and isn't empty"; fi

# The private values: required, local, never committed.
[[ -f "$values_file" ]] || die "$values_file is missing: list your private values there, one per line (see the header of this script)"
git ls-files --error-unmatch -- "$values_file" >/dev/null 2>&1 && die "$values_file is committed; remove it from git (git rm --cached) first"
git check-ignore -q -- "$values_file" || die "$values_file isn't git-ignored"
values=()
while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line%$'\r'}"
  line="${line#"${line%%[![:space:]]*}"}"; line="${line%"${line##*[![:space:]]}"}"
  values+=("$line")   # keep blanks and comments as empty slots, so numbers match the file's lines
  [[ -z "$line" || "$line" == \#* ]] && values[-1]=""
done < "$values_file"
count=0; for v in "${values[@]}"; do [[ -n "$v" ]] && count=$((count + 1)); done
(( count > 0 )) || die "$values_file has no values"

head=$(git rev-parse --short HEAD)
[[ -z "$(git status --porcelain --untracked-files=no)" ]] || echo "note: uncommitted changes aren't included; this is HEAD ($head)"

stage=$(mktemp -d)
trap 'rm -rf -- "$stage"' EXIT
git archive --format=tar HEAD | tar -x -C "$stage"

# Leave out the private paths.
if [[ -f "$paths_file" ]]; then
  shopt -s nullglob dotglob globstar
  while IFS= read -r p || [[ -n "$p" ]]; do
    p="${p%$'\r'}"; p="${p%%#*}"; p="${p#"${p%%[![:space:]]*}"}"; p="${p%"${p##*[![:space:]]}"}"; p="${p%/}"
    [[ -z "$p" ]] && continue
    [[ "$p" == /* || "/$p/" == */../* ]] && die "$paths_file: '$p' must be a path inside the repo"
    matches=()
    for m in "$stage"/$p; do [[ -e "$m" || -L "$m" ]] && matches+=("$m"); done
    if (( ${#matches[@]} == 0 )); then echo "note: $paths_file: nothing matches '$p'"; continue; fi
    rm -rf -- "${matches[@]}"
    echo "left out: $p"
  done < "$paths_file"
  shopt -u nullglob dotglob globstar
fi
rm -f -- "$stage/$values_file"

problems=()
add() { problems+=("$1"); }

# Files that hold secrets by their nature.
while IFS= read -r f; do add "${f#"$stage"/}: a secrets file (.env, key, certificate store or database)"; done < <(
  find "$stage" -type f \( -name '.env' -o -name '.env.*' ! -name '.env.example' -o -name '*.pem' -o -name '*.key' \
    -o -name '*.p12' -o -name '*.pfx' -o -name 'id_rsa*' -o -name 'id_ed25519*' -o -name '*.db' -o -name '*.sqlite' \) | sort)

# Secret-looking lines: private keys, provider tokens, and filled-in secret keys from .env.example.
patterns=(
  'private key|-----BEGIN [A-Z ]*PRIVATE KEY-----'
  'GitHub token|gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,}'
  'Anthropic key|sk-ant-[A-Za-z0-9_-]{20,}'
  'AWS key|AKIA[0-9A-Z]{16}'
  'Slack token|xox[abpors]-[A-Za-z0-9-]{10,}'
  'Discord webhook|discord(app)?\.com/api/webhooks/[0-9]+/[A-Za-z0-9_-]{20,}'
  'filled-in secret|^[[:space:]]*(export[[:space:]]+)?(CLAUDE_CODE_OAUTH_TOKEN|GH_APP_PRIVATE_KEY_B64|GH_TOKEN|WEBHOOK_SECRET|DEVICE_TOKEN|CF_API_TOKEN|CLOUDFLARE_TUNNEL_TOKEN|CF_ACCESS_CLIENT_SECRET|PVE_TOKEN|GLITCHTIP_TOKEN|SECRET_KEY|POSTGRES_PASSWORD)=[^[:space:]<$]'
)
for entry in "${patterns[@]}"; do
  name="${entry%%|*}"; re="${entry#*|}"
  while IFS= read -r hit; do add "${hit#"$stage"/}: $name"; done < <(grep -rIEn -- "$re" "$stage" | cut -d: -f1,2 || true)
done

if command -v gitleaks >/dev/null 2>&1; then
  report=$(mktemp)
  if gitleaks dir --help >/dev/null 2>&1; then
    gitleaks dir "$stage" --no-banner --redact --exit-code 2 --report-format csv --report-path "$report" >/dev/null 2>&1 && rc=0 || rc=$?
  else
    gitleaks detect --no-git --source "$stage" --no-banner --redact --exit-code 2 --report-format csv --report-path "$report" >/dev/null 2>&1 && rc=0 || rc=$?
  fi
  before=${#problems[@]}
  if (( rc == 2 )); then
    # csv: RuleID,Commit,File,SymlinkFile,Secret,Match,StartLine,...
    while IFS=, read -r rule _ file _ _ _ line _; do add "${file#"$stage"/}:$line: gitleaks $rule"; done < <(tail -n +2 "$report")
    (( ${#problems[@]} > before )) || add "gitleaks found something (no report)"
  elif (( rc != 0 )); then add "gitleaks failed to run (exit $rc)"; fi
  rm -f -- "$report"
  echo "secret scan: built-in patterns and gitleaks"
else
  echo "secret scan: built-in patterns only (gitleaks isn't installed; install it for a deeper scan)"
fi

# The snapshot's commit identity, as git would use it here; the commit below uses exactly this.
author=$(git var GIT_AUTHOR_IDENT | sed 's/ [0-9]* [-+][0-9]*$//')
committer=$(git var GIT_COMMITTER_IDENT | sed 's/ [0-9]* [-+][0-9]*$//')

# The private values, in contents and in file names.
for i in "${!values[@]}"; do
  v="${values[$i]}"; [[ -z "$v" ]] && continue
  label="private value on line $((i + 1)) of $values_file"
  while IFS= read -r hit; do add "${hit#"$stage"/}: $label"; done < <(grep -rIinF -- "$v" "$stage" | cut -d: -f1,2 || true)
  # Names are counted, not listed: listing them would print the value.
  named=$(find "$stage" -mindepth 1 -printf '%P\n' | grep -ciF -- "$v" || true)
  (( named > 0 )) && add "$named file or folder name(s): $label (find them with: find . | grep -iF '<that value>')"
  for who in author committer; do
    [[ "$who" == author ]] && ident="$author" || ident="$committer"
    if grep -qiF -- "$v" <<<"$ident"; then add "the commit's $who: $label (set GIT_AUTHOR_* and GIT_COMMITTER_* to a public identity)"; fi
  done
done

if (( ${#problems[@]} > 0 )); then
  printf '  %s\n' "${problems[@]}" >&2
  die "refused: ${#problems[@]} problem(s) above. Nothing was written to $out"
fi

mkdir -p -- "$out"
cp -a -- "$stage"/. "$out"/
git -C "$out" init -q -b main
git -C "$out" add -A
name_of() { local x="${1% <*}"; printf '%s' "$x"; }
email_of() { local x="${1##*<}"; printf '%s' "${x%>}"; }
GIT_AUTHOR_NAME=$(name_of "$author") GIT_AUTHOR_EMAIL=$(email_of "$author") \
GIT_COMMITTER_NAME=$(name_of "$committer") GIT_COMMITTER_EMAIL=$(email_of "$committer") \
  git -C "$out" commit -q -m "Factory snapshot ($(date -u +%F))"
files=$(git -C "$out" ls-files | wc -l)
echo
echo "What it would publish ($files files, from HEAD $head):"
git -C "$out" ls-files | sed 's|^|  |'
echo
echo "Ready in $out: one commit, nothing pushed. Read it through, then push it yourself, e.g."
echo "  git -C $out remote add origin ${FACTORY_PUBLIC_REPO:-<your public repo URL>} && git -C $out push -u origin main"
