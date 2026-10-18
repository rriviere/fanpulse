# FanPulse Foundry agents

This directory is the version-controlled source of truth for the two persisted
Microsoft Foundry agents used by FanPulse. The Foundry portal contains deployed
versions; it does not replace the definitions checked into this repository.

1. `fanpulse-match-analyst` receives a validated multimodal observation and
   returns `MatchAssessment`: significance, rationale, and uncertainty.
2. `fanpulse-fan-engagement` receives that observation and assessment and
   returns `FanEngagementDecision`: selective UI copy and an optional poll.

Each agent is fully described by a YAML file in `definitions/`; strict response
contracts are JSON Schema files in `schemas/`. `loader.py` validates and resolves
those files. `contracts.py` contains runtime application types, while
`provider.py` owns bounded retries and two-agent orchestration. The generic
`provision.py` hashes each resolved YAML definition and schema and creates a new
immutable Foundry version only when that configuration changes.

Validate all model and agent files locally without contacting Azure:

```bash
python -m ai.provision
```

After review, publish changed agent versions with:

```bash
source .venv/bin/activate
export PYTHONPYCACHEPREFIX="$PWD/.cache/python"
set -a
source .azure/fanpulse-dev/.env
set +a
python -m ai.provision --apply
```

The normal shared-environment route is the protected **Deploy Foundry solution**
GitHub Actions workflow. The local command is retained for controlled development
and recovery. Publishing is idempotent against the latest deployed version; a
reverted definition becomes a new immutable version so rollback is explicit.

Authentication is Microsoft Entra ID via `DefaultAzureCredential`. No keys or
agent secrets are stored in this repository.
