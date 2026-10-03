import json
import os
import sqlite3
import subprocess
import tempfile
import threading
from pathlib import Path
from typing import Optional, List, Dict, Any

from app.config import (
    CALIBRE_LIBRARY_PATH,
    CALIBREDB_BIN,
    CONVERTED_PDF_DIR,
    EBOOK_CONVERT_BIN,
)
from app.services.pdf_layout_service import pdf_layout_service
from app.services.metadata_service import metadata_service
from app.services import calibre_cli, calibre_conversion

class CalibreService:
    # Resolve dependencies here so patches on this module remain effective after extraction.
    def __init__(
        self,
        library_path: str = CALIBRE_LIBRARY_PATH,
        converted_pdf_dir: Path = CONVERTED_PDF_DIR,
    ):
        self.library_path = Path(library_path)
        self.db_path = self.library_path / "metadata.db"
        self.converted_pdf_dir = Path(converted_pdf_dir)
        self._conversion_locks: dict[int, Any] = {}
        self._conversion_locks_guard = threading.Lock()

    def ensure_library(self):
        """Ensures the Calibre library exists or creates an empty one for testing."""
        return calibre_cli.ensure_library(self, CALIBREDB_BIN=CALIBREDB_BIN, subprocess=subprocess)

    def get_db_connection(self) -> Optional[sqlite3.Connection]:
        """Provides direct read-only connection to Calibre's metadata.db for high performance."""
        if not self.db_path.exists():
            return None
        # uri=True allows opening in read-only mode (file:... ?mode=ro)
        try:
            uri = f"file:{self.db_path.resolve()}?mode=ro"
            conn = sqlite3.connect(uri, uri=True)
            conn.row_factory = sqlite3.Row
            return conn
        except Exception:
            # Fallback to standard connect
            conn = sqlite3.connect(str(self.db_path))
            conn.row_factory = sqlite3.Row
            return conn

    def list_books(self, search_query: Optional[str] = None, book_ids: Optional[List[int]] = None) -> List[Dict[str, Any]]:
        """
        Lists books from Calibre.
        Uses calibredb search if search_query is provided, or direct SQLite if listing / filtering by IDs.
        """
        self.ensure_library()
        
        # If specific Calibre search query is provided, use calibredb search
        if search_query and search_query.strip():
            books = calibre_cli.search_books(
                self, search_query, CALIBREDB_BIN=CALIBREDB_BIN,
                subprocess=subprocess, json=json,
            )
            if books is not None:
                return books

        # High-performance direct SQLite query
        conn = self.get_db_connection()
        if not conn:
            return []

        try:
            cursor = conn.cursor()
            query = """
                SELECT 
                    b.id, 
                    b.title, 
                    b.path, 
                    b.pubdate,
                    b.timestamp as date_added,
                    b.series_index,
                    (SELECT group_concat(a.name, ', ') FROM books_authors_link bal JOIN authors a ON bal.author = a.id WHERE bal.book = b.id) as authors,
                    (SELECT group_concat(t.name, ', ') FROM books_tags_link btl JOIN tags t ON btl.tag = t.id WHERE btl.book = b.id) as tags,
                    (SELECT s.name FROM books_series_link bsl JOIN series s ON bsl.series = s.id WHERE bsl.book = b.id) as series,
                    (SELECT group_concat(d.format, ',') FROM data d WHERE d.book = b.id) as formats,
                    (SELECT c.text FROM comments c WHERE c.book = b.id) as comments,
                    (SELECT val FROM identifiers WHERE book = b.id AND type = 'isbn' LIMIT 1) as isbn
                FROM books b
            """
            params = []
            if book_ids is not None:
                if not book_ids:
                    return []
                placeholders = ",".join("?" for _ in book_ids)
                query += f" WHERE b.id IN ({placeholders})"
                params.extend(book_ids)
            
            query += " ORDER BY b.id DESC"
            cursor.execute(query, params)
            rows = cursor.fetchall()

            books = []
            for row in rows:
                book_id = row["id"]
                formats_str = row["formats"] or ""
                formats_list = [f.strip() for f in formats_str.split(",") if f.strip()]
                tags_str = row["tags"] or ""
                tags_list = [t.strip() for t in tags_str.split(",") if t.strip()]
                
                cover_path = self.get_cover_path(book_id, row["path"])
                has_cover = cover_path is not None and cover_path.exists()

                books.append({
                    "id": book_id,
                    "title": row["title"] or "Untitled",
                    "authors": row["authors"] or "Unknown",
                    "formats": formats_list,
                    "tags": tags_list,
                    "series": row["series"],
                    "series_index": row["series_index"],
                    "pubdate": row["pubdate"],
                    "date_added": row["date_added"],
                    "comments": row["comments"],
                    "isbn": row["isbn"],
                    "has_cover": has_cover,
                    "cover_url": f"/api/books/{book_id}/cover" if has_cover else None
                })
            return books
        finally:
            conn.close()

    def get_book(self, book_id: int) -> Optional[Dict[str, Any]]:
        books = self.list_books(book_ids=[book_id])
        return books[0] if books else None

    def get_book_dir(self, book_id: int, relative_path: Optional[str] = None) -> Optional[Path]:
        if relative_path:
            p = self.library_path / relative_path
            if p.exists():
                return p
        
        conn = self.get_db_connection()
        if not conn:
            return None
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT path FROM books WHERE id = ?", (book_id,))
            row = cursor.fetchone()
            if row and row["path"]:
                return self.library_path / row["path"]
            return None
        finally:
            conn.close()

    def get_pdf_path(self, book_id: int) -> Optional[Path]:
        """Returns a native PDF or converts an EPUB to a cached PDF on demand."""
        conn = self.get_db_connection()
        if not conn:
            return None
        try:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT b.path, d.name
                FROM books b
                JOIN data d ON b.id = d.book
                WHERE b.id = ? AND UPPER(d.format) = 'PDF'
            """, (book_id,))
            row = cursor.fetchone()
            if row and row["path"] and row["name"]:
                pdf_file = self.library_path / row["path"] / f"{row['name']}.pdf"
                if pdf_file.exists():
                    return pdf_file
        finally:
            conn.close()

        book_dir = self.get_book_dir(book_id)
        if book_dir and book_dir.exists():
            for file_path in book_dir.iterdir():
                if file_path.suffix.lower() == ".pdf":
                    return file_path

        epub_path = self.get_epub_path(book_id)
        if epub_path:
            return self.convert_epub_to_pdf(book_id, epub_path)
        return None

    def get_epub_path(self, book_id: int) -> Optional[Path]:
        """Returns the EPUB file registered for a book in Calibre."""
        conn = self.get_db_connection()
        if not conn:
            return None
        try:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT b.path, d.name
                FROM books b
                JOIN data d ON b.id = d.book
                WHERE b.id = ? AND UPPER(d.format) = 'EPUB'
            """, (book_id,))
            row = cursor.fetchone()
            if row and row["path"] and row["name"]:
                epub_file = self.library_path / row["path"] / f"{row['name']}.epub"
                if epub_file.exists():
                    return epub_file
        finally:
            conn.close()

        book_dir = self.get_book_dir(book_id)
        if book_dir and book_dir.exists():
            for file_path in book_dir.iterdir():
                if file_path.suffix.lower() == ".epub":
                    return file_path
        return None

    def convert_epub_to_pdf(self, book_id: int, epub_path: Path) -> Path:
        """Converts an EPUB into a cached PDF without modifying the Calibre library."""
        return calibre_conversion.convert_epub_to_pdf(
            self,
            book_id,
            epub_path,
            EBOOK_CONVERT_BIN=EBOOK_CONVERT_BIN,
            Path=Path,
            os=os,
            subprocess=subprocess,
            tempfile=tempfile,
            threading=threading,
        )

    @staticmethod
    def _is_valid_pdf(file_path: Path) -> bool:
        return calibre_conversion._is_valid_pdf(file_path)

    def get_page_layout(self, book_id: int, page_number: int) -> Optional[Dict[str, Any]]:
        """Extracts pixel-perfect word bounding boxes for a given page using PdfLayoutService."""
        pdf_path = self.get_pdf_path(book_id)
        if not pdf_path:
            return None
        return pdf_layout_service.extract_page_layout(pdf_path, page_number)

    def get_page_layouts_batch(self, book_id: int, start_page: int, end_page: int) -> Optional[Dict[str, Any]]:
        """Extracts pixel-perfect word & line layouts for a range of pages using PdfLayoutService."""
        pdf_path = self.get_pdf_path(book_id)
        if not pdf_path:
            return None
        batch = pdf_layout_service.extract_page_layouts_batch(pdf_path, start_page, end_page)
        if batch:
            batch["book_id"] = book_id
        return batch

    def get_cover_path(self, book_id: int, relative_path: Optional[str] = None) -> Optional[Path]:
        book_dir = self.get_book_dir(book_id, relative_path)
        if book_dir and book_dir.exists():
            cover = book_dir / "cover.jpg"
            if cover.exists():
                return cover
        return None

    def add_book(self, file_path: str, title: Optional[str] = None, authors: Optional[str] = None, tags: Optional[str] = None, isbn: Optional[str] = None) -> int:
        """Adds a book to Calibre using calibredb add."""
        return calibre_cli.add_book(
            self,
            file_path,
            title,
            authors,
            tags,
            isbn,
            CALIBREDB_BIN=CALIBREDB_BIN,
            subprocess=subprocess,
        )

    def delete_book(self, book_id: int) -> bool:
        """
        Permanently removes a book from Calibre library using calibredb remove --permanent.
        Also cleans up internal app state (reading progress, annotations, manual virtual library entries).
        """
        from app.database import get_db
        self.ensure_library()
        calibre_cli.remove_book(self, book_id, CALIBREDB_BIN=CALIBREDB_BIN, subprocess=subprocess)

        self._cleanup_converted_pdfs(book_id)

        # Clean up related records in app_state.db
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM reading_progress WHERE book_id = ?", (book_id,))
            cursor.execute("DELETE FROM annotations WHERE book_id = ?", (book_id,))
            cursor.execute("DELETE FROM page_drawings WHERE book_id = ?", (book_id,))
            cursor.execute("SELECT id, book_ids FROM virtual_libraries WHERE type = 'manual'")
            rows = cursor.fetchall()
            for r in rows:
                b_ids = json.loads(r["book_ids"] or "[]")
                if book_id in b_ids:
                    b_ids.remove(book_id)
                    cursor.execute("UPDATE virtual_libraries SET book_ids = ? WHERE id = ?", (json.dumps(b_ids), r["id"]))
            conn.commit()

        return True

    def _cleanup_converted_pdfs(self, book_id: int) -> None:
        return calibre_conversion._cleanup_converted_pdfs(self, book_id)

    def update_metadata(self, book_id: int, title: Optional[str] = None, authors: Optional[str] = None, tags: Optional[str] = None, series: Optional[str] = None, series_index: Optional[float] = None, comments: Optional[str] = None, isbn: Optional[str] = None):
        """Updates book metadata using calibredb set_metadata."""
        return calibre_cli.update_metadata(
            self,
            book_id,
            title,
            authors,
            tags,
            series,
            series_index,
            comments,
            isbn,
            CALIBREDB_BIN=CALIBREDB_BIN,
            subprocess=subprocess,
        )

    def fetch_metadata(self, isbn: Optional[str] = None, title: Optional[str] = None, authors: Optional[str] = None) -> Dict[str, Any]:
        """Uses MetadataService to scrape online metadata by ISBN or title/authors."""
        return metadata_service.fetch_online_metadata(isbn=isbn, title=title, authors=authors)

calibre_service = CalibreService()
