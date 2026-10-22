import logging
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

import pymupdf

logger = logging.getLogger(__name__)

GENERIC_TITLES = {
    "untitled",
    "document",
    "microsoft word",
    "libreoffice",
    "calibre",
    "scan",
    "archivo",
    "presentation",
    "powerpoint",
    "unknown",
    "pdf document",
    "test",
}

GENERIC_AUTHORS = {
    "calibre",
    "administrator",
    "admin",
    "user",
    "owner",
    "unknown",
    "author",
}

DIGITAL_KEYWORDS = (
    "ebook",
    "e-book",
    "pdf",
    "electronic",
    "digital",
    "epub",
    "mobi",
    "eisbn",
    "online",
)

PRINT_KEYWORDS = (
    "print",
    "hardcover",
    "paperback",
    "impreso",
    "tapa dura",
    "rustica",
    "rústica",
    "cloth",
)

PENALTY_KEYWORDS = (
    "also by",
    "otros libros",
    "en esta coleccion",
    "en esta colección",
    "issn",
    "set",
    "obra completa",
    "coleccion",
    "colección",
    "titles by",
    "other books",
)


def validate_isbn_10(isbn: str) -> bool:
    """Validates ISBN-10 check digit using modulo 11."""
    cleaned = re.sub(r"[^0-9Xx]", "", isbn)
    if len(cleaned) != 10:
        return False
    if not (cleaned[:9].isdigit() and (cleaned[9].isdigit() or cleaned[9] in "Xx")):
        return False
    total = sum((10 - i) * (10 if ch in "Xx" else int(ch)) for i, ch in enumerate(cleaned))
    return total % 11 == 0


def validate_isbn_13(isbn: str) -> bool:
    """Validates ISBN-13 check digit using alternating weights 1 and 3, modulo 10."""
    cleaned = re.sub(r"[^0-9]", "", isbn)
    if len(cleaned) != 13:
        return False
    if not (cleaned.startswith("978") or cleaned.startswith("979")):
        return False
    total = sum(int(ch) * (1 if i % 2 == 0 else 3) for i, ch in enumerate(cleaned))
    return total % 10 == 0


def isbn_10_to_13(isbn10: str) -> str:
    """Converts a valid ISBN-10 to its canonical 13-digit representation with 978 prefix."""
    cleaned = re.sub(r"[^0-9Xx]", "", isbn10)
    prefix = "978" + cleaned[:9]
    chk = (10 - (sum(int(ch) * (1 if i % 2 == 0 else 3) for i, ch in enumerate(prefix)) % 10)) % 10
    return prefix + str(chk)


def normalize_isbn(raw: str) -> Optional[str]:
    """Cleans and validates an ISBN, returning its canonical 13-digit representation or None."""
    cleaned = re.sub(r"[^0-9Xx]", "", raw)
    if len(cleaned) == 13 and validate_isbn_13(cleaned):
        return cleaned
    if len(cleaned) == 10 and validate_isbn_10(cleaned):
        return isbn_10_to_13(cleaned)
    return None


def clean_pdf_title(raw_title: Optional[str]) -> Optional[str]:
    """Cleans a raw PDF title string, rejecting generic software defaults or filenames."""
    if not raw_title or not isinstance(raw_title, str):
        return None
    cleaned = raw_title.strip()
    if len(cleaned) < 2:
        return None
    lowered = cleaned.lower()
    if (
        lowered in GENERIC_TITLES
        or lowered.startswith("microsoft word -")
        or lowered.startswith("untitled")
        or lowered.endswith(".pdf")
        or ".pdf" in lowered
    ):
        return None
    return cleaned


def clean_pdf_author(raw_author: Optional[str]) -> Optional[str]:
    """Cleans a raw PDF author string, rejecting system accounts or generic placeholders."""
    if not raw_author or not isinstance(raw_author, str):
        return None
    cleaned = raw_author.strip()
    if len(cleaned) < 2:
        return None
    if cleaned.lower() in GENERIC_AUTHORS:
        return None
    return cleaned


def score_candidate(
    canonical_isbn: str,
    original_raw: str,
    line_context: str,
    page_index: int,
    total_pages: int,
    from_metadata: bool = False,
) -> int:
    """Computes relevance score for an ISBN candidate based on context and page location."""
    score = 10
    if from_metadata:
        score += 20
        return score

    # Location scoring
    if page_index < 6:
        score += 15  # Copyright/credits page
    elif total_pages > 0 and page_index >= max(0, total_pages - 5):
        score += 5  # Back cover / colophon

    ctx = line_context.lower()

    if any(k in ctx for k in DIGITAL_KEYWORDS):
        score += 20
    elif any(k in ctx for k in PRINT_KEYWORDS):
        score += 10

    if any(k in ctx for k in PENALTY_KEYWORDS):
        score -= 30

    if "isbn" in ctx:
        score += 5

    cleaned_orig = re.sub(r"[^0-9Xx]", "", original_raw)
    if len(cleaned_orig) == 13:
        score += 2

    return score


