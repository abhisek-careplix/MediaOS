#!/usr/bin/env bash
# Remove the VideoGen deployment from Google Cloud: the VM (with its films and brand kits), the static IP and the firewall rule.
#   ./deploy/gcp-down.sh
set -euo pipefail
PROJECT=${PROJECT:-careplix-labs}
REGION=${REGION:-us-central1}
ZONE=${ZONE:-us-central1-a}
NAME=${NAME:-videogen}

echo "This deletes, in project $PROJECT:"
echo "  - VM $NAME ($ZONE), including every film and brand kit stored on it"
echo "  - static IP $NAME-ip ($REGION)"
echo "  - firewall rule $NAME-web"
read -r -p "Type the VM name to confirm: " answer
[ "$answer" = "$NAME" ] || { echo "Cancelled."; exit 1; }

gcloud --project "$PROJECT" --quiet compute instances delete "$NAME" --zone "$ZONE" || true
gcloud --project "$PROJECT" --quiet compute addresses delete "$NAME-ip" --region "$REGION" || true
gcloud --project "$PROJECT" --quiet compute firewall-rules delete "$NAME-web" || true
echo "Removed."
