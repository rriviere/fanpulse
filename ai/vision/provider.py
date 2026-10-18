from __future__ import annotations

import asyncio
from dataclasses import dataclass
from time import perf_counter

from azure.ai.projects import AIProjectClient
from azure.identity import DefaultAzureCredential

from ai.models.loader import get_model_profile

from .extractor import ExtractedFrame
from .models import VisionBatchResult


SYSTEM_PROMPT = """You are a cautious football video analyst. Analyse only the ordered still frames supplied.
Report directly visible action and clearly label reasonable interpretations. Treat missing context as unknown.
Never invent goals, scores, player identities, jersey numbers, substitutions, exact formations, possession
statistics, or events not supported by the images. Team must be a visible kit colour such as 'blue', 'red',
'light', or 'dark'; use 'unknown' when unclear. Return no_significant_event when the frames do not support a
meaningful football observation. Confidence is qualitative, not a calibrated probability."""


@dataclass(frozen=True)
class VisionInference:
    result: VisionBatchResult
    latency_ms: int
    input_tokens: int
    output_tokens: int
    model_deployment: str


class FoundryVisionProvider:
    def __init__(self, *, project_endpoint: str, model_deployment: str, timeout_seconds: float = 45):
        profile = get_model_profile("foundry-multimodal")
        self.model_deployment = model_deployment
        self.timeout_seconds = timeout_seconds
        self.reasoning_effort = profile.defaults["reasoning_effort"]
        self.image_detail = profile.defaults["image_detail"]
        self.max_output_tokens = profile.defaults["max_output_tokens"]
        self._credential = DefaultAzureCredential()
        self._project = AIProjectClient(endpoint=project_endpoint, credential=self._credential)
        self._openai = self._project.get_openai_client()

    async def analyze(self, frames: list[ExtractedFrame]) -> VisionInference:
        if not frames:
            raise ValueError("At least one frame is required")
        return await asyncio.wait_for(
            asyncio.to_thread(self._analyze_sync, frames),
            timeout=self.timeout_seconds,
        )

    def _analyze_sync(self, frames: list[ExtractedFrame]) -> VisionInference:
        content: list[dict] = [{
            "type": "input_text",
            "text": (
                "These frames are consecutive and ordered. Produce one observation for the most meaningful "
                "visible sequence, or no_significant_event. Use a timestamp from the supplied frames."
            ),
        }]
        for index, frame in enumerate(frames, start=1):
            content.append({
                "type": "input_text",
                "text": f"Frame {index}, video timestamp {frame.timestamp_seconds:.3f} seconds:",
            })
            content.append({
                "type": "input_image",
                "image_url": frame.data_url,
                "detail": self.image_detail,
            })

        started = perf_counter()
        response = self._openai.responses.parse(
            model=self.model_deployment,
            instructions=SYSTEM_PROMPT,
            input=[{"role": "user", "content": content}],
            text_format=VisionBatchResult,
            reasoning={"effort": self.reasoning_effort},
            max_output_tokens=self.max_output_tokens,
            store=False,
            timeout=self.timeout_seconds,
        )
        latency_ms = round((perf_counter() - started) * 1000)
        if response.output_parsed is None:
            raise ValueError(f"Model returned no validated output (status={response.status})")

        usage = response.usage
        return VisionInference(
            result=response.output_parsed,
            latency_ms=latency_ms,
            input_tokens=usage.input_tokens if usage else 0,
            output_tokens=usage.output_tokens if usage else 0,
            model_deployment=self.model_deployment,
        )

    def close(self):
        self._openai.close()
        self._project.close()
        self._credential.close()
