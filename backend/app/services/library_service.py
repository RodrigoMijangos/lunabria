import json
from typing import List, Optional, Dict, Any
from app.database import get_db
from app.services.calibre_service import calibre_service

class LibraryService:
    def list_virtual_libraries(self) -> List[Dict[str, Any]]:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM virtual_libraries ORDER BY name ASC")
            rows = cursor.fetchall()
            result = []
            for row in rows:
                book_ids = json.loads(row["book_ids"] or "[]")
                result.append({
                    "id": row["id"],
                    "name": row["name"],
                    "type": row["type"],
                    "query": row["query"],
                    "book_ids": book_ids,
                    "book_count": len(book_ids) if row["type"] == "manual" else None,
                    "created_at": row["created_at"],
                    "updated_at": row["updated_at"]
                })
            return result

    def get_virtual_library(self, lib_id: int) -> Optional[Dict[str, Any]]:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM virtual_libraries WHERE id = ?", (lib_id,))
            row = cursor.fetchone()
            if not row:
                return None
            return {
                "id": row["id"],
                "name": row["name"],
                "type": row["type"],
                "query": row["query"],
                "book_ids": json.loads(row["book_ids"] or "[]"),
                "created_at": row["created_at"],
                "updated_at": row["updated_at"]
            }

    def create_virtual_library(self, name: str, lib_type: str = "query", query: str = "", book_ids: Optional[List[int]] = None) -> Dict[str, Any]:
        book_ids = book_ids or []
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO virtual_libraries (name, type, query, book_ids)
                VALUES (?, ?, ?, ?)
            """, (name.strip(), lib_type, query.strip(), json.dumps(book_ids)))
            lib_id = cursor.lastrowid
            conn.commit()
            return self.get_virtual_library(lib_id)

    def update_virtual_library(self, lib_id: int, name: Optional[str] = None, query: Optional[str] = None, book_ids: Optional[List[int]] = None) -> Optional[Dict[str, Any]]:
        with get_db() as conn:
            cursor = conn.cursor()
            updates = []
            params = []
            if name is not None:
                updates.append("name = ?")
                params.append(name.strip())
            if query is not None:
                updates.append("query = ?")
                params.append(query.strip())
            if book_ids is not None:
                updates.append("book_ids = ?")
                params.append(json.dumps(book_ids))
            
            if updates:
                updates.append("updated_at = CURRENT_TIMESTAMP")
                params.append(lib_id)
                cursor.execute(f"UPDATE virtual_libraries SET {', '.join(updates)} WHERE id = ?", params)
                conn.commit()
            return self.get_virtual_library(lib_id)

    def add_books_to_manual_library(self, lib_id: int, book_ids: List[int]) -> Optional[Dict[str, Any]]:
        requested_ids = list(dict.fromkeys(int(book_id) for book_id in book_ids))
        if not requested_ids:
            raise ValueError("Select at least one book")

        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("BEGIN IMMEDIATE")
            cursor.execute("SELECT type, book_ids FROM virtual_libraries WHERE id = ?", (lib_id,))
            row = cursor.fetchone()
            if not row:
                return None
            if row["type"] != "manual":
                raise ValueError("Books can only be added to manual libraries")

            existing_ids = [int(book_id) for book_id in json.loads(row["book_ids"] or "[]")]
            merged_ids = list(dict.fromkeys([*existing_ids, *requested_ids]))
            cursor.execute(
                "UPDATE virtual_libraries SET book_ids = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (json.dumps(merged_ids), lib_id)
            )
            conn.commit()

        return self.get_virtual_library(lib_id)

    def delete_virtual_library(self, lib_id: int) -> bool:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM virtual_libraries WHERE id = ?", (lib_id,))
            conn.commit()
            return cursor.rowcount > 0

    def get_books_in_virtual_library(self, lib_id: int) -> List[Dict[str, Any]]:
        lib = self.get_virtual_library(lib_id)
        if not lib:
            return []
        
        if lib["type"] == "manual":
            return calibre_service.list_books(book_ids=lib["book_ids"])
        else:
            # Query / Regex mode
            return calibre_service.list_books(search_query=lib["query"])

library_service = LibraryService()
