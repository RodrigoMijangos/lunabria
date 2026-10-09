import hashlib
import json
import re
import unicodedata
from typing import Any, Dict, List, Optional, Tuple
import pymupdf
import yaml
import tomli_w

from app.services.reader_annotations import normalize_text as base_normalize_text

CATEGORY_WINS = True
MAX_RUN_PAGE_GAP = 1
TOC_Y_TOLERANCE = 3.0
VERTICAL_OVERLAP_THRESHOLD = 0.5


def normalize_text(text: str) -> str:
    return base_normalize_text(text, re=re)


def note_of(annotation: Dict[str, Any]) -> str:
    c = annotation.get("comment") or ""
    return c.strip()


def slugify(text: str) -> str:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9]+", "_", text).strip("_")
    return text


def seg(x: str) -> List[str]:
    if not x or not x.strip():
        return []
    parts = x.split(" / ")
    res = [slugify(p) for p in parts if p.strip()]
    return [r for r in res if r]


def build_palette(colors: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
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


def split_words_with_dashes(words: List[Tuple]) -> List[Tuple]:
    new_words = []
    for w in words:
        x0, y0, x1, y1, text, block, line, word_idx = w[:8]
        if "\u2014" in text or "\u2013" in text:
            parts = re.split(r"([\u2014\u2013])", text)
            total_len = len(text)
            curr_x0 = x0
            total_w = x1 - x0
            sub_idx = 0
            for p in parts:
                if not p:
                    continue
                p_len = len(p)
                p_x1 = curr_x0 + (total_w * (p_len / total_len) if total_len > 0 else 0)
                if p not in ("\u2014", "\u2013"):
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
    saved_text: str
) -> Tuple[str, Optional[str], str, Tuple[int, int, int, int, int], float]:
    cleaned_saved = normalize_text(saved_text)
    sorted_rects = sorted(rects or [], key=lambda r: (round(r.get("y0", 0.0), 1), r.get("x0", 0.0)))
    first_y0 = sorted_rects[0]["y0"] if sorted_rects else 0.0
    first_x0 = sorted_rects[0]["x0"] if sorted_rects else 0.0

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
                vert_overlap = max(0.0, min(r["y1"], w_y1) - max(r["y0"], w_y0))
                horiz_overlap = max(0.0, min(r["x1"], w_x1) - max(r["x0"], w_x0))
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


def parse_toc_sections(doc: Optional[pymupdf.Document], book_id: int) -> List[Dict[str, Any]]:
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
        lvl, title, page, dest = entry
        title = normalize_text(title)
        
        y = 0.0
        if isinstance(dest, dict) and "to" in dest and dest["to"] is not None:
            y = dest["to"].y
        else:
            try:
                p = doc[page - 1]
                matches = p.search_for(title)
                if matches:
                    y = matches[0].y0
            except Exception:
                y = 0.0

        sec_id = "s_" + hashlib.sha1(f"{book_id}|{lvl}|{title}|{page}".encode("utf-8")).hexdigest()[:8]

        while stack and stack[-1]["level"] >= lvl:
            popped = stack.pop()
            popped["page_end"] = page

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
            "raw_page": page
        }

        if stack:
            stack[-1]["children"].append(sec_id)

        stack.append(sec_data)
        sections.append(sec_data)

    return sections


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
    exported_at: Optional[str] = None
) -> Dict[str, Any]:
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


def render_json(model: Dict[str, Any]) -> str:
    return json.dumps(model, ensure_ascii=False, indent=2) + "\n"


def render_yaml(model: Dict[str, Any]) -> str:
    return yaml.safe_dump(model, allow_unicode=True, sort_keys=False, width=100)


def render_toml(model: Dict[str, Any]) -> str:
    cleaned = clean_none(model)
    return tomli_w.dumps(cleaned)


def render_jsonl(model: Dict[str, Any]) -> str:
    sections_by_id = {s["id"]: s for s in model["sections"]}
    book_title = model["source"]["title"]
    lines = []

    for r in model["runs"]:
        sec = sections_by_id.get(r["section"])
        path = sec["path"] if sec else []
        
        marks_json = [
            {
                "id": m["id"],
                "section": m.get("section", r["section"]),
                "page": m["page"],
                "text": m["text"],
                "note": m["note"],
                "is_heading": m["is_heading"]
            }
            for m in r["marks"]
        ]

        run_chunk = {
            "kind": "run",
            "id": r["id"],
            "book": book_title,
            "path": path,
            "pages": r["pages"],
            "type": r["type"],
            "label": r["label"],
            "text": r["text"],
            "marks": marks_json
        }
        lines.append(json.dumps(run_chunk, ensure_ascii=False))

    return "\n".join(lines) + ("\n" if lines else "")


