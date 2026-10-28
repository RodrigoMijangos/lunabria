import hashlib
import re
import unicodedata
from typing import Any, Callable, Dict, List, Optional, Tuple

import pymupdf

from app.services.notes_export_pdf import extract_reconstructed_text, normalize_text, parse_toc_sections

MAX_RUN_PAGE_GAP = 1
TOC_Y_TOLERANCE = 3.0


def note_of(annotation: Dict[str, Any]) -> str:
    c = annotation.get("comment") or ""
    return c.strip()


def slugify(text: str) -> str:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9]+", "_", text).strip("_")
    return text


def seg(x: str, *, _slugify=slugify) -> List[str]:
    slugify_fn = _slugify
    if not x or not x.strip():
        return []
    parts = x.split(" / ")
    res = [slugify_fn(p) for p in parts if p.strip()]
    return [r for r in res if r]


def build_palette(colors: List[Dict[str, Any]], *, _seg=seg) -> List[Dict[str, Any]]:
    seg_fn = _seg
    palette = []
    seen_keys = set()
    for c in colors:
        label = c.get("name", "").strip() or c.get("id", "").strip().capitalize()
        s = seg_fn(label)
        key = s[0] if s else slugify(c.get("id", "color"))
        if key in seen_keys:
            i = 2
            while f"{key}_{i}" in seen_keys:
                i += 1
            key = f"{key}_{i}"
        seen_keys.add(key)
        palette.append({
            "id": c["id"],
            "label": label,
            "seg": s,
            "key": key,
            "color": c.get("color", ""),
            "textColor": c.get("textColor", "")
        })
    return palette


def clean_none(d: Any) -> Any:
    if isinstance(d, dict):
        return {k: clean_none(v) for k, v in d.items() if v is not None}
    elif isinstance(d, list):
        return [clean_none(v) for v in d]
    return d


def _resolve_mark_meaning(
    color_id: str,
    cat_norm: str,
    cat_segments: List[str],
    palette: List[Dict[str, Any]],
    palette_map_by_id: Dict[str, Dict[str, Any]],
) -> Tuple[Optional[Dict[str, Any]], str, str, str, bool]:
    if cat_segments:
        matched_entry = next(
            (p for p in palette if any(s in p["seg"] for s in cat_segments)),
            None,
        )
        if matched_entry:
            return matched_entry, matched_entry["key"], matched_entry["label"], "category", False
        return None, cat_segments[0], cat_norm, "category", True

    p_color = palette_map_by_id.get(color_id)
    if p_color:
        return p_color, p_color["key"], p_color["label"], "color", False
    return None, "uncategorized", "Uncategorized", "color", False


def _is_heading_mark(text: str, page: int, raw_sections: List[Dict[str, Any]]) -> bool:
    if not raw_sections:
        return False
    norm_text = re.sub(r"^(\d+(\.\d+)*\s*)", "", text).strip().lower()
    for s in raw_sections:
        if s["raw_page"] == page:
            norm_s_title = re.sub(r"^(\d+(\.\d+)*\s*)", "", s["title"]).strip().lower()
            if norm_s_title and norm_text == norm_s_title:
                return True
    return False


def _process_single_annotation(
    a: Dict[str, Any],
    doc: Any,
    palette: List[Dict[str, Any]],
    palette_map_by_id: Dict[str, Dict[str, Any]],
    raw_sections: List[Dict[str, Any]],
    normalize_text_fn: Callable[[str], str],
    seg_fn: Callable[[str], List[str]],
    extract_reconstructed_text_fn: Callable[..., Any],
    note_of_fn: Callable[[Dict[str, Any]], str],
) -> Dict[str, Any]:
    a_id = a["id"]
    color_id = a.get("color", "")
    cat_str = a.get("category", "") or ""
    cat_norm = normalize_text_fn(cat_str)
    cat_segments = seg_fn(cat_str)

    matched_entry, type_key, label, meaning_source, legacy = _resolve_mark_meaning(
        color_id, cat_norm, cat_segments, palette, palette_map_by_id
    )

    p_slot = palette_map_by_id.get(color_id)
    slot_conflict = bool(matched_entry and p_slot and matched_entry["id"] != p_slot["id"])
    category_raw = cat_str if cat_norm != label else None

    text, text_raw, text_source, order_tuple, pos_y0 = extract_reconstructed_text_fn(
        doc, a["page"], a.get("rects") or [], a.get("text", "")
    )
    note_text = note_of_fn(a)
    is_heading = _is_heading_mark(text, a["page"], raw_sections)

    return {
        "id": a_id,
        "page": a["page"],
        "color": color_id,
        "type": type_key,
        "label": label,
        "text": text,
        "text_raw": text_raw,
        "text_source": text_source,
        "note": note_text if note_text else None,
        "is_heading": is_heading,
        "category_raw": category_raw,
        "legacy": legacy if legacy else None,
        "slot_conflict": slot_conflict if slot_conflict else None,
        "meaning_source": meaning_source,
        "order": order_tuple,
        "pos_y0": pos_y0,
    }


