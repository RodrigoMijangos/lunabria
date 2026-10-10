import asyncio
import logging
import shutil
import unicodedata
from uuid import uuid4
from pathlib import Path
from typing import Optional, List, Literal

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Query

from app.config import UPLOAD_DIR
from app import database
from app.services.calibre_service import calibre_service
from app.services.ingestion_queue import ingestion_queue
from app.services.library_service import library_service
from app.services.reader_service import reader_service
from app.models import BookBase, PaginatedBooksResponse

router = APIRouter(prefix="/api/books", tags=["Books"])
logger = logging.getLogger(__name__)


def _copy_upload_to_staging(upload_file, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("wb") as buffer:
        shutil.copyfileobj(upload_file, buffer, length=1024 * 1024)


def _public_upload_job(job):
    return {
        "job_id": job["job_id"],
        "filename": job["filename"],
        "status": job["status"],
        "error": job.get("error"),
        "book_id": job.get("book_id"),
        "created_at": job.get("created_at"),
        "updated_at": job.get("updated_at"),
    }

@router.get("", response_model=PaginatedBooksResponse)
def list_books(
    search: Optional[str] = Query(None, description="Calibre search query"),
    virtual_library_id: Optional[int] = Query(None, description="Filter by virtual library ID"),
    q: Optional[str] = Query(None, max_length=200, description="Text search in titles, authors and tags"),
    page: int = Query(1, ge=1),
    page_size: int = Query(24, ge=1, le=100),
    sort: Literal["title", "date_added", "last_read_at"] = Query("title"),
    exclude_ids: Optional[List[int]] = Query(None, description="Book IDs to omit from the catalog")
):
    if virtual_library_id is not None:
        books = library_service.get_books_in_virtual_library(virtual_library_id)
    else:
        books = calibre_service.list_books(search_query=search)
    books = reader_service.add_last_read_dates(books)
    query = (q or "").strip().casefold()
    if query:
        def matches_query(book):
            tags = book.get("tags") or []
            tags_text = " ".join(str(tag) for tag in tags) if isinstance(tags, (list, tuple, set)) else str(tags)
            searchable_text = " ".join([
                str(book.get("title") or ""),
                str(book.get("authors") or ""),
                tags_text
            ])
            return query in searchable_text.casefold()

        books = [book for book in books if matches_query(book)]

    excluded_ids = {int(book_id) for book_id in (exclude_ids or [])}
    if excluded_ids:
        books = [book for book in books if int(book.get("id", 0)) not in excluded_ids]

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

    books.sort(key=sort_key, reverse=sort != "title")
    total = len(books)
    page_count = max(1, (total + page_size - 1) // page_size)
    page = min(page, page_count)
    start = (page - 1) * page_size
    return {
        "books": books[start:start + page_size],
        "total": total,
        "page": page,
        "page_size": page_size
    }

@router.get("/{book_id}", response_model=BookBase)
def get_book(book_id: int):
    book = calibre_service.get_book(book_id)
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")
    return book

@router.post("/upload", status_code=202)
async def upload_books(
    files: List[UploadFile] = File(...),
    auto_fetch_metadata: bool = Form(False),
    isbns: Optional[str] = Form(None)  # Comma-separated or JSON list of ISBNs matching files
):
    """Stage PDF uploads and enqueue them for background Calibre ingestion."""
    if not ingestion_queue.is_running:
        raise HTTPException(status_code=503, detail="Book ingestion worker is unavailable.")

    isbn_list = [value.strip() for value in (isbns or "").split(",") if value.strip()]
    prepared = []
    for index, upload_file in enumerate(files):
        filename = (upload_file.filename or "").replace("\\", "/").rsplit("/", 1)[-1]
        if (
            not filename
            or not filename.lower().endswith(".pdf")
            or any(ord(character) < 32 for character in filename)
        ):
            for prior_file in files:
                await prior_file.close()
            raise HTTPException(status_code=400, detail="Only valid PDF filenames can be uploaded.")

        job_id = uuid4().hex
        staged_path = UPLOAD_DIR / "staging" / f"{job_id}.pdf"
        prepared.append({
            "job_id": job_id,
            "filename": filename,
            "staging_path": str(staged_path),
            "auto_fetch_metadata": auto_fetch_metadata,
            "isbn": isbn_list[index] if index < len(isbn_list) else None,
            "upload_file": upload_file,
        })

    staged_paths = []
    job_records = [
        {key: value for key, value in job.items() if key != "upload_file"}
        for job in prepared
    ]
    records_created = False
    try:
        for job in prepared:
            staged_path = Path(job["staging_path"])
            staged_paths.append(staged_path)
            await asyncio.to_thread(
                _copy_upload_to_staging,
                job["upload_file"].file,
                staged_path,
            )
        await asyncio.to_thread(
            database.create_upload_jobs,
            job_records,
        )
        records_created = True
        await ingestion_queue.enqueue_many(job_records)
    except Exception as error:
        for staged_path in staged_paths:
            try:
                staged_path.unlink(missing_ok=True)
            except OSError:
                logger.exception("Could not remove rejected staged upload %s", staged_path)
        if records_created:
            for job in job_records:
                try:
                    await asyncio.to_thread(
                        database.update_upload_job,
                        job["job_id"],
                        "failed",
                        "The upload could not be added to the background queue.",
                    )
                except Exception:
                    logger.exception(
                        "Could not record rejected upload job %s",
                        job["job_id"],
                    )
        logger.exception("Could not queue uploaded books")
        raise HTTPException(status_code=503, detail="The uploaded books could not be queued.") from error
    finally:
        for job in prepared:
            await job["upload_file"].close()

    jobs = [_public_upload_job({**job, "status": "queued"}) for job in job_records]
    return {
        "job_id": jobs[0]["job_id"] if len(jobs) == 1 else None,
        "filename": jobs[0]["filename"] if len(jobs) == 1 else None,
        "status": "queued",
        "jobs": jobs,
    }


@router.get("/upload/jobs")
def get_active_upload_jobs():
    return [_public_upload_job(job) for job in database.get_active_upload_jobs()]


@router.get("/upload/jobs/{job_id}")
def get_upload_job(job_id: str):
    job = database.get_upload_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Upload job not found.")
    return _public_upload_job(job)

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
