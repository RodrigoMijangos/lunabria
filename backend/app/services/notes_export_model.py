import hashlib
import re
import unicodedata
from typing import Any, Dict, List, Optional

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
    slugify = _slugify
    if not x or not x.strip():
        return []
    parts = x.split(" / ")
    res = [slugify(p) for p in parts if p.strip()]
    return [r for r in res if r]

def build_palette(colors: List[Dict[str, Any]], *, _seg=seg) -> List[Dict[str, Any]]:
    seg = _seg
    palette = []
    seen_keys = set()
    for c in colors:
        label = c.get("name", "").strip() or c.get("id", "").strip().capitalize()
        s = seg(label)
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
    normalize_text = _normalize_text
    note_of = _note_of
    seg = _seg
    build_palette = _build_palette
    parse_toc_sections = _parse_toc_sections
    extract_reconstructed_text = _extract_reconstructed_text
    finalize_run = _finalize_run if _finalize_run is not None else globals()["finalize_run"]
    pymupdf = _pymupdf
    MAX_RUN_PAGE_GAP = _max_run_page_gap
    TOC_Y_TOLERANCE = _toc_y_tolerance
    palette = build_palette(highlight_colors)
    palette_map_by_id = {p["id"]: p for p in palette}

    doc = None
    if pdf_path:
        try:
            doc = pymupdf.open(pdf_path)
        except Exception:
            doc = None

    book_id = book_info.get("id", 0)
    raw_sections = parse_toc_sections(doc, book_id)

    processed_marks = []
    for a in annotations:
        a_id = a["id"]
        color_id = a.get("color", "")
        cat_str = a.get("category", "") or ""
        cat_norm = normalize_text(cat_str)
        cat_segments = seg(cat_str)

        matched_entry = None
        meaning_source = "category"
        legacy = False

        if cat_segments:
            for p in palette:
                if any(s in p["seg"] for s in cat_segments):
                    matched_entry = p
                    break
            if matched_entry:
                type_key = matched_entry["key"]
                label = matched_entry["label"]
            else:
                type_key = cat_segments[0]
                label = cat_norm
                legacy = True
        else:
            p_color = palette_map_by_id.get(color_id)
            if p_color:
                matched_entry = p_color
                type_key = p_color["key"]
                label = p_color["label"]
                meaning_source = "color"
            else:
                type_key = "uncategorized"
                label = "Uncategorized"
                meaning_source = "color"

        slot_conflict = False
        p_slot = palette_map_by_id.get(color_id)
        if matched_entry and p_slot and matched_entry["id"] != p_slot["id"]:
            slot_conflict = True

        category_raw = cat_str if cat_norm != label else None

        text, text_raw, text_source, order_tuple, pos_y0 = extract_reconstructed_text(
            doc,
            a["page"],
            a.get("rects") or [],
            a.get("text", "")
        )

        note_text = note_of(a)

        is_heading = False
        norm_text_for_heading = re.sub(r"^(\d+(\.\d+)*\s*)", "", text).strip().lower()
        if raw_sections:
            for s in raw_sections:
                if s["raw_page"] == a["page"]:
                    norm_s_title = re.sub(r"^(\d+(\.\d+)*\s*)", "", s["title"]).strip().lower()
                    if norm_s_title and norm_text_for_heading == norm_s_title:
                        is_heading = True
                        break

        processed_marks.append({
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
            "pos_y0": pos_y0
        })

    if doc:
        try:
            doc.close()
        except Exception:
            pass

    processed_marks.sort(key=lambda m: (m["order"], m["id"]))

    for m in processed_marks:
        m_page = m["page"]
        m_y = m["pos_y0"]
        matched_s = None
        for s in raw_sections:
            if (s["raw_page"] < m_page) or (s["raw_page"] == m_page and s["y"] <= m_y + TOC_Y_TOLERANCE):
                matched_s = s
            elif s["raw_page"] > m_page:
                break

        if matched_s:
            m["section_id"] = matched_s["id"]
        else:
            m["section_id"] = "s_default_no_index"

    has_no_index_marks = any(m["section_id"] == "s_default_no_index" for m in processed_marks)
    all_sections = []
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

    filtered_marks = processed_marks
    if color_filter:
        filtered_marks = [m for m in processed_marks if m["color"] == color_filter]

    runs = []
    current_run: Optional[Dict[str, Any]] = None

    for m in filtered_marks:
        should_cut = False
        if current_run is None:
            should_cut = True
        else:
            if m["type"] != current_run["type"]:
                should_cut = True
            elif m["section_id"] != current_run["section"]:
                should_cut = True
            elif (m["page"] - current_run["pages"][1]) > MAX_RUN_PAGE_GAP:
                should_cut = True
            elif m["is_heading"] or current_run["is_heading"]:
                should_cut = True

        if should_cut:
            if current_run is not None:
                runs.append(finalize_run(current_run))
            current_run = {
                "section": m["section_id"],
                "type": m["type"],
                "label": m["label"],
                "pages": [m["page"], m["page"]],
                "is_heading": m["is_heading"],
                "marks": [m]
            }
        else:
            current_run["marks"].append(m)
            current_run["pages"][1] = m["page"]

    if current_run is not None:
        runs.append(finalize_run(current_run))

    sections_with_runs = {r["section"] for r in runs}
    sections_by_id = {s["id"]: s for s in all_sections}

    active_section_ids = set()
    for s_id in sections_with_runs:
        curr = s_id
        while curr:
            active_section_ids.add(curr)
            curr_sec = sections_by_id.get(curr)
            curr = curr_sec["parent"] if curr_sec else None

    pruned_sections = []
    for s in all_sections:
        if s["id"] in active_section_ids:
            filtered_children = [c for c in s["children"] if c in active_section_ids]
            pruned_sections.append({
                "id": s["id"],
                "title": s["title"],
                "level": s["level"],
                "parent": s["parent"] if s["parent"] in active_section_ids else None,
                "children": filtered_children,
                "page_start": s["page_start"],
                "page_end": s["page_end"],
                "path": s["path"]
            })

    authors_raw = book_info.get("authors") or "Unknown"
    if isinstance(authors_raw, list):
        authors_list = authors_raw
    else:
        authors_list = [a.strip() for a in re.split(r"&|,", str(authors_raw)) if a.strip()]
        if not authors_list:
            authors_list = ["Unknown"]

    legend = []
    for p in palette:
        aliases = [s for s in p["seg"][1:]]
        legend.append({
            "key": p["key"],
            "label": p["label"],
            "aliases": aliases,
            "color_id": p["id"],
            "hex": p.get("color") or None,
            "description": ""
        })

    by_type_stats = {}
    for p in palette:
        by_type_stats[p["key"]] = 0
    for m in filtered_marks:
        k = m["type"]
        by_type_stats[k] = by_type_stats.get(k, 0) + 1

    stats = {
        "total": len(filtered_marks),
        "by_type": by_type_stats,
        "legacy": sum(1 for m in filtered_marks if m.get("legacy")),
        "uncategorized": sum(1 for m in filtered_marks if m["type"] == "uncategorized"),
        "slot_conflict": sum(1 for m in filtered_marks if m.get("slot_conflict"))
    }

    model = {
        "schema_version": "1.0",
        "source": {
            "id": book_id,
            "title": book_info.get("title", ""),
            "authors": authors_list,
            "exported_at": exported_at
        },
        "legend": legend,
        "stats": stats,
        "sections": pruned_sections,
        "runs": runs
    }

    return model

