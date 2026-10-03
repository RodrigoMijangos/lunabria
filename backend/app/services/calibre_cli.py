"""Calibre CLI operations; dependencies are supplied by the public service."""

from typing import Any, Dict, List, Optional


def ensure_library(self, *, CALIBREDB_BIN, subprocess):
    """Ensures the Calibre library exists or creates an empty one for testing."""
    if not self.db_path.exists():
        self.library_path.mkdir(parents=True, exist_ok=True)
        # Run calibredb to initialize an empty library
        try:
            subprocess.run(
                [CALIBREDB_BIN, "list", "--with-library", str(self.library_path)],
                capture_output=True,
                text=True,
                check=False
            )
        except Exception as e:
            print(f"Warning: Could not run calibredb to init library: {e}")


def add_book(self, file_path: str, title: Optional[str] = None, authors: Optional[str] = None, tags: Optional[str] = None, isbn: Optional[str] = None, *, CALIBREDB_BIN, subprocess) -> int:
    """Adds a book to Calibre using calibredb add."""
    cmd = [CALIBREDB_BIN, "add", "--with-library", str(self.library_path)]
    if title:
        cmd.extend(["--title", title])
    if authors:
        cmd.extend(["--authors", authors])
    if tags:
        cmd.extend(["--tags", tags])
    if isbn:
        cmd.extend(["--identifier", f"isbn:{isbn}"])
    cmd.append(str(file_path))

    result = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        err_msg = (result.stderr or result.stdout or "").strip()
        if "Another calibre program" in err_msg:
            raise RuntimeError(
                "Calibre desktop application is currently open. "
                "Calibre blocks database modifications while running to prevent corruption. "
                "Please close the Calibre desktop app (or enable Calibre Content Server) and try uploading again."
            )
        raise RuntimeError(f"Error adding book with calibredb: {err_msg}")

    # Parse returned book id (e.g., "Added book ids: 42")
    output = result.stdout
    for line in output.splitlines():
        if "Added book ids:" in line:
            id_str = line.split(":")[-1].strip().split(",")[0].strip()
            return int(id_str)

    # Fallback: get highest id from db
    conn = self.get_db_connection()
    if conn:
        cursor = conn.cursor()
        cursor.execute("SELECT MAX(id) as max_id FROM books")
        row = cursor.fetchone()
        conn.close()
        if row and row["max_id"]:
            return int(row["max_id"])
    raise RuntimeError(f"Could not determine new book ID from calibredb: {output}")


def update_metadata(self, book_id: int, title: Optional[str] = None, authors: Optional[str] = None, tags: Optional[str] = None, series: Optional[str] = None, series_index: Optional[float] = None, comments: Optional[str] = None, isbn: Optional[str] = None, *, CALIBREDB_BIN, subprocess):
    """Updates book metadata using calibredb set_metadata."""
    fields = []
    if title is not None:
        fields.append(f"title:{title}")
    if authors is not None:
        fields.append(f"authors:{authors}")
    if tags is not None:
        fields.append(f"tags:{tags}")
    if series is not None:
        fields.append(f"series:{series}")
    if series_index is not None:
        fields.append(f"series_index:{series_index}")
    if comments is not None:
        fields.append(f"comments:{comments}")
    if isbn is not None and isbn.strip():
        fields.append(f"identifiers:isbn:{isbn.strip()}")

    if not fields:
        return

    cmd = [CALIBREDB_BIN, "set_metadata", "--with-library", str(self.library_path), str(book_id)]
    for f in fields:
        cmd.extend(["--field", f])

    try:
        subprocess.run(cmd, capture_output=True, text=True, check=True)
    except subprocess.CalledProcessError as e:
        err_msg = (e.stderr or e.stdout or str(e)).strip()
        raise RuntimeError(f"Error updating metadata with calibredb: {err_msg}")


def search_books(self, search_query: str, *, CALIBREDB_BIN, subprocess, json) -> Optional[List[Dict[str, Any]]]:
    try:
        cmd = [
            CALIBREDB_BIN, "list",
            "--with-library", str(self.library_path),
            "--search", search_query.strip(),
            "--fields", "id,title,authors,formats,tags,series,pubdate,comments,timestamp",
            "--for-machine"
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        raw_books = json.loads(result.stdout)

        # Format response
        books = []
        for b in raw_books:
            book_id = b.get("id")
            cover_file = self.get_cover_path(book_id)
            books.append({
                "id": book_id,
                "title": b.get("title", "Untitled"),
                "authors": b.get("authors", "Unknown"),
                "formats": b.get("formats", []),
                "tags": [t.strip() for t in b.get("tags", "").split(",") if t.strip()] if isinstance(b.get("tags"), str) else (b.get("tags") or []),
                "series": b.get("series"),
                "pubdate": b.get("pubdate"),
                "date_added": b.get("timestamp"),
                "comments": b.get("comments"),
                "has_cover": cover_file is not None and cover_file.exists(),
                "cover_url": f"/api/books/{book_id}/cover" if cover_file and cover_file.exists() else None
            })
        return books
    except Exception as e:
        print(f"calibredb search failed: {e}. Falling back to SQLite.")


def remove_book(self, book_id: int, *, CALIBREDB_BIN, subprocess) -> None:
    cmd = [CALIBREDB_BIN, "remove", str(book_id), "--with-library", str(self.library_path), "--permanent"]
    try:
        subprocess.run(cmd, capture_output=True, text=True, check=True)
    except subprocess.CalledProcessError as e:
        err_msg = (e.stderr or e.stdout or str(e)).strip()
        raise RuntimeError(f"Error deleting book with calibredb: {err_msg}")
