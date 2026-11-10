import hashlib
import re
from typing import Any, Dict, List, Optional, Tuple

import pymupdf

from app.services.reader_annotations import normalize_text as base_normalize_text

TOC_Y_TOLERANCE = 3.0
VERTICAL_OVERLAP_THRESHOLD = 0.5


def normalize_text(text: str) -> str:
    return base_normalize_text(text, re=re)

def split_words_with_dashes(words: List[Tuple]) -> List[Tuple]:
    new_words = []
    for w in words:
        x0, y0, x1, y1, text, block, line, word_idx = w[:8]
        # Some PDF fonts substitute unsupported em dashes with a middle dot.
        if "\u2014" in text or "\u2013" in text or "\u00b7" in text:
            parts = re.split(r"([\u2014\u2013\u00b7])", text)
            total_len = len(text)
            curr_x0 = x0
            total_w = x1 - x0
            sub_idx = 0
            for p in parts:
                if not p:
                    continue
                p_len = len(p)
                p_x1 = curr_x0 + (total_w * (p_len / total_len) if total_len > 0 else 0)
                if p not in ("\u2014", "\u2013", "\u00b7"):
                    new_words.append((curr_x0, y0, p_x1, y1, p, block, line, word_idx, sub_idx))
                    sub_idx += 1
                curr_x0 = p_x1
        else:
            new_words.append((x0, y0, x1, y1, text, block, line, word_idx, 0))
    return new_words

def extract_reconstructed_text(
    doc: Optional[pymupdf.Document],
    page_num: int,
    rects: List[Dict[str, Any]],
    saved_text: str,
    *,
    _normalize_text=normalize_text,
    _split_words_with_dashes=split_words_with_dashes,
    _vertical_overlap_threshold=VERTICAL_OVERLAP_THRESHOLD
) -> Tuple[str, Optional[str], str, Tuple[int, int, int, int, int], float]:
    normalize_text = _normalize_text
    split_words_with_dashes = _split_words_with_dashes
    VERTICAL_OVERLAP_THRESHOLD = _vertical_overlap_threshold
    cleaned_saved = normalize_text(saved_text)

    def _rect_y0(r: Dict[str, Any]) -> float:
        for k in ("y0", "top", "y"):
            if k in r and r[k] is not None:
                try:
                    return float(r[k])
                except (ValueError, TypeError):
                    pass
        return 0.0

    def _rect_x0(r: Dict[str, Any]) -> float:
        for k in ("x0", "left", "x"):
            if k in r and r[k] is not None:
                try:
                    return float(r[k])
                except (ValueError, TypeError):
                    pass
        return 0.0

    def _rect_y1(r: Dict[str, Any]) -> float:
        for k in ("y1", "bottom"):
            if k in r and r[k] is not None:
                try:
                    return float(r[k])
                except (ValueError, TypeError):
                    pass
        if "height" in r and r["height"] is not None:
            return _rect_y0(r) + float(r["height"])
        return _rect_y0(r)

    def _rect_x1(r: Dict[str, Any]) -> float:
        for k in ("x1", "right"):
            if k in r and r[k] is not None:
                try:
                    return float(r[k])
                except (ValueError, TypeError):
                    pass
        if "width" in r and r["width"] is not None:
            return _rect_x0(r) + float(r["width"])
        return _rect_x0(r)

    sorted_rects = sorted(rects or [], key=lambda r: (round(_rect_y0(r), 1), _rect_x0(r)))
    first_y0 = _rect_y0(sorted_rects[0]) if sorted_rects else 0.0
    first_x0 = _rect_x0(sorted_rects[0]) if sorted_rects else 0.0

    if not doc or not rects or page_num < 1 or page_num > doc.page_count:
        return cleaned_saved, None, "stored", (page_num, int(first_y0 * 10), int(first_x0 * 10), 0, 0), first_y0

    try:
        page = doc[page_num - 1]
        raw_words = page.get_text("words")
        if not raw_words:
            return cleaned_saved, None, "stored", (page_num, int(first_y0 * 10), int(first_x0 * 10), 0, 0), first_y0

        split_w = split_words_with_dashes(raw_words)
        matched_words = []
        for sw in split_w:
            w_x0, w_y0, w_x1, w_y1 = sw[:4]
            word_h = w_y1 - w_y0
            word_w = w_x1 - w_x0
            for r in sorted_rects:
                r_y0 = _rect_y0(r)
                r_y1 = _rect_y1(r)
                r_x0 = _rect_x0(r)
                r_x1 = _rect_x1(r)
                vert_overlap = max(0.0, min(r_y1, w_y1) - max(r_y0, w_y0))
                horiz_overlap = max(0.0, min(r_x1, w_x1) - max(r_x0, w_x0))
                if word_h > 0 and (vert_overlap / word_h) > VERTICAL_OVERLAP_THRESHOLD and (horiz_overlap > 0.25 * word_w or horiz_overlap > 0):
                    matched_words.append(sw)
                    break

        if not matched_words:
            return cleaned_saved, None, "stored", (page_num, int(first_y0 * 10), int(first_x0 * 10), 0, 0), first_y0

        matched_words.sort(key=lambda w: (w[5], w[6], w[7], w[8]))
        reconstructed = normalize_text(" ".join(m[4] for m in matched_words))

        if not reconstructed:
            return cleaned_saved, None, "stored", (page_num, int(first_y0 * 10), int(first_x0 * 10), 0, 0), first_y0

        text_raw = cleaned_saved if cleaned_saved != reconstructed else None
        first_word = matched_words[0]
        order_tuple = (page_num, first_word[5], first_word[6], first_word[7], first_word[8])
        pos_y0 = first_word[1]
        return reconstructed, text_raw, "pdf", order_tuple, pos_y0

    except Exception:
        return cleaned_saved, None, "stored", (page_num, int(first_y0 * 10), int(first_x0 * 10), 0, 0), first_y0

