# GitHub delivery pipelines

FanPulse separates validation, application delivery, Foundry configuration, and Azure infrastructure:

| Workflow | Responsibility | Azure access |
| --- | --- | --- |
| `ci.yml` | Test Python, lint/build React, validate Foundry YAML/JSON Schema, compile Bicep | None |
| `deploy-application.yml` | Build and deploy the combined React/FastAPI package to App Service | OIDC, manual run |
| `deploy-foundry.yml` | Validate and publish immutable Foundry agent versions and the evaluation definition; optionally run the billable six-window evaluation | OIDC, manual run |
| `azd provision` | Create or update resources, model deployment, identities, and RBAC | Explicit local operation |

React and FastAPI share one application workflow because FastAPI serves the built React assets from the same App Service package. They are one deployable unit today; separate frontend and backend workflows would add coordination without providing independent deployment.

Neither deployment workflow runs `azd up`, provisions infrastructure, uses a publish profile, or invokes paid Foundry inference. Model deployments are Azure resources, so Bicep remains their deployment authority. Files under `ai/models/deployments/` are the version-controlled application contract for those resources.

## One-time GitHub and Azure preparation

Create a GitHub environment named `development` and add required reviewers. Create a Microsoft Entra application/service principal with a federated credential containing:

```text
issuer:   https://token.actions.githubusercontent.com
audience: api://AzureADTokenExchange
subject:  repo:OWNER/REPOSITORY:environment:development
```

Grant that service principal only:

- `Website Contributor` on the FanPulse App Service.
- `Storage Blob Data Reader` on the private `football-videos` container.
- `Foundry User` (`53ca6127-db72-4b80-b1b0-d745d6d5456d`) on the `fanpulse-dev` Foundry project.
- `Reader` on the parent Foundry account.

No client secret or App Service publish profile is required.

Configure these environment secrets:

| Secret | Meaning |
| --- | --- |
| `AZURE_CLIENT_ID` | Client ID of the federated Entra application |
| `AZURE_TENANT_ID` | Microsoft Entra tenant ID |
| `AZURE_SUBSCRIPTION_ID` | Azure subscription ID |

Configure these environment variables:

| Variable | Value |
| --- | --- |
| `AZURE_RESOURCE_GROUP` | `rg-fanpulse-dev` |
| `AZURE_WEBAPP_NAME` | Current `SERVICE_WEB_NAME` azd output |
| `AZURE_STORAGE_ACCOUNT_NAME` | Current `STORAGE_ACCOUNT_NAME` azd output |
| `FOOTBALL_VIDEOS_CONTAINER` | `football-videos` |
| `FOOTBALL_VIDEO_BLOB_NAME` | `match.mov` |
| `FOUNDRY_PROJECT_ENDPOINT` | Current `FOUNDRY_PROJECT_ENDPOINT` azd output |
| `FOUNDRY_VISION_MODEL_DEPLOYMENT` | Current `FOUNDRY_VISION_MODEL_DEPLOYMENT` azd output |

Retrieve a value locally with, for example:

```bash
azd env get-value FOUNDRY_PROJECT_ENDPOINT
```

## Licensed video

The MP4 is excluded from Git. Upload it once to the existing private container:

```bash
storage_account="$(azd env get-value STORAGE_ACCOUNT_NAME)"
container="$(azd env get-value FOOTBALL_VIDEOS_CONTAINER)"

az storage blob upload \
  --auth-mode login \
  --account-name "$storage_account" \
  --container-name "$container" \
  --name match.mov \
  --file apps/web/public/media/match.mov \
  --overwrite true
```

The web deployment downloads this blob into the immutable application ZIP and fails if the configured video is missing.

## Releases and rollback

Both deployment workflows are manual-only. Open GitHub Actions, select the
workflow, choose **Run workflow**, and retain the `main` branch. A hard workflow
condition prevents deployment from any other branch. CI continues to run on
pull requests and pushes to `main`.

The current GitHub plan does not support required-reviewer or wait-timer rules
for environments in this private repository. The `development` environment still
scopes its OIDC identity, secrets, and variables, but deployment begins as soon
as you manually run the workflow.

When a model profile changes, run and review `azd provision` first so the Bicep-managed deployment exists, then approve the waiting Foundry workflow. Agent publication cannot create or resize model infrastructure.

Web deployment artifacts are retained for 30 days. Rerun a known-good commit's workflow to roll back. Its health checks cover the API, HTML, and MP4 byte ranges without invoking Foundry.

Foundry agent versions are immutable. Revert the YAML/schema commit and run the Foundry workflow to publish that configuration as the newest version. Publishing does nothing when the latest version already has the desired configuration hash.

Real Foundry evaluation remains explicit because it uses billable inference. In
the manually triggered **Deploy Foundry solution** workflow, leave
`run_evaluation` disabled to publish only the agents and evaluation definition,
or enable it to run the six licensed video windows and upload the report. It is
never executed by pull-request validation or application deployment.
