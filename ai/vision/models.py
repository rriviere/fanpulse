from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


EventType = Literal[
    "attacking_sequence",
    "attacking_pressure",
    "counterattack",
    "dangerous_movement",
    "potential_shot",
    "defensive_transition",
    "team_shape_change",
    "sustained_momentum",
    "unusual_moment",
    "no_significant_event",
    "unknown",
]
Confidence = Literal["low", "medium", "high"]
EvidenceBasis = Literal["directly_visible", "reasonable_interpretation", "insufficient_evidence"]


class FootballObservation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    video_timestamp_seconds: float = Field(ge=0)
    event_type: EventType
    team: str = Field(min_length=1, max_length=40, description="Visible kit colour or 'unknown'; never infer identity.")
    description: str = Field(min_length=1, max_length=300)
    evidence: str = Field(min_length=1, max_length=400)
    evidence_basis: EvidenceBasis
    confidence: Confidence
    is_significant: bool

    @model_validator(mode="after")
    def unknown_results_are_not_significant(self):
        if self.event_type in {"unknown", "no_significant_event"} and self.is_significant:
            raise ValueError("unknown and no_significant_event observations cannot be significant")
        return self


class VisionBatchResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    observations: list[FootballObservation] = Field(min_length=1, max_length=5)
    limitations: list[str] = Field(default_factory=list, max_length=5)
