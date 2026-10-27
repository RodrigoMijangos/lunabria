"""Compatibility facade for building and rendering notes exports."""

import hashlib
import json
import re
import unicodedata
from typing import Any, Callable, Dict, List, Optional, Tuple

import pymupdf
import tomli_w
import yaml

from app.services.reader_annotations import normalize_text as base_normalize_text
from app.services import notes_export_model as _model
from app.services import notes_export_pdf as _pdf
from app.services import notes_export_renderers as _renderers

CATEGORY_WINS = True
MAX_RUN_PAGE_GAP = _model.MAX_RUN_PAGE_GAP
TOC_Y_TOLERANCE = _pdf.TOC_Y_TOLERANCE
VERTICAL_OVERLAP_THRESHOLD = _pdf.VERTICAL_OVERLAP_THRESHOLD


def normalize_text(text: str) -> str:
    return base_normalize_text(text, re=re)


def note_of(annotation: Dict[str, Any]) -> str:
    return _model.note_of(annotation)


def slugify(text: str) -> str:
    return _model.slugify(text)


def seg(x: str) -> List[str]:
    return _model.seg(x, _slugify=slugify)


def build_palette(colors: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return _model.build_palette(colors, _seg=seg)


def split_words_with_dashes(words: List[Tuple]) -> List[Tuple]:
    return _pdf.split_words_with_dashes(words)


def extract_reconstructed_text(
    doc: Optional[pymupdf.Document],
    page_num: int,
    rects: List[Dict[str, Any]],
    saved_text: str
) -> Tuple[str, Optional[str], str, Tuple[int, int, int, int, int], float]:
    return _pdf.extract_reconstructed_text(
        doc,
        page_num,
        rects,
        saved_text,
        _normalize_text=normalize_text,
        _split_words_with_dashes=split_words_with_dashes,
        _vertical_overlap_threshold=VERTICAL_OVERLAP_THRESHOLD
    )


def parse_toc_sections(doc: Optional[pymupdf.Document], book_id: int) -> List[Dict[str, Any]]:
    return _pdf.parse_toc_sections(doc, book_id, _normalize_text=normalize_text)


def get_export_sections(pdf_path: Optional[str], book_id: int) -> Tuple[List[Dict[str, Any]], Optional[int]]:
    if not pdf_path:
        return [], None

    doc = pymupdf.open(pdf_path)
    try:
        return parse_toc_sections(doc, book_id), doc.page_count
    finally:
        doc.close()


def clean_none(value: Any) -> Any:
    return _model.clean_none(value)


def finalize_run(run_data: Dict[str, Any]) -> Dict[str, Any]:
    return _model.finalize_run(run_data)


def build_model(
    annotations: List[Dict[str, Any]],
    book_info: Dict[str, Any],
    pdf_path: Optional[str],
    highlight_colors: List[Dict[str, Any]],
    color_filter: Optional[str] = None,
    exported_at: Optional[str] = None
) -> Dict[str, Any]:
    return _model.build_model(
        annotations,
        book_info,
        pdf_path,
        highlight_colors,
        color_filter=color_filter,
        exported_at=exported_at,
        _normalize_text=normalize_text,
        _note_of=note_of,
        _seg=seg,
        _build_palette=build_palette,
        _parse_toc_sections=parse_toc_sections,
        _extract_reconstructed_text=extract_reconstructed_text,
        _finalize_run=finalize_run,
        _pymupdf=pymupdf,
        _max_run_page_gap=MAX_RUN_PAGE_GAP,
        _toc_y_tolerance=TOC_Y_TOLERANCE
    )


def render_json(model: Dict[str, Any]) -> str:
    return _renderers.render_json(model)


def render_yaml(model: Dict[str, Any]) -> str:
    return _renderers.render_yaml(model)


def render_toml(model: Dict[str, Any]) -> str:
    return _renderers.render_toml(model, _clean_none=clean_none)


def render_jsonl(model: Dict[str, Any]) -> str:
    return _renderers.render_jsonl(model)


def render_md(model: Dict[str, Any], group_by: str = "hierarchy") -> str:
    return _renderers.render_md(
        model,
        group_by=group_by,
        _render_md_hierarchy=render_md_hierarchy,
        _render_md_by_color=render_md_by_color,
        _render_md_by_page=render_md_by_page
    )


def render_md_hierarchy(model: Dict[str, Any]) -> str:
    return _renderers.render_md_hierarchy(model)


def render_md_by_color(model: Dict[str, Any]) -> str:
    return _renderers.render_md_by_color(model)


def render_md_by_page(model: Dict[str, Any]) -> str:
    return _renderers.render_md_by_page(model)


def _select_all_annotations(
    annotations: List[Dict[str, Any]],
    *,
    has_page_bounds: bool,
    **kwargs: Any
) -> List[Dict[str, Any]]:
    if has_page_bounds:
        raise ValueError("Page and section filters require a matching export scope.")
    return annotations


def _select_page_annotations(
    annotations: List[Dict[str, Any]],
    *,
    page: Optional[int] = None,
    start_page: Optional[int] = None,
    end_page: Optional[int] = None,
    section_index: Optional[int] = None,
    total_pages: Optional[int] = None,
    **kwargs: Any
) -> List[Dict[str, Any]]:
    if page is None or start_page is not None or end_page is not None or section_index is not None:
        raise ValueError("A single page is required for page exports.")
    if total_pages is not None and page > total_pages:
        raise ValueError("Page is outside this book.")
    return [annotation for annotation in annotations if annotation["page"] == page]


def _select_range_annotations(
    annotations: List[Dict[str, Any]],
    *,
    page: Optional[int] = None,
    start_page: Optional[int] = None,
    end_page: Optional[int] = None,
    section_index: Optional[int] = None,
    total_pages: Optional[int] = None,
    **kwargs: Any
) -> List[Dict[str, Any]]:
    if start_page is None or end_page is None or page is not None or section_index is not None:
        raise ValueError("Both start_page and end_page are required for range exports.")
    if start_page > end_page:
        raise ValueError("start_page must be less than or equal to end_page.")
    if total_pages is not None and end_page > total_pages:
        raise ValueError("Page range is outside this book.")
    return [
        annotation for annotation in annotations
        if start_page <= annotation["page"] <= end_page
    ]


def _select_section_annotations(
    annotations: List[Dict[str, Any]],
    *,
    page: Optional[int] = None,
    start_page: Optional[int] = None,
    end_page: Optional[int] = None,
    section_index: Optional[int] = None,
    sections: Optional[List[Dict[str, Any]]] = None,
    **kwargs: Any
) -> List[Dict[str, Any]]:
    if section_index is None or any(value is not None for value in (page, start_page, end_page)):
        raise ValueError("A table-of-contents section is required for section exports.")
    if not sections:
        raise ValueError("This book has no table of contents for chapter exports.")
    if section_index >= len(sections):
        raise ValueError("The selected table-of-contents section does not exist.")
    section = sections[section_index]
    page_start = section["page_start"]
    page_end = section["page_end"]
    return [
        annotation for annotation in annotations
        if page_start <= annotation["page"] <= page_end
    ]


SCOPE_SELECTORS: Dict[str, Callable[..., List[Dict[str, Any]]]] = {
    "all": _select_all_annotations,
    "page": _select_page_annotations,
    "range": _select_range_annotations,
    "section": _select_section_annotations,
}


def select_export_annotations(
    annotations: List[Dict[str, Any]],
    scope: str,
    *,
    page: Optional[int] = None,
    start_page: Optional[int] = None,
    end_page: Optional[int] = None,
    section_index: Optional[int] = None,
    sections: Optional[List[Dict[str, Any]]] = None,
    total_pages: Optional[int] = None
) -> List[Dict[str, Any]]:
    """Filters annotations by scope (all, page, range, section). Raises ValueError on invalid inputs."""
    selector = SCOPE_SELECTORS.get(scope)
    if not selector:
        raise ValueError("Unsupported annotation export scope.")

    has_page_bounds = any(value is not None for value in (page, start_page, end_page, section_index))
    return selector(
        annotations=annotations,
        has_page_bounds=has_page_bounds,
        page=page,
        start_page=start_page,
        end_page=end_page,
        section_index=section_index,
        sections=sections,
        total_pages=total_pages
    )


EXPORT_FORMAT_DISPATCH: Dict[str, Tuple[Callable[[Dict[str, Any], str], str], str, str]] = {
    "json": (lambda m, g: render_json(m), "application/json", "json"),
    "jsonl": (lambda m, g: render_jsonl(m), "application/x-ndjson", "jsonl"),
    "yaml": (lambda m, g: render_yaml(m), "application/yaml", "yaml"),
    "toml": (lambda m, g: render_toml(m), "application/toml", "toml"),
}


def render_export_payload(
    model: Dict[str, Any],
    format: str,
    group_by: str = "hierarchy"
) -> Tuple[str, str, str]:
    """Returns (content, media_type, file_extension) for an export model."""
    dispatch = EXPORT_FORMAT_DISPATCH.get(format)
    if dispatch:
        render_fn, media_type, ext = dispatch
        return render_fn(model, group_by), media_type, ext
    return render_md(model, group_by), "text/markdown", "md"
