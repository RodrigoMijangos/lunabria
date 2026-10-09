import json
from typing import Any, Dict, List

import tomli_w
import yaml

from app.services.notes_export_model import clean_none


def render_json(model: Dict[str, Any]) -> str:
    return json.dumps(model, ensure_ascii=False, indent=2) + "\n"

def render_yaml(model: Dict[str, Any]) -> str:
    return yaml.safe_dump(model, allow_unicode=True, sort_keys=False, width=100)

def render_toml(model: Dict[str, Any], *, _clean_none=clean_none) -> str:
    cleaned = _clean_none(model)
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

def render_md(
    model: Dict[str, Any],
    group_by: str = "hierarchy",
    *,
    _render_md_hierarchy=None,
    _render_md_by_color=None,
    _render_md_by_page=None
) -> str:
    _render_md_hierarchy = _render_md_hierarchy or render_md_hierarchy
    _render_md_by_color = _render_md_by_color or render_md_by_color
    _render_md_by_page = _render_md_by_page or render_md_by_page
    if group_by == "color":
        return _render_md_by_color(model)
    elif group_by == "page":
        return _render_md_by_page(model)
    else:
        return _render_md_hierarchy(model)

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
