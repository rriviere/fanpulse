from __future__ import annotations

import argparse
import asyncio
import json
import os
from pathlib import Path

from .extractor import extract_sequential_frames
from .provider import FoundryVisionProvider


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the FanPulse five-frame Foundry vision proof of concept.")
    parser.add_argument("--video", type=Path, default=Path("apps/web/public/media/match.mov"))
    parser.add_argument("--start", type=float, default=30.0, help="First video timestamp in seconds.")
    parser.add_argument("--interval", type=float, default=1.0, help="Seconds between frames.")
    parser.add_argument("--count", type=int, default=5)
    return parser.parse_args()


async def run() -> dict:
    args = parse_args()
    project_endpoint = os.environ.get("FOUNDRY_PROJECT_ENDPOINT")
    model_deployment = os.environ.get("FOUNDRY_VISION_MODEL_DEPLOYMENT")
    if not project_endpoint or not model_deployment:
        raise RuntimeError("FOUNDRY_PROJECT_ENDPOINT and FOUNDRY_VISION_MODEL_DEPLOYMENT are required")

    frames = extract_sequential_frames(
        args.video,
        start_seconds=args.start,
        count=args.count,
        interval_seconds=args.interval,
    )
    provider = FoundryVisionProvider(
        project_endpoint=project_endpoint,
        model_deployment=model_deployment,
    )
    try:
        inference = await provider.analyze(frames)
    finally:
        provider.close()

    return {
        "video": str(args.video),
        "frames": [
            {
                "timestamp_seconds": frame.timestamp_seconds,
                "width": frame.width,
                "height": frame.height,
                "jpeg_bytes": len(frame.jpeg_bytes),
            }
            for frame in frames
        ],
        "model_deployment": inference.model_deployment,
        "latency_ms": inference.latency_ms,
        "usage": {
            "input_tokens": inference.input_tokens,
            "output_tokens": inference.output_tokens,
        },
        "result": inference.result.model_dump(mode="json"),
    }


def main():
    print(json.dumps(asyncio.run(run()), indent=2))


if __name__ == "__main__":
    main()
