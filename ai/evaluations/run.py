from __future__ import annotations

import argparse
import asyncio
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from statistics import median
from time import monotonic

from azure.ai.projects import AIProjectClient
from azure.identity import DefaultAzureCredential

from ai.agents.loader import get_agent_configuration
from ai.agents.provider import FoundryAgentPipeline
from ai.vision.extractor import extract_sequential_frames
from ai.vision.provider import FoundryVisionProvider

from .loader import EvaluationCase, load_evaluation
from .provision import find_evaluation


async def evaluate_case(case: EvaluationCase, video: Path, vision, agents) -> dict:
    started = monotonic()
    try:
        frames = extract_sequential_frames(video, start_seconds=case.start_seconds, count=5, interval_seconds=1)
        vision_result = await vision.analyze(frames)
        observation = vision_result.result.observations[0]
        agent_result = await agents.analyze(observation, "analyst")
        return {
            "case_id": case.id,
            "category": case.category,
            "expected_visible_event": case.expected_visible_event,
            "forbidden_claims": ", ".join(case.forbidden_claims),
            "expected_poll": str(case.expected_poll).lower(),
            "actual_poll": str(agent_result.decision.poll is not None).lower(),
            "observation": observation.model_dump_json(),
            "total_latency_ms": round((monotonic() - started) * 1000),
            "vision_latency_ms": vision_result.latency_ms,
            "agent_latency_ms": agent_result.latency_ms,
            "error": None,
        }
    except Exception as exc:
        return {
            "case_id": case.id,
            "category": case.category,
            "expected_visible_event": case.expected_visible_event,
            "forbidden_claims": ", ".join(case.forbidden_claims),
            "expected_poll": str(case.expected_poll).lower(),
            "actual_poll": "error",
            "observation": f"Evaluation pipeline error: {type(exc).__name__}",
            "total_latency_ms": round((monotonic() - started) * 1000),
            "vision_latency_ms": None,
            "agent_latency_ms": None,
            "error": f"{type(exc).__name__}: {str(exc)[:300]}",
        }


def submit_foundry_run(items: list[dict], configuration_hash: str):
    endpoint = os.environ["FOUNDRY_PROJECT_ENDPOINT"]
    with DefaultAzureCredential() as credential, AIProjectClient(endpoint=endpoint, credential=credential) as project:
        with project.get_openai_client() as openai_client:
            evaluation = find_evaluation(openai_client, configuration_hash)
            if not evaluation:
                raise RuntimeError("The checked-in evaluation is not deployed. Run `python -m ai.provision --apply` first.")
            payload = [
                {"item": {key: value for key, value in item.items() if key not in {"vision_latency_ms", "agent_latency_ms", "error"}}}
                for item in items
            ]
            run = openai_client.evals.runs.create(
                evaluation.id,
                name=f"FanPulse manual evaluation {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}",
                metadata={"managed_by": "fanpulse", "trigger": "manual"},
                data_source={"type": "jsonl", "source": {"type": "file_content", "content": payload}},
            )
            deadline = monotonic() + 900
            while run.status not in {"completed", "failed", "canceled"}:
                if monotonic() >= deadline:
                    raise TimeoutError(f"Foundry evaluation run {run.id} did not finish within 15 minutes")
                import time
                time.sleep(5)
                run = openai_client.evals.runs.retrieve(run.id, eval_id=evaluation.id)
            if run.status != "completed":
                message = run.error.message if run.error else "unknown Foundry evaluation error"
                raise RuntimeError(f"Foundry evaluation run {run.id} ended as {run.status}: {message}")
            return run


def write_reports(results_dir: Path, items: list[dict], run) -> tuple[Path, Path]:
    results_dir.mkdir(parents=True, exist_ok=True)
    poll_correct = sum(item["actual_poll"] == item["expected_poll"] for item in items)
    latencies = [item["total_latency_ms"] for item in items if item["error"] is None]
    summary = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "foundry_eval_id": run.eval_id,
        "foundry_run_id": run.id,
        "foundry_report_url": run.report_url,
        "foundry_status": run.status,
        "cases": len(items),
        "successful_pipeline_runs": sum(item["error"] is None for item in items),
        "correct_poll_decisions": poll_correct,
        "median_latency_ms": round(median(latencies)) if latencies else None,
        "foundry_result_counts": run.result_counts.model_dump() if run.result_counts else None,
        "foundry_criteria": [result.model_dump() for result in run.per_testing_criteria_results],
        "items": items,
    }
    json_path = results_dir / "latest.json"
    markdown_path = results_dir / "latest.md"
    json_path.write_text(json.dumps(summary, indent=2) + "\n")
    lines = [
        "# FanPulse evaluation result",
        "",
        f"- Cases: {len(items)}",
        f"- Successful pipeline runs: {summary['successful_pipeline_runs']}/{len(items)}",
        f"- Correct poll decisions: {poll_correct}/{len(items)}",
        f"- Median end-to-end latency: {summary['median_latency_ms']} ms",
        f"- Foundry status: {run.status}",
        f"- [Open this run in Foundry]({run.report_url})",
        "",
        "| Case | Category | Expected poll | Actual poll | Latency |",
        "|---|---|---:|---:|---:|",
    ]
    for item in items:
        lines.append(
            f"| {item['case_id']} | {item['category']} | {item['expected_poll']} | "
            f"{item['actual_poll']} | {item['total_latency_ms']} ms |"
        )
    markdown_path.write_text("\n".join(lines) + "\n")
    return markdown_path, json_path


async def run(video: Path, results_dir: Path):
    configuration, cases = load_evaluation()
    if not video.is_file():
        raise FileNotFoundError(f"Licensed evaluation video not found: {video}")
    endpoint = os.environ["FOUNDRY_PROJECT_ENDPOINT"]
    deployment = os.environ["FOUNDRY_VISION_MODEL_DEPLOYMENT"]
    vision = FoundryVisionProvider(project_endpoint=endpoint, model_deployment=deployment)
    agents = FoundryAgentPipeline(
        project_endpoint=endpoint,
        match_analyst_name=get_agent_configuration("match-analyst").resolved_name(),
        fan_engagement_name=get_agent_configuration("fan-engagement").resolved_name(),
        model_deployment=deployment,
    )
    try:
        items = []
        for case in cases:
            print(f"evaluating {case.id} at {case.start_seconds:.1f}s", flush=True)
            items.append(await evaluate_case(case, video, vision, agents))
    finally:
        vision.close()
        agents.close()
    foundry_run = await asyncio.to_thread(submit_foundry_run, items, configuration.configuration_hash(cases))
    markdown_path, json_path = write_reports(results_dir, items, foundry_run)
    print(f"Foundry evaluation: {foundry_run.report_url}")
    print(f"Reports: {markdown_path} and {json_path}")


def main():
    parser = argparse.ArgumentParser(description="Run the six-case FanPulse pipeline evaluation in Microsoft Foundry.")
    parser.add_argument("--video", type=Path, default=Path("apps/web/public/media/match.mov"))
    parser.add_argument("--results-dir", type=Path, default=Path("ai/evaluations/results"))
    args = parser.parse_args()
    asyncio.run(run(args.video, args.results_dir))


if __name__ == "__main__":
    main()

