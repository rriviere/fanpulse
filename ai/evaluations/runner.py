from __future__ import annotations

import argparse
import hashlib
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path

import yaml
from azure.ai.projects import AIProjectClient
from azure.identity import DefaultAzureCredential

ROOT = Path(__file__).resolve().parent
REQUIRED_FIELDS = {
    "case_id",
    "category",
    "expected_grounded",
    "actual_grounded",
    "expected_poll",
    "actual_poll",
    "observation",
}


def load_evaluation() -> tuple[dict, list[dict], str]:
    definition = yaml.safe_load((ROOT / "evaluation.yaml").read_text())
    dataset_path = ROOT / definition["dataset"]
    items = [json.loads(line) for line in dataset_path.read_text().splitlines() if line.strip()]
    if not items:
        raise ValueError("Evaluation dataset is empty")
    for line_number, item in enumerate(items, 1):
        missing = REQUIRED_FIELDS - item.keys()
        extra = item.keys() - REQUIRED_FIELDS
        if missing or extra:
            raise ValueError(f"Invalid dataset line {line_number}: missing={sorted(missing)}, extra={sorted(extra)}")
        boolean_fields = ("expected_grounded", "actual_grounded", "expected_poll", "actual_poll")
        if any(item[field] not in {"true", "false"} for field in boolean_fields):
            raise ValueError(f"Invalid boolean value on dataset line {line_number}")
    digest = hashlib.sha256(
        json.dumps({"definition": definition, "items": items}, sort_keys=True).encode()
    ).hexdigest()
    return definition, items, digest


def _criteria(definition: dict) -> list[dict]:
    return definition["testing_criteria"]


def _schema() -> dict:
    return {
        "type": "object",
        "properties": {field: {"type": "string"} for field in sorted(REQUIRED_FIELDS)},
        "required": sorted(REQUIRED_FIELDS),
        "additionalProperties": False,
    }


def _find(openai_client, digest: str):
    evaluations = openai_client.evals.list(limit=100, order="desc", order_by="created_at")
    return next(
        (
            evaluation
            for evaluation in evaluations.data
            if (evaluation.metadata or {}).get("managed_by") == "fanpulse"
            and (evaluation.metadata or {}).get("configuration_sha256") == digest
        ),
        None,
    )


def publish(openai_client, definition: dict, digest: str):
    existing = _find(openai_client, digest)
    if existing:
        return existing, "unchanged"
    evaluation = openai_client.evals.create(
        name=f"{definition['name']} {digest[:8]}",
        metadata={
            "managed_by": "fanpulse",
            "configuration_sha256": digest,
            "definition_file": "evaluation.yaml",
            "dataset_file": definition["dataset"],
        },
        data_source_config={"type": "custom", "item_schema": _schema()},
        testing_criteria=_criteria(definition),
    )
    return evaluation, "created"


def provision_evaluation() -> dict[str, str]:
    definition, _, digest = load_evaluation()
    with DefaultAzureCredential() as credential, AIProjectClient(
        endpoint=os.environ["FOUNDRY_PROJECT_ENDPOINT"], credential=credential
    ) as project, project.get_openai_client() as openai_client:
        evaluation, status = publish(openai_client, definition, digest)
        return {"id": evaluation.id, "name": evaluation.name, "status": status}


def run_evaluation(results_dir: Path = ROOT / "results") -> dict:
    definition, items, digest = load_evaluation()
    with DefaultAzureCredential() as credential, AIProjectClient(
        endpoint=os.environ["FOUNDRY_PROJECT_ENDPOINT"], credential=credential
    ) as project, project.get_openai_client() as openai_client:
        evaluation, _ = publish(openai_client, definition, digest)
        run = openai_client.evals.runs.create(
            evaluation.id,
            name=f"FanPulse dataset evaluation {datetime.now(timezone.utc):%Y-%m-%d %H:%M UTC}",
            metadata={"managed_by": "fanpulse", "trigger": "deployment"},
            data_source={
                "type": "jsonl",
                "source": {"type": "file_content", "content": [{"item": item} for item in items]},
            },
        )
        deadline = time.monotonic() + 600
        while run.status not in {"completed", "failed", "canceled"}:
            if time.monotonic() >= deadline:
                raise TimeoutError(f"Foundry evaluation run {run.id} exceeded 10 minutes")
            time.sleep(5)
            run = openai_client.evals.runs.retrieve(run.id, eval_id=evaluation.id)
        if run.status != "completed":
            message = run.error.message if run.error else "unknown Foundry evaluation error"
            raise RuntimeError(f"Foundry evaluation run {run.id} ended as {run.status}: {message}")

    summary = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "foundry_eval_id": run.eval_id,
        "foundry_run_id": run.id,
        "foundry_report_url": run.report_url,
        "status": run.status,
        "cases": len(items),
        "result_counts": run.result_counts.model_dump() if run.result_counts else None,
        "criteria": [result.model_dump() for result in run.per_testing_criteria_results],
    }
    results_dir.mkdir(parents=True, exist_ok=True)
    (results_dir / "latest.json").write_text(json.dumps(summary, indent=2) + "\n")
    (results_dir / "latest.md").write_text(
        "# FanPulse evaluation result\n\n"
        f"- Cases: {len(items)}\n"
        f"- Foundry status: {run.status}\n"
        f"- [Open this run in Foundry]({run.report_url})\n"
    )
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate or run the static FanPulse Foundry evaluation.")
    parser.add_argument("--run", action="store_true", help="Publish and run the dataset in Foundry")
    args = parser.parse_args()
    definition, items, _ = load_evaluation()
    print(f"valid evaluation: {definition['id']} ({len(items)} static cases)")
    if args.run:
        result = run_evaluation()
        print(f"Foundry evaluation: {result['foundry_report_url']}")


if __name__ == "__main__":
    main()
