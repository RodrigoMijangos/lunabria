import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from app.config import EBOOK_CONVERT_BIN
from app.services.calibre_service import CalibreService


class TestEpubPdfConversion(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory(prefix="lunabria-conversion-")
        self.root = Path(self.temp_dir.name)
        self.library_path = self.root / "library"
        self.book_dir = self.library_path / "Author" / "Test Book (7)"
        self.book_dir.mkdir(parents=True)
        self.epub_path = self.book_dir / "Test Book.epub"
        self.epub_path.write_bytes(b"test epub content")
        self.database_path = self.library_path / "metadata.db"
        self.converted_pdf_dir = self.root / "converted-pdfs"

        with closing(sqlite3.connect(self.database_path)) as conn, conn:
            conn.execute("CREATE TABLE books (id INTEGER PRIMARY KEY, path TEXT)")
            conn.execute("CREATE TABLE data (book INTEGER, name TEXT, format TEXT)")
            conn.execute(
                "INSERT INTO books (id, path) VALUES (?, ?)",
                (7, "Author/Test Book (7)"),
            )
            conn.execute(
                "INSERT INTO data (book, name, format) VALUES (?, ?, ?)",
                (7, "Test Book", "EPUB"),
            )

        self.service = CalibreService(
            library_path=str(self.library_path),
            converted_pdf_dir=self.converted_pdf_dir,
        )

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_epub_is_converted_and_cached_outside_calibre_library(self):
        def convert(command, **kwargs):
            Path(command[-1]).write_bytes(b"%PDF-1.4 converted fixture")
            return SimpleNamespace(stdout="", stderr="")

        with patch(
            "app.services.calibre_service.subprocess.run", side_effect=convert
        ) as run:
            first_path = self.service.get_pdf_path(7)
            second_path = self.service.get_pdf_path(7)

        if first_path is None or second_path is None:
            self.fail("Expected the EPUB to be converted into a PDF")

        self.assertEqual(first_path, second_path)
        self.assertEqual(first_path.read_bytes()[:5], b"%PDF-")
        self.assertNotEqual(first_path.parent, self.book_dir)
        self.assertEqual(run.call_count, 1)
        self.assertEqual(
            run.call_args.args[0][:2],
            [EBOOK_CONVERT_BIN, str(self.epub_path)],
        )

    def test_native_pdf_is_used_without_conversion(self):
        native_pdf = self.book_dir / "Native.pdf"
        native_pdf.write_bytes(b"%PDF-1.4 native fixture")
        with closing(sqlite3.connect(self.database_path)) as conn, conn:
            conn.execute(
                "INSERT INTO data (book, name, format) VALUES (?, ?, ?)",
                (7, "Native", "PDF"),
            )

        with patch("app.services.calibre_service.subprocess.run") as run:
            self.assertEqual(self.service.get_pdf_path(7), native_pdf)
        run.assert_not_called()

    def test_missing_converter_returns_actionable_error(self):
        with (
            patch(
                "app.services.calibre_service.subprocess.run",
                side_effect=FileNotFoundError,
            ),
            self.assertRaisesRegex(RuntimeError, "EBOOK_CONVERT_BIN"),
        ):
            self.service.get_pdf_path(7)


if __name__ == "__main__":
    unittest.main()
