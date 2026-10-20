from __future__ import annotations

import os

from azure.ai.projects import AIProjectClient
from azure.identity import DefaultAzureCredential

from .loader import EvaluationConfiguration, load_evaluation


ITEM_SCHEMA = {
    "type": "object",
    "properties": {
        "case_id": {"type": "string"},
        "category": {"type": "string"},
        "expected_visible_event": {"type": "string"},
        "forbidden_claims": {"type": "string"},
        "expected_poll": {"type": "string", "enum": ["true", "false"]},
        "actual_poll": {"type": "string", "enum": ["true", "false", "error"]},
        "observation": {"type": "string"},
        "total_latency_ms": {"type": "number"},
    },
    "required": [
        "case_id",
        "category",
        "expected_visible_event",
        "forbidden_claims",
        "expected_poll",
        "actual_poll",
        "observation",
        "total_latency_ms",
    ],
    "additionalProperties": False,
}


def build_testing_criteria(configuration: EvaluationConfiguration) -> list[dict]:
    grounding = configuration.grounding
    return [
        {
            "type": "label_model",
            "name": grounding.name,
            "model": configuration.model.deployment_name(),
            "labels": grounding.labels,
            "passing_labels": grounding.passing_labels,
            "input": [
                {"role": "system", "content": grounding.instructions},
                {
                    "role": "user",
                    "content": (
                        "Expected visible scene: {{ item.expected_visible_event }}\n"
                        "Forbidden claims: {{ item.forbidden_claims }}\n"
                        "Actual observation: {{ item.observation }}"
                    ),
                },
            ],
        },
        {
            "type": "string_check",
            "name": configuration.poll_decision.name,
            "operation": "eq",
            "input": "{{ item.actual_poll }}",
            "reference": "{{ item.expected_poll }}",
        },
    ]


def find_evaluation(openai_client, configuration_hash: str):
    page = openai_client.evals.list(limit=100, order="desc", order_by="created_at")
    return next(
        (
            evaluation
            for evaluation in page.data
            if (evaluation.metadata or {}).get("managed_by") == "fanpulse"
            and (evaluation.metadata or {}).get("configuration_sha256") == configuration_hash
        ),
        None,
    )


def provision_evaluation() -> dict[str, str]:
    configuration, cases = load_evaluation()
    configuration_hash = configuration.configuration_hash(cases)
    endpoint = os.environ["FOUNDRY_PROJECT_ENDPOINT"]
    with DefaultAzureCredential() as credential, AIProjectClient(endpoint=endpoint, credential=credential) as project:
        with project.get_openai_client() as openai_client:
            existing = find_evaluation(openai_client, configuration_hash)
            if existing:
                return {"id": existing.id, "name": existing.name, "status": "unchanged"}
            created = openai_client.evals.create(
                name=f"{configuration.name} {configuration_hash[:8]}",
                metadata={
                    "managed_by": "fanpulse",
                    "configuration_sha256": configuration_hash,
                    "definition_file": configuration.source_path.name,
                    "cases_file": configuration.cases_path.name,
                },
                data_source_config={"type": "custom", "item_schema": ITEM_SCHEMA},
                testing_criteria=build_testing_criteria(configuration),
            )
            return {"id": created.id, "name": created.name, "status": "created"}

