# FanPulse Foundry evaluation

This evaluation runs six labelled windows from the licensed football recording
through the real multimodal model, Match Analyst agent, and Fan Engagement agent.
It measures only the three metrics most relevant to FanPulse:

- grounded observation quality, judged in Microsoft Foundry;
- correct poll creation or suppression;
- end-to-end latency.

The checked-in files contain timestamps and labels only. Video, extracted frames,
raw credentials, and generated evaluation results are not committed.

`python -m ai.provision` validates the definition and cases without contacting
Azure. `python -m ai.provision --apply` idempotently publishes the evaluation
definition alongside the agents so it appears in the Foundry Evaluation screen.

After deployment, run the billable evaluation explicitly:

```bash
source .venv/bin/activate
set -a
source .azure/fanpulse-dev/.env
set +a
python -m ai.evaluations.run
```

Alternatively, manually run the **Deploy Foundry solution** GitHub workflow. After
publishing the agents and evaluation definition, it retrieves the licensed video
from private Blob Storage, runs the evaluation, submits it to Foundry, and retains
the Markdown and JSON reports as a GitHub artifact.

