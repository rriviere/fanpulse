from __future__ import annotations

import asyncio
import argparse
import json
import os
from pathlib import Path

from ai.agents.loader import get_agent_configuration
from ai.agents.provider import FoundryAgentPipeline
from ai.vision.extractor import extract_sequential_frames
from ai.vision.provider import FoundryVisionProvider


async def run(start_seconds: float = 30) -> dict:
    endpoint = os.environ["FOUNDRY_PROJECT_ENDPOINT"]
    model = os.environ["FOUNDRY_VISION_MODEL_DEPLOYMENT"]
    agent_name = get_agent_configuration("match-analyst").resolved_name()
    engagement_name = get_agent_configuration("fan-engagement").resolved_name()
    vision = FoundryVisionProvider(project_endpoint=endpoint, model_deployment=model)
    analyst = FoundryAgentPipeline(
        project_endpoint=endpoint,
        match_analyst_name=agent_name,
        fan_engagement_name=engagement_name,
        model_deployment=model,
    )
    try:
        frames = extract_sequential_frames(
            Path("apps/web/public/media/match.mov"),
            start_seconds=start_seconds,
            count=5,
            interval_seconds=1,
        )
        vision_result = await vision.analyze(frames)
        observation = vision_result.result.observations[0]
        agent_result = await analyst.analyze(observation, "analyst")
        return {
            "window": [frames[0].timestamp_seconds, frames[-1].timestamp_seconds],
            "observation": observation.model_dump(mode="json"),
            "assessment": agent_result.match_assessment.model_dump(mode="json") if agent_result.match_assessment else None,
            "insight": agent_result.decision.model_dump(mode="json"),
            "latency": {
                "vision_ms": vision_result.latency_ms,
                "agent_ms": agent_result.latency_ms,
                "match_analyst_ms": agent_result.match_analyst_ms,
                "fan_engagement_ms": agent_result.fan_engagement_ms,
                "total_ms": vision_result.latency_ms + agent_result.latency_ms,
            },
            "agent": {"name": agent_result.agent_name, "model": agent_result.model_deployment},
        }
    finally:
        vision.close()
        analyst.close()


def main():
    parser = argparse.ArgumentParser(description="Run real video through vision and both Foundry agents.")
    parser.add_argument("--start", type=float, default=30)
    args = parser.parse_args()
    print(json.dumps(asyncio.run(run(args.start)), indent=2))


if __name__ == "__main__":
    main()
