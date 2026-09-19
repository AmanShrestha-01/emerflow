#!/usr/bin/env bash
# Deploy Emer Flow to Cloud Run. Usage: PROJECT=my-gcp-project ./deploy.sh
# State lives in memory, so: exactly one instance, CPU always on (the clock keeps ticking),
# long request timeout for the live event stream. Never redeploy during judging: it wipes state.
set -euo pipefail
: "${PROJECT:?set PROJECT to your Google Cloud project id}"
REGION="${REGION:-us-east4}"
gcloud run deploy emerflow \
  --project "$PROJECT" --region "$REGION" --source . \
  --min-instances 1 --max-instances 1 --no-cpu-throttling \
  --timeout 3600 --memory 1Gi \
  --set-env-vars "GOOGLE_CLOUD_PROJECT=$PROJECT,GOOGLE_CLOUD_LOCATION=global,EMERFLOW_DEMO_KEY=${DEMO_KEY:-demo}" \
  --allow-unauthenticated