def finalize_run(run_data: Dict[str, Any]) -> Dict[str, Any]:
    marks = run_data["marks"]
    run_id = "r_" + hashlib.sha1("|".join(m["id"] for m in marks).encode("utf-8")).hexdigest()[:10]

    combined_parts = []
    for i, m in enumerate(marks):
        t = m["text"]
        if i == 0:
            combined_parts.append(t)
        else:
            prev_m = marks[i - 1]
            prev_order = prev_m["order"]
            curr_order = m["order"]

            if prev_order[0] == curr_order[0] and prev_order[1] == curr_order[1] and prev_order[2] == curr_order[2] and (curr_order[3] - prev_order[3] <= 1):
                combined_parts.append(" ")
            else:
                combined_parts.append(" … ")
            combined_parts.append(t)

    full_text = "".join(combined_parts).strip()

    run_marks = []
    for m in marks:
        rm = {
            "id": m["id"],
            "section": run_data["section"],
            "page": m["page"],
            "text": m["text"],
            "type": m["type"],
            "text_source": m["text_source"],
            "note": m["note"],
            "is_heading": m["is_heading"]
        }
        if m.get("meaning_source"):
            rm["meaning_source"] = m["meaning_source"]
        if m.get("category_raw"):
            rm["category_raw"] = m["category_raw"]
        if m.get("legacy"):
            rm["legacy"] = True
        if m.get("slot_conflict"):
            rm["slot_conflict"] = True
        run_marks.append(rm)

    return {
        "id": run_id,
        "section": run_data["section"],
        "type": run_data["type"],
        "label": run_data["label"],
        "pages": run_data["pages"],
        "text": full_text,
        "marks": run_marks
    }
