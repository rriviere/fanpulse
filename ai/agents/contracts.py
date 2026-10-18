from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, model_validator


class AgentPollOption(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(pattern=r"^[a-z0-9-]{1,32}$")
    label: str = Field(min_length=1, max_length=100)


class AgentPoll(BaseModel):
    model_config = ConfigDict(extra="forbid")

    question: str = Field(min_length=1, max_length=180)
    options: list[AgentPollOption] = Field(min_length=2, max_length=4)
    duplicate_key: str = Field(min_length=3, max_length=100, pattern=r"^[a-z0-9-]+$")

    @model_validator(mode="after")
    def reject_placeholder_key(self):
        if self.duplicate_key in {"duplicate-key", "poll-key", "placeholder"}:
            raise ValueError("duplicate_key must describe the observed moment")
        return self


class MatchAssessment(BaseModel):
    model_config = ConfigDict(extra="forbid")

    significant: bool
    significance: int = Field(ge=0, le=100)
    summary: str = Field(min_length=1, max_length=160)
    rationale: str = Field(min_length=1, max_length=320)
    uncertainty_note: str | None = Field(default=None, max_length=200)

    @model_validator(mode="after")
    def enforce_significance(self):
        if not self.significant and self.significance >= 70:
            raise ValueError("non-significant assessments must score below 70")
        return self


class FanEngagementDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")

    publish_insight: bool
    significance: int = Field(ge=0, le=100)
    headline: str = Field(min_length=1, max_length=120)
    explanation: str = Field(min_length=1, max_length=320)
    uncertainty_note: str | None = Field(default=None, max_length=200)
    poll: AgentPoll | None = None

    @model_validator(mode="after")
    def enforce_poll_threshold(self):
        if self.poll is not None and (not self.publish_insight or self.significance < 70):
            raise ValueError("polls require a published insight with significance >= 70")
        return self


MatchAnalystDecision = FanEngagementDecision


class AgentInference(BaseModel):
    decision: FanEngagementDecision
    latency_ms: int = Field(ge=0)
    model_deployment: str
    agent_name: str
    match_assessment: MatchAssessment | None = None
    match_analyst_ms: int = Field(default=0, ge=0)
    fan_engagement_ms: int = Field(default=0, ge=0)
    retried_stages: list[str] = Field(default_factory=list)
    agents: list[str] = Field(default_factory=list)
