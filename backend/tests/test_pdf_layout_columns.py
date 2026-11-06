import tempfile
import unittest
from pathlib import Path

import pymupdf

from app.services.pdf_layout_service import PdfLayoutService


class TestPdfLayoutColumns(unittest.TestCase):
    def test_native_block_lines_preserve_column_order_and_separate_vertical_text(self):
        words = [
            {"text": "LEFT", "x0": 50, "y0": 100, "x1": 80, "y1": 115, "block": 0, "line": 0, "word": 0},
            {"text": "RIGHT", "x0": 320, "y0": 100, "x1": 365, "y1": 115, "block": 0, "line": 0, "word": 1},
            {"text": "COLUMN", "x0": 50, "y0": 120, "x1": 100, "y1": 135, "block": 0, "line": 1, "word": 0},
            {"text": "TEXT", "x0": 320, "y0": 120, "x1": 355, "y1": 135, "block": 0, "line": 1, "word": 1},
            {
                "text": "MARGIN",
                "x0": 550,
                "y0": 300,
                "x1": 562,
                "y1": 345,
                "block": 1,
                "line": 0,
                "word": 0,
                "direction": (0.0, -1.0),
            },
            {
                "text": "TITLE",
                "x0": 550,
                "y0": 250,
                "x1": 562,
                "y1": 295,
                "block": 1,
                "line": 0,
                "word": 1,
                "direction": (0.0, -1.0),
            },
        ]

        lines = PdfLayoutService._group_words_geometrically(words)

        self.assertEqual([line["text"] for line in lines[:4]], ["LEFT", "COLUMN", "RIGHT", "TEXT"])
        self.assertEqual(len(lines), 6)
        self.assertTrue(all(line["is_vertical"] for line in lines[4:]))
        self.assertTrue(all(line["y1"] - line["y0"] <= 50 for line in lines))

    def test_vertical_margin_and_early_footer_blocks_move_after_body_columns(self):
        words = [
            {
                "text": "REVISTA",
                "x0": 550,
                "y0": 400,
                "x1": 561,
                "y1": 455,
                "block": 0,
                "line": 0,
                "word": 0,
                "direction": (0.0, -1.0),
            },
            {"text": "FOOTER", "x0": 120, "y0": 760, "x1": 240, "y1": 774, "block": 1, "line": 0, "word": 0},
            {"text": "COL1_A", "x0": 70, "y0": 60, "x1": 140, "y1": 76, "block": 2, "line": 0, "word": 0},
            {"text": "COL1_B", "x0": 70, "y0": 82, "x1": 140, "y1": 98, "block": 2, "line": 1, "word": 0},
            {"text": "COL2_A", "x0": 300, "y0": 60, "x1": 370, "y1": 76, "block": 3, "line": 0, "word": 0},
            {"text": "COL2_B", "x0": 300, "y0": 82, "x1": 370, "y1": 98, "block": 3, "line": 1, "word": 0},
        ]

        lines = PdfLayoutService._group_words_geometrically(words)

        self.assertEqual(
            [line["text"] for line in lines],
            ["COL1_A", "COL1_B", "COL2_A", "COL2_B", "FOOTER", "REVISTA"],
        )
        self.assertTrue(lines[-1].get("is_vertical"))

    def test_merges_fragmented_same_row_justified_lines_within_column(self):
        words = [
            {"text": "including", "x0": 300, "y0": 623.5, "x1": 350, "y1": 641.5, "block": 4, "line": 2, "word": 0},
            {"text": "within", "x0": 365, "y0": 623.5, "x1": 399, "y1": 641.5, "block": 4, "line": 3, "word": 0},
            {"text": "the", "x0": 414, "y0": 623.5, "x1": 433, "y1": 641.5, "block": 4, "line": 4, "word": 0},
            {
                "text": "Philosophical",
                "x0": 448,
                "y0": 623.5,
                "x1": 518,
                "y1": 641.5,
                "block": 4,
                "line": 5,
                "word": 0,
            },
            {"text": "Transactions.", "x0": 300, "y0": 636.0, "x1": 380, "y1": 654.0, "block": 4, "line": 6, "word": 0},
        ]

        lines = PdfLayoutService._group_words_geometrically(words)

        self.assertEqual(len(lines), 2)
        self.assertEqual(lines[0]["text"], "including within the Philosophical")
        self.assertEqual(lines[1]["text"], "Transactions.")

    def test_geometric_fallback_detects_columns_and_caps_line_height(self):
        words = [
            {"text": "LEFT1", "x0": 50, "y0": 100, "x1": 95, "y1": 115},
            {"text": "RIGHT1", "x0": 320, "y0": 100, "x1": 370, "y1": 115},
            {"text": "LEFT2", "x0": 50, "y0": 120, "x1": 95, "y1": 135},
            {"text": "RIGHT2", "x0": 320, "y0": 120, "x1": 370, "y1": 135},
        ]

        lines = PdfLayoutService._group_words_geometrically(words)

        self.assertEqual([line["text"] for line in lines], ["LEFT1", "LEFT2", "RIGHT1", "RIGHT2"])
        self.assertTrue(all(line["y1"] - line["y0"] <= 40 for line in lines))

    def test_extractors_use_native_layout_for_real_two_column_pdf(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            pdf_path = Path(temp_dir) / "two_columns.pdf"
            document = pymupdf.open()
            page = document.new_page(width=600, height=800)
            page.insert_text((50, 80), "LEFT FIRST LINE", fontsize=11)
            page.insert_text((50, 110), "LEFT SECOND LINE", fontsize=11)
            page.insert_text((320, 80), "RIGHT FIRST LINE", fontsize=11)
            page.insert_text((320, 110), "RIGHT SECOND LINE", fontsize=11)
            page.insert_text((560, 700), "VERTICAL MARGIN TITLE", fontsize=9, rotate=90)
            document.save(pdf_path)
            document.close()

            layout = PdfLayoutService.extract_page_layout(pdf_path, 1)
            batch = PdfLayoutService.extract_page_layouts_batch(pdf_path, 1, 1)

        self.assertIsNotNone(layout)
        self.assertIsNotNone(batch)
        lines = layout["lines"]
        texts = [line["text"] for line in lines]
        self.assertEqual(texts[:4], ["LEFT FIRST LINE", "LEFT SECOND LINE", "RIGHT FIRST LINE", "RIGHT SECOND LINE"])
        self.assertTrue(any(line.get("is_vertical") for line in lines))
        self.assertTrue(all(line["y1"] - line["y0"] <= 50 for line in lines))
        self.assertEqual(batch["layouts"]["1"]["lines"], lines)


if __name__ == "__main__":
    unittest.main()
