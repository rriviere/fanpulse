from __future__ import annotations

import base64
import binascii
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from ai.vision.extractor import ExtractedFrame


class PlaybackState(BaseModel):
    model_config = ConfigDict(extra="forbid")

    generation: int = Field(ge=0)
    playing: bool
    position_seconds: float = Field(ge=0)


class BrowserFrame(BaseModel):
    model_config = ConfigDict(extra="forbid")

    timestamp_seconds: float = Field(ge=0)
    data_url: str = Field(max_length=350_000)

    @field_validator("data_url")
    @classmethod
    def jpeg_data_url_only(cls, value: str):
        if not value.startswith("data:image/jpeg;base64,"):
            raise ValueError("frame must be a JPEG data URL")
        return value

    def to_extracted_frame(self) -> ExtractedFrame:
        try:
            raw = base64.b64decode(self.data_url.partition(",")[2], validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ValueError("invalid base64 frame") from exc
        if len(raw) > 250_000 or not raw.startswith(b"\xff\xd8"):
            raise ValueError("invalid or oversized JPEG frame")
        return ExtractedFrame(timestamp_seconds=self.timestamp_seconds, jpeg_bytes=raw, width=0, height=0)


class AnalysisWindow(BaseModel):
    model_config = ConfigDict(extra="forbid")

    generation: int = Field(ge=0)
    viewer_mode: Literal["casual", "analyst"] = "casual"
    frames: list[BrowserFrame] = Field(min_length=3, max_length=8)

    @field_validator("frames")
    @classmethod
    def ordered_unique_timestamps(cls, frames: list[BrowserFrame]):
        timestamps = [frame.timestamp_seconds for frame in frames]
        if timestamps != sorted(set(timestamps)):
            raise ValueError("frame timestamps must be ordered and unique")
        if timestamps[-1] - timestamps[0] > 12:
            raise ValueError("analysis window cannot exceed 12 seconds")
        return frames


class SubmissionResult(BaseModel):
    status: Literal["queued", "replaced", "ignored"]
    reason: str | None = None
