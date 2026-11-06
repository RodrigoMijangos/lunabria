from pathlib import Path
from typing import Optional, Dict, Any, List, Tuple

class PdfLayoutService:
    """
    Extracts pixel-perfect word and line bounding boxes from PDF documents
    using PyMuPDF (fitz) with typographical line merging and tracking de-spacing.
    """

    MAX_LINE_HEIGHT_PT = 40.0
    MAX_COLUMN_GAP_PT = 45.0
    MAX_VERTICAL_LINE_WIDTH_PT = 25.0

    @staticmethod
    def _line_direction(page: Any) -> Dict[Tuple[int, int], Tuple[float, float]]:
        directions: Dict[Tuple[int, int], Tuple[float, float]] = {}
        try:
            import pymupdf as fitz
            text_dict = page.get_text("dict", flags=getattr(fitz, "TEXTFLAGS_WORDS", 0))
        except Exception:
            text_dict = page.get_text("dict")

        text_blocks = [
            block for block in text_dict.get("blocks", []) if block.get("type", 0) == 0
        ]
        for text_index, block in enumerate(text_blocks):
            block_number = block.get("number", text_index)
            for line_number, line in enumerate(block.get("lines", [])):
                direction = line.get("dir")
                if direction and len(direction) == 2:
                    dir_tuple = (float(direction[0]), float(direction[1]))
                    directions[(text_index, line_number)] = dir_tuple
                    if isinstance(block_number, int):
                        directions[(block_number, line_number)] = dir_tuple
        return directions

    @staticmethod
    def _extract_words(page: Any) -> List[Dict[str, Any]]:
        directions = PdfLayoutService._line_direction(page)
        words = []
        for word in page.get_text("words"):
            item = {
                "text": word[4],
                "x0": round(word[0], 2),
                "y0": round(word[1], 2),
                "x1": round(word[2], 2),
                "y1": round(word[3], 2),
                "block": word[5],
                "line": word[6],
                "word": word[7],
            }
            direction = directions.get((word[5], word[6]))
            if direction:
                item["direction"] = direction
            words.append(item)
        return words

    @staticmethod
    def _is_vertical(words: List[Dict[str, Any]]) -> bool:
        for word in words:
            direction = word.get("direction")
            if direction and abs(direction[1]) > 0.1:
                return True

        width = max(word["x1"] for word in words) - min(word["x0"] for word in words)
        height = max(word["y1"] for word in words) - min(word["y0"] for word in words)
        return width <= PdfLayoutService.MAX_VERTICAL_LINE_WIDTH_PT and height > PdfLayoutService.MAX_LINE_HEIGHT_PT

    @staticmethod
    def _make_line(words: List[Dict[str, Any]], is_vertical: bool = False) -> Dict[str, Any]:
        ordered_words = words if is_vertical else sorted(words, key=lambda word: word["x0"])
        line = {
            "block": ordered_words[0].get("block"),
            "line": ordered_words[0].get("line"),
            "x0": round(min(word["x0"] for word in ordered_words), 2),
            "y0": round(min(word["y0"] for word in ordered_words), 2),
            "x1": round(max(word["x1"] for word in ordered_words), 2),
            "y1": round(max(word["y1"] for word in ordered_words), 2),
            "text": " ".join(word["text"] for word in ordered_words),
            "words": ordered_words,
        }
        if is_vertical:
            line["is_vertical"] = True
            line["direction"] = ordered_words[0].get("direction") or (0.0, -1.0)
        elif ordered_words[0].get("direction"):
            line["direction"] = ordered_words[0]["direction"]
        return line

    @staticmethod
    def _split_by_column_gaps(words: List[Dict[str, Any]]) -> List[List[Dict[str, Any]]]:
        ordered_words = sorted(words, key=lambda word: word["x0"])
        groups = []
        current_group: List[Dict[str, Any]] = []
        current_x1 = None

        for word in ordered_words:
            if (
                current_group
                and current_x1 is not None
                and word["x0"] - current_x1 > PdfLayoutService.MAX_COLUMN_GAP_PT
            ):
                groups.append(current_group)
                current_group = []
            current_group.append(word)
            current_x1 = max(word["x1"], current_x1) if current_x1 is not None else word["x1"]

        if current_group:
            groups.append(current_group)
        return groups

    @staticmethod
    def _merge_same_row_lines(lines: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        merged: List[Dict[str, Any]] = []
        for line in lines:
            if not merged or line.get("is_vertical") or merged[-1].get("is_vertical"):
                merged.append(line)
                continue
            prev = merged[-1]
            overlap = min(prev["y1"], line["y1"]) - max(prev["y0"], line["y0"])
            min_height = min(max(1.0, prev["y1"] - prev["y0"]), max(1.0, line["y1"] - line["y0"]))
            mid_diff = abs(((prev["y0"] + prev["y1"]) / 2.0) - ((line["y0"] + line["y1"]) / 2.0))
            combined_height = max(prev["y1"], line["y1"]) - min(prev["y0"], line["y0"])
            gap = line["x0"] - prev["x1"]
            if (
                combined_height <= PdfLayoutService.MAX_LINE_HEIGHT_PT
                and (overlap / min_height >= 0.5 or mid_diff <= min_height * 0.35)
                and -4.0 <= gap <= PdfLayoutService.MAX_COLUMN_GAP_PT
            ):
                merged[-1] = PdfLayoutService._make_line(prev["words"] + line["words"])
            else:
                merged.append(line)
        return merged

    @staticmethod
    def _order_column_lines(lines: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        horizontal_lines = PdfLayoutService._merge_same_row_lines(
            [line for line in lines if not line.get("is_vertical")]
        )
        vertical_lines = [line for line in lines if line.get("is_vertical")]
        columns: List[Dict[str, Any]] = []
        for line in sorted(horizontal_lines, key=lambda item: item["x0"]):
            if not columns or line["x0"] - columns[-1]["x1"] > PdfLayoutService.MAX_COLUMN_GAP_PT:
                columns.append({"x1": line["x1"], "lines": [line]})
            else:
                columns[-1]["x1"] = max(columns[-1]["x1"], line["x1"])
                columns[-1]["lines"].append(line)
        if len(columns) < 2 or any(len(column["lines"]) < 2 for column in columns):
            return horizontal_lines + vertical_lines

        shared_vertical_range = min(max(line["y1"] for line in column["lines"]) for column in columns) - max(
            min(line["y0"] for line in column["lines"]) for column in columns
        )
        if shared_vertical_range <= 0:
            return horizontal_lines + vertical_lines

        ordered_horizontal = [
            line
            for column in columns
            for line in sorted(column["lines"], key=lambda item: (item["y0"], item["x0"]))
        ]
        return ordered_horizontal + vertical_lines

    @staticmethod
    def _order_horizontal_blocks(
        blocks: List[Tuple[int, List[Dict[str, Any]]]]
    ) -> List[List[Dict[str, Any]]]:
        ordered: List[List[Dict[str, Any]]] = []
        deferred: List[List[Dict[str, Any]]] = []
        for idx, (_, block_lines) in enumerate(blocks):
            if not block_lines:
                continue
            block_y0 = min(line["y0"] for line in block_lines)
            later_max_y1 = max(
                (max(line["y1"] for line in other_lines) for _, other_lines in blocks[idx + 1 :] if other_lines),
                default=-1.0,
            )
            if later_max_y1 >= 0.0 and block_y0 >= later_max_y1 - 2.0:
                deferred.append(block_lines)
            else:
                ordered.append(block_lines)
        ordered.extend(deferred)
        return ordered

    @staticmethod
    def _group_words_by_geometry(words: List[Dict[str, Any]]) -> List[List[Dict[str, Any]]]:
        horizontal_words = [word for word in words if not PdfLayoutService._is_vertical([word])]
        vertical_words = [word for word in words if PdfLayoutService._is_vertical([word])]
        sorted_words = sorted(
            horizontal_words,
            key=lambda word: (round(word["y0"] / 4.0) * 4.0, word["x0"]),
        )
        line_groups: List[List[Dict[str, Any]]] = []

        for word in sorted_words:
            word_mid_y = (word["y0"] + word["y1"]) / 2.0
            word_height = max(1.0, word["y1"] - word["y0"])
            matched_group = None

            for group in line_groups:
                group_y0 = min(item["y0"] for item in group)
                group_y1 = max(item["y1"] for item in group)
                group_x0 = min(item["x0"] for item in group)
                group_x1 = max(item["x1"] for item in group)
                group_mid_y = sum((item["y0"] + item["y1"]) / 2.0 for item in group) / len(group)
                group_height = max(1.0, group_y1 - group_y0)
                combined_height = max(group_y1, word["y1"]) - min(group_y0, word["y0"])
                horizontal_gap = max(0, word["x0"] - group_x1, group_x0 - word["x1"])
                if horizontal_gap > PdfLayoutService.MAX_COLUMN_GAP_PT:
                    continue
                if combined_height > PdfLayoutService.MAX_LINE_HEIGHT_PT:
                    continue

                overlap = min(word["y1"], group_y1) - max(word["y0"], group_y0)
                min_height = min(word_height, group_height)
                overlap_ratio = overlap / min_height if min_height > 0 else 0
                mid_distance = abs(word_mid_y - group_mid_y)
                if (
                    overlap_ratio >= 0.35
                    or mid_distance <= max(word_height, group_height) * 0.45
                    or (overlap > 0 and mid_distance <= min_height * 0.75)
                ):
                    matched_group = group
                    break

            if matched_group is not None:
                matched_group.append(word)
            else:
                line_groups.append([word])

        return line_groups + [[word] for word in vertical_words]

    @staticmethod
    def _group_words_geometrically(words: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        if not words:
            return []
        has_native_lines = all(
            isinstance(word.get("block"), int) and isinstance(word.get("line"), int)
            for word in words
        )
        line_groups: Dict[Tuple[int, int], List[Dict[str, Any]]] = {}

        if has_native_lines:
            for word in words:
                line_groups.setdefault((word["block"], word["line"]), []).append(word)
            ordered_groups = [line_groups[key] for key in sorted(line_groups)]
        else:
            ordered_groups = PdfLayoutService._group_words_by_geometry(words)

        if not has_native_lines:
            lines = [PdfLayoutService._make_line(group, PdfLayoutService._is_vertical(group)) for group in ordered_groups]
            horizontal = sorted(
                [line for line in lines if not line.get("is_vertical")],
                key=lambda line: (line["y0"], line["x0"]),
            )
            vertical = [line for line in lines if line.get("is_vertical")]
            return PdfLayoutService._order_column_lines(horizontal) + vertical

        lines_by_block: Dict[int, List[Dict[str, Any]]] = {}
        vertical_lines: List[Dict[str, Any]] = []
        for group in ordered_groups:
            block_number = group[0]["block"]
            is_vertical = PdfLayoutService._is_vertical(group)
            if is_vertical:
                vertical_lines.extend(PdfLayoutService._make_line([word], is_vertical=True) for word in group)
                continue

            lines = lines_by_block.setdefault(block_number, [])
            group_height = max(word["y1"] for word in group) - min(word["y0"] for word in group)
            if group_height > PdfLayoutService.MAX_LINE_HEIGHT_PT:
                fallback_groups = PdfLayoutService._group_words_by_geometry(group)
                for fallback in fallback_groups:
                    if PdfLayoutService._is_vertical(fallback):
                        vertical_lines.append(PdfLayoutService._make_line(fallback, is_vertical=True))
                    else:
                        lines.append(PdfLayoutService._make_line(fallback, False))
                continue

            lines.extend(
                PdfLayoutService._make_line(segment)
                for segment in PdfLayoutService._split_by_column_gaps(group)
            )

        sorted_blocks = [
            (block_number, PdfLayoutService._order_column_lines(lines_by_block[block_number]))
            for block_number in sorted(lines_by_block)
        ]
        ordered_horizontal = [
            line
            for block_lines in PdfLayoutService._order_horizontal_blocks(sorted_blocks)
            for line in block_lines
        ]
        return ordered_horizontal + vertical_lines

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
                words = PdfLayoutService._extract_words(page)

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
                    words = PdfLayoutService._extract_words(page)

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
