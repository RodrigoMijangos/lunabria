import json
import sqlite3
import tempfile
import unittest
from contextlib import closing, contextmanager
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
        with closing(sqlite3.connect(self.db_path)) as conn, conn:
            conn.execute("CREATE TABLE user_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")

        self.db_patch = patch("app.services.metadata_service.get_db", side_effect=self.get_db)
        self.db_patch.start()
        MetadataService.get_available_sources.cache_clear()

    def tearDown(self):
        self.db_patch.stop()
        MetadataService.get_available_sources.cache_clear()
        self.temp_dir.cleanup()

    @contextmanager
    def get_db(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            with conn:
                yield conn
        finally:
            conn.close()

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

    def test_fetch_online_metadata_matched_flag_and_empty_handling(self):
        with patch(
            "app.services.metadata_service.subprocess.run",
            return_value=SimpleNamespace(returncode=0, stdout=CALIBRE_HELP, stderr="")
        ):
            MetadataService.save_source_preferences(["Google", "Open Library"])

        # Empty stdout -> matched: False
        with patch(
            "app.services.metadata_service.subprocess.run",
            return_value=SimpleNamespace(returncode=0, stdout="", stderr="")
        ):
            res_empty = MetadataService.fetch_online_metadata(isbn="9780000000000")
            self.assertFalse(res_empty["matched"])

        # Valid OPF XML -> matched: True
        valid_opf = """<?xml version='1.0' encoding='utf-8'?>
        <package xmlns="http://www.idpf.org/2007/opf">
          <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
            <dc:title>Test Title</dc:title>
            <dc:creator>Test Author</dc:creator>
          </metadata>
        </package>"""
        with patch(
            "app.services.metadata_service.subprocess.run",
            return_value=SimpleNamespace(returncode=0, stdout=valid_opf, stderr="")
        ):
            res_valid = MetadataService.fetch_online_metadata(isbn="9780000000000")
            self.assertTrue(res_valid["matched"])
            self.assertEqual(res_valid["title"], "Test Title")

        # Exception -> matched: False
        with patch(
            "app.services.metadata_service.subprocess.run",
            side_effect=RuntimeError("Calibre timeout")
        ):
            res_err = MetadataService.fetch_online_metadata(isbn="9780000000000")
            self.assertFalse(res_err["matched"])

    def test_fetch_metadata_cascade_order(self):
        call_log = []

        def mock_fetch(isbn=None, title=None, authors=None):
            call_log.append({"isbn": isbn, "title": title, "authors": authors})
            if isbn == "9780132350884":
                return {"matched": True, "title": "Clean Code", "authors": ["Robert C. Martin"]}
            if title == "Specific PDF Title":
                return {"matched": True, "title": "Specific PDF Title Found", "authors": ["Author"]}
            if title == "Clean File Name":
                return {"matched": True, "title": "Clean File Name Found", "authors": ["Author"]}
            return {"matched": False, "title": title, "authors": []}

        with patch.object(MetadataService, "fetch_online_metadata", side_effect=mock_fetch):
            # 1. First ISBN matches immediately
            call_log.clear()
            res1 = MetadataService.fetch_metadata_cascade(
                candidate_isbns=["9780132350884", "9780306406157"],
                pdf_title="Specific PDF Title",
                clean_title="Clean File Name"
            )
            self.assertTrue(res1["matched"])
            self.assertEqual(res1["title"], "Clean Code")
            self.assertEqual(len(call_log), 1)
            self.assertEqual(call_log[0]["isbn"], "9780132350884")

            # 2. First ISBN fails, second ISBN matches
            call_log.clear()
            res2 = MetadataService.fetch_metadata_cascade(
                candidate_isbns=["9780000000000", "9780132350884"],
                pdf_title="Specific PDF Title",
                clean_title="Clean File Name"
            )
            self.assertTrue(res2["matched"])
            self.assertEqual(res2["title"], "Clean Code")
            self.assertEqual(len(call_log), 2)
            self.assertEqual(call_log[0]["isbn"], "9780000000000")
            self.assertEqual(call_log[1]["isbn"], "9780132350884")

            # 3. All ISBNs fail, PDF title matches
            call_log.clear()
            res3 = MetadataService.fetch_metadata_cascade(
                candidate_isbns=["9780000000000"],
                pdf_title="Specific PDF Title",
                clean_title="Clean File Name"
            )
            self.assertTrue(res3["matched"])
            self.assertEqual(res3["title"], "Specific PDF Title Found")
            self.assertEqual(len(call_log), 2)
            self.assertEqual(call_log[0]["isbn"], "9780000000000")
            self.assertEqual(call_log[1]["title"], "Specific PDF Title")

            # 4. ISBN and PDF title fail (or missing), clean_title matches
            call_log.clear()
            res4 = MetadataService.fetch_metadata_cascade(
                candidate_isbns=[],
                pdf_title="Unknown PDF Title",
                clean_title="Clean File Name"
            )
            self.assertTrue(res4["matched"])
            self.assertEqual(res4["title"], "Clean File Name Found")
            self.assertEqual(len(call_log), 2)
            self.assertEqual(call_log[0]["title"], "Unknown PDF Title")
            self.assertEqual(call_log[1]["title"], "Clean File Name")

            # 5. Nothing matches -> fallback matched: False
            call_log.clear()
            res5 = MetadataService.fetch_metadata_cascade(
                candidate_isbns=["9780000000000"],
                pdf_title="Unknown PDF Title",
                clean_title="Unmatched File"
            )
            self.assertFalse(res5["matched"])
            self.assertEqual(res5["title"], "Unmatched File")


if __name__ == "__main__":
    unittest.main()
