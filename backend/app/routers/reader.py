from typing import Optional, List, Dict, Any
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
    HighlightColor
)
from datetime import datetime

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
@router.get("/api/books/{book_id}/export")
def export_annotations(
    book_id: int, 
    format: str = Query("md", pattern="^(md|json|jsonl|yaml|toml)$"),
    group_by: str = Query("color", pattern="^(color|page|hierarchy)$"),
    color: Optional[str] = Query(None),
    stamp: bool = Query(False)
):
    book_info = calibre_service.get_book(book_id) or {"id": book_id, "title": f"Book {book_id}", "authors": "Unknown"}
    annotations = reader_service.list_annotations(book_id=book_id)
    highlight_colors = reader_service.get_highlight_colors()
    
    pdf_path_obj = calibre_service.get_pdf_path(book_id)
    pdf_path = str(pdf_path_obj) if pdf_path_obj else None
    
    exported_at = datetime.utcnow().isoformat() + "Z" if stamp else None
    
    model = notes_export.build_model(
        annotations=annotations,
        book_info=book_info,
        pdf_path=pdf_path,
        highlight_colors=highlight_colors,
        color_filter=color,
        exported_at=exported_at
    )
    
    if format == "json":
        content = notes_export.render_json(model)
        media_type = "application/json"
        ext = "json"
    elif format == "jsonl":
        content = notes_export.render_jsonl(model)
        media_type = "application/x-ndjson"
        ext = "jsonl"
    elif format == "yaml":
        content = notes_export.render_yaml(model)
        media_type = "application/yaml"
        ext = "yaml"
    elif format == "toml":
        content = notes_export.render_toml(model)
        media_type = "application/toml"
        ext = "toml"
    else:
        content = notes_export.render_md(model, group_by)
        media_type = "text/markdown"
        ext = "md"
        
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f"attachment; filename=notes_book_{book_id}.{ext}"}
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
