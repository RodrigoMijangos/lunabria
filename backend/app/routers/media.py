import re
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, StreamingResponse

from app.services.calibre_service import calibre_service

router = APIRouter(prefix="/api/books", tags=["Media"])


def range_requests_response(
    request: Request, file_path: Path, content_type: str = "application/pdf"
):
    """
    Handles HTTP Range requests (RFC 7233) for efficient PDF chunk streaming over HTTP/2.
    Allows instant page rendering without downloading entire files.
    """
    file_size = file_path.stat().st_size
    range_header = request.headers.get("range")

    if not range_header:
        return FileResponse(
            path=str(file_path),
            media_type=content_type,
            headers={
                "Accept-Ranges": "bytes",
                "Cache-Control": "public, max-age=3600"
            }
        )

    match = re.fullmatch(r"bytes=(\d*)-(\d*)", range_header.strip(), re.IGNORECASE)
    if not match or file_size == 0:
        raise HTTPException(
            status_code=416,
            detail="Requested Range Not Satisfiable",
            headers={"Content-Range": f"bytes */{file_size}", "Accept-Ranges": "bytes"}
        )

    start_str, end_str = match.groups()
    try:
        if not start_str:
            suffix_length = int(end_str) if end_str else 0
            if suffix_length <= 0:
                raise HTTPException(
                    status_code=416,
                    detail="Requested Range Not Satisfiable",
                    headers={"Content-Range": f"bytes */{file_size}", "Accept-Ranges": "bytes"}
                )
            start = max(0, file_size - suffix_length)
            end = file_size - 1
        else:
            start = int(start_str)
            end = int(end_str) if end_str else file_size - 1
            if start >= file_size or end < start:
                raise HTTPException(
                    status_code=416,
                    detail="Requested Range Not Satisfiable",
                    headers={"Content-Range": f"bytes */{file_size}", "Accept-Ranges": "bytes"}
                )
            end = min(end, file_size - 1)
    except ValueError:
        raise HTTPException(
            status_code=416,
            detail="Requested Range Not Satisfiable",
            headers={"Content-Range": f"bytes */{file_size}", "Accept-Ranges": "bytes"}
        ) from None

    chunk_length = end - start + 1

    async def file_iterator():
        with open(file_path, "rb") as f:
            f.seek(start)
            remaining = chunk_length
            chunk_size = 64 * 1024  # 64KB chunks
            while remaining > 0:
                try:
                    if await request.is_disconnected():
                        break
                except Exception:
                    pass
                read_size = min(chunk_size, remaining)
                data = f.read(read_size)
                if not data:
                    break
                remaining -= len(data)
                yield data

    headers = {
        "Content-Range": f"bytes {start}-{end}/{file_size}",
        "Accept-Ranges": "bytes",
        "Content-Length": str(chunk_length),
        "Cache-Control": "public, max-age=3600"
    }

    return StreamingResponse(
        file_iterator(),
        status_code=206,
        headers=headers,
        media_type=content_type
    )


@router.get("/{book_id}/pdf")
def stream_pdf(book_id: int, request: Request):
    try:
        pdf_path = calibre_service.get_pdf_path(book_id)
    except RuntimeError as error:
        raise HTTPException(status_code=500, detail=str(error)) from error

    if not pdf_path or not pdf_path.exists():
        raise HTTPException(status_code=404, detail="No compatible PDF or EPUB found for this book")
    return range_requests_response(request, pdf_path, "application/pdf")

@router.get("/{book_id}/cover")
def get_cover(book_id: int):
    cover_path = calibre_service.get_cover_path(book_id)
    if not cover_path or not cover_path.exists():
        raise HTTPException(status_code=404, detail="Cover not found")
    return FileResponse(
        path=str(cover_path),
        media_type="image/jpeg",
        headers={"Cache-Control": "public, max-age=86400"}
    )
