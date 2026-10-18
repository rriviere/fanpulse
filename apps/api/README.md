# FanPulse API

The FastAPI service owns application concerns: session freshness, single-flight
analysis scheduling, policy checks, WebSockets, and votes. Foundry prompts and
providers intentionally live in `../../ai/`.

In App Service, votes and structured analysis results are persisted in serverless
Azure Cosmos DB using managed identity. Video frames are never stored. Local
development uses `apps/api/data/fanpulse.db` unless `COSMOS_ENDPOINT`,
`COSMOS_DATABASE_NAME`, and `COSMOS_CONTAINER_NAME` are present.

From the repository root:

```bash
uvicorn apps.api.app.main:app --reload --port 8000
```
