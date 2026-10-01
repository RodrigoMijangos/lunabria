from typing import Optional, List, Dict, Any
from fastapi import APIRouter, HTTPException, Query, Response, Body
from app.services.reader_service import reader_service
from app.models import (
    ReadingProgressUpdate, 
    ReadingProgressResponse, 
    BookWithProgress,
    AnnotationCreate, 
    AnnotationUpdate, 
    AnnotationResponse,
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
@router.get("/api/books/{book_id}/export")
def export_annotations(
    book_id: int, 
    color: Optional[str] = Query(None),
    group_by: str = Query("color", pattern="^(color|page)$")
):
    markdown_content = reader_service.export_annotations_markdown(
        book_id=book_id,
        color_filter=color,
        group_by=group_by
    )
    return Response(
        content=markdown_content,
        media_type="text/markdown",
        headers={"Content-Disposition": f"attachment; filename=notes_book_{book_id}.md"}
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

