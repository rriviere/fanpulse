from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, model_validator

from ai.models.loader import ModelProfile, load_model_profiles


ROOT = Path(__file__).resolve().parent


class GroundingCriterion(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1)
    labels: list[str] = Field(min_length=2)
    passing_labels: list[str] = Field(min_length=1)
    instructions: str = Field(min_length=1)


class PollDecisionCriterion(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1)


class EvaluationConfiguration(BaseModel):
    model_config = ConfigDict(extra="forbid", arbitrary_types_allowed=True)

    id: str = Field(pattern=r"^[a-z0-9-]+$")
    name: str = Field(min_length=1, max_length=64)
    description: str = Field(min_length=1, max_length=512)
    judge_model: str
    grounding: GroundingCriterion
    poll_decision: PollDecisionCriterion
    model: ModelProfile
    source_path: Path
    cases_path: Path

    def configuration_hash(self, cases: list[EvaluationCase]) -> str:
        payload = {
            "configuration": self.model_dump(
                mode="json",
                exclude={"model", "source_path", "cases_path"},
            ),
            "judge_deployment": self.model.deployment_name(),
            "cases": [case.model_dump(mode="json") for case in cases],
        }
        return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


class EvaluationCase(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(pattern=r"^[a-z0-9-]+$")
    category: Literal["routine", "significant", "ambiguous"]
    start_seconds: float = Field(ge=0)
    expected_visible_event: str = Field(min_length=1, max_length=500)
    expected_poll: bool
    forbidden_claims: list[str] = Field(min_length=1)

    @model_validator(mode="after")
    def significant_cases_expect_polls(self):
        if (self.category == "significant") != self.expected_poll:
            raise ValueError("only significant evaluation cases should expect a poll")
        return self


def load_evaluation() -> tuple[EvaluationConfiguration, list[EvaluationCase]]:
    definition_path = ROOT / "definition.yaml"
    cases_path = ROOT / "cases.yaml"
    definition = yaml.safe_load(definition_path.read_text())
    case_document = yaml.safe_load(cases_path.read_text())
    models = load_model_profiles()
    model_id = definition["judge_model"]
    if model_id not in models:
        raise ValueError(f"Unknown evaluation judge model profile: {model_id}")
    configuration = EvaluationConfiguration(
        **definition,
        model=models[model_id],
        source_path=definition_path,
        cases_path=cases_path,
    )
    cases = [EvaluationCase.model_validate(item) for item in case_document.get("cases", [])]
    if len(cases) != 6:
        raise ValueError("FanPulse evaluation must contain exactly six cases")
    if len({case.id for case in cases}) != len(cases):
        raise ValueError("Evaluation case IDs must be unique")
    counts = {category: sum(case.category == category for case in cases) for category in ("routine", "significant", "ambiguous")}
    if counts != {"routine": 2, "significant": 2, "ambiguous": 2}:
        raise ValueError("Evaluation requires two routine, two significant, and two ambiguous cases")
    return configuration, cases

