from typing import Optional, List, Dict, Any
from datetime import datetime
from fastapi import APIRouter, HTTPException, Query, Response, Body
from app.services.reader_service import reader_service
from app.services.calibre_service import calibre_service
from app.services import notes_export
from app.models import (
    ReadingProgressUpdate, 
    ReadingProgressResponse, 
    BookWithProgress,
    AnnotationCreate, 
    AnnotationUpdate, 
    AnnotationResponse,
    SelectedAnnotationsExportRequest,
    HighlightColor
)

router = APIRouter(tags=["Reader & Annotations"])

# --- Reading Progress & Recents ---
@router.get("/api/recents", response_model=List[BookWithProgress])
def get_recents(limit: int = 10):
    """Returns the 10 most recently opened/read books with page and progress."""
    return reader_service.get_top_recent_books(limit=limit)

@router.get("/api/books/{book_id}/progress", response_model=Optional[ReadingProgressResponse])
def get_book_progress(book_id: int):
    prog = reader_service.get_progress(book_id)
    return prog

@router.post("/api/books/{book_id}/opened")
def mark_book_opened(book_id: int, req: ReadingProgressUpdate):
    reader_service.mark_book_opened(
        book_id=book_id,
        current_page=req.current_page,
        total_pages=req.total_pages,
        percentage=req.percentage
    )
    return {"message": "Book opening recorded"}

@router.post("/api/books/{book_id}/progress")
def save_book_progress(book_id: int, req: ReadingProgressUpdate):
    reader_service.update_progress(
        book_id=book_id,
        current_page=req.current_page,
        total_pages=req.total_pages,
        percentage=req.percentage
    )
    return {"message": "Reading progress saved"}

# --- Annotations & Highlights ---
@router.get("/api/books/{book_id}/annotations", response_model=List[AnnotationResponse])
def list_annotations(book_id: int, color: Optional[str] = Query(None)):
    return reader_service.list_annotations(book_id=book_id, color=color)

@router.post("/api/books/{book_id}/annotations", response_model=AnnotationResponse)
def create_annotation(book_id: int, req: AnnotationCreate):
    return reader_service.add_annotation(
        book_id=book_id,
        page=req.page,
        color=req.color,
        category=req.category or "",
        text=req.text,
        comment=req.comment or "",
        rects=req.rects or [],
        annot_id=req.id
    )

@router.put("/api/annotations/{annot_id}", response_model=AnnotationResponse)
def update_annotation(annot_id: str, req: AnnotationUpdate):
    annot = reader_service.update_annotation(
        annot_id=annot_id,
        color=req.color,
        category=req.category,
        comment=req.comment
    )
    if not annot:
        raise HTTPException(status_code=404, detail="Annotation not found")
    return annot

@router.delete("/api/annotations/{annot_id}")
def delete_annotation(annot_id: str):
    success = reader_service.delete_annotation(annot_id)
    if not success:
        raise HTTPException(status_code=404, detail="Annotation not found")
    return {"message": "Annotation deleted"}

# --- Export Highlights & Notes ---
def _select_export_annotations(
    annotations: List[Dict[str, Any]],
    scope: str,
    *,
    page: Optional[int] = None,
    start_page: Optional[int] = None,
    end_page: Optional[int] = None,
    section_index: Optional[int] = None,
    sections: Optional[List[Dict[str, Any]]] = None,
    total_pages: Optional[int] = None
) -> List[Dict[str, Any]]:
    try:
        return notes_export.select_export_annotations(
            annotations,
            scope,
            page=page,
            start_page=start_page,
            end_page=end_page,
            section_index=section_index,
            sections=sections,
            total_pages=total_pages
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


def _render_annotations_export(
    book_id: int,
    annotations: List[Dict[str, Any]],
    format: str,
    group_by: str,
    color: Optional[str],
    stamp: bool,
    pdf_path: Optional[str]
) -> Response:
    book_info = calibre_service.get_book(book_id) or {"id": book_id, "title": f"Book {book_id}", "authors": "Unknown"}
    highlight_colors = reader_service.get_highlight_colors()
    exported_at = datetime.utcnow().isoformat() + "Z" if stamp else None

    model = notes_export.build_model(
        annotations=annotations,
        book_info=book_info,
        pdf_path=pdf_path,
        highlight_colors=highlight_colors,
        color_filter=color,
        exported_at=exported_at
    )

    content, media_type, ext = notes_export.render_export_payload(model, format, group_by)

    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f"attachment; filename=notes_book_{book_id}.{ext}"}
    )


