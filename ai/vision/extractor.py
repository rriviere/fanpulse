from __future__ import annotations

import base64
from dataclasses import dataclass
from pathlib import Path

import cv2


@dataclass(frozen=True)
class ExtractedFrame:
    timestamp_seconds: float
    jpeg_bytes: bytes
    width: int
    height: int

    @property
    def data_url(self) -> str:
        encoded = base64.b64encode(self.jpeg_bytes).decode("ascii")
        return f"data:image/jpeg;base64,{encoded}"


def extract_sequential_frames(
    video_path: Path,
    *,
    start_seconds: float,
    count: int = 5,
    interval_seconds: float = 1.0,
    max_width: int = 768,
    jpeg_quality: int = 70,
) -> list[ExtractedFrame]:
    if count < 1:
        raise ValueError("count must be positive")
    if start_seconds < 0 or interval_seconds <= 0:
        raise ValueError("timestamps and interval must be valid")
    if not video_path.is_file():
        raise FileNotFoundError(video_path)

    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        raise ValueError(f"Could not open video: {video_path}")

    frames: list[ExtractedFrame] = []
    try:
        for index in range(count):
            requested_timestamp = start_seconds + index * interval_seconds
            capture.set(cv2.CAP_PROP_POS_MSEC, requested_timestamp * 1000)
            ok, image = capture.read()
            if not ok:
                raise ValueError(f"Could not decode frame at {requested_timestamp:.3f}s")

            height, width = image.shape[:2]
            if width > max_width:
                scale = max_width / width
                width = max_width
                height = round(height * scale)
                image = cv2.resize(image, (width, height), interpolation=cv2.INTER_AREA)

            encoded, jpeg = cv2.imencode(
                ".jpg",
                image,
                [int(cv2.IMWRITE_JPEG_QUALITY), jpeg_quality],
            )
            if not encoded:
                raise ValueError(f"Could not encode frame at {requested_timestamp:.3f}s")

            actual_timestamp = capture.get(cv2.CAP_PROP_POS_MSEC) / 1000
            frames.append(
                ExtractedFrame(
                    timestamp_seconds=round(actual_timestamp or requested_timestamp, 3),
                    jpeg_bytes=jpeg.tobytes(),
                    width=width,
                    height=height,
                )
            )
    finally:
        capture.release()

    return frames
