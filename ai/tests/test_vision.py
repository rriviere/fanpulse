from pathlib import Path
import unittest

from pydantic import ValidationError

from ai.vision.extractor import extract_sequential_frames
from ai.vision.models import FootballObservation


class VisionSchemaTests(unittest.TestCase):
    def test_unknown_observation_cannot_be_significant(self):
        with self.assertRaises(ValidationError):
            FootballObservation(
                video_timestamp_seconds=10,
                event_type="unknown",
                team="unknown",
                description="The action is unclear.",
                evidence="The ball is not visible.",
                evidence_basis="insufficient_evidence",
                confidence="low",
                is_significant=True,
            )


class FrameExtractionTests(unittest.TestCase):
    def test_extracts_five_ordered_resized_frames_from_recording(self):
        video = Path(__file__).resolve().parents[2] / "apps" / "web" / "public" / "media" / "match.mov"
        if not video.exists():
            self.skipTest("Licensed local recording is not available")
        frames = extract_sequential_frames(video, start_seconds=30, count=5, interval_seconds=1)
        self.assertEqual(len(frames), 5)
        self.assertEqual([frame.timestamp_seconds for frame in frames], sorted(frame.timestamp_seconds for frame in frames))
        self.assertTrue(all(frame.width <= 768 for frame in frames))
        self.assertTrue(all(frame.jpeg_bytes.startswith(b"\xff\xd8") for frame in frames))


if __name__ == "__main__":
    unittest.main()
