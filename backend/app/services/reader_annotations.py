"""Annotation persistence, text normalization, and Markdown export."""

from typing import Any, Dict, List, Optional


def normalize_text(text: str, *, re) -> str:
    if not text:
        return ""
    # 1. Join words hyphenated across line endings: e.g. "ani- mated" -> "animated", "un- derstood" -> "understood"
    # Supports standard hyphen (-), unicode hyphen (‐), and soft hyphen (\xad)
    text = re.sub(r'(\b\w+)[-‐\xad]\s+([a-zA-ZáéíóúÁÉÍÓÚñÑ]\w*\b)', r'\1\2', text)
    # 2. Collapse excessive horizontal whitespace
    text = re.sub(r'[ \t]{2,}', ' ', text)
    return text.strip()


def add_annotation(self, book_id: int, page: int, color: str, text: str,
                   category: str = "", comment: str = "", rects: Optional[List[Dict[str, Any]]] = None,
                   annot_id: Optional[str] = None, *, get_db, json, uuid) -> Dict[str, Any]:
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


def get_annotation(self, annot_id: str, *, get_db, json) -> Optional[Dict[str, Any]]:
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


def list_annotations(self, book_id: int, color: Optional[str] = None, *, get_db, json) -> List[Dict[str, Any]]:
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
                      category: Optional[str] = None, comment: Optional[str] = None, *, get_db) -> Optional[Dict[str, Any]]:
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


def delete_annotation(self, annot_id: str, *, get_db) -> bool:
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM annotations WHERE id = ?", (annot_id,))
        conn.commit()
        return cursor.rowcount > 0


def export_annotations_markdown(self, book_id: int, color_filter: Optional[str] = None, group_by: str = "color", *, calibre_service, datetime) -> str:
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
