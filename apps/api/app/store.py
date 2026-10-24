import sqlite3
import threading
from datetime import UTC, datetime
import json
import os
from pathlib import Path
from typing import Any
from uuid import uuid4


class VoteStore:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self.lock = threading.Lock()
        self._setup()

    def connect(self):
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        return connection

    def _setup(self):
        with self.connect() as db:
            columns = {row["name"] for row in db.execute("PRAGMA table_info(votes)").fetchall()}
            if "source" in columns:
                db.executescript("""
                    ALTER TABLE votes RENAME TO votes_legacy;
                    CREATE TABLE votes (
                        poll_id TEXT NOT NULL,
                        option_id TEXT NOT NULL,
                        viewer_id TEXT NOT NULL,
                        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        PRIMARY KEY (poll_id, viewer_id)
                    );
                    INSERT INTO votes(poll_id, option_id, viewer_id, created_at)
                    SELECT poll_id, option_id, viewer_id, created_at FROM votes_legacy;
                    DROP TABLE votes_legacy;
                """)
            db.executescript("""
                CREATE TABLE IF NOT EXISTS votes (
                    poll_id TEXT NOT NULL,
                    option_id TEXT NOT NULL,
                    viewer_id TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (poll_id, viewer_id)
                );
                CREATE TABLE IF NOT EXISTS poll_status (
                    poll_id TEXT PRIMARY KEY,
                    status TEXT NOT NULL DEFAULT 'open'
                );
                CREATE TABLE IF NOT EXISTS activity (
                    id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    activity_type TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    payload TEXT NOT NULL
                );
            """)

    def cast(self, poll_id: str, option_id: str, viewer_id: str):
        with self.lock, self.connect() as db:
            status = db.execute("SELECT status FROM poll_status WHERE poll_id = ?", (poll_id,)).fetchone()
            if status and status["status"] == "closed":
                raise ValueError("Poll is closed")
            try:
                db.execute(
                    "INSERT INTO votes(poll_id, option_id, viewer_id) VALUES (?, ?, ?)",
                    (poll_id, option_id, viewer_id),
                )
            except sqlite3.IntegrityError as exc:
                raise ValueError("Viewer has already voted in this poll") from exc
        return self.results(poll_id)

    def results(self, poll_id: str):
        with self.connect() as db:
            rows = db.execute(
                "SELECT option_id, COUNT(*) count FROM votes WHERE poll_id = ? GROUP BY option_id",
                (poll_id,),
            ).fetchall()
        totals: dict[str, int] = {}
        for row in rows:
            totals[row["option_id"]] = row["count"]
        return {"poll_id": poll_id, "counts": totals}

    def clear(self):
        with self.lock, self.connect() as db:
            db.execute("DELETE FROM votes")
            db.execute("DELETE FROM poll_status")
            db.execute("DELETE FROM activity")

    def record_analysis(self, session_id: str, payload: dict[str, Any]):
        with self.lock, self.connect() as db:
            db.execute(
                "INSERT INTO activity(id, session_id, activity_type, created_at, payload) VALUES (?, ?, ?, ?, ?)",
                (
                    str(uuid4()),
                    session_id,
                    "analysis_result",
                    datetime.now(UTC).isoformat(),
                    json.dumps(payload, separators=(",", ":")),
                ),
            )


class CosmosStore:
    """Durable production store using Cosmos DB and Microsoft Entra authentication."""

    def __init__(self, endpoint: str, database_name: str, container_name: str):
        from azure.cosmos import CosmosClient
        from azure.identity import DefaultAzureCredential, ManagedIdentityCredential

        credential = ManagedIdentityCredential() if os.getenv("WEBSITE_HOSTNAME") else DefaultAzureCredential()
        self.client = CosmosClient(endpoint, credential=credential)
        self.container = self.client.get_database_client(database_name).get_container_client(container_name)

    def cast(self, poll_id: str, option_id: str, viewer_id: str):
        from azure.cosmos.exceptions import CosmosResourceExistsError, CosmosResourceNotFoundError

        try:
            status = self.container.read_item(item=f"poll-status:{poll_id}", partition_key=poll_id)
            if status.get("status") == "closed":
                raise ValueError("Poll is closed")
        except CosmosResourceNotFoundError:
            pass
        try:
            self.container.create_item({
                "id": f"vote:{poll_id}:{viewer_id}",
                "partition_key": poll_id,
                "type": "vote",
                "poll_id": poll_id,
                "option_id": option_id,
                "viewer_id": viewer_id,
                "created_at": datetime.now(UTC).isoformat(),
            })
        except CosmosResourceExistsError as exc:
            raise ValueError("Viewer has already voted in this poll") from exc
        return self.results(poll_id)

    def results(self, poll_id: str):
        rows = self.container.query_items(
            query="SELECT c.option_id FROM c WHERE c.type = 'vote' AND c.poll_id = @poll_id",
            parameters=[{"name": "@poll_id", "value": poll_id}],
            partition_key=poll_id,
        )
        totals: dict[str, int] = {}
        for row in rows:
            option_id = row["option_id"]
            totals[option_id] = totals.get(option_id, 0) + 1
        return {"poll_id": poll_id, "counts": totals}

    def record_analysis(self, session_id: str, payload: dict[str, Any]):
        self.container.create_item({
            "id": f"analysis:{session_id}:{payload['generation']}:{payload['window']['end_seconds']}:{uuid4()}",
            "partition_key": session_id,
            "type": "analysis_result",
            "session_id": session_id,
            "created_at": datetime.now(UTC).isoformat(),
            **payload,
        })

    def close(self):
        close_client = getattr(self.client, "close", None)
        if close_client:
            close_client()

