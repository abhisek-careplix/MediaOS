#!/usr/bin/env bash
# Deploy VideoGen as an open website (no sign-in) on Google Cloud: one VM with Docker, HTTPS by Caddy.
# Run it again to ship updates; the server's .env and its films and brand kits are kept.
#
#   ./deploy/gcp-up.sh                                 asks for the Anthropic API key (stored only on the VM), then deploys
#   ANTHROPIC_API_KEY=sk-ant-… ./deploy/gcp-up.sh     the same, non-interactive
#   DRY_RUN=1 ./deploy/gcp-up.sh                       print what it would do, change nothing
#
# Settings (environment): PROJECT (careplix-labs), REGION (us-central1), ZONE (us-central1-a), MACHINE (e2-standard-8),
# NAME (videogen), DISK (100GB), DOMAIN (default: <ip>.sslip.io, which needs no DNS setup).
set -euo pipefail

PROJECT=${PROJECT:-careplix-labs}
REGION=${REGION:-us-central1}
ZONE=${ZONE:-us-central1-a}
MACHINE=${MACHINE:-e2-standard-8}
NAME=${NAME:-videogen}
DISK=${DISK:-100GB}
case $MACHINE in t2a-* | c4a-* | n4a-*) IMAGE_FAMILY=debian-12-arm64 ;; *) IMAGE_FAMILY=debian-12 ;; esac
HERE=$(cd "$(dirname "$0")/.." && pwd)
DRY=${DRY_RUN:-}

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\n✗ %s\n' "$*" >&2; exit 1; }
run() { echo "+ $*"; [ -n "$DRY" ] || "$@"; }
gc() { run gcloud --project "$PROJECT" --quiet "$@"; }
have() { [ -z "$DRY" ] && gcloud --project "$PROJECT" "$@" >/dev/null 2>&1; }

command -v gcloud >/dev/null || die "Install the Google Cloud CLI first: brew install --cask google-cloud-sdk"
ACCOUNT=$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | head -1)
[ -n "$ACCOUNT" ] || die "Sign in to Google Cloud first: gcloud auth login"
say "Deploying VideoGen to project $PROJECT as $ACCOUNT ($MACHINE in $ZONE)"
if [ -z "${ANTHROPIC_API_KEY:-}" ] && [ -z "$DRY" ] && [ -t 0 ]; then
  read -r -s -p "Anthropic API key for the server (hidden; press Enter to keep the server's current one): " ANTHROPIC_API_KEY
  echo
fi

say "1/7  Compute Engine API"
gc services enable compute.googleapis.com

say "2/7  Static IP address"
have compute addresses describe "$NAME-ip" --region "$REGION" || gc compute addresses create "$NAME-ip" --region "$REGION"
if [ -n "$DRY" ]; then IP=203.0.113.10; else IP=$(gcloud --project "$PROJECT" compute addresses describe "$NAME-ip" --region "$REGION" --format='value(address)'); fi
DOMAIN=${DOMAIN:-$(echo "$IP" | tr . -).sslip.io}
echo "  $IP  →  https://$DOMAIN"

say "3/7  Firewall: HTTP and HTTPS"
have compute firewall-rules describe "$NAME-web" || gc compute firewall-rules create "$NAME-web" \
  --allow tcp:80,tcp:443 --target-tags "$NAME" --description "Web traffic to VideoGen (Caddy)"

say "4/7  Virtual machine"
have compute instances describe "$NAME" --zone "$ZONE" || gc compute instances create "$NAME" --zone "$ZONE" \
  --machine-type "$MACHINE" --image-family "$IMAGE_FAMILY" --image-project debian-cloud \
  --boot-disk-size "$DISK" --boot-disk-type pd-balanced --address "$IP" --tags "$NAME"

say "5/7  Packaging the app"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
( cd "$HERE" && COPYFILE_DISABLE=1 tar czf "$TMP/videogen.tgz" --exclude '.DS_Store' \
    app Dockerfile docker-compose.yml Caddyfile .env.example .dockerignore README.md DEPLOY.md )
echo "  $(du -h "$TMP/videogen.tgz" | cut -f1) (films and brand kits on this Mac are not uploaded)"

say "6/7  Uploading and starting (the first build takes a few minutes)"
if [ -z "$DRY" ]; then
  for i in $(seq 1 30); do
    gcloud --project "$PROJECT" compute ssh "$NAME" --zone "$ZONE" --quiet --command true >/dev/null 2>&1 && break
    [ "$i" = 30 ] && die "The VM did not accept SSH after 5 minutes."
    echo "  waiting for the VM to boot…"; sleep 10
  done
fi
gc compute scp "$TMP/videogen.tgz" "$NAME:videogen.tgz" --zone "$ZONE"

# the server-side steps travel over SSH on stdin, so the API key never appears in a command line
REMOTE=$(cat <<'SH'
set -e
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sudo sh
mkdir -p ~/videogen && tar xzf ~/videogen.tgz -C ~/videogen && rm ~/videogen.tgz
cd ~/videogen
[ -f .env ] || cp .env.example .env
setenv() { if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else echo "$1=$2" >> .env; fi; }
setenv DOMAIN "$VG_DOMAIN"
setenv PUBLIC_URL "https://$VG_DOMAIN"
setenv OPEN_ACCESS 1
[ -n "$VG_KEY" ] && setenv ANTHROPIC_API_KEY "$VG_KEY"
chmod 600 .env
grep -q '^ANTHROPIC_API_KEY=.' .env || echo "! No ANTHROPIC_API_KEY on the server yet: sample films work, Claude-written scripts won't. Re-run with ANTHROPIC_API_KEY=… set."
sudo docker compose up -d --build
sudo docker compose ps
SH
)
if [ -n "$DRY" ]; then
  echo "+ gcloud compute ssh $NAME --zone $ZONE --command 'bash -s'   <<  (VG_DOMAIN=$DOMAIN, VG_KEY=${ANTHROPIC_API_KEY:+<set>})"
  printf '%s\n' "$REMOTE" | sed 's/^/    /'
else
  { printf 'VG_DOMAIN=%q\nVG_KEY=%q\n' "$DOMAIN" "${ANTHROPIC_API_KEY:-}"; printf '%s\n' "$REMOTE"; } |
    gcloud --project "$PROJECT" compute ssh "$NAME" --zone "$ZONE" --quiet --command 'bash -s'
fi

say "7/7  Waiting for https://$DOMAIN"
if [ -z "$DRY" ]; then
  for i in $(seq 1 60); do
    curl -fsS -o /dev/null "https://$DOMAIN/api/me" 2>/dev/null && { say "✓ VideoGen is live: https://$DOMAIN"; break; }
    [ "$i" = 60 ] && { echo "Not answering yet. Watch the logs:"; echo "  gcloud --project $PROJECT compute ssh $NAME --zone $ZONE --command 'cd videogen && sudo docker compose logs -f'"; exit 1; }
    sleep 10
  done
fi
echo "Logs:     gcloud --project $PROJECT compute ssh $NAME --zone $ZONE --command 'cd videogen && sudo docker compose logs -f videogen'"
echo "Settings: gcloud --project $PROJECT compute ssh $NAME --zone $ZONE   then edit ~/videogen/.env and run: cd videogen && sudo docker compose up -d"
echo "Remove:   ./deploy/gcp-down.sh"
