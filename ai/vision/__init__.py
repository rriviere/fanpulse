"""Multimodal football vision proof-of-concept components."""

from .extractor import ExtractedFrame, extract_sequential_frames
from .models import FootballObservation, VisionBatchResult
from .provider import FoundryVisionProvider

__all__ = [
    "ExtractedFrame",
    "FootballObservation",
    "FoundryVisionProvider",
    "VisionBatchResult",
    "extract_sequential_frames",
]
