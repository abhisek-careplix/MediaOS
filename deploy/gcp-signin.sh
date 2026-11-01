#!/usr/bin/env bash
# Turn Google sign-in (CarePlix accounts only) on for the live VideoGen server, or off again.
#
#   ./deploy/gcp-signin.sh          asks for the OAuth client ID and secret (the secret is not shown), then turns sign-in on
#   ./deploy/gcp-signin.sh --off    back to an open site with no sign-in
#
# Before the first run, create the OAuth client (DEPLOY.md, "Google sign-in"); this script prints its redirect URI.
# The secret travels to the VM over SSH on stdin, never on a command line, and is stored only in the VM's .env.
# Settings (environment): PROJECT, REGION, ZONE, NAME as for gcp-up.sh; DOMAINS (careplix.com), DOMAIN (<ip>.sslip.io).
set -euo pipefail

PROJECT=${PROJECT:-careplix-labs}
REGION=${REGION:-us-central1}
ZONE=${ZONE:-us-central1-a}
NAME=${NAME:-videogen}
DOMAINS=${DOMAINS:-careplix.com}

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\n✗ %s\n' "$*" >&2; exit 1; }

command -v gcloud >/dev/null || die "Install the Google Cloud CLI first: brew install --cask google-cloud-sdk"
IP=$(gcloud --project "$PROJECT" compute addresses describe "$NAME-ip" --region "$REGION" --format='value(address)' 2>/dev/null) || die "No VideoGen server in $PROJECT yet: run ./deploy/gcp-up.sh first."
DOMAIN=${DOMAIN:-$(echo "$IP" | tr . -).sslip.io}

if [ "${1:-}" = "--off" ]; then
  say "Turning sign-in off: https://$DOMAIN becomes an open site again"
  CID= SECRET=
else
  say "Google sign-in for https://$DOMAIN (only $DOMAINS accounts)"
  echo "The OAuth client (Google Cloud console → Google Auth Platform → Clients, type Web application) needs:"
  echo "  Authorized redirect URI:  https://$DOMAIN/auth/google/callback"
  echo
  read -r -p "OAuth client ID: " CID
  [[ "$CID" =~ ^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$ ]] || die "That doesn't look like a client ID (it ends in .apps.googleusercontent.com)."
  read -r -s -p "OAuth client secret (hidden): " SECRET
  echo
  [ -n "$SECRET" ] || die "No client secret given."
fi

# the server-side steps travel over SSH on stdin, so the secret never appears in a command line
REMOTE=$(cat <<'SH'
set -e
cd ~/videogen
[ -f .env ] || { echo "No ~/videogen/.env on the server: run ./deploy/gcp-up.sh first." >&2; exit 1; }
setenv() { grep -v "^$1=" .env > .env.new || true; printf '%s=%s\n' "$1" "$2" >> .env.new; mv .env.new .env; }
unset_() { grep -v "^$1=" .env > .env.new || true; mv .env.new .env; }
if [ -n "$VG_CID" ]; then
  setenv GOOGLE_CLIENT_ID "$VG_CID"
  setenv GOOGLE_CLIENT_SECRET "$VG_SECRET"
  setenv ALLOWED_DOMAINS "$VG_DOMAINS"
  setenv PUBLIC_URL "https://$VG_DOMAIN"
  # keep an existing session key (changing it signs everyone out)
  grep -q '^SESSION_SECRET=.\{32,\}' .env || setenv SESSION_SECRET "$(openssl rand -hex 32)"
else
  unset_ GOOGLE_CLIENT_ID
  unset_ GOOGLE_CLIENT_SECRET
  setenv OPEN_ACCESS 1
fi
chmod 600 .env
sudo docker compose up -d
SH
)
say "Updating the server"
{ printf 'VG_CID=%q\nVG_SECRET=%q\nVG_DOMAINS=%q\nVG_DOMAIN=%q\n' "$CID" "$SECRET" "$DOMAINS" "$DOMAIN"; printf '%s\n' "$REMOTE"; } |
  gcloud --project "$PROJECT" compute ssh "$NAME" --zone "$ZONE" --quiet --command 'bash -s'

say "Checking https://$DOMAIN"
for i in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "https://$DOMAIN/api/me" || true)
  if [ -n "$CID" ] && [ "$code" = 401 ]; then say "✓ Sign-in is on: open https://$DOMAIN and sign in with your $DOMAINS Google account."; exit 0; fi
  if [ -z "$CID" ] && [ "$code" = 200 ]; then say "✓ Sign-in is off: https://$DOMAIN is open to everyone."; exit 0; fi
  sleep 3
done
die "The server didn't answer as expected (last status $code). Logs: gcloud --project $PROJECT compute ssh $NAME --zone $ZONE --command 'cd videogen && sudo docker compose logs --tail 50 videogen'"
