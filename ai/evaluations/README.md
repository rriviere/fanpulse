# FanPulse evaluation

This is a deliberately small, static Foundry evaluation:

- `evaluation.yaml` declares the judge model and two criteria.
- `dataset.jsonl` contains six representative outputs captured from the real
  FanPulse video pipeline.
- `runner.py` validates, publishes, and runs the dataset through Foundry.

It measures observation grounding and correct poll decisions. It does not
download the video or call the vision and agent pipeline, keeping CI reliable
and inexpensive.

Validate locally:

```bash
python -m ai.evaluations.runner
```

The manually triggered **Deploy Foundry solution** workflow publishes and runs
the evaluation automatically. Its report is visible in Foundry and retained as
a GitHub Actions artifact.