@router.get("/api/books/{book_id}/export-sections")
def get_annotation_export_sections(book_id: int):
    pdf_path_obj = calibre_service.get_pdf_path(book_id)
    sections, total_pages = notes_export.get_export_sections(
        str(pdf_path_obj) if pdf_path_obj else None,
        book_id
    )
    return {
        "sections": [
            {
                "index": index,
                "title": section["title"],
                "level": section["level"],
                "page_start": section["page_start"],
                "page_end": section["page_end"]
            }
            for index, section in enumerate(sections)
        ],
        "total_pages": total_pages
    }


@router.get("/api/books/{book_id}/export")
def export_annotations(
    book_id: int,
    format: str = Query("md", pattern="^(md|json|jsonl|yaml|toml)$"),
    group_by: str = Query("color", pattern="^(color|page|hierarchy)$"),
    color: Optional[str] = Query(None),
    stamp: bool = Query(False),
    scope: str = Query("all", pattern="^(all|page|range|section)$"),
    page: Optional[int] = Query(None, ge=1),
    start_page: Optional[int] = Query(None, ge=1),
    end_page: Optional[int] = Query(None, ge=1),
    section_index: Optional[int] = Query(None, ge=0)
):
    annotations = reader_service.list_annotations(book_id=book_id)
    pdf_path_obj = calibre_service.get_pdf_path(book_id)
    pdf_path = str(pdf_path_obj) if pdf_path_obj else None

    sections, total_pages = notes_export.get_export_sections(pdf_path, book_id) if scope != "all" else ([], None)
    annotations = _select_export_annotations(
        annotations,
        scope,
        page=page,
        start_page=start_page,
        end_page=end_page,
        section_index=section_index,
        sections=sections,
        total_pages=total_pages
    )

    return _render_annotations_export(
        book_id,
        annotations,
        format,
        group_by,
        color,
        stamp,
        pdf_path
    )


@router.post("/api/books/{book_id}/export")
def export_selected_annotations(book_id: int, req: SelectedAnnotationsExportRequest):
    requested_ids = req.annotation_ids
    if any(not annot_id.strip() for annot_id in requested_ids):
        raise HTTPException(status_code=422, detail="Annotation IDs must not be empty.")
    if len(set(requested_ids)) != len(requested_ids):
        raise HTTPException(status_code=422, detail="Annotation IDs must be unique.")

    annotations = reader_service.list_annotations(book_id=book_id)
    annotations_by_id = {str(annotation["id"]): annotation for annotation in annotations}
    if any(annot_id not in annotations_by_id for annot_id in requested_ids):
        raise HTTPException(status_code=404, detail="One or more selected annotations were not found for this book.")
    selected_ids = set(requested_ids)
    selected_annotations = [
        annotation for annotation in annotations
        if str(annotation["id"]) in selected_ids
    ]

    pdf_path_obj = calibre_service.get_pdf_path(book_id)
    return _render_annotations_export(
        book_id,
        selected_annotations,
        req.format,
        req.group_by,
        None,
        req.stamp,
        str(pdf_path_obj) if pdf_path_obj else None
    )

# --- Customizable Highlight Colors ---
@router.get("/api/settings/colors", response_model=List[HighlightColor])
def get_colors():
    return reader_service.get_highlight_colors()

@router.post("/api/settings/colors")
def save_colors(colors: List[HighlightColor]):
    reader_service.set_highlight_colors([c.model_dump() for c in colors])
    return {"message": "Colors updated successfully"}

# --- Freehand Page Drawings (Smart pencil, tablet, and canvas drawings) ---
@router.get("/api/books/{book_id}/pages/{page}/drawings")
def get_page_drawings(book_id: int, page: int):
    return reader_service.get_page_drawings(book_id=book_id, page=page)

@router.post("/api/books/{book_id}/pages/{page}/drawings")
def save_page_drawings(book_id: int, page: int, data: Dict[str, Any] = Body(...)):
    strokes = data.get("strokes", [])
    return reader_service.save_page_drawings(book_id=book_id, page=page, strokes=strokes)

@router.delete("/api/books/{book_id}/pages/{page}/drawings")
def clear_page_drawings(book_id: int, page: int):
    reader_service.clear_page_drawings(book_id=book_id, page=page)
    return {"message": "Page drawings deleted"}
