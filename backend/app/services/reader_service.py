import re
import json
import uuid
from typing import List, Optional, Dict, Any
from datetime import datetime
from app.database import get_db
from app.services.calibre_service import calibre_service

class ReaderService:
    @staticmethod
    def normalize_text(text: str) -> str:
        if not text:
            return ""
        # 1. Join words hyphenated across line endings: e.g. "ani- mated" -> "animated", "un- derstood" -> "understood"
        # Supports standard hyphen (-), unicode hyphen (‐), and soft hyphen (\xad)
        text = re.sub(r'(\b\w+)[-‐\xad]\s+([a-zA-ZáéíóúÁÉÍÓÚñÑ]\w*\b)', r'\1\2', text)
        # 2. Collapse excessive horizontal whitespace
        text = re.sub(r'[ \t]{2,}', ' ', text)
        return text.strip()

    # --- Reading Progress (Top 10 Recents) ---
    def update_progress(self, book_id: int, current_page: int, total_pages: int, percentage: float):
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
        percentage: float
    ) -> None:
        with get_db() as conn:
            conn.execute("""
                INSERT INTO reading_progress (book_id, current_page, total_pages, percentage, last_read_at)
                VALUES (?, ?, ?, ?, strftime('%Y-%m-%d %H:%M:%f', 'now'))
                ON CONFLICT(book_id) DO UPDATE SET
                    last_read_at = excluded.last_read_at
            """, (book_id, current_page, total_pages, percentage))
            conn.commit()

    def get_progress(self, book_id: int) -> Optional[Dict[str, Any]]:
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

    def add_last_read_dates(self, books: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
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

    def get_top_recent_books(self, limit: int = 10) -> List[Dict[str, Any]]:
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

    # --- Annotations & Highlights ---
    def add_annotation(self, book_id: int, page: int, color: str, text: str, 
                       category: str = "", comment: str = "", rects: Optional[List[Dict[str, Any]]] = None,
                       annot_id: Optional[str] = None) -> Dict[str, Any]:
        annot_id = annot_id or str(uuid.uuid4())
        text = self.normalize_text(text)
        rects_json = json.dumps(rects or [])
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT OR REPLACE INTO annotations (id, book_id, page, color, category, text, comment, rects, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            """, (annot_id, book_id, page, color, category, text, comment, rects_json))
            conn.commit()
            return self.get_annotation(annot_id)

    def get_annotation(self, annot_id: str) -> Optional[Dict[str, Any]]:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM annotations WHERE id = ?", (annot_id,))
            row = cursor.fetchone()
            if not row:
                return None
            return {
                "id": row["id"],
                "book_id": row["book_id"],
                "page": row["page"],
                "color": row["color"],
                "category": row["category"],
                "text": row["text"],
                "comment": row["comment"],
                "rects": json.loads(row["rects"] or "[]"),
                "created_at": row["created_at"],
                "updated_at": row["updated_at"]
            }

    def list_annotations(self, book_id: int, color: Optional[str] = None) -> List[Dict[str, Any]]:
        with get_db() as conn:
            cursor = conn.cursor()
            if color:
                cursor.execute("""
                    SELECT * FROM annotations 
                    WHERE book_id = ? AND color = ? 
                    ORDER BY page ASC, created_at ASC
                """, (book_id, color))
            else:
                cursor.execute("""
                    SELECT * FROM annotations 
                    WHERE book_id = ? 
                    ORDER BY page ASC, created_at ASC
                """, (book_id,))
            rows = cursor.fetchall()
            return [{
                "id": r["id"],
                "book_id": r["book_id"],
                "page": r["page"],
                "color": r["color"],
                "category": r["category"],
                "text": r["text"],
                "comment": r["comment"],
                "rects": json.loads(r["rects"] or "[]"),
                "created_at": r["created_at"],
                "updated_at": r["updated_at"]
            } for r in rows]

    def update_annotation(self, annot_id: str, color: Optional[str] = None, 
                          category: Optional[str] = None, comment: Optional[str] = None) -> Optional[Dict[str, Any]]:
        with get_db() as conn:
            cursor = conn.cursor()
            updates = []
            params = []
            if color is not None:
                updates.append("color = ?")
                params.append(color)
            if category is not None:
                updates.append("category = ?")
                params.append(category)
            if comment is not None:
                updates.append("comment = ?")
                params.append(comment)
            
            if updates:
                updates.append("updated_at = CURRENT_TIMESTAMP")
                params.append(annot_id)
                cursor.execute(f"UPDATE annotations SET {', '.join(updates)} WHERE id = ?", params)
                conn.commit()
            return self.get_annotation(annot_id)

    def delete_annotation(self, annot_id: str) -> bool:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM annotations WHERE id = ?", (annot_id,))
            conn.commit()
            return cursor.rowcount > 0

    # --- Export Highlights & Notes ---
    def export_annotations_markdown(self, book_id: int, color_filter: Optional[str] = None, group_by: str = "color") -> str:
        book = calibre_service.get_book(book_id) or {"title": f"Book {book_id}", "authors": "Unknown"}
        annotations = self.list_annotations(book_id, color=color_filter)
        
        # Colors dictionary for labels
        colors_meta = {c["id"]: c for c in self.get_highlight_colors()}

        md = []
        md.append(f"# Notes & Highlights: {book['title']}")
        md.append(f"**Author(s):** {book['authors']}")
        md.append(f"**Exported on:** {datetime.now().strftime('%Y-%m-%d %H:%M')}")
        md.append(f"**Total quotes:** {len(annotations)}\n")
        md.append("---\n")

        if not annotations:
            md.append("*No annotations found matching the selected criteria.*")
            return "\n".join(md)

        if group_by == "color":
            # Group by color
            by_color = {}
            for a in annotations:
                c = a["color"]
                by_color.setdefault(c, []).append(a)

            for color_key, items in by_color.items():
                label = colors_meta.get(color_key, {}).get("name", color_key.capitalize())
                md.append(f"## {label} ({len(items)})")
                for item in items:
                    clean_text = self.normalize_text(item['text'])
                    md.append(f"- **[Page {item['page']}]**: \"{clean_text}\"")
                    if item.get("comment"):
                        md.append(f"  > 💡 *Note:* {item['comment']}")
                md.append("")
        else:
            # Group by Page
            current_page = None
            for item in annotations:
                if item["page"] != current_page:
                    current_page = item["page"]
                    md.append(f"### Page {current_page}")
                
                label = colors_meta.get(item['color'], {}).get("name", item['color'])
                clean_text = self.normalize_text(item['text'])
                md.append(f"- *[{label}]* \"{clean_text}\"")
                if item.get("comment"):
                    md.append(f"  > 💡 *Note:* {item['comment']}")
                md.append("")

        return "\n".join(md)

    # --- User Settings (Colors & Themes) ---
    def get_highlight_colors(self) -> List[Dict[str, Any]]:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT value FROM user_settings WHERE key = 'highlight_colors'")
            row = cursor.fetchone()
            if row:
                colors = json.loads(row["value"])
                legacy_map = {
                    "Idea Clave": "Key Idea",
                    "Definición": "Definition",
                    "Definicion": "Definition",
                    "Referencia": "Reference",
                    "Duda / Importante": "Question / Important",
                    "Cita": "Quote"
                }
                for c in colors:
                    if c.get("name") in legacy_map:
                        c["name"] = legacy_map[c["name"]]
                return colors
            return []

    def set_highlight_colors(self, colors: List[Dict[str, Any]]):
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT OR REPLACE INTO user_settings (key, value)
                VALUES ('highlight_colors', ?)
            """, (json.dumps(colors),))
            conn.commit()

    # --- Freehand Page Drawings (Smart pencil, stylus, and canvas drawings) ---
    def get_page_drawings(self, book_id: int, page: int) -> List[Dict[str, Any]]:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT strokes FROM page_drawings WHERE book_id = ? AND page = ?", (book_id, page))
            row = cursor.fetchone()
            if not row:
                return []
            return json.loads(row["strokes"] or "[]")

    def save_page_drawings(self, book_id: int, page: int, strokes: List[Dict[str, Any]]) -> Dict[str, Any]:
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

    def clear_page_drawings(self, book_id: int, page: int) -> bool:
        draw_id = f"{book_id}_{page}"
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM page_drawings WHERE id = ?", (draw_id,))
            conn.commit()
            return True

reader_service = ReaderService()
