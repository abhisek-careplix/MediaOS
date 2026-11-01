#!/usr/bin/env bash
# The studio's Cloud Storage bucket: private (no public access, one access policy for the whole bucket), versioned so a
# changed or deleted file can be recovered for 30 days, in the VM's region, writable only by the VM's service account.
# Safe to run again; gcp-up.sh runs it on every deploy. Settings: PROJECT, REGION, ZONE, NAME as gcp-up.sh, BUCKET.
set -euo pipefail

PROJECT=${PROJECT:-careplix-labs}
REGION=${REGION:-us-central1}
ZONE=${ZONE:-us-central1-a}
NAME=${NAME:-videogen}
BUCKET=${BUCKET:-$PROJECT-studio-media}

gcloud --project "$PROJECT" --quiet services enable storage.googleapis.com
if ! gcloud --project "$PROJECT" storage buckets describe "gs://$BUCKET" >/dev/null 2>&1; then
  echo "  creating gs://$BUCKET"
  gcloud --project "$PROJECT" storage buckets create "gs://$BUCKET" --location "$REGION" --uniform-bucket-level-access --public-access-prevention
fi
LIFE=$(mktemp)
trap 'rm -f "$LIFE"' EXIT
echo '{"rule":[{"action":{"type":"Delete"},"condition":{"isLive":false,"daysSinceNoncurrentTime":30}}]}' > "$LIFE"
gcloud --project "$PROJECT" --quiet storage buckets update "gs://$BUCKET" --versioning --lifecycle-file "$LIFE" >/dev/null
# the VM's service account may read and write objects in this bucket, nothing else
SA=$(gcloud --project "$PROJECT" compute instances describe "$NAME" --zone "$ZONE" --format='value(serviceAccounts[0].email)' 2>/dev/null || true)
if [ -n "$SA" ]; then
  gcloud --project "$PROJECT" --quiet storage buckets add-iam-policy-binding "gs://$BUCKET" --member "serviceAccount:$SA" --role roles/storage.objectAdmin >/dev/null
fi
echo "  gs://$BUCKET ready (private, versioned, 30-day history${SA:+, writable by $SA})"
