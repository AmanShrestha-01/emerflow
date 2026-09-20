# Deploy from GitHub to Cloud Run

Every push to `main` builds the site and redeploys Cloud Run (`.github/workflows/deploy.yml`).
GitHub authenticates to Google Cloud with **Workload Identity Federation**: no service-account key is
stored anywhere. The five commands below are a one-time setup; run them yourself (they create a service
account and grant it roles, which the assistant's sandbox blocks).

**A deploy restarts the service, and the hospital lives in memory. Never push during judging.**

## One-time setup

Paste these into a terminal. `PATH` line first if `gcloud` isn't on your path.

```bash
export PATH="$HOME/google-cloud-sdk/bin:$PATH"
P=hop-hacks-509103; N=229667440524; REPO=lama9811/Emerflow.
SA=emerflow-deployer@$P.iam.gserviceaccount.com

# 1. the account GitHub will act as
gcloud iam service-accounts create emerflow-deployer --project $P \
  --display-name "EmerFlow GitHub deployer"

# 2. what it may do: deploy Cloud Run, run builds, use the source bucket and image repo
for R in roles/run.admin roles/cloudbuild.builds.builder roles/storage.admin \
         roles/artifactregistry.admin roles/iam.serviceAccountUser; do
  gcloud projects add-iam-policy-binding $P --member="serviceAccount:$SA" --role="$R" --condition=None
done

# 3. trust GitHub's OIDC tokens
gcloud iam workload-identity-pools create github-pool --project $P --location global \
  --display-name "GitHub Actions"

gcloud iam workload-identity-pools providers create-oidc github --project $P --location global \
  --workload-identity-pool github-pool --issuer-uri "https://token.actions.githubusercontent.com" \
  --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition "assertion.repository=='$REPO'"

# 4. let THIS repo (and only this repo) act as that account
gcloud iam service-accounts add-iam-policy-binding $SA --project $P \
  --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/projects/$N/locations/global/workloadIdentityPools/github-pool/attribute.repository/$REPO"

# 5. the runtime account needs Vertex AI (it already has it in this project, this is the check)
gcloud projects get-iam-policy $P --flatten="bindings[].members" \
  --filter="bindings.members:$N-compute@developer.gserviceaccount.com" --format="value(bindings.role)"
```

The provider path in the workflow is
`projects/229667440524/locations/global/workloadIdentityPools/github-pool/providers/github`.
If you create the pool or provider under different names, update that line in `.github/workflows/deploy.yml`.

## Optional

- **A different demo key:** add a repository secret `EMERFLOW_DEMO_KEY`; the workflow passes it through.
  Without it the key stays `demo`.
- **Replay instead of live Gemini:** change `EMERFLOW_MODE=live` to `replay` in the workflow.

## Checking a deploy

```bash
gcloud run services describe emerflow --project hop-hacks-509103 --region us-east4 --format="value(status.url)"
curl -s "$URL/api/health"          # the backend
curl -sN -m 5 "$URL/api/events" | head -3   # the live event stream (should print data: lines)
```

The GitHub run also prints the URL as its last step.

## What the workflow does

1. Builds `web/` (the static export FastAPI serves at `/`) and `frontend/` (DeepChart and patient links).
2. Authenticates with Workload Identity Federation.
3. `gcloud run deploy --source .`: one instance, CPU always on so the clock keeps ticking, an hour-long
   request timeout for the event stream, live Gemini mode.
