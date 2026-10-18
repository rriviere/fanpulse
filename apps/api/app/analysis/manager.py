from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
import logging
from time import monotonic
from typing import Any, Awaitable, Callable, Protocol

from ai.agents.contracts import AgentInference, MatchAnalystDecision
from ai.foundry_errors import FoundryRateLimitError
from ai.vision.models import FootballObservation
from ai.vision.provider import VisionInference
from apps.api.app.analysis.models import AnalysisWindow, PlaybackState, SubmissionResult


class VisionProvider(Protocol):
    async def analyze(self, frames: list) -> VisionInference: ...


class AnalystProvider(Protocol):
    async def analyze(self, observation: FootballObservation, viewer_mode: str = "casual") -> AgentInference: ...


Broadcast = Callable[[dict], Awaitable[None]]


class ActivityStore(Protocol):
    def record_analysis(self, session_id: str, payload: dict[str, Any]) -> None: ...
logger = logging.getLogger("uvicorn.error")
POLL_SIGNIFICANCE_THRESHOLD = 60


@dataclass
class SessionState:
    generation: int = 0
    playing: bool = False
    position_seconds: float = 0
    pending: AnalysisWindow | None = None
    worker: asyncio.Task | None = None
    pending_agent: AgentWork | None = None
    agent_worker: asyncio.Task | None = None
    last_accepted_end: float = -1
    last_poll_at: float = -999
    poll_keys: set[str] = field(default_factory=set)


@dataclass(frozen=True)
class AgentWork:
    generation: int
    window: AnalysisWindow
    observation: FootballObservation
    vision_result: VisionInference
    started: float