def parse_toc_sections(
    doc: Optional[pymupdf.Document],
    book_id: int,
    *,
    _normalize_text=normalize_text
) -> List[Dict[str, Any]]:
    normalize_text = _normalize_text
    if not doc:
        return []
    try:
        raw_toc = doc.get_toc(simple=False)
    except Exception:
        return []

    if not raw_toc:
        return []

    sections = []
    stack: List[Dict[str, Any]] = []

    for entry in raw_toc:
        if len(entry) >= 4:
            lvl, title, page, dest = entry[:4]
        else:
            lvl, title, page = entry[:3]
            dest = None
        title = normalize_text(title)

        dest_y = None
        if isinstance(dest, dict) and "to" in dest and dest["to"] is not None:
            dest_y = float(dest["to"].y)

        found_y = None
        if doc and 1 <= page <= doc.page_count:
            try:
                p = doc[page - 1]
                matches = p.search_for(title)
                if not matches:
                    cleaned = re.sub(r"\s+", " ", title).strip()
                    if cleaned and cleaned != title:
                        matches = p.search_for(cleaned)
                if not matches:
                    for sep in (": ", " - ", " – ", " — "):
                        if sep in title:
                            part = title.split(sep)[0].strip()
                            if len(part) >= 3:
                                matches = p.search_for(part)
                                if matches:
                                    break
                if matches:
                    if dest_y is not None and dest_y > 40.0:
                        closest_match = min(matches, key=lambda m: abs(m.y0 - dest_y))
                        found_y = closest_match.y0
                    else:
                        body_matches = [m for m in matches if m.y0 >= 45.0]
                        found_y = body_matches[0].y0 if body_matches else matches[0].y0
            except Exception:
                pass

        if found_y is not None:
            y = float(found_y)
        elif dest_y is not None:
            y = dest_y
        else:
            y = 0.0

        sec_id = "s_" + hashlib.sha1(f"{book_id}|{lvl}|{title}|{page}".encode("utf-8")).hexdigest()[:8]

        while stack and stack[-1]["level"] >= lvl:
            popped = stack.pop()
            popped["page_end"] = page
            popped["end_y"] = y

        parent_id = stack[-1]["id"] if stack else None
        parent_path = list(stack[-1]["path"]) if stack else []

        sec_data = {
            "id": sec_id,
            "title": title,
            "level": lvl,
            "parent": parent_id,
            "children": [],
            "page_start": page,
            "page_end": doc.page_count,
            "path": parent_path + [title],
            "y": y,
            "end_y": None,
            "raw_page": page
        }

        if stack:
            stack[-1]["children"].append(sec_id)

        stack.append(sec_data)
        sections.append(sec_data)

    return sections
