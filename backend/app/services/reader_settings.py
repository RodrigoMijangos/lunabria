"""Reader highlight color preferences."""

from typing import Any, Dict, List


def get_highlight_colors(self, *, get_db, json) -> List[Dict[str, Any]]:
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


def set_highlight_colors(self, colors: List[Dict[str, Any]], *, get_db, json):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
                INSERT OR REPLACE INTO user_settings (key, value)
                VALUES ('highlight_colors', ?)
            """, (json.dumps(colors),))
        conn.commit()