def _assign_sections_to_marks(
    processed_marks: List[Dict[str, Any]],
    raw_sections: List[Dict[str, Any]],
    toc_y_tolerance: float,
) -> List[Dict[str, Any]]:
    for m in processed_marks:
        m_page = m["page"]
        m_y = m["pos_y0"]
        matched_s = None
        for s in raw_sections:
            if (s["raw_page"] < m_page) or (s["raw_page"] == m_page and s["y"] <= m_y + toc_y_tolerance):
                matched_s = s
            elif s["raw_page"] > m_page:
                break
        m["section_id"] = matched_s["id"] if matched_s else "s_default_no_index"

    has_no_index_marks = any(m["section_id"] == "s_default_no_index" for m in processed_marks)
    all_sections: List[Dict[str, Any]] = []
    if has_no_index_marks or not raw_sections:
        all_sections.append({
            "id": "s_default_no_index",
            "title": "(sin índice)",
            "level": 0,
            "parent": None,
            "children": [],
            "page_start": min((m["page"] for m in processed_marks), default=1),
            "page_end": max((m["page"] for m in processed_marks), default=1),
            "path": ["(sin índice)"]
        })
    for s in raw_sections:
        all_sections.append({
            "id": s["id"],
            "title": s["title"],
            "level": s["level"],
            "parent": s["parent"],
            "children": list(s["children"]),
            "page_start": s["page_start"],
            "page_end": s["page_end"],
            "path": list(s["path"])
        })
    return all_sections


def _should_cut_run(
    m: Dict[str, Any], current_run: Optional[Dict[str, Any]], max_run_page_gap: int
) -> bool:
    if current_run is None:
        return True
    if m["type"] != current_run["type"] or m["section_id"] != current_run["section"]:
        return True
    if (m["page"] - current_run["pages"][1]) > max_run_page_gap:
        return True
    return bool(m["is_heading"] or current_run["is_heading"])


def _group_marks_into_runs(
    filtered_marks: List[Dict[str, Any]],
    max_run_page_gap: int,
    finalize_run_fn: Callable[[Dict[str, Any]], Dict[str, Any]],
) -> List[Dict[str, Any]]:
    runs = []
    current_run: Optional[Dict[str, Any]] = None

    for m in filtered_marks:
        if _should_cut_run(m, current_run, max_run_page_gap):
            if current_run is not None:
                runs.append(finalize_run_fn(current_run))
            current_run = {
                "section": m["section_id"],
                "type": m["type"],
                "label": m["label"],
                "pages": [m["page"], m["page"]],
                "is_heading": m["is_heading"],
                "marks": [m],
            }
        else:
            if current_run is None:
                raise RuntimeError("Cannot append a mark without an active export run.")
            current_run["marks"].append(m)
            current_run["pages"][1] = m["page"]

    if current_run is not None:
        runs.append(finalize_run_fn(current_run))
    return runs


