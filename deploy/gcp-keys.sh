#!/usr/bin/env bash
# Add a service key to the live CarePlix Studio server (and, if you like, to this Mac for local testing).
#
#   ./deploy/gcp-keys.sh            the fal.ai key (FAL_KEY), which turns on the "Character" video engine
#   ./deploy/gcp-keys.sh NAME       another supported key
#   ./deploy/gcp-keys.sh NAME --off remove it
#
# The key is read without being shown, travels to the VM over SSH on stdin (never on a command line), and is stored only
# in the VM's .env and, if you say so, in .env.local here (git-ignored). Settings: PROJECT, ZONE, NAME as for gcp-up.sh.
set -euo pipefail

PROJECT=${PROJECT:-careplix-labs}
ZONE=${ZONE:-us-central1-a}
NAME=${NAME:-videogen}
KEY=${1:-FAL_KEY}
SUPPORTED="FAL_KEY"
HERE=$(cd "$(dirname "$0")/.." && pwd)

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\n✗ %s\n' "$*" >&2; exit 1; }
[[ " $SUPPORTED " == *" $KEY "* ]] || die "Unsupported key $KEY (supported: $SUPPORTED)."
command -v gcloud >/dev/null || die "Install the Google Cloud CLI first: brew install --cask google-cloud-sdk"

if [ "${2:-}" = "--off" ]; then
  VALUE=
  say "Removing $KEY from the server"
else
  case $KEY in FAL_KEY) echo "The fal.ai API key (fal.ai → Dashboard → Keys). It turns on the Character video engine." ;; esac
  read -r -s -p "$KEY (hidden): " VALUE
  echo
  [ -n "$VALUE" ] || die "No key given."
fi

REMOTE=$(cat <<'SH'
set -e
cd ~/videogen
[ -f .env ] || { echo "No ~/videogen/.env on the server: run ./deploy/gcp-up.sh first." >&2; exit 1; }
grep -v "^$VG_NAME=" .env > .env.new || true
[ -n "$VG_VALUE" ] && printf '%s=%s\n' "$VG_NAME" "$VG_VALUE" >> .env.new
mv .env.new .env
chmod 600 .env
sudo docker compose up -d
SH
)
say "Updating the server"
{ printf 'VG_NAME=%q\nVG_VALUE=%q\n' "$KEY" "$VALUE"; printf '%s\n' "$REMOTE"; } |
  gcloud --project "$PROJECT" compute ssh "$NAME" --zone "$ZONE" --quiet --command 'bash -s'

if [ -n "$VALUE" ]; then
  read -r -p "Also save it on this Mac for local testing (.env.local, not committed)? [y/N] " LOCAL
  if [[ "$LOCAL" =~ ^[Yy] ]]; then
    touch "$HERE/.env.local" && chmod 600 "$HERE/.env.local"
    { grep -v "^$KEY=" "$HERE/.env.local" || true; printf '%s=%s\n' "$KEY" "$VALUE"; } > "$HERE/.env.local.new" && mv "$HERE/.env.local.new" "$HERE/.env.local"
    echo "  saved in .env.local; restart the local server to use it"
  fi
fi
if [ -n "$VALUE" ]; then say "✓ Done: $KEY is set on the server (the app restarted)."; else say "✓ Done: $KEY is removed from the server (the app restarted)."; fi
