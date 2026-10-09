import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app
from app.services.metadata_service import MetadataService


CALIBRE_HELP = """Usage: fetch-ebook-metadata [options]

Options:
  -p ALLOWED_PLUGIN, --allowed-plugin=ALLOWED_PLUGIN
                        Specify the name of a metadata download plugin to use.
                        All
                        plugin names: Google, Google Images, Amazon.com,
                        Edelweiss, Open Library, Big Book Search

Created by Calibre
"""


class TestMetadataSources(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory(prefix="lunabria-metadata-tests-")
        self.db_path = Path(self.temp_dir.name) / "app_state.db"
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("CREATE TABLE user_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")

        self.db_patch = patch("app.services.metadata_service.get_db", side_effect=self.get_db)
        self.db_patch.start()
        MetadataService.get_available_sources.cache_clear()

    def tearDown(self):
        self.db_patch.stop()
        MetadataService.get_available_sources.cache_clear()
        self.temp_dir.cleanup()

    def get_db(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def test_detects_plugin_names_across_wrapped_help_lines(self):
        with patch(
            "app.services.metadata_service.subprocess.run",
            return_value=SimpleNamespace(returncode=0, stdout=CALIBRE_HELP, stderr="")
        ):
            self.assertEqual(
                MetadataService.get_available_sources(),
                ["Google", "Google Images", "Amazon.com", "Edelweiss", "Open Library", "Big Book Search"]
            )

    def test_source_preferences_default_to_all_and_persist_selection(self):
        with patch(
            "app.services.metadata_service.subprocess.run",
            return_value=SimpleNamespace(returncode=0, stdout=CALIBRE_HELP, stderr="")
        ):
            initial = MetadataService.get_source_preferences()
            self.assertEqual(initial["selected_sources"], initial["available_sources"])
            self.assertEqual(initial["unavailable_sources"], ["Goodreads"])

            saved = MetadataService.save_source_preferences(["Google", "Open Library"])
            self.assertEqual(saved["selected_sources"], ["Google", "Open Library"])
            self.assertEqual(
                MetadataService.get_source_preferences()["selected_sources"],
                ["Google", "Open Library"]
            )

            with self.get_db() as conn:
                stored = conn.execute(
                    "SELECT value FROM user_settings WHERE key = 'metadata_sources'"
                ).fetchone()["value"]
            self.assertEqual(json.loads(stored), ["Google", "Open Library"])

    def test_metadata_source_api_reads_and_saves_preferences(self):
        help_result = SimpleNamespace(returncode=0, stdout=CALIBRE_HELP, stderr="")
        with patch("app.database.APP_STATE_DB_PATH", str(self.db_path)), patch(
            "app.services.metadata_service.subprocess.run", return_value=help_result
        ), TestClient(app) as client:
            initial = client.get("/api/metadata/sources")
            self.assertEqual(initial.status_code, 200)
            self.assertEqual(initial.json()["selected_sources"], initial.json()["available_sources"])

            saved = client.put(
                "/api/metadata/sources",
                json={"selected_sources": ["Google", "Open Library"]}
            )
            self.assertEqual(saved.status_code, 200)
            self.assertEqual(saved.json()["selected_sources"], ["Google", "Open Library"])

            unknown = client.put(
                "/api/metadata/sources",
                json={"selected_sources": ["Goodreads"]}
            )
            self.assertEqual(unknown.status_code, 400)

    def test_goodreads_becomes_available_when_calibre_plugin_is_installed(self):
        calibre_help = CALIBRE_HELP.replace("Big Book Search", "Big Book Search, Goodreads")
        with patch(
            "app.services.metadata_service.subprocess.run",
            return_value=SimpleNamespace(returncode=0, stdout=calibre_help, stderr="")
        ):
            preferences = MetadataService.get_source_preferences()

        self.assertIn("Goodreads", preferences["available_sources"])
        self.assertNotIn("Goodreads", preferences["unavailable_sources"])

    def test_rejects_unknown_sources(self):
        with patch(
            "app.services.metadata_service.subprocess.run",
            return_value=SimpleNamespace(returncode=0, stdout=CALIBRE_HELP, stderr="")
        ):
            with self.assertRaisesRegex(ValueError, "Goodreads"):
                MetadataService.save_source_preferences(["Goodreads"])

    def test_fetch_restricts_calibre_to_selected_sources(self):
        with patch(
            "app.services.metadata_service.subprocess.run",
            return_value=SimpleNamespace(returncode=0, stdout=CALIBRE_HELP, stderr="")
        ):
            MetadataService.save_source_preferences(["Google", "Open Library"])

        with patch(
            "app.services.metadata_service.subprocess.run",
            return_value=SimpleNamespace(returncode=0, stdout="", stderr="")
        ) as run:
            MetadataService.fetch_online_metadata(isbn="9780000000000")

        command = run.call_args.args[0]
        self.assertEqual(
            [command[index + 1] for index, arg in enumerate(command[:-1]) if arg == "--allowed-plugin"],
            ["Google", "Open Library"]
        )
        self.assertNotIn("Goodreads", command)


if __name__ == "__main__":
    unittest.main()