def extract_candidate_isbns_from_text(
    text: str,
    page_index: int = 0,
    total_pages: int = 1,
) -> List[Tuple[str, int]]:
    """
    Extracts valid ISBN-10/13 candidates from text, scoring each occurrence by its surrounding line.
    Returns pairs of (canonical_isbn_13, score).
    """
    candidates: List[Tuple[str, int]] = []
    lines = text.splitlines()

    pattern_labeled = re.compile(
        r"(?i)\bisbn(?:-?(?:10|13))?(?:\s*\([^)]*\))?\s*[:#]?\s*([0-9Xx\s\-]{10,25})"
    )
    pattern_standalone_13 = re.compile(r"\b(97[89][\s\-]*(?:[0-9][\s\-]*){9}[0-9])\b")
    pattern_hyphenated_10 = re.compile(r"\b([0-9]{1,5}[\s\-]+[0-9]{1,7}[\s\-]+[0-9]{1,7}[\s\-]+[0-9Xx])\b")

    for line in lines:
        stripped_line = line.strip()
        if not stripped_line:
            continue

        found_in_line: List[Tuple[str, str]] = []

        for match in pattern_labeled.finditer(stripped_line):
            raw = match.group(1)
            canonical = normalize_isbn(raw)
            if canonical:
                found_in_line.append((canonical, raw))

        for match in pattern_standalone_13.finditer(stripped_line):
            raw = match.group(1)
            canonical = normalize_isbn(raw)
            if canonical and not any(c == canonical for c, _ in found_in_line):
                found_in_line.append((canonical, raw))

        if "isbn" in stripped_line.lower():
            for match in pattern_hyphenated_10.finditer(stripped_line):
                raw = match.group(1)
                canonical = normalize_isbn(raw)
                if canonical and not any(c == canonical for c, _ in found_in_line):
                    found_in_line.append((canonical, raw))

        for canonical, raw in found_in_line:
            sc = score_candidate(
                canonical_isbn=canonical,
                original_raw=raw,
                line_context=stripped_line,
                page_index=page_index,
                total_pages=total_pages,
                from_metadata=False,
            )
            candidates.append((canonical, sc))

    return candidates


def extract_pdf_metadata(
    file_path: Union[str, Path],
    max_isbn_candidates: int = 3,
) -> Dict[str, Any]:
    """
    Inspects a PDF document to extract candidate ISBNs (ordered by priority), document title,
    and author without blocking or raising unhandled exceptions.
    """
    path_obj = Path(file_path)
    if not path_obj.is_file():
        return {"isbns": [], "title": None, "author": None}

    isbn_scores: Dict[str, int] = {}
    extracted_title: Optional[str] = None
    extracted_author: Optional[str] = None

    try:
        doc = pymupdf.open(str(path_obj))
    except Exception as err:
        logger.warning("Could not open PDF %s for metadata extraction: %s", path_obj, err)
        return {"isbns": [], "title": None, "author": None}

    try:
        total_pages = len(doc)
        meta = doc.metadata or {}

        # 1. Document title and author from metadata
        extracted_title = clean_pdf_title(meta.get("title"))
        extracted_author = clean_pdf_author(meta.get("author"))

        # Check metadata fields for potential ISBNs
        for field in ("subject", "keywords", "description"):
            val = meta.get(field)
            if val and isinstance(val, str):
                for can, sc in extract_candidate_isbns_from_text(val, 0, total_pages):
                    isbn_scores[can] = max(isbn_scores.get(can, 0), sc + 10)

        # 2. Text scanning (pages 0-14 and last 5 pages)
        pages_to_scan: List[int] = []
        if total_pages <= 20:
            pages_to_scan = list(range(total_pages))
        else:
            first_pages = list(range(min(15, total_pages)))
            last_pages = list(range(max(15, total_pages - 5), total_pages))
            pages_to_scan = sorted(set(first_pages + last_pages))

        for p_num in pages_to_scan:
            try:
                page = doc[p_num]
                text = page.get_text()
                if text:
                    for can, sc in extract_candidate_isbns_from_text(text, p_num, total_pages):
                        isbn_scores[can] = max(isbn_scores.get(can, 0), sc)
            except Exception as page_err:
                logger.debug("Error extracting text from page %d of %s: %s", p_num, path_obj, page_err)

        # 3. Typographical title fallback if title not yet found
        if not extracted_title and total_pages > 0:
            try:
                for p_num in range(min(2, total_pages)):
                    page = doc[p_num]
                    blocks = page.get_text("dict").get("blocks", [])
                    max_size = 0.0
                    best_candidate = ""
                    for block in blocks:
                        if "lines" not in block:
                            continue
                        for line in block["lines"]:
                            line_text = "".join(span.get("text", "") for span in line.get("spans", [])).strip()
                            for span in line.get("spans", []):
                                span_text = span.get("text", "").strip()
                                span_size = span.get("size", 0.0)
                                if span_size > max_size and len(span_text) >= 3:
                                    max_size = span_size
                                    best_candidate = line_text if len(line_text) <= 120 else span_text

                    if best_candidate and len(best_candidate) <= 120:
                        candidate_clean = clean_pdf_title(best_candidate)
                        if candidate_clean:
                            extracted_title = candidate_clean
                            break
            except Exception as typo_err:
                logger.debug("Error extracting typographical title from %s: %s", path_obj, typo_err)

    finally:
        try:
            doc.close()
        except Exception:
            pass

    filtered_isbns = [isbn for isbn, sc in isbn_scores.items() if sc > 0]
    sorted_isbns = sorted(filtered_isbns, key=lambda k: isbn_scores[k], reverse=True)

    return {
        "isbns": sorted_isbns[:max_isbn_candidates],
        "title": extracted_title,
        "author": extracted_author,
    }
