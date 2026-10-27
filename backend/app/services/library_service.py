import json
import unicodedata
from typing import List, Optional, Dict, Any
from app.database import get_db
from app.services.calibre_service import calibre_service
from app.services.query_compiler import compile_lunabria_query

class LibraryService:
    def list_virtual_libraries(self) -> List[Dict[str, Any]]:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM virtual_libraries ORDER BY name ASC")
            rows = cursor.fetchall()
            result = []
            for row in rows:
                book_ids = json.loads(row["book_ids"] or "[]")
                excluded_book_ids = json.loads(row["excluded_book_ids"] or "[]") if "excluded_book_ids" in row.keys() and row["excluded_book_ids"] else []
                result.append({
                    "id": row["id"],
                    "name": row["name"],
                    "type": row["type"],
                    "query": row["query"],
                    "book_ids": book_ids,
                    "excluded_book_ids": excluded_book_ids,
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
            excluded_book_ids = json.loads(row["excluded_book_ids"] or "[]") if "excluded_book_ids" in row.keys() and row["excluded_book_ids"] else []
            return {
                "id": row["id"],
                "name": row["name"],
                "type": row["type"],
                "query": row["query"],
                "book_ids": json.loads(row["book_ids"] or "[]"),
                "excluded_book_ids": excluded_book_ids,
                "created_at": row["created_at"],
                "updated_at": row["updated_at"]
            }

    def create_virtual_library(
        self,
        name: str,
        lib_type: str = "query",
        query: str = "",
        book_ids: Optional[List[int]] = None,
        excluded_book_ids: Optional[List[int]] = None
    ) -> Dict[str, Any]:
        cleaned_name = name.strip()
        if not cleaned_name:
            raise ValueError("Collection name cannot be empty")
        book_ids = book_ids or []
        excluded_book_ids = excluded_book_ids or []
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO virtual_libraries (name, type, query, book_ids, excluded_book_ids)
                VALUES (?, ?, ?, ?, ?)
            """, (cleaned_name, lib_type, query.strip(), json.dumps(book_ids), json.dumps(excluded_book_ids)))
            lib_id = cursor.lastrowid
            conn.commit()
            created_library = self.get_virtual_library(lib_id)
            if created_library is None:
                raise RuntimeError("Unable to read the newly created virtual library.")
            return created_library

    def update_virtual_library(
        self,
        lib_id: int,
        name: Optional[str] = None,
        query: Optional[str] = None,
        book_ids: Optional[List[int]] = None,
        excluded_book_ids: Optional[List[int]] = None
    ) -> Optional[Dict[str, Any]]:
        with get_db() as conn:
            cursor = conn.cursor()
            updates = []
            params: List[Any] = []
            if name is not None:
                cleaned_name = name.strip()
                if not cleaned_name:
                    raise ValueError("Collection name cannot be empty")
                updates.append("name = ?")
                params.append(cleaned_name)
            if query is not None:
                updates.append("query = ?")
                params.append(query.strip())
            if book_ids is not None:
                updates.append("book_ids = ?")
                params.append(json.dumps(book_ids))
            if excluded_book_ids is not None:
                updates.append("excluded_book_ids = ?")
                params.append(json.dumps(excluded_book_ids))
            
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
            cursor.execute("SELECT type, book_ids, excluded_book_ids FROM virtual_libraries WHERE id = ?", (lib_id,))
            row = cursor.fetchone()
            if not row:
                return None
            if row["type"] != "manual":
                raise ValueError("Books can only be added to manual libraries")

            existing_ids = [int(book_id) for book_id in json.loads(row["book_ids"] or "[]")]
            existing_excluded = [int(book_id) for book_id in json.loads(row["excluded_book_ids"] or "[]")] if "excluded_book_ids" in row.keys() and row["excluded_book_ids"] else []
            merged_ids = list(dict.fromkeys([*existing_ids, *requested_ids]))
            updated_excluded = [bid for bid in existing_excluded if bid not in requested_ids]
            cursor.execute(
                "UPDATE virtual_libraries SET book_ids = ?, excluded_book_ids = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (json.dumps(merged_ids), json.dumps(updated_excluded), lib_id)
            )
            conn.commit()

        return self.get_virtual_library(lib_id)

    def remove_books_from_virtual_library(self, lib_id: int, book_ids: List[int]) -> Optional[Dict[str, Any]]:
        requested_ids = set(int(book_id) for book_id in book_ids)
        if not requested_ids:
            raise ValueError("Select at least one book")

        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("BEGIN IMMEDIATE")
            cursor.execute("SELECT id, type, query, book_ids, excluded_book_ids FROM virtual_libraries WHERE id = ?", (lib_id,))
            row = cursor.fetchone()
            if not row:
                return None

            existing_manual_ids = [int(bid) for bid in json.loads(row["book_ids"] or "[]")]
            existing_excluded_ids = [int(bid) for bid in json.loads(row["excluded_book_ids"] or "[]")] if "excluded_book_ids" in row.keys() and row["excluded_book_ids"] else []

            remaining_manual_ids = [bid for bid in existing_manual_ids if bid not in requested_ids]

            # If the library has a query or is type query, add to excluded_book_ids
            has_query = bool((row["query"] or "").strip()) or row["type"] == "query"
            if has_query:
                updated_excluded_ids = list(dict.fromkeys([*existing_excluded_ids, *requested_ids]))
            else:
                updated_excluded_ids = existing_excluded_ids

            cursor.execute(
                """UPDATE virtual_libraries 
                   SET book_ids = ?, excluded_book_ids = ?, updated_at = CURRENT_TIMESTAMP 
                   WHERE id = ?""",
                (json.dumps(remaining_manual_ids), json.dumps(updated_excluded_ids), lib_id)
            )
            conn.commit()

        return self.get_virtual_library(lib_id)

    # Backward-compatible alias
    def remove_books_from_manual_library(self, lib_id: int, book_ids: List[int]) -> Optional[Dict[str, Any]]:
        return self.remove_books_from_virtual_library(lib_id, book_ids)

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

        query = (lib.get("query") or "").strip()
        manual_ids = [int(bid) for bid in (lib.get("book_ids") or [])]
        excluded_ids = {int(bid) for bid in (lib.get("excluded_book_ids") or [])}

        query_books = []
        if query:
            compiled_query = compile_lunabria_query(query)
            raw_books = calibre_service.list_books(search_query=compiled_query)
            query_books = [b for b in raw_books if int(b["id"]) not in excluded_ids]

        query_book_ids = {int(b["id"]) for b in query_books}
        additional_manual_ids = [bid for bid in manual_ids if bid not in query_book_ids and bid not in excluded_ids]

        manual_books = []
        if additional_manual_ids:
            manual_books = calibre_service.list_books(book_ids=additional_manual_ids)

        return query_books + manual_books

    def filter_and_sort_books(
        self,
        books: List[Dict[str, Any]],
        q: Optional[str] = None,
        sort: str = "title",
        exclude_ids: Optional[List[int]] = None
    ) -> List[Dict[str, Any]]:
        """Applies case-insensitive text search (q), exclusion filters, and Unicode sorting to book list."""
        query = (q or "").strip().casefold()
        filtered = books
        if query:
            def matches_query(book):
                tags = book.get("tags") or []
                tags_text = " ".join(str(tag) for tag in tags) if isinstance(tags, (list, tuple, set)) else str(tags)
                searchable_text = " ".join([
                    str(book.get("title") or ""),
                    str(book.get("authors") or ""),
                    str(book.get("publisher") or ""),
                    tags_text
                ])
                return query in searchable_text.casefold()

            filtered = [book for book in filtered if matches_query(book)]

        excluded_ids = {int(book_id) for book_id in (exclude_ids or [])}
        if excluded_ids:
            filtered = [book for book in filtered if int(book.get("id", 0)) not in excluded_ids]

        def sort_key(book):
            book_id = int(book.get("id") or 0)
            value = str(book.get(sort) or "")
            if sort == "title":
                value = "".join(
                    char for char in unicodedata.normalize("NFKD", value.casefold())
                    if not unicodedata.combining(char)
                )
                return value, book_id
            return value, book_id

        books_sorted = list(filtered)
        books_sorted.sort(key=sort_key, reverse=sort != "title")
        return books_sorted

library_service = LibraryService()
