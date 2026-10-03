"""Regression coverage for service facades and their original patch points."""

import importlib
import json
import sqlite3
import subprocess
import tempfile
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing, contextmanager
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from app.database import init_db


from app.services.calibre_service import CalibreService
from app.services.reader_service import ReaderService

calibre_module = importlib.import_module("app.services.calibre_service")
reader_module = importlib.import_module("app.services.reader_service")


class ServiceFixture(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory(prefix="lunabria-refactor-")
        self.addCleanup(self.temp_dir.cleanup)
        self.root = Path(self.temp_dir.name)
        self.state_path = self.root / "app_state.db"
        with patch("app.database.get_db", self.get_db):
            init_db()
        self.db_patch = patch("app.services.reader_service.get_db", self.get_db)
        self.db_patch.start()
        self.addCleanup(self.db_patch.stop)
        self.reader = ReaderService()
        self.calibre = CalibreService(
            library_path=str(self.root / "library"),
            converted_pdf_dir=self.root / "converted",
        )
        self.calibre.library_path.mkdir()
        with closing(sqlite3.connect(self.calibre.db_path)) as conn, conn:
            conn.execute("CREATE TABLE books (id INTEGER PRIMARY KEY, path TEXT)")
            conn.execute("INSERT INTO books VALUES (7, 'Author/Book (7)')")
            conn.execute("CREATE TABLE data (book INTEGER, name TEXT, format TEXT)")
        self.book_dir = self.calibre.library_path / "Author" / "Book (7)"
        self.book_dir.mkdir(parents=True)
        self.epub = self.book_dir / "Book.epub"
        self.epub.write_bytes(b"epub fixture")
        with closing(sqlite3.connect(self.calibre.db_path)) as conn, conn:
            conn.execute("INSERT INTO data VALUES (7, 'Book', 'EPUB')")

    @contextmanager
    def get_db(self):
        conn = sqlite3.connect(self.state_path)
        conn.row_factory = sqlite3.Row
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    def convert(self, command, **kwargs):
        Path(command[-1]).write_bytes(b"%PDF-1.4 fixture")
        return SimpleNamespace(stdout="", stderr="")


class TestReaderServiceRefactor(ServiceFixture):

    def test_public_classes_singletons_and_static_normalization(self):
        self.assertIsInstance(reader_module.reader_service, ReaderService)
        self.assertIsInstance(calibre_module.calibre_service, CalibreService)
        self.assertEqual(ReaderService.normalize_text(" ani- mated  high-school "), "animated high-school")
        self.assertEqual(ReaderService.normalize_text(""), "")
        self.assertEqual(ReaderService.normalize_text("un‐ derstood soft\xad ware"), "understood software")

    def test_progress_upsert_and_open_preserve_existing_position(self):
        self.assertIsNone(self.reader.get_progress(7))
        self.assertIsNone(self.reader.mark_book_opened(7, 2, 10, 20.0))
        self.assertIsNone(self.reader.update_progress(7, 4, 10, 40.0))
        self.reader.mark_book_opened(7, 1, 1, 0.0)
        progress = self.reader.get_progress(7)
        assert progress is not None
        self.assertEqual(set(progress), {"book_id", "current_page", "total_pages", "percentage", "last_read_at"})
        self.assertEqual((progress["book_id"], progress["current_page"], progress["total_pages"], progress["percentage"]), (7, 4, 10, 40.0))
        self.assertIsInstance(progress["last_read_at"], str)

    def test_recent_order_limit_missing_books_and_module_service_patch(self):
        for book_id in (7, 8, 9):
            self.reader.update_progress(book_id, book_id, 20, 50.0)
        with self.get_db() as conn:
            conn.execute("UPDATE reading_progress SET last_read_at = '2025-01-01 12:00:00'")
        books = {7: {"id": 7, "title": "Seven"}, 8: {"id": 8, "title": "Eight"}}
        fake_calibre = SimpleNamespace(get_book=lambda book_id: books.get(book_id))
        with patch("app.services.reader_service.calibre_service", fake_calibre):
            recent = self.reader.get_top_recent_books(limit=2)
        self.assertEqual([b["id"] for b in recent], [8])
        self.assertIs(recent[0], books[8])
        self.assertEqual(recent[0]["current_page"], 8)
        self.assertEqual(recent[0]["last_read_at"], "2025-01-01 12:00:00")

    def test_last_read_dates_do_not_mutate_input_and_empty_input_skips_db(self):
        self.reader.update_progress(7, 1, 1, 100.0)
        books = [{"id": 7}, {"id": 8, "title": "Unread"}]
        enriched = self.reader.add_last_read_dates(books)
        self.assertEqual(books, [{"id": 7}, {"id": 8, "title": "Unread"}])
        progress = self.reader.get_progress(7)
        assert progress is not None
        self.assertEqual(enriched[0]["last_read_at"], progress["last_read_at"])
        self.assertIsNone(enriched[1]["last_read_at"])
        empty = []
        with patch("app.services.reader_service.get_db") as get_db:
            self.assertIs(self.reader.add_last_read_dates(empty), empty)
        get_db.assert_not_called()

    def test_annotation_crud_rectangles_filters_and_original_uuid_patch(self):
        rects = [{"x": 1.5, "y": 2, "width": 3, "height": 4}]
        with patch("app.services.reader_service.uuid.uuid4", return_value="fixed-id"):
            annotation = self.reader.add_annotation(7, 3, "yellow", "un- derstood", rects=rects)
        self.assertEqual(annotation["id"], "fixed-id")
        self.assertEqual(annotation["text"], "understood")
        self.assertEqual(annotation["rects"], rects)
        self.assertEqual(set(annotation), {"id", "book_id", "page", "color", "category", "text", "comment", "rects", "created_at", "updated_at"})
        self.reader.add_annotation(7, 1, "blue", "Earlier", annot_id="earlier")
        self.assertEqual([a["id"] for a in self.reader.list_annotations(7)], ["earlier", "fixed-id"])
        self.assertEqual([a["id"] for a in self.reader.list_annotations(7, color="yellow")], ["fixed-id"])
        updated = self.reader.update_annotation("fixed-id", color="green", category="", comment="note")
        assert updated is not None
        self.assertEqual((updated["color"], updated["category"], updated["comment"]), ("green", "", "note"))
        self.assertEqual(self.reader.update_annotation("fixed-id"), updated)
        self.assertTrue(self.reader.delete_annotation("fixed-id"))
        self.assertFalse(self.reader.delete_annotation("fixed-id"))
        self.assertIsNone(self.reader.get_annotation("fixed-id"))
        self.assertIsNone(self.reader.update_annotation("missing", comment="note"))

    def test_annotation_self_patch_points_and_replace_semantics(self):
        self.reader.add_annotation(7, 2, "yellow", "first", annot_id="same")
        with patch.object(self.reader, "normalize_text", return_value="patched") as normalize:
            with patch.object(self.reader, "get_annotation", return_value={"sentinel": True}) as lookup:
                result = self.reader.add_annotation(8, 4, "blue", "second", annot_id="same")
        normalize.assert_called_once_with("second")
        lookup.assert_called_once_with("same")
        self.assertEqual(result, {"sentinel": True})
        self.assertEqual(self.reader.list_annotations(7), [])
        annotation = self.reader.get_annotation("same")
        assert annotation is not None
        self.assertEqual(annotation["text"], "patched")
        self.assertEqual(annotation["rects"], [])

    def test_markdown_exact_output_and_facade_dependencies(self):
        annotations = [{"page": 3, "color": "yellow", "text": "ani- mated", "comment": "A note"}]
        fake_calibre = SimpleNamespace(get_book=lambda book_id: {"title": "Title", "authors": "Author"})
        clock = SimpleNamespace(now=lambda: datetime(2025, 1, 2, 3, 4))
        with patch("app.services.reader_service.calibre_service", fake_calibre), patch("app.services.reader_service.datetime", clock), patch.object(self.reader, "list_annotations", return_value=annotations) as listing, patch.object(self.reader, "get_highlight_colors", return_value=[{"id": "yellow", "name": "Key Idea"}]):
            markdown = self.reader.export_annotations_markdown(7, color_filter="yellow")
            listing.assert_called_once_with(7, color="yellow")
            self.assertEqual(markdown, '# Notes & Highlights: Title\n**Author(s):** Author\n**Exported on:** 2025-01-02 03:04\n**Total quotes:** 1\n\n---\n\n## Key Idea (1)\n- **[Page 3]**: "animated"\n  > 💡 *Note:* A note\n')
            by_page = self.reader.export_annotations_markdown(7, group_by="page")
            self.assertTrue(by_page.endswith('### Page 3\n- *[Key Idea]* "animated"\n  > 💡 *Note:* A note\n'))
        with patch("app.services.reader_service.calibre_service", SimpleNamespace(get_book=lambda book_id: None)):
            empty = self.reader.export_annotations_markdown(42)
        self.assertIn("# Notes & Highlights: Book 42\n**Author(s):** Unknown", empty)
        self.assertTrue(empty.endswith("*No annotations found matching the selected criteria.*"))

    def test_settings_legacy_names_are_translated_without_persisting(self):
        colors = [{"id": "yellow", "name": "Idea Clave"}, {"id": "blue", "name": "Custom"}]
        self.assertIsNone(self.reader.set_highlight_colors(colors))
        self.assertEqual(self.reader.get_highlight_colors(), [{"id": "yellow", "name": "Key Idea"}, {"id": "blue", "name": "Custom"}])
        with self.get_db() as conn:
            stored = conn.execute("SELECT value FROM user_settings WHERE key = 'highlight_colors'").fetchone()[0]
            self.assertEqual(json.loads(stored), colors)
            conn.execute("DELETE FROM user_settings")
        self.assertEqual(self.reader.get_highlight_colors(), [])

    def test_drawings_upsert_response_and_clear_contract(self):
        self.assertEqual(self.reader.get_page_drawings(7, 2), [])
        strokes = [{"points": [[1, 2], [3, 4]], "color": "red"}]
        self.assertEqual(self.reader.save_page_drawings(7, 2, strokes), {"id": "7_2", "book_id": 7, "page": 2, "stroke_count": 1})
        self.assertEqual(self.reader.get_page_drawings(7, 2), strokes)
        self.reader.save_page_drawings(7, 2, [])
        self.assertEqual(self.reader.get_page_drawings(7, 2), [])
        with self.get_db() as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM page_drawings").fetchone()[0], 1)
        self.assertTrue(self.reader.clear_page_drawings(7, 2))
        self.assertTrue(self.reader.clear_page_drawings(7, 2))


class TestCalibreServiceRefactor(ServiceFixture):
    def test_cli_add_uses_original_module_binary_and_runner(self):
        with patch("app.services.calibre_service.CALIBREDB_BIN", "custom-calibredb"), patch("app.services.calibre_service.subprocess.run", return_value=SimpleNamespace(returncode=0, stdout="Added book ids: 42, 43\n", stderr="")) as run:
            self.assertEqual(self.calibre.add_book("input.epub", title="Title", authors="Author", tags="Tag", isbn="123"), 42)
        run.assert_called_once_with(["custom-calibredb", "add", "--with-library", str(self.calibre.library_path), "--title", "Title", "--authors", "Author", "--tags", "Tag", "--identifier", "isbn:123", "input.epub"], capture_output=True, text=True, check=False)

    def test_add_id_fallback_and_lock_error(self):
        with patch("app.services.calibre_service.subprocess.run", return_value=SimpleNamespace(returncode=0, stdout="No id", stderr="")):
            self.assertEqual(self.calibre.add_book("input.epub"), 7)
        with patch("app.services.calibre_service.subprocess.run", return_value=SimpleNamespace(returncode=1, stdout="", stderr="Another calibre program is running")), self.assertRaisesRegex(RuntimeError, "Please close the Calibre desktop app"):
            self.calibre.add_book("input.epub")

    def test_metadata_fields_empty_values_and_error_contract(self):
        with patch("app.services.calibre_service.CALIBREDB_BIN", "custom-calibredb"), patch("app.services.calibre_service.subprocess.run") as run:
            self.assertIsNone(self.calibre.update_metadata(7, title="", authors="A", tags="", series="S", series_index=0.0, comments="", isbn=" 123 "))
            self.assertEqual(run.call_args.args[0], ["custom-calibredb", "set_metadata", "--with-library", str(self.calibre.library_path), "7", "--field", "title:", "--field", "authors:A", "--field", "tags:", "--field", "series:S", "--field", "series_index:0.0", "--field", "comments:", "--field", "identifiers:isbn:123"])
            self.assertEqual(run.call_args.kwargs, {"capture_output": True, "text": True, "check": True})
            run.reset_mock()
            self.calibre.update_metadata(7, isbn=" ")
            run.assert_not_called()
        error = subprocess.CalledProcessError(1, "cmd", stderr=" failure ")
        with patch("app.services.calibre_service.subprocess.run", side_effect=error), self.assertRaisesRegex(RuntimeError, "^Error updating metadata with calibredb: failure$"):
            self.calibre.update_metadata(7, title="Title")

    def test_search_response_and_failure_fallback(self):
        raw_books = [{"id": 7, "title": "Title", "authors": "Author", "formats": ["EPUB"], "tags": "one, two", "timestamp": "date"}]
        with patch("app.services.calibre_service.subprocess.run", return_value=SimpleNamespace(stdout=json.dumps(raw_books))) as run:
            books = self.calibre.list_books(search_query="  title:Title  ")
        self.assertEqual(books, [{"id": 7, "title": "Title", "authors": "Author", "formats": ["EPUB"], "tags": ["one", "two"], "series": None, "pubdate": None, "date_added": "date", "comments": None, "has_cover": False, "cover_url": None}])
        self.assertIn("title:Title", run.call_args.args[0])
        with patch("app.services.calibre_service.subprocess.run", side_effect=RuntimeError("failure")), patch.object(self.calibre, "get_db_connection", return_value=None) as get_db, patch("builtins.print"):
            self.assertEqual(self.calibre.list_books(search_query="query"), [])
        get_db.assert_called_once_with()

    def test_ensure_library_retains_warning_and_noop(self):
        with patch("app.services.calibre_service.subprocess.run") as run:
            self.calibre.ensure_library()
        run.assert_not_called()
        empty = CalibreService(str(self.root / "empty"))
        with patch("app.services.calibre_service.subprocess.run", side_effect=FileNotFoundError("missing")), patch("builtins.print") as warning:
            self.assertIsNone(empty.ensure_library())
        self.assertTrue(empty.library_path.is_dir())
        self.assertIn("Warning: Could not run calibredb to init library: missing", warning.call_args.args[0])

    def test_conversion_cache_source_change_and_original_binary_patch(self):
        with patch("app.services.calibre_service.EBOOK_CONVERT_BIN", "custom-convert"), patch("app.services.calibre_service.subprocess.run", side_effect=self.convert) as run:
            first = self.calibre.get_pdf_path(7)
            self.assertEqual(self.calibre.get_pdf_path(7), first)
            self.assertEqual(run.call_count, 1)
            self.epub.write_bytes(b"changed epub fixture")
            second = self.calibre.get_pdf_path(7)
            self.assertNotEqual(first, second)
            self.assertEqual(run.call_count, 2)
            self.assertEqual(run.call_args.args[0][:2], ["custom-convert", str(self.epub)])
        assert first is not None
        self.assertEqual(first.parent, self.calibre.converted_pdf_dir)
        self.assertEqual(list(self.book_dir.iterdir()), [self.epub])

    def test_conversion_keeps_per_book_locks_and_serializes_work(self):
        locks = self.calibre._conversion_locks
        guard = self.calibre._conversion_locks_guard

        def convert(command, **kwargs):
            time.sleep(0.02)
            return self.convert(command, **kwargs)

        with patch("app.services.calibre_service.subprocess.run", side_effect=convert) as run:
            with ThreadPoolExecutor(max_workers=4) as executor:
                paths = list(executor.map(lambda _: self.calibre.convert_epub_to_pdf(7, self.epub), range(4)))
        self.assertEqual(run.call_count, 1)
        self.assertEqual(len(set(paths)), 1)
        self.assertIs(self.calibre._conversion_locks, locks)
        self.assertIs(self.calibre._conversion_locks_guard, guard)
        self.assertIn(7, locks)

    def test_conversion_invalid_output_and_cli_errors_leave_no_files(self):
        errors = [
            (FileNotFoundError(), "ebook-convert was not found. Please install Calibre or set EBOOK_CONVERT_BIN."),
            (subprocess.CalledProcessError(1, "cmd", stderr=" detail "), "Calibre could not convert the EPUB to PDF. detail"),
            (OSError("denied"), "Could not execute ebook-convert: denied"),
        ]
        for error, message in errors:
            with self.subTest(error=type(error).__name__), patch("app.services.calibre_service.subprocess.run", side_effect=error):
                with self.assertRaises(RuntimeError) as raised:
                    self.calibre.convert_epub_to_pdf(7, self.epub)
                self.assertEqual(str(raised.exception), message)
                self.assertIs(raised.exception.__cause__, error)
            self.assertEqual(list(self.calibre.converted_pdf_dir.iterdir()), [])

        def invalid(command, **kwargs):
            Path(command[-1]).write_bytes(b"not a PDF")

        with patch("app.services.calibre_service.subprocess.run", side_effect=invalid), self.assertRaisesRegex(RuntimeError, "Calibre did not generate a valid PDF"):
            self.calibre.convert_epub_to_pdf(7, self.epub)
        self.assertEqual(list(self.calibre.converted_pdf_dir.iterdir()), [])

    def test_pdf_validation_and_self_patch_point(self):
        self.assertFalse(CalibreService._is_valid_pdf(self.root / "missing.pdf"))
        with patch.object(self.calibre, "_is_valid_pdf", return_value=True) as valid, patch("app.services.calibre_service.subprocess.run") as run:
            path = self.calibre.convert_epub_to_pdf(7, self.epub)
        valid.assert_called_once_with(path)
        run.assert_not_called()
        self.assertEqual(self.calibre._conversion_locks, {})

    def test_delete_preserves_database_cleanup_cache_scope_and_order(self):
        self.reader.update_progress(7, 1, 1, 100.0)
        self.reader.add_annotation(7, 1, "yellow", "quote", annot_id="quote")
        self.reader.save_page_drawings(7, 1, [{"points": []}])
        with self.get_db() as conn:
            conn.execute("INSERT INTO virtual_libraries (name, type, book_ids) VALUES ('Manual', 'manual', '[7, 8]')")
            conn.execute("INSERT INTO virtual_libraries (name, type, book_ids) VALUES ('Query', 'query', '[7]')")
        self.calibre.converted_pdf_dir.mkdir()
        removed = self.calibre.converted_pdf_dir / "7-fixture.pdf"
        kept = self.calibre.converted_pdf_dir / "8-fixture.pdf"
        removed.write_bytes(b"%PDF-")
        kept.write_bytes(b"%PDF-")

        def remove(command, **kwargs):
            self.assertTrue(removed.exists())
            self.assertIsNotNone(self.reader.get_progress(7))
            return SimpleNamespace(stdout="", stderr="")

        with patch("app.database.get_db", self.get_db), patch("app.services.calibre_service.subprocess.run", side_effect=remove) as run:
            self.assertTrue(self.calibre.delete_book(7))
        self.assertEqual(run.call_args.args[0][1:], ["remove", "7", "--with-library", str(self.calibre.library_path), "--permanent"])
        self.assertIsNone(self.reader.get_progress(7))
        self.assertEqual(self.reader.list_annotations(7), [])
        self.assertEqual(self.reader.get_page_drawings(7, 1), [])
        self.assertFalse(removed.exists())
        self.assertTrue(kept.exists())
        with self.get_db() as conn:
            rows = conn.execute("SELECT book_ids FROM virtual_libraries ORDER BY id").fetchall()
        self.assertEqual([json.loads(row[0]) for row in rows], [[8], [7]])

    def test_failed_delete_does_not_clean_state_or_cache(self):
        error = subprocess.CalledProcessError(1, "cmd", stderr=" failure ")
        with patch("app.services.calibre_service.subprocess.run", side_effect=error), patch.object(self.calibre, "_cleanup_converted_pdfs") as cleanup, patch("app.database.get_db") as get_db:
            with self.assertRaisesRegex(RuntimeError, "^Error deleting book with calibredb: failure$"):
                self.calibre.delete_book(7)
        cleanup.assert_not_called()
        get_db.assert_not_called()


if __name__ == "__main__":
    unittest.main()
