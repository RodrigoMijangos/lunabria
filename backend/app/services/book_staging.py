"""Book upload staging and duplicate inspection helpers."""

import logging
import shutil
from collections.abc import Mapping
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.services.calibre_service import calibre_service
from app.services.pdf_metadata_extractor import extract_pdf_metadata, extract_candidate_isbns_from_text

logger = logging.getLogger(__name__)


def copy_upload_to_staging(upload_file, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("wb") as buffer:
        shutil.copyfileobj(upload_file, buffer, length=1024 * 1024)


def public_upload_job(job: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "job_id": job["job_id"],
        "filename": job["filename"],
        "status": job["status"],
        "error": job.get("error"),
        "book_id": job.get("book_id"),
        "created_at": job.get("created_at"),
        "updated_at": job.get("updated_at"),
    }


def auto_fetch_metadata_enabled(form_data: Mapping[str, object], parsed_value: Optional[bool]) -> bool:
    if "auto_fetch_metadata" not in form_data or parsed_value is None:
        return True
    return parsed_value


def check_duplicate_isbn(prepared: list, staged_paths: list, calibre_svc=calibre_service) -> Optional[dict]:
    """Inspects staged uploads for duplicate ISBNs already present in Calibre in PDF format."""
    for job in prepared:
        staged_path = Path(job["staging_path"])
        candidate_isbns = []
        if job.get("isbn"):
            candidate_isbns.append(job.get("isbn"))

        for can, _ in extract_candidate_isbns_from_text(job.get("filename") or ""):
            if can not in candidate_isbns:
                candidate_isbns.append(can)

        try:
            extracted = extract_pdf_metadata(staged_path, max_isbn_candidates=5)
            for can in extracted.get("isbns", []):
                if can not in candidate_isbns:
                    candidate_isbns.append(can)
        except Exception:
            pass

        duplicate = None
        matched_isbn = None
        for candidate in candidate_isbns:
            duplicate = calibre_svc.find_duplicate_by_isbn(candidate, format_name="PDF")
            if duplicate:
                matched_isbn = duplicate.get("isbn") or candidate
                break

        if duplicate:
            for p in staged_paths:
                try:
                    p.unlink(missing_ok=True)
                except OSError:
                    pass
            return {
                "code": "DUPLICATE_ISBN_FORMAT",
                "isbn": matched_isbn,
                "format": "PDF",
                "existing_title": duplicate.get("title"),
                "existing_id": duplicate.get("id"),
                "message": f"A book with ISBN {matched_isbn} in PDF format already exists: '{duplicate.get('title')}'.",
            }
    return None
