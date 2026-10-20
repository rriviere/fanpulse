# FanPulse Foundry solution

This directory is the version-controlled source of truth for the AI solution.

- `agents/` defines and provisions the Match Analyst and Fan Engagement agents.
- `models/` contains declarative Foundry model profiles and inference defaults.
- `vision/` extracts frames and invokes the multimodal Foundry model.
- `evaluations/` contains the six-case Foundry evaluation definition, labels,
  deployment code, and explicit billable runner.
- `tests/` contains local vision contract and extraction tests.

Deployed Foundry agent versions are runtime artifacts created from these files;
they are not the only copy of the prompts or schemas.

Run `python -m ai.provision` for offline validation, or add `--apply` to publish
changed agent versions and the Foundry evaluation definition after reviewing the
diff. Evaluation execution remains a separate manual, billable action.
