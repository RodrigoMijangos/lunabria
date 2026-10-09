import os
import shutil
from pathlib import Path
from typing import Optional, List
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Query
from app.config import UPLOAD_DIR
from app.services.calibre_service import calibre_service
from app.services.library_service import library_service
from app.services.reader_service import reader_service
from app.models import BookBase, MetadataUpdateRequest

router = APIRouter(prefix="/api/books", tags=["Books"])

@router.get("", response_model=List[BookBase])
def list_books(
    search: Optional[str] = Query(None, description="Calibre search query or text"),
    virtual_library_id: Optional[int] = Query(None, description="Filter by virtual library ID")
):
    if virtual_library_id:
        books = library_service.get_books_in_virtual_library(virtual_library_id)
    else:
        books = calibre_service.list_books(search_query=search)
    return reader_service.add_last_read_dates(books)

@router.get("/{book_id}", response_model=BookBase)
def get_book(book_id: int):
    book = calibre_service.get_book(book_id)
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")
    return book

@router.post("/upload")
async def upload_books(
    files: List[UploadFile] = File(...),
    auto_fetch_metadata: bool = Form(False),
    isbns: Optional[str] = Form(None)  # Comma-separated or JSON list of ISBNs matching files
):
    """
    Uploads one or multiple PDF books.
    - If auto_fetch_metadata is True, attempts to fetch metadata via Calibre CLI using ISBN or filename.
    - If False, imports the file directly into Calibre without external lookups.
    """
    isbn_list = []
    if isbns:
        isbn_list = [i.strip() for i in isbns.split(",") if i.strip()]

    added_books = []
    for idx, file in enumerate(files):
        if not file.filename.lower().endswith(".pdf"):
            continue

        temp_path = UPLOAD_DIR / file.filename
        try:
            with open(temp_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)

            # Derive initial title from filename
            clean_title = Path(file.filename).stem.replace("_", " ").replace("-", " ")
            isbn = isbn_list[idx] if idx < len(isbn_list) else None

            # Add to calibre
            try:
                book_id = calibre_service.add_book(
                    file_path=str(temp_path),
                    title=clean_title,
                    isbn=isbn
                )
            except Exception as add_err:
                raise HTTPException(status_code=409, detail=str(add_err))

            # If user wanted automatic metadata fetch
            if auto_fetch_metadata and isbn:
                try:
                    meta = calibre_service.fetch_metadata(isbn=isbn)
                    calibre_service.update_metadata(
                        book_id=book_id,
                        title=meta.get("title") or clean_title,
                        authors=", ".join(meta.get("authors") or []) or None,
                        tags=", ".join(meta.get("tags") or []) or None,
                        comments=meta.get("comments"),
                        isbn=meta.get("isbn") or isbn
                    )
                except Exception as meta_err:
                    print(f"Warning: Failed to fetch metadata for uploaded book {book_id}: {meta_err}")

            book = calibre_service.get_book(book_id)
            if book:
                added_books.append(book)
        finally:
            if temp_path.exists():
                os.remove(temp_path)

    return {"message": f"{len(added_books)} books added successfully", "books": added_books}

@router.delete("/{book_id}")
def delete_book(book_id: int):
    book = calibre_service.get_book(book_id)
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")
    try:
        calibre_service.delete_book(book_id)
        return {"message": f"Book {book_id} successfully deleted", "id": book_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error deleting book: {e}")

@router.get("/{book_id}/layouts")
def get_page_layouts_batch(book_id: int, start_page: int = 1, end_page: int = 10):
    """
    Returns exact word and line bounding boxes for a range of pages in a single batch.
    Enables pre-buffering (e.g. 10 pages) and offline caching in IndexedDB.
    """
    layouts = calibre_service.get_page_layouts_batch(book_id, start_page, end_page)
    if not layouts:
        raise HTTPException(status_code=404, detail="Could not extract layouts for this page range")
    return layouts

@router.get("/{book_id}/pages/{page_number}/layout")
def get_page_layout(book_id: int, page_number: int):
    """
    Returns exact bounding box coordinates for each word on the page via PyMuPDF.
    Allows pixel-perfect text selection and highlighting on the client.
    """
    layout = calibre_service.get_page_layout(book_id, page_number)
    if not layout:
        raise HTTPException(status_code=404, detail="Could not extract page layout")
    return layout


