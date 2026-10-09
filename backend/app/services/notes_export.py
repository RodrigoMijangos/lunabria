"""Compatibility facade for building and rendering notes exports."""

import hashlib
import json
import re
import unicodedata
from typing import Any, Dict, List, Optional, Tuple

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
