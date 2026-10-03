import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app import database


class TestDatabaseConnectionLifecycle(unittest.TestCase):
    def test_context_commits_closes_and_rolls_back_connections(self):
        with tempfile.TemporaryDirectory(prefix="lunabria-db-lifecycle-") as temp_dir:
            database_path = Path(temp_dir) / "app_state.db"
            with patch("app.database.APP_STATE_DB_PATH", str(database_path)):
                with database.get_db() as connection:
                    connection.execute(
                        "CREATE TABLE lifecycle (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
                    )
                    connection.execute(
                        "INSERT INTO lifecycle VALUES ('state', 'committed')"
                    )

                with self.assertRaises(sqlite3.ProgrammingError):
                    connection.execute("SELECT 1")

                failed_connection = None
                with self.assertRaisesRegex(RuntimeError, "rollback fixture"):
                    with database.get_db() as connection_to_roll_back:
                        failed_connection = connection_to_roll_back
                        connection_to_roll_back.execute(
                            "UPDATE lifecycle SET value = 'rolled back' WHERE key = 'state'"
                        )
                        raise RuntimeError("rollback fixture")

                with database.get_db() as verification:
                    row = verification.execute(
                        "SELECT value FROM lifecycle WHERE key = 'state'"
                    ).fetchone()

            self.assertEqual(row["value"], "committed")
            assert failed_connection is not None
            with self.assertRaises(sqlite3.ProgrammingError):
                failed_connection.execute("SELECT 1")
