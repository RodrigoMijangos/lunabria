import os
from pathlib import Path
from typing import Optional, Dict, Any, List

class PdfLayoutService:
    """
    Extracts pixel-perfect word and line bounding boxes from PDF documents
    using PyMuPDF (fitz) with typographical line merging and tracking de-spacing.
    """

    @staticmethod
    def extract_page_layout(pdf_path: Path, page_number: int) -> Optional[Dict[str, Any]]:
        """
        Extracts pixel-perfect word bounding boxes for a given page using PyMuPDF (fitz).
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
                
                # Merge words on the same line if gap is smaller than a typographical space (< 2.8 pt)
                # This fixes tracked titles like "IN T ROD UCTION" -> "INTRODUCTION"
                merged_raw = []
                for w in raw_words:
                    if merged_raw and merged_raw[-1][5] == w[5] and merged_raw[-1][6] == w[6]:
                        prev = merged_raw[-1]
                        gap = w[0] - prev[2]
                        font_h = max(prev[3] - prev[1], w[3] - w[1])
                        # A typographical word space in fonts is >= 0.22 of font height.
                        # Tracking / wide kerning between letters in a single word is typically <= 0.18 * font height.
                        if font_h > 0 and (gap / font_h) < 0.18:
                            merged_raw[-1] = (
                                prev[0],
                                min(prev[1], w[1]),
                                w[2],
                                max(prev[3], w[3]),
                                prev[4] + w[4],
                                prev[5],
                                prev[6],
                                prev[7]
                            )
                            continue
                    merged_raw.append(w)

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
                    for w in merged_raw
                ]

                # Group words into continuous typographical lines for gapless selection & highlighting
                lines = []
                cur_line = []
                for w in words:
                    if cur_line and (cur_line[0]["block"] != w["block"] or cur_line[0]["line"] != w["line"]):
                        lines.append({
                            "block": cur_line[0]["block"],
                            "line": cur_line[0]["line"],
                            "x0": round(min(x["x0"] for x in cur_line), 2),
                            "y0": round(min(x["y0"] for x in cur_line), 2),
                            "x1": round(max(x["x1"] for x in cur_line), 2),
                            "y1": round(max(x["y1"] for x in cur_line), 2),
                            "text": " ".join(x["text"] for x in cur_line)
                        })
                        cur_line = []
                    cur_line.append(w)
                if cur_line:
                    lines.append({
                        "block": cur_line[0]["block"],
                        "line": cur_line[0]["line"],
                        "x0": round(min(x["x0"] for x in cur_line), 2),
                        "y0": round(min(x["y0"] for x in cur_line), 2),
                        "x1": round(max(x["x1"] for x in cur_line), 2),
                        "y1": round(max(x["y1"] for x in cur_line), 2),
                        "text": " ".join(x["text"] for x in cur_line)
                    })

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

                    merged_raw = []
                    for w in raw_words:
                        if merged_raw and merged_raw[-1][5] == w[5] and merged_raw[-1][6] == w[6]:
                            prev = merged_raw[-1]
                            gap = w[0] - prev[2]
                            font_h = max(prev[3] - prev[1], w[3] - w[1])
                            if font_h > 0 and (gap / font_h) < 0.18:
                                merged_raw[-1] = (
                                    prev[0], min(prev[1], w[1]), w[2], max(prev[3], w[3]),
                                    prev[4] + w[4], prev[5], prev[6], prev[7]
                                )
                                continue
                        merged_raw.append(w)

                    words = [
                        {
                            "text": w[4],
                            "x0": round(w[0], 2), "y0": round(w[1], 2),
                            "x1": round(w[2], 2), "y1": round(w[3], 2),
                            "block": w[5], "line": w[6], "word": w[7]
                        }
                        for w in merged_raw
                    ]

                    lines = []
                    cur_line = []
                    for w in words:
                        if cur_line and (cur_line[0]["block"] != w["block"] or cur_line[0]["line"] != w["line"]):
                            lines.append({
                                "block": cur_line[0]["block"],
                                "line": cur_line[0]["line"],
                                "x0": round(min(x["x0"] for x in cur_line), 2),
                                "y0": round(min(x["y0"] for x in cur_line), 2),
                                "x1": round(max(x["x1"] for x in cur_line), 2),
                                "y1": round(max(x["y1"] for x in cur_line), 2),
                                "text": " ".join(x["text"] for x in cur_line)
                            })
                            cur_line = []
                        cur_line.append(w)
                    if cur_line:
                        lines.append({
                            "block": cur_line[0]["block"],
                            "line": cur_line[0]["line"],
                            "x0": round(min(x["x0"] for x in cur_line), 2),
                            "y0": round(min(x["y0"] for x in cur_line), 2),
                            "x1": round(max(x["x1"] for x in cur_line), 2),
                            "y1": round(max(x["y1"] for x in cur_line), 2),
                            "text": " ".join(x["text"] for x in cur_line)
                        })

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
