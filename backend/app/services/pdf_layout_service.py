import os
from pathlib import Path
from typing import Optional, Dict, Any, List

class PdfLayoutService:
    """
    Extracts pixel-perfect word and line bounding boxes from PDF documents
    using PyMuPDF (fitz) with typographical line merging and tracking de-spacing.
    """

    @staticmethod
    def _group_words_geometrically(words: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        if not words:
            return []
        sorted_words = sorted(words, key=lambda w: (round(w["y0"] / 4.0) * 4.0, w["x0"]))
        line_groups = []
        for w in sorted_words:
            w_y0 = w["y0"]
            w_y1 = w["y1"]
            w_mid_y = (w_y0 + w_y1) / 2.0
            w_h = max(1.0, w_y1 - w_y0)
            matched_group = None
            for group in line_groups:
                g_y0 = min(item["y0"] for item in group)
                g_y1 = max(item["y1"] for item in group)
                g_mid_y = sum((item["y0"] + item["y1"]) / 2.0 for item in group) / len(group)
                g_h = max(1.0, g_y1 - g_y0)
                overlap = min(w_y1, g_y1) - max(w_y0, g_y0)
                min_h = min(w_h, g_h)
                overlap_ratio = overlap / min_h if min_h > 0 else 0
                mid_dist = abs(w_mid_y - g_mid_y)
                if overlap_ratio >= 0.35 or mid_dist <= max(w_h, g_h) * 0.45 or (overlap > 0 and mid_dist <= min_h * 0.75):
                    matched_group = group
                    break
            if matched_group is not None:
                matched_group.append(w)
            else:
                line_groups.append([w])

        lines = []
        for group in line_groups:
            group.sort(key=lambda x: x["x0"])
            lines.append({
                "block": group[0]["block"],
                "line": group[0]["line"],
                "x0": round(min(x["x0"] for x in group), 2),
                "y0": round(min(x["y0"] for x in group), 2),
                "x1": round(max(x["x1"] for x in group), 2),
                "y1": round(max(x["y1"] for x in group), 2),
                "text": " ".join(x["text"] for x in group),
                "words": group
            })
        lines.sort(key=lambda l: (l["y0"], l["x0"]))
        return lines

    @staticmethod
    def extract_page_layout(pdf_path: Path, page_number: int) -> Optional[Dict[str, Any]]:
        """
        Extracts pixel-perfect word bounding boxes and typographical lines for a single page.
        Coordinates are in PDF point units (unscaled).
        page_number is 1-indexed.
        """
        try:
            import pymupdf as fitz
        except ImportError:
            return None

        if not pdf_path or not pdf_path.exists():
            return None

        try:
            doc = fitz.open(pdf_path)
            try:
                page_idx = page_number - 1
                if page_idx < 0 or page_idx >= len(doc):
                    return None
                page = doc[page_idx]
                rect = page.rect
                raw_words = page.get_text("words")

                words = [
                    {
                        "text": w[4],
                        "x0": round(w[0], 2),
                        "y0": round(w[1], 2),
                        "x1": round(w[2], 2),
                        "y1": round(w[3], 2),
                        "block": w[5],
                        "line": w[6],
                        "word": w[7]
                    }
                    for w in raw_words
                ]

                lines = PdfLayoutService._group_words_geometrically(words)

                return {
                    "page": page_number,
                    "width": round(rect.width, 2),
                    "height": round(rect.height, 2),
                    "words": words,
                    "lines": lines
                }
            finally:
                doc.close()
        except Exception as e:
            print(f"Error extracting page layout for {pdf_path}, page {page_number}: {e}")
            return None

    @staticmethod
    def extract_page_layouts_batch(pdf_path: Path, start_page: int, end_page: int) -> Optional[Dict[str, Any]]:
        """
        Extracts pixel-perfect word & line layouts for a range of pages in a single fast pass.
        start_page and end_page are 1-indexed (inclusive).
        """
        try:
            import pymupdf as fitz
        except ImportError:
            return None

        if not pdf_path or not pdf_path.exists():
            return None

        try:
            doc = fitz.open(pdf_path)
            try:
                total = len(doc)
                s_page = max(1, start_page)
                e_page = min(total, max(s_page, end_page))
                layouts = {}

                for page_num in range(s_page, e_page + 1):
                    page = doc[page_num - 1]
                    rect = page.rect
                    raw_words = page.get_text("words")

                    words = [
                        {
                            "text": w[4],
                            "x0": round(w[0], 2), "y0": round(w[1], 2),
                            "x1": round(w[2], 2), "y1": round(w[3], 2),
                            "block": w[5], "line": w[6], "word": w[7]
                        }
                        for w in raw_words
                    ]

                    lines = PdfLayoutService._group_words_geometrically(words)

                    layouts[str(page_num)] = {
                        "page": page_num,
                        "width": round(rect.width, 2),
                        "height": round(rect.height, 2),
                        "words": words,
                        "lines": lines
                    }

                return {
                    "start_page": s_page,
                    "end_page": e_page,
                    "total_pages": total,
                    "layouts": layouts
                }
            finally:
                doc.close()
        except Exception as e:
            print(f"Error extracting batch layouts for {pdf_path}: {e}")
            return None

pdf_layout_service = PdfLayoutService()
