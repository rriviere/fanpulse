# FanPulse Azure AI infrastructure

This folder is intentionally infrastructure-only. It provisions no app hosting, GPU, AKS, Azure ML workspace, or paid capacity reservation.

## Resources

- A Microsoft Foundry `AIServices` account in `australiaeast`, with a system-assigned managed identity and key-based local authentication disabled.
- A Microsoft Foundry project named `fanpulse-dev`, with its own system-assigned managed identity.
- A `Standard_LRS` StorageV2 account with HTTPS/TLS 1.2, no anonymous Blob access, and Microsoft Entra ID/OAuth-only data-plane authentication (`allowSharedKeyAccess: false`).
- A private `football-videos` Blob container.
- A read-only `Storage Blob Data Reader` role assignment for the Foundry account's managed identity. This prepares the account for URL-based video analysis without granting write access.
- A small pay-as-you-go `gpt-5-mini` Global Standard model deployment for multimodal proof-of-concept inference. Global Standard can process inference outside Australia East even though the Foundry resource remains in Australia East.
- Keyless `Cognitive Services OpenAI User` and `Foundry User` access for the selected development principal.
- A workspace-based Application Insights resource and 30-day Log Analytics workspace in Australia East. The workspace has a 1 GB/day ingestion safety cap.
- A project-scoped Application Insights connection for Foundry traces, using the Foundry project managed identity rather than an instrumentation key.
- A single-region Azure Cosmos DB for NoSQL account in serverless mode, with one
  `fanpulse/activity` container. It stores votes and structured AI activity but
  never video frames. Local/key authentication is disabled.
- Cosmos DB Built-in Data Contributor access for the App Service managed identity
  and, when configured, the development principal.

The Foundry account and project both default to `fanpulse-dev`. The account name must be globally unique; if Azure reports that it is already taken, change only the `foundryAccountName` Bicep parameter to a unique name before retrying.

## Before provisioning

Install and authenticate the Azure CLI and Azure Developer CLI, then create the project-scoped `fanpulse-dev` environment once:

```bash
az login
azd auth login
azd config set auth.useAzCliAuth true
azd env new fanpulse-dev --subscription 49517b7e-56c6-4bd6-9b37-becfb0485544 --location australiaeast
```

`azure.yaml` permanently fixes this project to `rg-fanpulse-dev`; the `azd` environment saves its subscription and Australia East location in `.azure/fanpulse-dev/.env`. Both are picked up automatically by later `azd` commands. This local state is intentionally ignored by Git because it can contain deployment outputs.

The template automatically uses the signed-in `azd` principal where available to create a scoped `Storage Blob Data Contributor` assignment for Entra-authenticated video uploads. To opt out, clear `AZURE_PRINCIPAL_ID` before the first provision:

```bash
azd env unset AZURE_PRINCIPAL_ID
```

For observability, the project managed identity and the configured Match Analyst and Fan Engagement runtime identities receive `Monitoring Metrics Publisher` on Application Insights, while the configured developer receives `Log Analytics Reader`. Local/key-based Application Insights ingestion is disabled, and no telemetry connection string is emitted as an azd output.

Validate before creating anything:

```bash
az bicep build --file infra/main.bicep
az deployment group what-if --resource-group rg-fanpulse-dev --template-file infra/main.bicep --parameters infra/main.parameters.json
```

Only after reviewing the what-if output, run `azd provision`.

## Vision proof of concept

The backend Phase 2 utility extracts five timestamped frames from the licensed local recording and submits them to the deployed multimodal model. It uses Microsoft Entra ID and writes no credentials to disk. See the root README for the command after provisioning.

For Blob uploads, use Microsoft Entra auth, for example:

```bash
az storage blob upload --auth-mode login --account-name <storage-account-name> --container-name football-videos --name test/clip.mp4 --file ./clip.mp4
```

## Foundry traces

Open the `fanpulse-dev` project in Microsoft Foundry, select **Agents**, then
**Traces**. The project connection is named `fanpulse-appinsights`. Hosted
Foundry agent operations will appear after ingestion and role propagation,
which can take a few minutes.

The Phase 2 vision proof of concept calls the Responses API directly and is not
automatically an agent trace. Instrument application-side calls with Azure
Monitor OpenTelemetry in a later implementation phase if they also need to
appear in Application Insights.
