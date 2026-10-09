import re
import json
import uuid
from typing import List, Optional, Dict, Any
from datetime import datetime
from app.database import get_db
from app.services.calibre_service import calibre_service
from app.services import reader_progress, reader_annotations, reader_settings, reader_drawings

class ReaderService:
    # Resolve dependencies here so patches on this module remain effective after extraction.
    @staticmethod
    def normalize_text(text: str) -> str:
        return reader_annotations.normalize_text(text, re=re)

    # --- Reading Progress (Top 10 Recents) ---
    def update_progress(self, book_id: int, current_page: int, total_pages: int, percentage: float):
        return reader_progress.update_progress(
            self,
            book_id,
            current_page,
            total_pages,
            percentage,
            get_db=get_db,
        )

    def mark_book_opened(
        self,
        book_id: int,
        current_page: int,
        total_pages: int,
        percentage: float
    ) -> None:
        return reader_progress.mark_book_opened(
            self,
            book_id,
            current_page,
            total_pages,
            percentage,
            get_db=get_db,
        )

    def get_progress(self, book_id: int) -> Optional[Dict[str, Any]]:
        return reader_progress.get_progress(self, book_id, get_db=get_db)

    def add_last_read_dates(self, books: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        return reader_progress.add_last_read_dates(self, books, get_db=get_db)

    def get_top_recent_books(self, limit: int = 10) -> List[Dict[str, Any]]:
        return reader_progress.get_top_recent_books(
            self,
            limit,
            calibre_service=calibre_service,
            get_db=get_db,
        )

    # --- Annotations & Highlights ---
    def add_annotation(self, book_id: int, page: int, color: str, text: str, 
                       category: str = "", comment: str = "", rects: Optional[List[Dict[str, Any]]] = None,
                       annot_id: Optional[str] = None) -> Dict[str, Any]:
        return reader_annotations.add_annotation(
            self,
            book_id,
            page,
            color,
            text,
            category,
            comment,
            rects,
            annot_id,
            get_db=get_db,
            json=json,
            uuid=uuid,
        )

    def get_annotation(self, annot_id: str) -> Optional[Dict[str, Any]]:
        return reader_annotations.get_annotation(self, annot_id, get_db=get_db, json=json)

    def list_annotations(self, book_id: int, color: Optional[str] = None) -> List[Dict[str, Any]]:
        return reader_annotations.list_annotations(self, book_id, color, get_db=get_db, json=json)

    def update_annotation(self, annot_id: str, color: Optional[str] = None, 
                          category: Optional[str] = None, comment: Optional[str] = None) -> Optional[Dict[str, Any]]:
        return reader_annotations.update_annotation(self, annot_id, color, category, comment, get_db=get_db)

    def delete_annotation(self, annot_id: str) -> bool:
        return reader_annotations.delete_annotation(self, annot_id, get_db=get_db)

    # --- Export Highlights & Notes ---
    def export_annotations_markdown(self, book_id: int, color_filter: Optional[str] = None, group_by: str = "color") -> str:
        return reader_annotations.export_annotations_markdown(
            self,
            book_id,
            color_filter,
            group_by,
            calibre_service=calibre_service,
            datetime=datetime,
        )

    # --- User Settings (Colors & Themes) ---
    def get_highlight_colors(self) -> List[Dict[str, Any]]:
        return reader_settings.get_highlight_colors(self, get_db=get_db, json=json)

    def set_highlight_colors(self, colors: List[Dict[str, Any]]):
        return reader_settings.set_highlight_colors(self, colors, get_db=get_db, json=json)

    # --- Freehand Page Drawings (Smart pencil, stylus, and canvas drawings) ---
    def get_page_drawings(self, book_id: int, page: int) -> List[Dict[str, Any]]:
        return reader_drawings.get_page_drawings(self, book_id, page, get_db=get_db, json=json)

    def save_page_drawings(self, book_id: int, page: int, strokes: List[Dict[str, Any]]) -> Dict[str, Any]:
        return reader_drawings.save_page_drawings(self, book_id, page, strokes, get_db=get_db, json=json)

    def clear_page_drawings(self, book_id: int, page: int) -> bool:
        return reader_drawings.clear_page_drawings(self, book_id, page, get_db=get_db)

reader_service = ReaderService()
