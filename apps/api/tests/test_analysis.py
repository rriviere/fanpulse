import asyncio
import base64
import unittest

from ai.agents.contracts import AgentInference, AgentPoll, AgentPollOption, MatchAnalystDecision, MatchAssessment
from ai.vision.models import FootballObservation, VisionBatchResult
from ai.vision.provider import VisionInference
from apps.api.app.analysis.manager import AnalysisManager, SessionState
from apps.api.app.analysis.models import AnalysisWindow, BrowserFrame, PlaybackState


JPEG = b"\xff\xd8\xff\xd9"
DATA_URL = "data:image/jpeg;base64," + base64.b64encode(JPEG).decode()


def observation(timestamp: float = 4) -> FootballObservation:
    return FootballObservation(
        video_timestamp_seconds=timestamp,
        event_type="attacking_pressure",
        team="green",
        description="Green players advance near the penalty area.",
        evidence="Three green shirts move forward while dark shirts retreat.",
        evidence_basis="directly_visible",
        confidence="high",
        is_significant=True,
    )


def window(generation: int, start: int) -> AnalysisWindow:
    return AnalysisWindow(
        generation=generation,
        frames=[BrowserFrame(timestamp_seconds=start + i, data_url=DATA_URL) for i in range(5)],
    )


class MockVision:
    def __init__(self, gate: asyncio.Event | None = None):
        self.gate = gate
        self.calls: list[float] = []

    async def analyze(self, frames):
        self.calls.append(frames[-1].timestamp_seconds)
        if self.gate:
            await self.gate.wait()
        item = observation(frames[-1].timestamp_seconds)
        return VisionInference(
            result=VisionBatchResult(observations=[item]),
            latency_ms=10,
            input_tokens=1,
            output_tokens=1,
            model_deployment="mock-vision",
        )


class MockAnalyst:
    async def analyze(self, item, viewer_mode="casual"):
        return AgentInference(
            decision=MatchAnalystDecision(
                publish_insight=True,
                significance=80,
                headline="Pressure building",
                explanation="Green are advancing, based on the visible frame sequence.",
                uncertainty_note=None,
                poll=AgentPoll(
                    question="Will this pressure create a chance?",
                    options=[
                        AgentPollOption(id="yes", label="Likely"),
                        AgentPollOption(id="no", label="Defence will recover"),
                    ],
                    duplicate_key="green-pressure",
                ),
            ),
            latency_ms=5,
            model_deployment="mock-agent-model",
            agent_name="mock-agent",
        )


class MockRoutineAnalyst:
    async def analyze(self, item, viewer_mode="casual"):
        assessment = MatchAssessment(
            significant=False,
            significance=25,
            summary="Routine circulation near midfield.",
            rationale="The visible movement does not show a clear attacking or defensive turning point.",
            uncertainty_note="The ball is small in the wide frame.",
        )
        return AgentInference(
            decision=MatchAnalystDecision(
                publish_insight=False,
                significance=25,
                headline=assessment.summary,
                explanation=assessment.rationale,
                uncertainty_note=assessment.uncertainty_note,
                poll=None,
            ),
            latency_ms=5,
            model_deployment="mock-agent-model",
            agent_name="mock-match-agent",
            match_assessment=assessment,
            match_analyst_ms=5,
            agents=["mock-match-agent"],
        )


class AnalysisManagerTests(unittest.IsolatedAsyncioTestCase):
    async def test_paused_session_rejects_window(self):
        messages = []
        manager = AnalysisManager(MockVision(), MockAnalyst(), messages.append)
        result = await manager.submit("s1", window(0, 0))
        self.assertEqual(result.status, "ignored")
        self.assertEqual(result.reason, "stale_or_paused")

    async def test_seek_discards_in_flight_result(self):
        gate = asyncio.Event()
        messages = []

        async def broadcast(message):
            messages.append(message)

        manager = AnalysisManager(MockVision(gate), MockAnalyst(), broadcast)
        await manager.update_state("s1", PlaybackState(generation=0, playing=True, position_seconds=4))
        await manager.submit("s1", window(0, 0))
        await asyncio.sleep(0)
        await manager.update_state("s1", PlaybackState(generation=1, playing=True, position_seconds=40))
        gate.set()
        await asyncio.sleep(0.01)
        self.assertFalse(any(message["type"] == "vision_result" for message in messages))
        await manager.close()

    async def test_policy_deduplicates_poll(self):
        state = SessionState()
        item = observation(20)
        decision = (await MockAnalyst().analyze(item)).decision
        first = AnalysisManager._apply_policy(state, item, decision)
        second = AnalysisManager._apply_policy(state, item.model_copy(update={"video_timestamp_seconds": 40}), decision)
        self.assertIsNotNone(first.poll)
        self.assertIsNone(second.poll)

    async def test_suppressed_observation_is_still_delivered_with_reason(self):
        messages = []

        async def broadcast(message):
            messages.append(message)

        manager = AnalysisManager(MockVision(), MockRoutineAnalyst(), broadcast)
        await manager.update_state("s1", PlaybackState(generation=0, playing=True, position_seconds=4))
        await manager.submit("s1", window(0, 0))
        await asyncio.sleep(0.02)
        result = next(message for message in messages if message["type"] == "vision_result")
        self.assertEqual(result["policy"], {"outcome": "suppressed", "reason": "match_analyst_routine"})
        self.assertEqual(result["assessment"]["significance"], 25)
        await manager.close()


if __name__ == "__main__":
    unittest.main()
