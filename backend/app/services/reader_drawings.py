"""Freehand page drawing persistence."""

from typing import Any, Dict, List


def get_page_drawings(self, book_id: int, page: int, *, get_db, json) -> List[Dict[str, Any]]:
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT strokes FROM page_drawings WHERE book_id = ? AND page = ?", (book_id, page))
        row = cursor.fetchone()
        if not row:
            return []
        return json.loads(row["strokes"] or "[]")


def save_page_drawings(self, book_id: int, page: int, strokes: List[Dict[str, Any]], *, get_db, json) -> Dict[str, Any]:
    draw_id = f"{book_id}_{page}"
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
                INSERT INTO page_drawings (id, book_id, page, strokes, updated_at)
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(id) DO UPDATE SET strokes = excluded.strokes, updated_at = CURRENT_TIMESTAMP
            """, (draw_id, book_id, page, json.dumps(strokes)))
        conn.commit()
        return {"id": draw_id, "book_id": book_id, "page": page, "stroke_count": len(strokes)}


def clear_page_drawings(self, book_id: int, page: int, *, get_db) -> bool:
    draw_id = f"{book_id}_{page}"
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM page_drawings WHERE id = ?", (draw_id,))
        conn.commit()
        return True
