import json
import os
import random
import sys
import tempfile
import unittest

import pymupdf
import yaml
try:
    import tomllib
except ModuleNotFoundError:
    import tomli as tomllib

from app.services import notes_export


class TestNotesExportDeterministic(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._tmp_dir = tempfile.TemporaryDirectory()
        cls.pdf_path = os.path.join(cls._tmp_dir.name, "test_book.pdf")
        doc = pymupdf.open()

        fontfile = r"C:\Windows\Fonts\arial.ttf"

        # Page 1 (0 in fitz): Chapter 1
        p1 = doc.new_page(width=600, height=800)
        if os.path.exists(fontfile):
            p1.insert_font(fontname="arial", fontfile=fontfile)
            p1.insert_text((72, 100), "Chapter 1 Introduction", fontname="arial", fontsize=16)
            p1.insert_text((72, 200), "This is knowledge sharing in microservices.", fontname="arial", fontsize=11)
            p1.insert_text((72, 300), "Here we have faster\u2014not to mention with better quality.", fontname="arial", fontsize=11)
        else:
            p1.insert_text((72, 100), "Chapter 1 Introduction", fontsize=16)
            p1.insert_text((72, 200), "This is knowledge sharing in microservices.", fontsize=11)
            p1.insert_text((72, 300), "Here we have faster\u2014not to mention with better quality.", fontsize=11)

        # Page 2 (1 in fitz): Chapter 2
        p2 = doc.new_page(width=600, height=800)
        if os.path.exists(fontfile):
            p2.insert_font(fontname="arial", fontfile=fontfile)
            p2.insert_text((72, 100), "Chapter 2 Deep Dive", fontname="arial", fontsize=16)
            p2.insert_text((72, 200), "Line one first word and second word multiline text.", fontname="arial", fontsize=11)
            p2.insert_text((72, 250), "Line two continuation of thoughts.", fontname="arial", fontsize=11)
        else:
            p2.insert_text((72, 100), "Chapter 2 Deep Dive", fontsize=16)
            p2.insert_text((72, 200), "Line one first word and second word multiline text.", fontsize=11)
            p2.insert_text((72, 250), "Line two continuation of thoughts.", fontsize=11)

        # Page 3 (2 in fitz): Section 2.1
        p3 = doc.new_page(width=600, height=800)
        p3.insert_text((72, 100), "2.1 Sub Section", fontsize=14)

        # Page 4 (3 in fitz): Chapter 3
        p4 = doc.new_page(width=600, height=800)
        p4.insert_text((72, 100), "Chapter 3 Summary", fontsize=16)

        # Set TOC: [lvl, title, page_1_indexed]
        toc = [
            [1, "Chapter 1 Introduction", 1],
            [1, "Chapter 2 Deep Dive", 2],
            [2, "2.1 Sub Section", 3],
            [1, "Chapter 3 Summary", 4]
        ]
        doc.set_toc(toc)
        doc.save(cls.pdf_path)
        doc.close()
        cls.sample_pdf_with_toc = cls.pdf_path

    @classmethod
    def tearDownClass(cls):
        cls._tmp_dir.cleanup()

    def get_sample_palette(self):
        return [
            {"id": "yellow", "name": "Key Idea / Concept", "color": "#ffeb3b", "textColor": "#713f12"},
            {"id": "green", "name": "Definition / Explanation", "color": "#f0c08a", "textColor": "#14532d"},
            {"id": "blue", "name": "Question / Analisis", "color": "#93c5fd", "textColor": "#1e3a8a"},
            {"id": "red", "name": "Example / Content / Exemption", "color": "#a6fcc4", "textColor": "#7f1d1d"},
            {"id": "purple", "name": "Quote / Reference / Use Later", "color": "#d8b4fe", "textColor": "#581c87"}
        ]

    def get_fixture_annotations(self):
        return [
            {
                "id": "annot-1",
                "page": 1,
                "color": "yellow",
                "category": "Key Idea",
                "text": "Chapter 1 Introduction",
                "comment": "Main chapter title note",
                "rects": [{"x0": 70.0, "y0": 85.0, "x1": 250.0, "y1": 105.0}]
            },
            {
                "id": "annot-2",
                "page": 1,
                "color": "green",
                "category": "Definition",
                "text": "knowledge",
                "comment": None,
                "rects": [{"x0": 110.0, "y0": 185.0, "x1": 170.0, "y1": 205.0}]
            },
            {
                "id": "annot-3",
                "page": 1,
                "color": "green",
                "category": "Definition",
                "text": "sharing",
                "comment": None,
                "rects": [{"x0": 175.0, "y0": 185.0, "x1": 220.0, "y1": 205.0}]
            },
            {
                "id": "annot-4",
                "page": 1,
                "color": "blue",
                "category": "Reference",
                "text": "faster",
                "comment": None,
                "rects": [{"x0": 140.0, "y0": 285.0, "x1": 175.0, "y1": 305.0}]
            },
            {
                "id": "annot-5",
                "page": 2,
                "color": "purple",
                "category": "",
                "text": "Line one first word",
                "comment": "Note on line one",
                "rects": [{"x0": 70.0, "y0": 185.0, "x1": 180.0, "y1": 205.0}]
            }
        ]

    def test_determinism_shuffled_20_times(self):
        palette = self.get_sample_palette()
        annots = self.get_fixture_annotations()
        book_info = {"id": 42, "title": "Determinism Test Book", "authors": "Ada Lovelace"}

        base_model = notes_export.build_model(
            annots, book_info, self.sample_pdf_with_toc, palette, exported_at="2026-10-04T00:00:00Z"
        )
        base_json = notes_export.render_json(base_model)
        base_jsonl = notes_export.render_jsonl(base_model)
        base_yaml = notes_export.render_yaml(base_model)
        base_toml = notes_export.render_toml(base_model)
        base_md = notes_export.render_md(base_model, group_by="hierarchy")

        for _ in range(20):
            shuffled = list(annots)
            random.shuffle(shuffled)
            m = notes_export.build_model(
                shuffled, book_info, self.sample_pdf_with_toc, palette, exported_at="2026-10-04T00:00:00Z"
            )
            self.assertEqual(notes_export.render_json(m), base_json)
            self.assertEqual(notes_export.render_jsonl(m), base_jsonl)
            self.assertEqual(notes_export.render_yaml(m), base_yaml)
            self.assertEqual(notes_export.render_toml(m), base_toml)
            self.assertEqual(notes_export.render_md(m, group_by="hierarchy"), base_md)

    def test_frontmatter_yaml_safe_load(self):
        palette = self.get_sample_palette()
        book_info = {"id": 751, "title": '"Looks Good to Me": Constructive Code Reviews', "authors": ["Adrienne Braganza"]}
        model = notes_export.build_model([], book_info, None, palette)
        md_out = notes_export.render_md(model, group_by="hierarchy")

        self.assertTrue(md_out.startswith("---"))
        parts = md_out.split("---", 2)
        fm_raw = parts[1].strip()
        parsed = yaml.safe_load(fm_raw)
        self.assertEqual(parsed["title"], '"Looks Good to Me": Constructive Code Reviews')
        self.assertEqual(parsed["authors"], ["Adrienne Braganza"])
        self.assertIn("legend", parsed)
        self.assertIn("stats", parsed)

    def test_category_mapping_and_slot_conflict(self):
        palette = self.get_sample_palette()
        annots = [
            {"id": "1", "page": 1, "color": "blue", "category": "Reference", "text": "A"},
            {"id": "2", "page": 1, "color": "red", "category": "Question / Important", "text": "B"},
            {"id": "3", "page": 1, "color": "yellow", "category": "Key Idea", "text": "C"},
            {"id": "4", "page": 1, "color": "purple", "category": "", "text": "D"},
            {"id": "5", "page": 1, "color": "green", "category": "Custom Old Tag", "text": "E"}
        ]
        book_info = {"id": 1, "title": "Map Test", "authors": "A"}
        model = notes_export.build_model(annots, book_info, None, palette)

        marks = {m["id"]: m for r in model["runs"] for m in r["marks"]}
        self.assertEqual(marks["1"]["type"], "quote")
        self.assertTrue(marks["1"]["slot_conflict"])

        self.assertEqual(marks["2"]["type"], "question")
        self.assertTrue(marks["2"]["slot_conflict"])

        self.assertEqual(marks["3"]["type"], "key_idea")
        self.assertIsNone(marks["3"].get("slot_conflict"))

        self.assertEqual(marks["4"]["type"], "quote")
        self.assertEqual(marks["4"].get("meaning_source"), "color")

        self.assertEqual(marks["5"]["type"], "custom_old_tag")
        self.assertTrue(marks["5"]["legacy"])

    def test_multi_chapter_toc_page_end(self):
        doc = pymupdf.open(self.sample_pdf_with_toc)
        sections = notes_export.parse_toc_sections(doc, book_id=10)
        doc.close()
        sec_by_title = {s["title"]: s for s in sections}

        self.assertEqual(sec_by_title["Chapter 1 Introduction"]["page_start"], 1)
        self.assertEqual(sec_by_title["Chapter 1 Introduction"]["page_end"], 2)

        self.assertEqual(sec_by_title["Chapter 2 Deep Dive"]["page_start"], 2)
        self.assertEqual(sec_by_title["Chapter 2 Deep Dive"]["page_end"], 4)

        self.assertEqual(sec_by_title["2.1 Sub Section"]["page_start"], 3)
        self.assertEqual(sec_by_title["2.1 Sub Section"]["page_end"], 4)

        self.assertEqual(sec_by_title["Chapter 3 Summary"]["page_start"], 4)
        self.assertEqual(sec_by_title["Chapter 3 Summary"]["page_end"], 4)

    def test_ids_consistency_in_all_formats(self):
        palette = self.get_sample_palette()
        annots = self.get_fixture_annotations()
        book_info = {"id": 1, "title": "ID Consistency Book", "authors": ["Author"]}
        model = notes_export.build_model(annots, book_info, None, palette)

        # In JSON, marks must retain original IDs without 'h_' prefix
        json_str = notes_export.render_json(model)
        data = json.loads(json_str)
        all_mark_ids = [m["id"] for r in data["runs"] for m in r["marks"]]
        for m_id in all_mark_ids:
            self.assertFalse(m_id.startswith("h_"))
            self.assertIn(m_id, ["annot-1", "annot-2", "annot-3", "annot-4", "annot-5"])

        # In JSONL
        jsonl_str = notes_export.render_jsonl(model)
        for line in jsonl_str.strip().split("\n"):
            obj = json.loads(line)
            self.assertEqual(obj["kind"], "run")
            for m in obj["marks"]:
                self.assertFalse(m["id"].startswith("h_"))
                self.assertIn("section", m)
                self.assertIn("is_heading", m)

        # In YAML
        yaml_data = yaml.safe_load(notes_export.render_yaml(model))
        for r in yaml_data["runs"]:
            for m in r["marks"]:
                self.assertFalse(m["id"].startswith("h_"))

        # In TOML
        toml_data = tomllib.loads(notes_export.render_toml(model))
        for r in toml_data["runs"]:
            for m in r["marks"]:
                self.assertFalse(m["id"].startswith("h_"))

    def test_obsidian_markdown_anchors(self):
        palette = self.get_sample_palette()
        annots = self.get_fixture_annotations()
        book_info = {"id": 1, "title": "Obsidian MD Test", "authors": ["Author"]}
        model = notes_export.build_model(annots, book_info, None, palette)
        md_str = notes_export.render_md(model, group_by="hierarchy")

        lines = md_str.split("\n")
        for i, line in enumerate(lines):
            if "^" in line:
                self.assertFalse(line.startswith("^"))
                self.assertFalse(line.startswith(">"))
                self.assertIn("^r-", line)
                anchor_part = line[line.index("^"):]
                self.assertNotIn("_", anchor_part, f"Anchor contains underscore: {anchor_part}")

            if line.startswith(">"):
                if i + 1 < len(lines):
                    next_line = lines[i + 1]
                    self.assertFalse(next_line.startswith("^"), "Anchor placed on a line directly after '>'")

            if line.startswith("<!-- marks:"):
                self.assertIn("annot-", line)

    def test_jsonl_no_heading_note_and_contains_section_is_heading(self):
        palette = self.get_sample_palette()
        annots = self.get_fixture_annotations()
        book_info = {"id": 1, "title": "JSONL Test", "authors": ["Author"]}
        model = notes_export.build_model(annots, book_info, None, palette)
        jsonl_str = notes_export.render_jsonl(model)

        lines = [json.loads(l) for l in jsonl_str.strip().split("\n")]
        for chunk in lines:
            self.assertNotEqual(chunk["kind"], "heading_note")
            self.assertEqual(chunk["kind"], "run")
            for m in chunk["marks"]:
                self.assertIn("section", m)
                self.assertIn("is_heading", m)

    def test_reconstruction_handles_middle_dot_em_dash_fallback(self):
        class FakePage:
            def get_text(self, _kind):
                return [(142.0, 285.0, 192.0, 305.0, "faster\u00b7not", 0, 0, 0)]

        class FakeDocument:
            page_count = 1

            def __getitem__(self, _page_num):
                return FakePage()

        rects = [{"x0": 140.0, "y0": 285.0, "x1": 175.0, "y1": 305.0}]
        reconstructed, _, source, _, _ = notes_export.extract_reconstructed_text(
            FakeDocument(), 1, rects, "faster"
        )

        self.assertEqual(reconstructed, "faster")
        self.assertEqual(source, "pdf")

    def test_text_reconstruction_em_dash(self):
        palette = self.get_sample_palette()
        annot = {
            "id": "t-1",
            "page": 1,
            "color": "blue",
            "category": "Reference",
            "text": "faster",
            "rects": [{"x0": 140.0, "y0": 285.0, "x1": 175.0, "y1": 305.0}]
        }
        book_info = {"id": 1, "title": "Dash Test", "authors": "A"}
        model = notes_export.build_model([annot], book_info, self.sample_pdf_with_toc, palette)
        reconstructed_text = model["runs"][0]["text"]
        self.assertIn("faster", reconstructed_text)
        self.assertNotIn("—not", reconstructed_text)
        self.assertNotIn("not", reconstructed_text)

    def test_reading_order_multiline(self):
        palette = self.get_sample_palette()
        annot_a = {
            "id": "annot-a",
            "page": 2,
            "color": "green",
            "category": "Definition",
            "text": "second word multiline",
            "rects": [{"x0": 200.0, "y0": 190.0, "x1": 350.0, "y1": 210.0}]
        }
        annot_b = {
            "id": "annot-b",
            "page": 2,
            "color": "green",
            "category": "Definition",
            "text": "Line one first word",
            "rects": [{"x0": 70.0, "y0": 190.0, "x1": 190.0, "y1": 210.0}]
        }
        book_info = {"id": 1, "title": "Order Test", "authors": "A"}
        model = notes_export.build_model([annot_a, annot_b], book_info, self.sample_pdf_with_toc, palette)
        marks = model["runs"][0]["marks"]
        self.assertEqual(marks[0]["id"], "annot-b")
        self.assertEqual(marks[1]["id"], "annot-a")

    def test_runs_fusion_rules(self):
        palette = self.get_sample_palette()
        annots = [
            {"id": "1", "page": 1, "color": "green", "category": "Definition", "text": "Alpha", "rects": [{"x0": 10, "y0": 10, "x1": 50, "y1": 20}]},
            {"id": "2", "page": 1, "color": "green", "category": "Definition", "text": "Beta", "rects": [{"x0": 60, "y0": 10, "x1": 100, "y1": 20}]},
            {"id": "3", "page": 1, "color": "blue", "category": "Question / Analisis", "text": "Gamma", "rects": [{"x0": 10, "y0": 30, "x1": 50, "y1": 40}]},
            {"id": "4", "page": 3, "color": "blue", "category": "Question / Analisis", "text": "Delta", "rects": [{"x0": 10, "y0": 10, "x1": 50, "y1": 20}]}
        ]
        book_info = {"id": 1, "title": "Run Test", "authors": "A"}
        model = notes_export.build_model(annots, book_info, None, palette)

        runs = model["runs"]
        self.assertEqual(len(runs), 3)
        self.assertEqual([m["id"] for m in runs[0]["marks"]], ["1", "2"])
        self.assertEqual(runs[0]["type"], "definition")
        self.assertIn("Alpha … Beta", runs[0]["text"])

        self.assertEqual([m["id"] for m in runs[1]["marks"]], ["3"])
        self.assertEqual(runs[1]["type"], "question")

        self.assertEqual([m["id"] for m in runs[2]["marks"]], ["4"])
        self.assertEqual(runs[2]["pages"], [3, 3])

    def test_section_by_position(self):
        palette = self.get_sample_palette()
        annot_ch1 = {"id": "c1", "page": 1, "color": "yellow", "category": "Key Idea", "text": "Intro mark", "rects": [{"x0": 70, "y0": 200, "x1": 150, "y1": 220}]}
        annot_ch2 = {"id": "c2", "page": 2, "color": "yellow", "category": "Key Idea", "text": "Dive mark", "rects": [{"x0": 70, "y0": 200, "x1": 150, "y1": 220}]}
        book_info = {"id": 1, "title": "Sec Test", "authors": "A"}
        model = notes_export.build_model([annot_ch1, annot_ch2], book_info, self.sample_pdf_with_toc, palette)

        sec_map = {s["id"]: s["title"] for s in model["sections"]}
        self.assertEqual(sec_map[model["runs"][0]["section"]], "Chapter 1 Introduction")
        self.assertEqual(sec_map[model["runs"][1]["section"]], "Chapter 2 Deep Dive")

    def test_fallback_without_toc_and_pdf(self):
        palette = self.get_sample_palette()
        annot = {"id": "f1", "page": 5, "color": "green", "category": "Definition", "text": "Fallback text", "rects": []}
        book_info = {"id": 99, "title": "No PDF", "authors": "Author"}
        model = notes_export.build_model([annot], book_info, None, palette)

        self.assertEqual(model["sections"][0]["title"], "(sin índice)")
        self.assertEqual(model["runs"][0]["marks"][0]["text_source"], "stored")
        self.assertEqual(model["runs"][0]["marks"][0]["text"], "Fallback text")

    def test_every_non_empty_note_appears_in_all_formats(self):
        palette = self.get_sample_palette()
        annot = {
            "id": "n1",
            "page": 1,
            "color": "yellow",
            "category": "Key Idea",
            "text": "Some concept",
            "comment": "Crucial note for testing all 5 formats",
            "rects": []
        }
        book_info = {"id": 1, "title": "Note Test", "authors": "A"}
        model = notes_export.build_model([annot], book_info, None, palette)

        target_note = "Crucial note for testing all 5 formats"
        self.assertIn(target_note, notes_export.render_json(model))
        self.assertIn(target_note, notes_export.render_jsonl(model))
        self.assertIn(target_note, notes_export.render_yaml(model))
        self.assertIn(target_note, notes_export.render_toml(model))
        self.assertIn(target_note, notes_export.render_md(model, group_by="hierarchy"))
        self.assertIn(target_note, notes_export.render_md(model, group_by="color"))
        self.assertIn(target_note, notes_export.render_md(model, group_by="page"))

    def test_toml_and_yaml_roundtrip_equivalence(self):
        palette = self.get_sample_palette()
        annot = {
            "id": "rt1",
            "page": 1,
            "color": "yellow",
            "category": "Key Idea",
            "text": "Roundtrip test",
            "comment": "Testing roundtrip note",
            "rects": []
        }
        book_info = {"id": 1, "title": "Roundtrip Book", "authors": ["Author One"]}
        model = notes_export.build_model([annot], book_info, None, palette)

        yaml_str = notes_export.render_yaml(model)
        parsed_yaml = yaml.safe_load(yaml_str)
        self.assertEqual(parsed_yaml["source"]["title"], "Roundtrip Book")
        self.assertEqual(parsed_yaml["stats"]["total"], 1)

        toml_str = notes_export.render_toml(model)
        parsed_toml = tomllib.loads(toml_str)
        self.assertEqual(parsed_toml["source"]["title"], "Roundtrip Book")
        self.assertEqual(parsed_toml["stats"]["total"], 1)

    def test_color_filter_consistency(self):
        palette = self.get_sample_palette()
        annots = [
            {"id": "1", "page": 1, "color": "yellow", "category": "Key Idea", "text": "Yellow One", "rects": []},
            {"id": "2", "page": 2, "color": "blue", "category": "Question / Analisis", "text": "Blue One", "rects": []}
        ]
        book_info = {"id": 1, "title": "Filter Book", "authors": "A"}
        model_filtered = notes_export.build_model(annots, book_info, None, palette, color_filter="yellow")

        self.assertEqual(model_filtered["stats"]["total"], 1)
        self.assertEqual(len(model_filtered["runs"]), 1)
        self.assertEqual(model_filtered["runs"][0]["type"], "key_idea")
        self.assertEqual(len(model_filtered["sections"]), 1)

    def test_legacy_md_color_retrocompatibility(self):
        palette = self.get_sample_palette()
        annots = [
            {"id": "1", "page": 1, "color": "yellow", "category": "Key Idea", "text": "Concept 1", "comment": "Note 1", "rects": []},
            {"id": "2", "page": 1, "color": "yellow", "category": "Key Idea", "text": "Concept 2", "rects": []}
        ]
        book_info = {"id": 1, "title": "Retro Book", "authors": "Author"}
        model = notes_export.build_model(annots, book_info, None, palette)
        md = notes_export.render_md(model, group_by="color")

        self.assertIn("## Key Idea / Concept (2)", md)
        self.assertIn('- **[Page 1]**: "Concept 1"', md)
        self.assertIn("> 💡 *Note:* Note 1", md)

    def test_golden_files_generation(self):
        palette = self.get_sample_palette()
        annots = self.get_fixture_annotations()
        book_info = {"id": 42, "title": "Golden Book", "authors": ["Jane Doe", "John Smith"]}
        model = notes_export.build_model(
            annots, book_info, None, palette, exported_at="2026-10-04T00:00:00Z"
        )

        golden_dir = os.path.join(os.path.dirname(__file__), "golden")
        expected = {
            "json": notes_export.render_json(model),
            "jsonl": notes_export.render_jsonl(model),
            "yaml": notes_export.render_yaml(model),
            "toml": notes_export.render_toml(model),
            "md": notes_export.render_md(model, group_by="hierarchy"),
        }

        for ext, rendered in expected.items():
            p = os.path.join(golden_dir, f"export.{ext}")
            self.assertTrue(os.path.exists(p))
            self.assertGreater(os.path.getsize(p), 0)
            with open(p, "r", encoding="utf-8") as f:
                content_f = f.read()
            self.assertEqual(rendered.strip(), content_f.strip())


if __name__ == "__main__":
    unittest.main()