def _prune_active_sections(
    all_sections: List[Dict[str, Any]], runs: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    sections_with_runs = {r["section"] for r in runs}
    sections_by_id = {s["id"]: s for s in all_sections}

    active_section_ids = set()
    for s_id in sections_with_runs:
        curr: Optional[str] = s_id
        while curr:
            active_section_ids.add(curr)
            curr_sec = sections_by_id.get(curr)
            curr = curr_sec["parent"] if curr_sec else None

    pruned_sections = []
    for s in all_sections:
        if s["id"] in active_section_ids:
            pruned_sections.append({
                "id": s["id"],
                "title": s["title"],
                "level": s["level"],
                "parent": s["parent"] if s["parent"] in active_section_ids else None,
                "children": [c for c in s["children"] if c in active_section_ids],
                "page_start": s["page_start"],
                "page_end": s["page_end"],
                "path": s["path"],
            })
    return pruned_sections


def _parse_authors_list(authors_raw: Any) -> List[str]:
    if isinstance(authors_raw, list):
        return authors_raw
    authors_list = [a.strip() for a in re.split(r"&|,", str(authors_raw or "Unknown")) if a.strip()]
    return authors_list or ["Unknown"]


def _build_legend_and_stats(
    palette: List[Dict[str, Any]], filtered_marks: List[Dict[str, Any]]
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    legend = [
        {
            "key": p["key"],
            "label": p["label"],
            "aliases": list(p["seg"][1:]),
            "color_id": p["id"],
            "hex": p.get("color") or None,
            "description": "",
        }
        for p in palette
    ]
    by_type_stats = {p["key"]: 0 for p in palette}
    for m in filtered_marks:
        k = m["type"]
        by_type_stats[k] = by_type_stats.get(k, 0) + 1

    stats = {
        "total": len(filtered_marks),
        "by_type": by_type_stats,
        "legacy": sum(1 for m in filtered_marks if m.get("legacy")),
        "uncategorized": sum(1 for m in filtered_marks if m["type"] == "uncategorized"),
        "slot_conflict": sum(1 for m in filtered_marks if m.get("slot_conflict")),
    }
    return legend, stats


def build_model(
    annotations: List[Dict[str, Any]],
    book_info: Dict[str, Any],
    pdf_path: Optional[str],
    highlight_colors: List[Dict[str, Any]],
    color_filter: Optional[str] = None,
    exported_at: Optional[str] = None,
    *,
    _normalize_text=normalize_text,
    _note_of=note_of,
    _seg=seg,
    _build_palette=build_palette,
    _parse_toc_sections=parse_toc_sections,
    _extract_reconstructed_text=extract_reconstructed_text,
    _finalize_run=None,
    _pymupdf=pymupdf,
    _max_run_page_gap=MAX_RUN_PAGE_GAP,
    _toc_y_tolerance=TOC_Y_TOLERANCE
) -> Dict[str, Any]:
    finalize_run_fn = _finalize_run if _finalize_run is not None else globals()["finalize_run"]
    palette = _build_palette(highlight_colors)
    palette_map_by_id = {p["id"]: p for p in palette}

    doc = None
    if pdf_path:
        try:
            doc = _pymupdf.open(pdf_path)
        except Exception:
            doc = None

    book_id = book_info.get("id", 0)
    raw_sections = _parse_toc_sections(doc, book_id)

    try:
        processed_marks = [
            _process_single_annotation(
                a, doc, palette, palette_map_by_id, raw_sections,
                _normalize_text, _seg, _extract_reconstructed_text, _note_of
            )
            for a in annotations
        ]
    finally:
        if doc:
            try:
                doc.close()
            except Exception:
                pass

    processed_marks.sort(key=lambda m: (m["order"], m["id"]))
    all_sections = _assign_sections_to_marks(processed_marks, raw_sections, _toc_y_tolerance)

    filtered_marks = (
        [m for m in processed_marks if m["color"] == color_filter]
        if color_filter
        else processed_marks
    )

    runs = _group_marks_into_runs(filtered_marks, _max_run_page_gap, finalize_run_fn)
    pruned_sections = _prune_active_sections(all_sections, runs)
    legend, stats = _build_legend_and_stats(palette, filtered_marks)

    return {
        "schema_version": "1.0",
        "source": {
            "id": book_id,
            "title": book_info.get("title", ""),
            "authors": _parse_authors_list(book_info.get("authors")),
            "exported_at": exported_at,
        },
        "legend": legend,
        "stats": stats,
        "sections": pruned_sections,
        "runs": runs,
    }


def _are_marks_contiguous(prev_order: Tuple[Any, ...], curr_order: Tuple[Any, ...]) -> bool:
    return (
        prev_order[0] == curr_order[0]
        and prev_order[1] == curr_order[1]
        and prev_order[2] == curr_order[2]
        and (curr_order[3] - prev_order[3] <= 1)
    )


def _format_run_mark(m: Dict[str, Any], section_id: str) -> Dict[str, Any]:
    rm: Dict[str, Any] = {
        "id": m["id"],
        "section": section_id,
        "page": m["page"],
        "text": m["text"],
        "type": m["type"],
        "text_source": m["text_source"],
        "note": m["note"],
        "is_heading": m["is_heading"],
    }
    for opt_key in ("meaning_source", "category_raw"):
        if m.get(opt_key):
            rm[opt_key] = m[opt_key]
    for flag_key in ("legacy", "slot_conflict"):
        if m.get(flag_key):
            rm[flag_key] = True
    return rm


def finalize_run(run_data: Dict[str, Any]) -> Dict[str, Any]:
    marks = run_data["marks"]
    run_id = "r_" + hashlib.sha1("|".join(m["id"] for m in marks).encode("utf-8")).hexdigest()[:10]

    combined_parts = []
    for i, m in enumerate(marks):
        if i > 0:
            sep = " " if _are_marks_contiguous(marks[i - 1]["order"], m["order"]) else " … "
            combined_parts.append(sep)
        combined_parts.append(m["text"])

    section_id = run_data["section"]
    return {
        "id": run_id,
        "section": section_id,
        "type": run_data["type"],
        "label": run_data["label"],
        "pages": run_data["pages"],
        "text": "".join(combined_parts).strip(),
        "marks": [_format_run_mark(m, section_id) for m in marks],
    }