def render_md(model: Dict[str, Any], group_by: str = "hierarchy") -> str:
    if group_by == "color":
        return render_md_by_color(model)
    elif group_by == "page":
        return render_md_by_page(model)
    else:
        return render_md_hierarchy(model)


def render_md_hierarchy(model: Dict[str, Any]) -> str:
    legend_dict = {item["key"]: item["label"] for item in model["legend"]}
    frontmatter_dict = {
        "title": model["source"]["title"],
        "authors": model["source"]["authors"],
        "legend": legend_dict,
        "stats": model["stats"]
    }
    if model["source"]["exported_at"]:
        frontmatter_dict["exported"] = model["source"]["exported_at"]

    fm_str = yaml.safe_dump(frontmatter_dict, allow_unicode=True, sort_keys=False, width=100).strip()

    lines = [f"---\n{fm_str}\n---", ""]

    sections_by_id = {s["id"]: s for s in model["sections"]}
    runs_by_section: Dict[str, List[Dict[str, Any]]] = {}
    for r in model["runs"]:
        runs_by_section.setdefault(r["section"], []).append(r)

    for sec in model["sections"]:
        s_id = sec["id"]
        sec_runs = runs_by_section.get(s_id, [])
        if not sec_runs:
            continue

        h_prefix = "#" * max(1, min(sec["level"], 6))
        page_range = f"(pp. {sec['page_start']}–{sec['page_end']})"
        lines.append(f"{h_prefix} {sec['title']} {page_range}")
        lines.append("")

        for r in sec_runs:
            p_start, p_end = r["pages"]
            page_label = f"p.{p_start}" if p_start == p_end else f"p.{p_start}–{p_end}"
            
            is_h = any(m.get("is_heading") for m in r["marks"])
            heading_star = " ★" if is_h else ""

            raw_hash = r["id"][2:] if r["id"].startswith("r_") else r["id"]
            anchor = f"^r-{raw_hash}"

            lines.append(f"**[{r['type']} · {page_label}]** {r['text']}{heading_star} {anchor}")

            for m in r["marks"]:
                if m.get("note"):
                    lines.append(f"> 📝 {m['note']}")

            marks_uuids = " ".join(m["id"] for m in r["marks"])
            lines.append(f"<!-- marks: {marks_uuids} -->")
            lines.append("")

    return "\n".join(lines).strip() + "\n"


def render_md_by_color(model: Dict[str, Any]) -> str:
    all_marks = []
    for r in model["runs"]:
        all_marks.extend(r["marks"])

    by_color: Dict[str, List[Dict[str, Any]]] = {}
    for r in model["runs"]:
        for m in r["marks"]:
            by_color.setdefault(r["label"], []).append(m)

    md = [
        f"# Notes & Highlights: {model['source']['title']}",
        f"**Author(s):** {', '.join(model['source']['authors'])}",
        f"**Total quotes:** {model['stats']['total']}\n",
        "---\n"
    ]

    if not all_marks:
        md.append("*No annotations found matching the selected criteria.*")
        return "\n".join(md)

    for label, items in by_color.items():
        md.append(f"## {label} ({len(items)})")
        for item in items:
            clean_text = item["text"]
            md.append(f"- **[Page {item['page']}]**: \"{clean_text}\"")
            if item.get("note"):
                md.append(f"  > 💡 *Note:* {item['note']}")
        md.append("")

    return "\n".join(md).strip() + "\n"


def render_md_by_page(model: Dict[str, Any]) -> str:
    marks_with_label = []
    for r in model["runs"]:
        for m in r["marks"]:
            marks_with_label.append((m, r["label"]))

    marks_with_label.sort(key=lambda pair: pair[0]["page"])

    md = [
        f"# Notes & Highlights: {model['source']['title']}",
        f"**Author(s):** {', '.join(model['source']['authors'])}",
        f"**Total quotes:** {model['stats']['total']}\n",
        "---\n"
    ]

    if not marks_with_label:
        md.append("*No annotations found matching the selected criteria.*")
        return "\n".join(md)

    current_page = None
    for item, label in marks_with_label:
        if item["page"] != current_page:
            current_page = item["page"]
            md.append(f"### Page {current_page}")
        clean_text = item["text"]
        md.append(f"- *[{label}]* \"{clean_text}\"")
        if item.get("note"):
            md.append(f"  > 💡 *Note:* {item['note']}")
        md.append("")

    return "\n".join(md).strip() + "\n"
