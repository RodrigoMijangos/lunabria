import sqlite3
import json
from datetime import datetime
from typing import Optional, List, Dict, Any
from app.config import APP_STATE_DB_PATH

def get_db():
    conn = sqlite3.connect(APP_STATE_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with get_db() as conn:
        cursor = conn.cursor()
        
        # 1. Virtual Libraries table
        # type can be: 'query' (Calibre search / regex) or 'manual' (list of selected book IDs)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS virtual_libraries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                type TEXT NOT NULL DEFAULT 'query',
                query TEXT DEFAULT '',
                book_ids TEXT DEFAULT '[]',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # 2. Reading Progress table (Tracks recent books and page position)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS reading_progress (
                book_id INTEGER PRIMARY KEY,
                current_page INTEGER NOT NULL DEFAULT 1,
                total_pages INTEGER NOT NULL DEFAULT 1,
                percentage REAL NOT NULL DEFAULT 0.0,
                last_read_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # 3. Annotations & Highlights table (Custom color, tags, comments, quotes)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS annotations (
                id TEXT PRIMARY KEY,
                book_id INTEGER NOT NULL,
                page INTEGER NOT NULL,
                color TEXT NOT NULL,
                category TEXT DEFAULT '',
                text TEXT NOT NULL,
                comment TEXT DEFAULT '',
                rects TEXT DEFAULT '[]',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_annotations_book ON annotations(book_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_annotations_color ON annotations(color)")

        # 4. Freehand Page Drawings (Smart pencil, stylus, and canvas drawings per page)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS page_drawings (
                id TEXT PRIMARY KEY,
                book_id INTEGER NOT NULL,
                page INTEGER NOT NULL,
                strokes TEXT NOT NULL DEFAULT '[]',
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_drawings_book_page ON page_drawings(book_id, page)")

        # 5. User Settings (Custom colors, themes, etc.)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS user_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        """)
        
        # Initialize default highlight colors if not set (Edge-style vibrant fluorescent colors)
        default_colors = json.dumps([
            {"id": "yellow", "name": "Key Idea", "color": "#ffeb3b", "textColor": "#713f12"},
            {"id": "green", "name": "Definition", "color": "#86efac", "textColor": "#14532d"},
            {"id": "blue", "name": "Reference", "color": "#93c5fd", "textColor": "#1e3a8a"},
            {"id": "red", "name": "Question / Important", "color": "#fca5a5", "textColor": "#7f1d1d"},
            {"id": "purple", "name": "Quote", "color": "#d8b4fe", "textColor": "#581c87"}
        ])
        cursor.execute("""
            INSERT OR IGNORE INTO user_settings (key, value)
            VALUES ('highlight_colors', ?)
        """, (default_colors,))
        
        # Migrate legacy Spanish category names in user_settings and annotations
        legacy_category_map = {
            "Idea Clave": "Key Idea",
            "Definición": "Definition",
            "Definicion": "Definition",
            "Referencia": "Reference",
            "Duda / Importante": "Question / Important",
            "Cita": "Quote"
        }
        cursor.execute("SELECT value FROM user_settings WHERE key = 'highlight_colors'")
        row = cursor.fetchone()
        if row:
            try:
                colors_data = json.loads(row["value"])
                updated = False
                for item in colors_data:
                    old_name = item.get("name")
                    if old_name in legacy_category_map:
                        item["name"] = legacy_category_map[old_name]
                        updated = True
                if updated:
                    cursor.execute(
                        "UPDATE user_settings SET value = ? WHERE key = 'highlight_colors'",
                        (json.dumps(colors_data),)
                    )
            except Exception:
                pass

        for es_cat, en_cat in legacy_category_map.items():
            cursor.execute("UPDATE annotations SET category = ? WHERE category = ?", (en_cat, es_cat))

        conn.commit()
