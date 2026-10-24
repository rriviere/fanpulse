import asyncio
import base64
import json
from pathlib import Path
import unittest

from ai.agents.contracts import AgentInference, AgentPoll, AgentPollOption, MatchAnalystDecision, MatchAssessment
from ai.foundry_errors import FoundryRateLimitError
from ai.vision.models import FootballObservation, VisionBatchResult
from ai.vision.provider import VisionInference
from apps.api.app.analysis.manager import AnalysisManager, SessionState
from apps.api.app.analysis.models import AnalysisWindow, BrowserFrame, PlaybackState, SyntheticObservationSubmission


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


def synthetic(generation: int = 1, timestamp: float = 12, event_id: str = "green-pressure"):
    return SyntheticObservationSubmission(
        generation=generation, event_id=event_id, event_label="Green pressure",
        observation=observation(timestamp),
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


class RateLimitedOnceVision(MockVision):
    async def analyze(self, frames):
        self.calls.append(frames[-1].timestamp_seconds)
        if len(self.calls) == 1:
            raise FoundryRateLimitError("vision")
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


class GatedAnalyst(MockAnalyst):
    def __init__(self):
        self.gate = asyncio.Event()
        self.calls = 0

    async def analyze(self, item, viewer_mode="casual"):
        self.calls += 1
        await self.gate.wait()
        return await super().analyze(item, viewer_mode)


class AnalysisManagerTests(unittest.IsolatedAsyncioTestCase):
    async def test_external_match_observations_satisfy_real_agent_contract(self):
        match_file = Path(__file__).resolve().parents[2] / "web/public/simulations/reference-match.v1.json"
        data = json.loads(match_file.read_text())
        for event in data["events"]:
            payload = SyntheticObservationSubmission(
                generation=1, event_id=event["id"], event_label=event["label"],
                observation=event["observation"],
            )
            self.assertEqual(payload.observation.video_timestamp_seconds, event["time"])

    async def test_synthetic_pause_preserves_in_flight_result_without_resubmission(self):
        messages = []

        async def broadcast(message):
            messages.append(message)

        analyst = GatedAnalyst()
        manager = AnalysisManager(MockVision(), analyst, broadcast)
        await manager.update_state("s1", PlaybackState(generation=1, playing=True, position_seconds=12))
        await manager.submit_synthetic("s1", synthetic())
        # Pause before the scheduled worker even starts.
        await manager.update_state("s1", PlaybackState(generation=1, playing=False, position_seconds=12))
        await asyncio.sleep(0)
        self.assertEqual(analyst.calls, 1)
        analyst.gate.set()
        await manager.sessions["s1"].agent_worker
        self.assertTrue(any(message.get("provider", {}).get("agent") == "mock-agent" for message in messages))
        self.assertIn("complete", [message["outcome"] for message in messages if message["type"] == "synthetic_complete"])
        await manager.update_state("s1", PlaybackState(generation=1, playing=True, position_seconds=12))
        duplicate = await manager.submit_synthetic("s1", synthetic())
        self.assertEqual(duplicate.reason, "duplicate_window")
        self.assertEqual(analyst.calls, 1)
        await manager.close()

    async def test_seek_keeps_old_request_reserved_until_server_completion(self):
        messages = []

        async def broadcast(message):
            messages.append(message)

        analyst = GatedAnalyst()
        manager = AnalysisManager(MockVision(), analyst, broadcast)
        await manager.update_state("s1", PlaybackState(generation=1, playing=True, position_seconds=12))
        await manager.submit_synthetic("s1", synthetic())
        await asyncio.sleep(0)
        await manager.update_state("s1", PlaybackState(generation=2, playing=True, position_seconds=103))
        busy = await manager.submit_synthetic("s1", synthetic(2, 103, "black-shot"))
        self.assertEqual(busy.reason, "agents_busy")
        analyst.gate.set()
        await manager.sessions["s1"].agent_worker
        completions = [message for message in messages if message["type"] == "synthetic_complete"]
        self.assertEqual(completions[0]["generation"], 1)
        self.assertEqual(completions[0]["outcome"], "discarded")
        self.assertFalse(any(message.get("provider", {}).get("agent") == "mock-agent" for message in messages))
        accepted = await manager.submit_synthetic("s1", synthetic(2, 103, "black-shot"))
        self.assertEqual(accepted.status, "queued")
        await manager.sessions["s1"].agent_worker
        await manager.close()

    async def test_agent_calls_are_serialized_across_sessions(self):
        messages = []

        async def broadcast(message):
            messages.append(message)

        analyst = GatedAnalyst()
        manager = AnalysisManager(MockVision(), analyst, broadcast)
        for session in ["one", "two"]:
            await manager.update_state(session, PlaybackState(generation=1, playing=True, position_seconds=12))
            await manager.submit_synthetic(session, synthetic())
        await asyncio.sleep(0)
        self.assertEqual(analyst.calls, 1)
        tasks = [state.agent_worker for state in manager.sessions.values()]
        analyst.gate.set()
        await asyncio.gather(*tasks)
        self.assertEqual(analyst.calls, 2)
        await manager.close()

    async def test_synthetic_failure_always_completes_and_releases_request(self):
        class FailingAnalyst:
            async def analyze(self, *_args):
                raise RuntimeError("Test agent failure")

        messages = []

        async def broadcast(message):
            messages.append(message)

        manager = AnalysisManager(MockVision(), FailingAnalyst(), broadcast)
        await manager.update_state("s1", PlaybackState(generation=1, playing=True, position_seconds=12))
        await manager.submit_synthetic("s1", synthetic())
        await manager.sessions["s1"].agent_worker
        self.assertIsNone(manager.sessions["s1"].synthetic_request)
        completion = next(message for message in messages if message["type"] == "synthetic_complete")
        self.assertEqual(completion["outcome"], "failed")
        self.assertEqual(completion["event_id"], "green-pressure")
        await manager.close()

    async def test_out_of_order_state_updates_cannot_restore_an_old_generation(self):
        manager = AnalysisManager(MockVision(), MockAnalyst(), lambda _message: None)
        await manager.update_state("s1", PlaybackState(generation=3, playing=False, position_seconds=100))
        await manager.update_state("s1", PlaybackState(generation=2, playing=True, position_seconds=12))
        self.assertEqual(manager.sessions["s1"].generation, 3)
        self.assertEqual(manager.sessions["s1"].position_seconds, 100)
        self.assertFalse(manager.sessions["s1"].playing)
        await manager.close()

    async def test_synthetic_observation_bypasses_vision_and_uses_agents(self):
        messages = []

        async def broadcast(message):
            messages.append(message)

        vision = MockVision()
        manager = AnalysisManager(vision, MockAnalyst(), broadcast)
        await manager.update_state("synthetic", PlaybackState(generation=2, playing=True, position_seconds=31))
        payload = SyntheticObservationSubmission(
            generation=2,
            viewer_mode="analyst",
            event_id="green-pressure",
            event_label="Green pressure",
            observation=observation(31),
        )
        first = await manager.submit_synthetic("synthetic", payload)
        duplicate = await manager.submit_synthetic("synthetic", payload)
        await asyncio.sleep(0.02)

        self.assertEqual(first.status, "queued")
        self.assertEqual(duplicate.reason, "duplicate_window")
        self.assertEqual(vision.calls, [])
        direct = next(
            message for message in messages
            if message.get("provider", {}).get("agent") == "synthetic-direct"
        )
        self.assertEqual(direct["policy"]["reason"], "synthetic_direct")
        self.assertEqual(direct["synthetic_event"]["id"], "green-pressure")
        self.assertTrue(any(
            message.get("provider", {}).get("agent") == "mock-agent" for message in messages
        ))
        enriched = next(message for message in messages if message.get("provider", {}).get("agent") == "mock-agent")
        self.assertEqual(enriched["synthetic_event"], {
            "id": "green-pressure",
            "label": "Green pressure",
            "timestamp_seconds": 31.0,
        })
        await manager.close()

    async def test_rate_limited_window_is_skipped_and_next_window_continues(self):
        messages = []

        async def broadcast(message):
            messages.append(message)

        manager = AnalysisManager(RateLimitedOnceVision(), MockAnalyst(), broadcast)
        await manager.update_state("s1", PlaybackState(generation=0, playing=True, position_seconds=4))
        await manager.submit("s1", window(0, 0))
        await asyncio.sleep(0.02)
        self.assertTrue(any(message.get("status") == "rate_limited" for message in messages))

        await manager.update_state("s1", PlaybackState(generation=0, playing=True, position_seconds=24))
        await manager.submit("s1", window(0, 20))
        await asyncio.sleep(0.02)
        self.assertTrue(any(message["type"] == "vision_result" for message in messages))
        await manager.close()

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

    async def test_policy_requires_demo_significance_threshold_for_poll(self):
        state = SessionState()
        item = observation(20)
        decision = (await MockAnalyst().analyze(item)).decision.model_copy(update={"significance": 59})
        result = AnalysisManager._apply_policy(state, item, decision)
        self.assertIsNone(result.poll)

    async def test_suppressed_observation_is_still_delivered_with_reason(self):
        messages = []

        async def broadcast(message):
            messages.append(message)

        manager = AnalysisManager(MockVision(), MockRoutineAnalyst(), broadcast)
        await manager.update_state("s1", PlaybackState(generation=0, playing=True, position_seconds=4))
        await manager.submit("s1", window(0, 0))
        await asyncio.sleep(0.02)
        result = next(
            message for message in messages
            if message["type"] == "vision_result" and message["provider"]["agent"] == "mock-match-agent"
        )
        self.assertEqual(result["policy"], {"outcome": "suppressed", "reason": "match_analyst_routine"})
        self.assertEqual(result["assessment"]["significance"], 25)
        await manager.close()

    async def test_vision_delivery_and_next_window_do_not_wait_for_agents(self):
        messages = []

        async def broadcast(message):
            messages.append(message)

        vision = MockVision()
        analyst = GatedAnalyst()
        manager = AnalysisManager(vision, analyst, broadcast)
        await manager.update_state("s1", PlaybackState(generation=0, playing=True, position_seconds=4))
        await manager.submit("s1", window(0, 0))
        await asyncio.sleep(0.01)

        direct = [
            message for message in messages
            if message.get("type") == "vision_result" and message["provider"]["agent"] == "vision-direct"
        ]
        self.assertEqual(len(direct), 1)
        self.assertEqual(analyst.calls, 1)

        await manager.update_state("s1", PlaybackState(generation=0, playing=True, position_seconds=14))
        await manager.submit("s1", window(0, 10))
        await asyncio.sleep(0.01)
        self.assertEqual(vision.calls, [4, 14])
        self.assertEqual(
            len([
                message for message in messages
                if message.get("type") == "vision_result" and message["provider"]["agent"] == "vision-direct"
            ]),
            2,
        )
        analyst.gate.set()
        await asyncio.sleep(0.02)
        enriched = [
            message for message in messages
            if message.get("type") == "vision_result" and message["provider"]["agent"] == "mock-agent"
        ]
        self.assertEqual([message["window"]["end_seconds"] for message in enriched], [4, 14])
        await manager.close()


if __name__ == "__main__":
    unittest.main()
