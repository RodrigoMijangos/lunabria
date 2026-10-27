import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

backend_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_dir))
sys.path.insert(0, str(backend_dir / "tests"))

_test_root = tempfile.TemporaryDirectory(prefix="lbt_vl_")
_test_data_dir = Path(_test_root.name)
_test_db_path = _test_data_dir / "app_state.db"
_test_calibre_path = _test_data_dir / "cal_lib"

os.environ["APP_DATA_DIR"] = str(_test_data_dir)
os.environ["APP_STATE_DB_PATH"] = str(_test_db_path)
os.environ["CALIBRE_LIBRARY_PATH"] = str(_test_calibre_path)

import app.config as config
config.DATA_DIR = _test_data_dir
config.APP_STATE_DB_PATH = str(_test_db_path)
config.CALIBRE_LIBRARY_PATH = str(_test_calibre_path)

import app.database as database
database.APP_STATE_DB_PATH = str(_test_db_path)

import app.services.calibre_service as cs_module
cs_module.calibre_service.library_path = _test_calibre_path
cs_module.calibre_service.db_path = _test_calibre_path / "metadata.db"

from app.database import get_db, init_db
from app.main import app
from setup_test_library import main as setup_test_library

class TestVirtualLibraries(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        init_db()
        setup_test_library()
        cls.client = TestClient(app)

    def test_01_create_and_rename_manual_library(self):
        # Create manual collection
        res = self.client.post("/api/virtual-libraries", json={
            "name": "Original Name",
            "type": "manual",
            "book_ids": [1, 2]
        })
        self.assertEqual(res.status_code, 200)
        vl = res.json()
        vl_id = vl["id"]
        self.assertEqual(vl["name"], "Original Name")
        self.assertEqual(vl["book_ids"], [1, 2])

        # Rename collection via PUT
        rename_res = self.client.put(f"/api/virtual-libraries/{vl_id}", json={
            "name": "Renamed Collection"
        })
        self.assertEqual(rename_res.status_code, 200)
        updated = rename_res.json()
        self.assertEqual(updated["name"], "Renamed Collection")
        # Ensure book_ids are NOT wiped out when only name is provided
        self.assertEqual(updated["book_ids"], [1, 2])

        # Ensure empty name returns 400
        empty_name_res = self.client.put(f"/api/virtual-libraries/{vl_id}", json={
            "name": "   "
        })
        self.assertEqual(empty_name_res.status_code, 400)

    def test_02_remove_books_from_manual_library(self):
        # Create collection with books 1, 2, 3
        res = self.client.post("/api/virtual-libraries", json={
            "name": "Collection For Removal",
            "type": "manual",
            "book_ids": [1, 2, 3]
        })
        self.assertEqual(res.status_code, 200)
        vl_id = res.json()["id"]

        # Remove single book (2)
        del_res = self.client.request(
            "DELETE",
            f"/api/virtual-libraries/{vl_id}/books",
            json={"book_ids": [2]}
        )
        self.assertEqual(del_res.status_code, 200)
        updated = del_res.json()
        self.assertEqual(updated["book_ids"], [1, 3])

        # Verify books in virtual library endpoint
        b_res = self.client.get(f"/api/virtual-libraries/{vl_id}/books")
        self.assertEqual(b_res.status_code, 200)
        book_ids = [b["id"] for b in b_res.json()]
        self.assertNotIn(2, book_ids)
        self.assertIn(1, book_ids)
        self.assertIn(3, book_ids)

        # Verify physical book 2 was NOT deleted from Calibre library
        book_2_res = self.client.get("/api/books/2")
        self.assertEqual(book_2_res.status_code, 200)

        # Remove multiple books (1 and 3)
        del_multi_res = self.client.request(
            "DELETE",
            f"/api/virtual-libraries/{vl_id}/books",
            json={"book_ids": [1, 3]}
        )
        self.assertEqual(del_multi_res.status_code, 200)
        self.assertEqual(del_multi_res.json()["book_ids"], [])

    def test_03_remove_books_validation_and_errors(self):
        # Non-existent library -> 404
        not_found = self.client.request(
            "DELETE",
            "/api/virtual-libraries/99999/books",
            json={"book_ids": [1]}
        )
        self.assertEqual(not_found.status_code, 404)

        # Empty book_ids -> 422 Unprocessable Entity
        empty_req = self.client.request(
            "DELETE",
            "/api/virtual-libraries/1/books",
            json={"book_ids": []}
        )
        self.assertEqual(empty_req.status_code, 422)

        # Query collection removes books by recording them into excluded_book_ids
        query_res = self.client.post("/api/virtual-libraries", json={
            "name": "Query Only",
            "type": "query",
            "query": "tags:=University"
        })
        self.assertEqual(query_res.status_code, 200)
        q_id = query_res.json()["id"]

        del_res = self.client.request(
            "DELETE",
            f"/api/virtual-libraries/{q_id}/books",
            json={"book_ids": [1]}
        )
        self.assertEqual(del_res.status_code, 200)
        self.assertIn(1, del_res.json()["excluded_book_ids"])

        # Books list now reflects exclusion
        books_res = self.client.get(f"/api/virtual-libraries/{q_id}/books")
        self.assertEqual(books_res.status_code, 200)
        self.assertEqual(len(books_res.json()), 0)

    def test_04_hybrid_collections(self):
        # Create hybrid collection with query and manual book_ids
        res = self.client.post("/api/virtual-libraries", json={
            "name": "Hybrid CS Selection",
            "type": "query",
            "query": "tags:=University",
            "book_ids": [2]
        })
        self.assertEqual(res.status_code, 200)
        vl_id = res.json()["id"]

        # Books should include book 1 (from query) and book 2 (manual)
        books_res = self.client.get(f"/api/virtual-libraries/{vl_id}/books")
        self.assertEqual(books_res.status_code, 200)
        books = books_res.json()
        book_ids = {b["id"] for b in books}
        self.assertIn(1, book_ids)
        self.assertIn(2, book_ids)

        # Exclude book 1
        del_res = self.client.request(
            "DELETE",
            f"/api/virtual-libraries/{vl_id}/books",
            json={"book_ids": [1]}
        )
        self.assertEqual(del_res.status_code, 200)
        self.assertIn(1, del_res.json()["excluded_book_ids"])

        # Now only manual book 2 remains
        books_res2 = self.client.get(f"/api/virtual-libraries/{vl_id}/books")
        self.assertEqual(books_res2.status_code, 200)
        books2 = books_res2.json()
        self.assertEqual(len(books2), 1)
        self.assertEqual(books2[0]["id"], 2)

if __name__ == "__main__":
    unittest.main()
