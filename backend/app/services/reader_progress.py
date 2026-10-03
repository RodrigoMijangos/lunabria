"""Reading progress persistence and recent-book enrichment."""

from typing import Any, Dict, List, Optional


def update_progress(self, book_id: int, current_page: int, total_pages: int, percentage: float, *, get_db):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
                INSERT INTO reading_progress (book_id, current_page, total_pages, percentage, last_read_at)
                VALUES (?, ?, ?, ?, strftime('%Y-%m-%d %H:%M:%f', 'now'))
                ON CONFLICT(book_id) DO UPDATE SET
                    current_page = excluded.current_page,
                    total_pages = excluded.total_pages,
                    percentage = excluded.percentage,
                    last_read_at = excluded.last_read_at
            """, (book_id, current_page, total_pages, percentage))
        conn.commit()


def mark_book_opened(
    self,
    book_id: int,
    current_page: int,
    total_pages: int,
    percentage: float,
    *,
    get_db,
) -> None:
    with get_db() as conn:
        conn.execute("""
                INSERT INTO reading_progress (book_id, current_page, total_pages, percentage, last_read_at)
                VALUES (?, ?, ?, ?, strftime('%Y-%m-%d %H:%M:%f', 'now'))
                ON CONFLICT(book_id) DO UPDATE SET
                    last_read_at = excluded.last_read_at
            """, (book_id, current_page, total_pages, percentage))
        conn.commit()


def get_progress(self, book_id: int, *, get_db) -> Optional[Dict[str, Any]]:
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM reading_progress WHERE book_id = ?", (book_id,))
        row = cursor.fetchone()
        if not row:
            return None
        return {
            "book_id": row["book_id"],
            "current_page": row["current_page"],
            "total_pages": row["total_pages"],
            "percentage": row["percentage"],
            "last_read_at": row["last_read_at"]
        }


def add_last_read_dates(self, books: List[Dict[str, Any]], *, get_db) -> List[Dict[str, Any]]:
    if not books:
        return books

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT book_id, last_read_at FROM reading_progress")
        last_read_by_id = {row["book_id"]: row["last_read_at"] for row in cursor.fetchall()}

    return [
        {**book, "last_read_at": last_read_by_id.get(book["id"])}
        for book in books
    ]


def get_top_recent_books(self, limit: int = 10, *, calibre_service, get_db) -> List[Dict[str, Any]]:
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
                SELECT * FROM reading_progress
                ORDER BY last_read_at DESC, book_id DESC
                LIMIT ?
            """, (limit,))
        rows = cursor.fetchall()

        recent = []
        for row in rows:
            book_id = row["book_id"]
            book_data = calibre_service.get_book(book_id)
            if book_data:
                book_data["current_page"] = row["current_page"]
                book_data["total_pages"] = row["total_pages"]
                book_data["percentage"] = row["percentage"]
                book_data["last_read_at"] = row["last_read_at"]
                recent.append(book_data)
        return recent
