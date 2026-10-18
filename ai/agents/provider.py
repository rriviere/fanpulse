from __future__ import annotations

import asyncio
import json
import logging
from time import perf_counter
from typing import Callable, TypeVar

from azure.ai.projects import AIProjectClient
from azure.identity import DefaultAzureCredential
from openai import APIConnectionError, APIStatusError, APITimeoutError

from ai.vision.models import FootballObservation

from .contracts import AgentInference, FanEngagementDecision, MatchAssessment
from .loader import get_agent_configuration

logger = logging.getLogger("uvicorn.error")
T = TypeVar("T")


class FoundryAgentPipeline:
    """Two persisted Foundry agents with one bounded transient retry per stage."""

    def __init__(self, *, project_endpoint: str, match_analyst_name: str | None = None,
                 fan_engagement_name: str | None = None,
                 model_deployment: str, timeout_seconds: float = 45):
        self.match_analyst_name = match_analyst_name or get_agent_configuration("match-analyst").resolved_name()
        self.fan_engagement_name = fan_engagement_name or get_agent_configuration("fan-engagement").resolved_name()
        self.model_deployment = model_deployment
        self.timeout_seconds = timeout_seconds
        self._credential = DefaultAzureCredential()
        self._project = AIProjectClient(endpoint=project_endpoint, credential=self._credential)
        self._match_client = self._project.get_openai_client(agent_name=self.match_analyst_name).with_options(max_retries=0)
        self._engagement_client = self._project.get_openai_client(agent_name=self.fan_engagement_name).with_options(max_retries=0)

    async def analyze(self, observation: FootballObservation, viewer_mode: str = "casual") -> AgentInference:
        started = perf_counter()
        assessment, match_ms, match_retried = await self._with_retry(
            "match-analyst", lambda: self._assess_sync(observation)
        )
        if not assessment.significant:
            decision = FanEngagementDecision(
                publish_insight=False,
                significance=assessment.significance,
                headline=assessment.summary[:120],
                explanation=assessment.rationale[:320],
                uncertainty_note=assessment.uncertainty_note,
                poll=None,
            )
            return AgentInference(
                decision=decision,
                latency_ms=round((perf_counter() - started) * 1000),
                model_deployment=self.model_deployment,
                agent_name=self.match_analyst_name,
                match_assessment=assessment,
                match_analyst_ms=match_ms,
                retried_stages=["match-analyst"] if match_retried else [],
                agents=[self.match_analyst_name],
            )

        decision, engagement_ms, engagement_retried = await self._with_retry(
            "fan-engagement", lambda: self._engage_sync(observation, assessment, viewer_mode)
        )
        retried = (["match-analyst"] if match_retried else []) + (["fan-engagement"] if engagement_retried else [])
        return AgentInference(
            decision=decision,
            latency_ms=round((perf_counter() - started) * 1000),
            model_deployment=self.model_deployment,
            agent_name=f"{self.match_analyst_name} → {self.fan_engagement_name}",
            match_assessment=assessment,
            match_analyst_ms=match_ms,
            fan_engagement_ms=engagement_ms,
            retried_stages=retried,
            agents=[self.match_analyst_name, self.fan_engagement_name],
        )

    async def _with_retry(self, stage: str, operation: Callable[[], T]) -> tuple[T, int, bool]:
        started = perf_counter()
        for attempt in range(2):
            try:
                result = await asyncio.wait_for(asyncio.to_thread(operation), timeout=self.timeout_seconds)
                return result, round((perf_counter() - started) * 1000), attempt == 1
            except Exception as exc:
                if attempt == 1 or not self._is_transient(exc):
                    raise
                logger.warning("fanpulse agent_retry stage=%s attempt=1 error=%s", stage, str(exc)[:200])
                await asyncio.sleep(0.75)
        raise RuntimeError("unreachable retry state")

    @staticmethod
    def _is_transient(exc: Exception) -> bool:
        if isinstance(exc, (APIConnectionError, APITimeoutError, TimeoutError, asyncio.TimeoutError)):
            return True
        return isinstance(exc, APIStatusError) and (exc.status_code == 429 or exc.status_code >= 500)

    def _assess_sync(self, observation: FootballObservation) -> MatchAssessment:
        response = self._match_client.responses.create(
            input=[{"role": "user", "content": [{"type": "input_text", "text": "Assess this validated football vision observation:\n" + observation.model_dump_json()}]}],
            store=False,
            timeout=self.timeout_seconds,
        )
        return MatchAssessment.model_validate(json.loads(response.output_text))

    def _engage_sync(self, observation: FootballObservation, assessment: MatchAssessment,
                     viewer_mode: str) -> FanEngagementDecision:
        response = self._engagement_client.responses.create(
            input=[{"role": "user", "content": [{"type": "input_text", "text": (
                f"Viewer explanation mode: {viewer_mode}. Use accessible language for casual mode and concise "
                "tactical language for analyst mode.\nValidated vision observation:\n"
                f"{observation.model_dump_json()}\nMatch Analyst assessment:\n{assessment.model_dump_json()}"
            )}]}],
            store=False,
            timeout=self.timeout_seconds,
        )
        return FanEngagementDecision.model_validate(json.loads(response.output_text))

    def close(self):
        self._match_client.close()
        self._engagement_client.close()
        self._project.close()
        self._credential.close()


FoundryMatchAnalyst = FoundryAgentPipeline
