import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

backend_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_dir))
sys.path.insert(0, str(backend_dir / "tests"))

_test_root = tempfile.TemporaryDirectory(prefix="lunabria-tests-")
_test_data_dir = Path(_test_root.name) / "data"
os.environ["APP_DATA_DIR"] = str(_test_data_dir)
os.environ["APP_STATE_DB_PATH"] = str(_test_data_dir / "app_state.db")
os.environ["CALIBRE_LIBRARY_PATH"] = str(_test_data_dir / "calibre_library")

from app.database import get_db, init_db
from app.main import app
from setup_test_library import main as setup_test_library

class TestLunabriaWorkflow(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        init_db()
        setup_test_library()
        cls.client = TestClient(app)

    def test_01_list_books(self):
        res = self.client.get("/api/books")
        self.assertEqual(res.status_code, 200)
        books = res.json()
        self.assertGreaterEqual(len(books), 2)
        self.assertIn("date_added", books[0])
        self.assertIn("last_read_at", books[0])
        print("✓ test_01_list_books passed: Found books in Calibre library")

    def test_02_virtual_library_mode_a_query(self):
        # Create virtual library with query
        res = self.client.post("/api/virtual-libraries", json={
            "name": "Computer Science Faculty",
            "type": "query",
            "query": "tags:=University"
        })
        self.assertEqual(res.status_code, 200)
        vl_id = res.json()["id"]

        # Fetch books in this virtual library
        b_res = self.client.get(f"/api/virtual-libraries/{vl_id}/books")
        self.assertEqual(b_res.status_code, 200)
        books = b_res.json()
        self.assertEqual(len(books), 1)
        self.assertIn("Tanenbaum", books[0]["authors"])
        print("✓ test_02_virtual_library_mode_a_query passed")

    def test_03_virtual_library_mode_b_manual(self):
        # Create manual virtual library with specific book IDs
        res = self.client.post("/api/virtual-libraries", json={
            "name": "My Personal Selection",
            "type": "manual",
            "book_ids": [2]
        })
        self.assertEqual(res.status_code, 200)
        vl_id = res.json()["id"]

        # Fetch books in manual collection
        b_res = self.client.get(f"/api/virtual-libraries/{vl_id}/books")
        self.assertEqual(b_res.status_code, 200)
        books = b_res.json()
        self.assertEqual(len(books), 1)
        self.assertEqual(books[0]["id"], 2)
        self.assertIn("Martin", books[0]["authors"])

        add_res = self.client.post(f"/api/virtual-libraries/{vl_id}/books", json={"book_ids": [1, 2, 1]})
        self.assertEqual(add_res.status_code, 200)
        self.assertEqual(add_res.json()["book_ids"], [2, 1])

        query_res = self.client.post("/api/virtual-libraries", json={
            "name": "Rule-based Collection",
            "type": "query",
            "query": "tags:=University"
        })
        self.assertEqual(query_res.status_code, 200)
        query_id = query_res.json()["id"]
        rejected_add = self.client.post(
            f"/api/virtual-libraries/{query_id}/books",
            json={"book_ids": [1]}
        )
        self.assertEqual(rejected_add.status_code, 400)

        delete_res = self.client.delete(f"/api/virtual-libraries/{vl_id}")
        self.assertEqual(delete_res.status_code, 200)
        self.assertEqual(self.client.get(f"/api/virtual-libraries/{vl_id}").status_code, 404)
        self.assertEqual(self.client.get("/api/books/2").status_code, 200)
        print("✓ test_03_virtual_library_mode_b_manual passed")

    def test_04_reading_progress_and_top10_recents(self):
        # Save progress for Book 1
        res = self.client.post("/api/books/1/progress", json={
            "current_page": 2,
            "total_pages": 2,
            "percentage": 100.0
        })
        self.assertEqual(res.status_code, 200)

        # Check recents
        r_res = self.client.get("/api/recents")
        self.assertEqual(r_res.status_code, 200)
        recents = r_res.json()
        self.assertGreaterEqual(len(recents), 1)
        self.assertEqual(recents[0]["id"], 1)
        self.assertEqual(recents[0]["current_page"], 2)

        with get_db() as conn:
            conn.execute(
                "UPDATE reading_progress SET last_read_at = '2000-01-01 00:00:00.000' WHERE book_id = 1"
            )
            conn.commit()

        opened = self.client.post("/api/books/2/opened", json={
            "current_page": 3,
            "total_pages": 8,
            "percentage": 37.5
        })
        self.assertEqual(opened.status_code, 200)
        recents = self.client.get("/api/recents").json()
        self.assertEqual(recents[0]["id"], 2)
        self.assertEqual(recents[0]["current_page"], 3)

        self.client.post("/api/books/1/opened", json={
            "current_page": 1,
            "total_pages": 99,
            "percentage": 0.0
        })
        progress = self.client.get("/api/books/1/progress").json()
        self.assertEqual(progress["current_page"], 2)
        self.assertEqual(progress["total_pages"], 2)
        self.assertEqual(progress["percentage"], 100.0)

        with patch("app.routers.reader.reader_service.get_top_recent_books", return_value=[]) as get_recent:
            response = self.client.get("/api/recents")
            self.assertEqual(response.status_code, 200)
            get_recent.assert_called_once_with(limit=10)

        books = self.client.get("/api/books").json()
        read_book = next(book for book in books if book["id"] == 1)
        self.assertIsNotNone(read_book["last_read_at"])
        print("✓ test_04_reading_progress_and_top10_recents passed")

    def test_05_annotations_and_markdown_export(self):
        # Add highlight 1 (Key Idea)
        self.client.post("/api/books/1/annotations", json={
            "book_id": 1,
            "page": 1,
            "color": "yellow",
            "category": "Key Idea",
            "text": "A distributed system is a collection of autonomous computing entities...",
            "comment": "Core concept to remember"
        })

        # Add highlight 2 (Definition)
        self.client.post("/api/books/1/annotations", json={
            "book_id": 1,
            "page": 2,
            "color": "green",
            "category": "Definition",
            "text": "Raft is a consensus algorithm designed as a more understandable...",
            "comment": "Compare with Paxos"
        })

        # List annotations
        list_res = self.client.get("/api/books/1/annotations")
        self.assertEqual(list_res.status_code, 200)
        annots = list_res.json()
        self.assertEqual(len(annots), 2)

        # Export to Markdown
        export_res = self.client.get("/api/books/1/export?group_by=color")
        self.assertEqual(export_res.status_code, 200)
        md_text = export_res.text
        self.assertIn("# Notes & Highlights", md_text)
        self.assertIn("Core concept to remember", md_text)
        self.assertIn("Compare with Paxos", md_text)
        print("✓ test_05_annotations_and_markdown_export passed")

    def test_06_metadata_update(self):
        # Update metadata of book 2 including ISBN
        update_res = self.client.put("/api/metadata/2", json={
            "title": "Advanced Clean Architecture",
            "comments": "Excellent guide to decoupled software design.",
            "isbn": "9780134494166"
        })
        self.assertEqual(update_res.status_code, 200)

        # Verify update
        b_res = self.client.get("/api/books/2")
        self.assertEqual(b_res.status_code, 200)
        self.assertEqual(b_res.json()["title"], "Advanced Clean Architecture")
        self.assertEqual(b_res.json()["isbn"], "9780134494166")
        print("✓ test_06_metadata_update passed (with ISBN)")

    def test_07_page_layout(self):
        # Test word layout extraction on book 3 page 19
        layout_res = self.client.get("/api/books/3/pages/19/layout")
        self.assertEqual(layout_res.status_code, 200)
        data = layout_res.json()
        self.assertEqual(data["page"], 19)
        self.assertGreater(data["width"], 0)
        self.assertGreater(data["height"], 0)
        self.assertGreater(len(data["words"]), 0)
        first_word = data["words"][0]
        self.assertIn("text", first_word)
        self.assertEqual(first_word["text"], "INTRODUCTION")
        self.assertIn("x0", first_word)
        self.assertIn("y0", first_word)
        self.assertIn("x1", first_word)
        self.assertIn("lines", data)
        self.assertGreater(len(data["lines"]), 0)
        self.assertEqual(data["lines"][0]["text"], "INTRODUCTION")
        print(f"✓ test_07_page_layout passed ({len(data['words'])} words, {len(data['lines'])} lines extracted, title merged to INTRODUCTION)")

        # Test batch layout endpoint (10-page buffering)
        batch_res = self.client.get("/api/books/3/layouts?start_page=18&end_page=20")
        self.assertEqual(batch_res.status_code, 200)
        batch_data = batch_res.json()
        self.assertIn("layouts", batch_data)
        self.assertIn("19", batch_data["layouts"])
        self.assertEqual(batch_data["layouts"]["19"]["lines"][0]["text"], "INTRODUCTION")
        print("✓ test_07b_batch_layouts passed (batch buffering 18-20)")

    def test_08_text_normalization_and_dehyphenation(self):
        from app.services.reader_service import reader_service
        # Test unit normalization
        raw_text = "ani- mated movies, un- derstood concepts, and profes- sional engineers"
        normalized = reader_service.normalize_text(raw_text)
        self.assertEqual(normalized, "animated movies, understood concepts, and professional engineers")

        # Hyphenated compound words like high-school must be preserved
        compound_text = "high-school students and state-of-the-art tools"
        self.assertEqual(reader_service.normalize_text(compound_text), compound_text)

        # Create annotation with split hyphenation and verify export normalizes it
        annot = reader_service.add_annotation(
            book_id=3,
            page=19,
            color="purple",
            text="un- derstood by profes- sional engineers",
            comment="Dehyphenation test"
        )
        self.assertEqual(annot["text"], "understood by professional engineers")

        # Verify export markdown normalization
        md_export = reader_service.export_annotations_markdown(3)
        self.assertIn("understood by professional engineers", md_export)
        self.assertNotIn("un- derstood", md_export)
        print("✓ test_08_text_normalization_and_dehyphenation passed")

    def test_09_delete_book(self):
        import tempfile

        import pymupdf as fitz

        from app.services.calibre_service import calibre_service
        from app.services.reader_service import reader_service

        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
            pdf_path = f.name
        
        doc = fitz.open()
        p = doc.new_page()
        p.insert_text((50, 50), "Temporary book to delete")
        doc.save(pdf_path)
        doc.close()

        # Add book
        book_id = calibre_service.add_book(pdf_path, title="Temp Book For Deletion", authors="Tester")
        self.assertIsNotNone(book_id)

        # Add annotation & progress
        reader_service.add_annotation(book_id, 1, "yellow", "Dummy annotation")
        reader_service.update_progress(book_id, 1, 1, 100.0)

        # Delete book via API
        del_res = self.client.delete(f"/api/books/{book_id}")
        self.assertEqual(del_res.status_code, 200)

        # Verify book is gone from Calibre
        get_res = self.client.get(f"/api/books/{book_id}")
        self.assertEqual(get_res.status_code, 404)

        # Verify annotations and progress cleaned up
        annots = reader_service.list_annotations(book_id)
        self.assertEqual(len(annots), 0)
        progress = reader_service.get_progress(book_id)
        self.assertIsNone(progress)
        print(f"✓ test_09_delete_book passed: Book {book_id} and related data deleted")

    def test_10_pdf_streaming_and_placeholder_cover(self):
        pdf_res = self.client.get("/api/books/1/pdf", headers={"Range": "bytes=0-7"})
        self.assertEqual(pdf_res.status_code, 206)
        self.assertTrue(pdf_res.headers["content-range"].startswith("bytes 0-7/"))
        self.assertTrue(pdf_res.content.startswith(b"%PDF-"))

        cover_res = self.client.get("/api/books/placeholder-cover")
        self.assertEqual(cover_res.status_code, 200)
        self.assertIn("image/svg+xml", cover_res.headers["content-type"])

if __name__ == "__main__":
    unittest.main()



