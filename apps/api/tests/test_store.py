from pathlib import Path
import sqlite3
from tempfile import TemporaryDirectory
import unittest

from apps.api.app.store import VoteStore


class VoteStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.store = VoteStore(Path(self.temp.name) / "votes.db")

    def tearDown(self):
        self.temp.cleanup()

    def test_counts_live_votes(self):
        self.store.cast("p1", "yes", "viewer-one")
        self.store.cast("p1", "yes", "viewer-two")
        self.assertEqual(self.store.results("p1")["counts"]["yes"], 2)

    def test_one_vote_per_viewer_per_poll(self):
        self.store.cast("p1", "yes", "viewer-one")
        with self.assertRaisesRegex(ValueError, "already voted"):
            self.store.cast("p1", "no", "viewer-one")

    def test_reset_clears_votes(self):
        self.store.cast("p1", "yes", "viewer-one")
        self.store.clear()
        self.assertEqual(self.store.results("p1")["counts"], {})

    def test_migrates_votes_from_the_legacy_source_schema(self):
        path = Path(self.temp.name) / "legacy.db"
        with sqlite3.connect(path) as db:
            db.executescript("""
                CREATE TABLE votes (
                    poll_id TEXT NOT NULL,
                    option_id TEXT NOT NULL,
                    viewer_id TEXT NOT NULL,
                    source TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (poll_id, viewer_id, source)
                );
                INSERT INTO votes(poll_id, option_id, viewer_id, source)
                VALUES ('p1', 'yes', 'viewer-one', 'live');
            """)

        migrated = VoteStore(path)

        self.assertEqual(migrated.results("p1")["counts"], {"yes": 1})
        with migrated.connect() as db:
            columns = {row["name"] for row in db.execute("PRAGMA table_info(votes)")}
        self.assertNotIn("source", columns)

    def test_records_structured_analysis_activity(self):
        payload = {
            "generation": 2,
            "window": {"start_seconds": 10.0, "end_seconds": 14.0},
            "policy": {"outcome": "published"},
        }

        self.store.record_analysis("session-one", payload)

        with self.store.connect() as db:
            row = db.execute("SELECT * FROM activity").fetchone()
        self.assertEqual(row["session_id"], "session-one")
        self.assertEqual(row["activity_type"], "analysis_result")
        self.assertIn('"generation":2', row["payload"])


if __name__ == "__main__":
    unittest.main()