class AnalysisManager:
    def __init__(
        self,
        vision: VisionProvider,
        analyst: AnalystProvider,
        broadcast: Broadcast,
        activity: ActivityStore | None = None,
    ):
        self.vision = vision
        self.analyst = analyst
        self.broadcast = broadcast
        self.activity = activity
        self.sessions: dict[str, SessionState] = {}
        self._inference_slot = asyncio.Semaphore(1)

    async def update_state(self, session_id: str, update: PlaybackState):
        state = self.sessions.setdefault(session_id, SessionState())
        if update.generation != state.generation:
            state.pending = None
            state.pending_agent = None
            state.last_accepted_end = -1
            state.poll_keys.clear()
            state.last_poll_at = -999
        state.generation = update.generation
        state.playing = update.playing
        state.position_seconds = update.position_seconds
        if not update.playing:
            state.pending = None
            state.pending_agent = None
        logger.info(
            "fanpulse playback_state session=%s generation=%d playing=%s timestamp=%.3f",
            session_id,
            update.generation,
            update.playing,
            update.position_seconds,
        )

    async def submit(self, session_id: str, window: AnalysisWindow) -> SubmissionResult:
        state = self.sessions.setdefault(session_id, SessionState())
        end = window.frames[-1].timestamp_seconds
        if not state.playing or window.generation != state.generation:
            logger.info(
                "fanpulse frames_ignored session=%s generation=%d timestamp=%.3f reason=stale_or_paused",
                session_id,
                window.generation,
                end,
            )
            return SubmissionResult(status="ignored", reason="stale_or_paused")
        if end <= state.last_accepted_end:
            logger.info(
                "fanpulse frames_ignored session=%s generation=%d timestamp=%.3f reason=duplicate_window",
                session_id,
                window.generation,
                end,
            )
            return SubmissionResult(status="ignored", reason="duplicate_window")

        replaced = state.pending is not None
        state.pending = window
        state.last_accepted_end = end
        if state.worker is None or state.worker.done():
            state.worker = asyncio.create_task(self._run(session_id, state))
        logger.info(
            "fanpulse frames_submitted session=%s generation=%d start=%.3f end=%.3f frames=%d queue=%s",
            session_id,
            window.generation,
            window.frames[0].timestamp_seconds,
            end,
            len(window.frames),
            "replaced" if replaced else "queued",
        )
        await self.broadcast({
            "type": "analysis_status",
            "session_id": session_id,
            "generation": state.generation,
            "status": "queued",
        })
        return SubmissionResult(status="replaced" if replaced else "queued")

    async def _run(self, session_id: str, state: SessionState):
        try:
            while state.pending is not None:
                window = state.pending
                state.pending = None
                generation = window.generation
                started = monotonic()
                logger.info(
                    "fanpulse analysis_started session=%s generation=%d start=%.3f end=%.3f frames=%d",
                    session_id,
                    generation,
                    window.frames[0].timestamp_seconds,
                    window.frames[-1].timestamp_seconds,
                    len(window.frames),
                )
                await self.broadcast({
                    "type": "analysis_status",
                    "session_id": session_id,
                    "generation": generation,
                    "status": "analyzing",
                })
                try:
                    frames = [frame.to_extracted_frame() for frame in window.frames]
                    async with self._inference_slot:
                        vision_result = await self.vision.analyze(frames)
                    logger.info(
                        "fanpulse vision_complete session=%s generation=%d timestamp=%.3f duration_ms=%d model=%s event=%s significant=%s",
                        session_id,
                        generation,
                        window.frames[-1].timestamp_seconds,
                        vision_result.latency_ms,
                        vision_result.model_deployment,
                        vision_result.result.observations[0].event_type,
                        vision_result.result.observations[0].is_significant,
                    )
                    if not self._is_current(state, generation, window.frames[-1].timestamp_seconds):
                        logger.info(
                            "fanpulse result_discarded session=%s generation=%d stage=vision reason=stale_playback",
                            session_id,
                            generation,
                        )
                        continue

                    observation = max(
                        vision_result.result.observations,
                        key=lambda item: (item.is_significant, item.confidence == "high"),
                    )
                    direct_result = AgentInference(
                        decision=self._vision_decision(observation),
                        latency_ms=0,
                        model_deployment=vision_result.model_deployment,
                        agent_name="vision-direct",
                    )
                    await self._deliver_result(
                        session_id, generation, window, observation, vision_result, direct_result, started
                    )
                    logger.info(
                        "fanpulse vision_delivered session=%s generation=%d timestamp=%.3f vision_ms=%d total_ms=%d",
                        session_id,
                        generation,
                        window.frames[-1].timestamp_seconds,
                        vision_result.latency_ms,
                        round((monotonic() - started) * 1000),
                    )
                    state.pending_agent = AgentWork(generation, window, observation, vision_result, started)
                    if state.agent_worker is None or state.agent_worker.done():
                        state.agent_worker = asyncio.create_task(self._run_agents(session_id, state))
                except asyncio.CancelledError:
                    raise
                except FoundryRateLimitError as exc:
                    logger.warning(
                        "fanpulse analysis_skipped session=%s generation=%d timestamp=%.3f stage=%s reason=rate_limited",
                        session_id,
                        generation,
                        window.frames[-1].timestamp_seconds,
                        exc.stage,
                    )
                    await self.broadcast({
                        "type": "analysis_status",
                        "session_id": session_id,
                        "generation": generation,
                        "status": "rate_limited",
                        "message": "Foundry is busy; this window was skipped and analysis will continue.",
                    })
                except Exception as exc:
                    logger.exception(
                        "fanpulse analysis_error session=%s generation=%d timestamp=%.3f total_ms=%d error=%s",
                        session_id,
                        generation,
                        window.frames[-1].timestamp_seconds,
                        round((monotonic() - started) * 1000),
                        str(exc)[:200],
                    )
                    await self.broadcast({
                        "type": "analysis_status",
                        "session_id": session_id,
                        "generation": generation,
                        "status": "error",
                        "message": str(exc)[:200],
                    })
        finally:
            state.worker = None

    async def _run_agents(self, session_id: str, state: SessionState):
        try:
            while state.pending_agent is not None:
                work = state.pending_agent
                state.pending_agent = None
                try:
                    agent_result = await self.analyst.analyze(work.observation, work.window.viewer_mode)
                    logger.info(
                        "fanpulse agent_complete session=%s generation=%d duration_ms=%d agent=%s publish=%s poll=%s",
                        session_id,
                        work.generation,
                        agent_result.latency_ms,
                        agent_result.agent_name,
                        agent_result.decision.publish_insight,
                        agent_result.decision.poll is not None,
                    )
                    if not self._is_current(
                        state, work.generation, work.window.frames[-1].timestamp_seconds
                    ):
                        logger.info(
                            "fanpulse result_discarded session=%s generation=%d stage=agent reason=stale_playback",
                            session_id,
                            work.generation,
                        )
                        continue
                    await self._deliver_result(
                        session_id,
                        work.generation,
                        work.window,
                        work.observation,
                        work.vision_result,
                        agent_result,
                        work.started,
                    )
                except asyncio.CancelledError:
                    raise
                except FoundryRateLimitError as exc:
                    logger.warning(
                        "fanpulse agent_skipped session=%s generation=%d stage=%s reason=rate_limited",
                        session_id,
                        work.generation,
                        exc.stage,
                    )
                    await self.broadcast({
                        "type": "analysis_status",
                        "session_id": session_id,
                        "generation": work.generation,
                        "status": "rate_limited",
                        "message": "Agent enrichment was skipped; live vision analysis will continue.",
                    })
                except Exception as exc:
                    logger.exception(
                        "fanpulse agent_error session=%s generation=%d error=%s vision_result_preserved=true",
                        session_id,
                        work.generation,
                        str(exc)[:200],
                    )
        finally:
            state.agent_worker = None

    async def _deliver_result(
        self,
        session_id: str,
        generation: int,
        window: AnalysisWindow,
        observation: FootballObservation,
        vision_result: VisionInference,
        agent_result: AgentInference,
        started: float,
    ):
        decision = self._apply_policy(state=self.sessions[session_id], observation=observation,
                                      decision=agent_result.decision)
        if not observation.is_significant:
            policy_reason = "vision_not_significant"
        elif observation.confidence == "low":
            policy_reason = "vision_low_confidence"
        elif agent_result.agent_name == "vision-direct":
            policy_reason = "vision_direct"
        elif not decision.publish_insight:
            policy_reason = (
                "match_analyst_routine"
                if agent_result.match_assessment and not agent_result.match_assessment.significant
                else "fan_engagement_suppressed"
            )
        else:
            policy_reason = "published"
        total_ms = round((monotonic() - started) * 1000)
        result_message = {
            "type": "vision_result",
            "session_id": session_id,
            "generation": generation,
            "window": {
                "start_seconds": window.frames[0].timestamp_seconds,
                "end_seconds": window.frames[-1].timestamp_seconds,
            },
            "observation": observation.model_dump(mode="json"),
            "insight": decision.model_dump(mode="json"),
            "assessment": (
                agent_result.match_assessment.model_dump(mode="json")
                if agent_result.match_assessment else None
            ),
            "policy": {
                "outcome": "published" if decision.publish_insight else "suppressed",
                "reason": policy_reason,
            },
            "latency": {
                "vision_ms": vision_result.latency_ms,
                "agent_ms": agent_result.latency_ms,
                "match_analyst_ms": agent_result.match_analyst_ms,
                "fan_engagement_ms": agent_result.fan_engagement_ms,
                "total_ms": total_ms,
            },
            "provider": {
                "vision_model": vision_result.model_deployment,
                "agent": agent_result.agent_name,
                "agents": agent_result.agents,
                "retried_stages": agent_result.retried_stages,
            },
        }
        if self.activity:
            try:
                await asyncio.to_thread(self.activity.record_analysis, session_id, result_message)
            except Exception as exc:
                logger.exception(
                    "fanpulse activity_store_error session=%s generation=%d error=%s",
                    session_id,
                    generation,
                    str(exc)[:200],
                )
        await self.broadcast(result_message)
        logger.info(
            "fanpulse analysis_complete session=%s generation=%d timestamp=%.3f vision_ms=%d agent_ms=%d total_ms=%d delivered=true provider=%s",
            session_id,
            generation,
            window.frames[-1].timestamp_seconds,
            vision_result.latency_ms,
            agent_result.latency_ms,
            total_ms,
            agent_result.agent_name,
        )

    @staticmethod
    def _is_current(state: SessionState, generation: int, window_end: float) -> bool:
        return (
            state.playing
            and state.generation == generation
            and state.position_seconds >= window_end - 2
            and state.position_seconds - window_end <= 15
        )

    @staticmethod
    def _apply_policy(
        state: SessionState,
        observation: FootballObservation,
        decision: MatchAnalystDecision,
    ) -> MatchAnalystDecision:
        if not observation.is_significant or observation.confidence == "low":
            return decision.model_copy(update={"publish_insight": False, "poll": None})
        poll = decision.poll
        if poll is not None:
            below_threshold = decision.significance < POLL_SIGNIFICANCE_THRESHOLD
            duplicate = poll.duplicate_key in state.poll_keys
            cooling_down = observation.video_timestamp_seconds - state.last_poll_at < 14
            if below_threshold or duplicate or cooling_down:
                decision = decision.model_copy(update={"poll": None})
            else:
                state.poll_keys.add(poll.duplicate_key)
                state.last_poll_at = observation.video_timestamp_seconds
        return decision

    @staticmethod
    def _vision_decision(observation: FootballObservation) -> MatchAnalystDecision:
        publish = observation.is_significant and observation.confidence != "low"
        return MatchAnalystDecision(
            publish_insight=publish,
            significance=70 if publish else 30,
            headline=observation.description[:120],
            explanation=observation.evidence[:320],
            uncertainty_note="Direct vision observation; Foundry agent enrichment may follow.",
            poll=None,
        )

    async def close(self):
        tasks = [
            task
            for state in self.sessions.values()
            for task in (state.worker, state.agent_worker)
            if task and not task.done()
        ]
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        for provider in (self.vision, self.analyst):
            close = getattr(provider, "close", None)
            if close:
                close()
