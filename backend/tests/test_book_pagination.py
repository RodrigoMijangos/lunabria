import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers.books import list_books, router


class TestBookPagination(unittest.TestCase):
    def setUp(self):
        self.books = [
            {"id": 1, "title": "Zulu", "authors": "Rafael", "tags": ["Science"], "date_added": "2025-01-01"},
            {"id": 2, "title": "Álgebra", "authors": "Ana", "tags": ["Science"], "date_added": "2024-01-01"},
            {"id": 3, "title": "Alpha", "authors": "Rafael", "tags": ["History"], "date_added": "2023-01-01"},
            {"id": 4, "title": "Beta", "authors": "Mina", "tags": ["Science"], "date_added": "2022-01-01"},
        ]

    @patch("app.routers.books.reader_service.add_last_read_dates", side_effect=lambda books: books)
    @patch("app.routers.books.calibre_service.list_books")
    def test_text_search_exclusion_sort_and_page_metadata(self, list_books_mock, _):
        list_books_mock.return_value = self.books

        result = list_books(
            search=None,
            virtual_library_id=None,
            q="SCIENCE",
            page=1,
            page_size=1,
            sort="title",
            exclude_ids=[2],
        )

        self.assertEqual(result["total"], 2)
        self.assertEqual(result["page"], 1)
        self.assertEqual(result["page_size"], 1)
        self.assertEqual([book["id"] for book in result["books"]], [4])

    @patch("app.routers.books.reader_service.add_last_read_dates", side_effect=lambda books: books)
    @patch("app.routers.books.calibre_service.list_books")
    def test_http_route_is_paginated_by_default_and_respects_requested_pages(self, list_books_mock, _):
        list_books_mock.return_value = self.books
        app = FastAPI()
        app.include_router(router)
        client = TestClient(app)

        default_page = client.get("/api/books")
        custom_page = client.get("/api/books", params={"page": 1, "page_size": 2})

        self.assertEqual(default_page.status_code, 200)
        self.assertEqual(default_page.json()["total"], 4)
        self.assertEqual(default_page.json()["page_size"], 24)
        self.assertEqual(len(default_page.json()["books"]), 4)
        self.assertEqual(custom_page.status_code, 200)
        self.assertEqual(custom_page.json()["total"], 4)
        self.assertEqual(len(custom_page.json()["books"]), 2)

    @patch("app.routers.books.reader_service.add_last_read_dates", side_effect=lambda books: books)
    @patch("app.routers.books.calibre_service.list_books")
    def test_search_handles_string_and_missing_tags(self, list_books_mock, _):
        list_books_mock.return_value = [
            {"id": 5, "title": "Book", "authors": "Author", "tags": "Data Science"},
            {"id": 6, "title": "Another book", "authors": "Author", "tags": None},
        ]

        result = list_books(
            search=None,
            virtual_library_id=None,
            q="science",
            page=1,
            page_size=10,
            sort="title",
            exclude_ids=None,
        )

        self.assertEqual(result["total"], 1)
        self.assertEqual([book["id"] for book in result["books"]], [5])

    @patch("app.routers.books.reader_service.add_last_read_dates", side_effect=lambda books: books)
    @patch("app.routers.books.calibre_service.list_books")
    def test_page_is_clamped_and_last_read_sort_is_descending(self, list_books_mock, _):
        list_books_mock.return_value = [
            {"id": 1, "title": "One", "last_read_at": "2025-01-01"},
            {"id": 2, "title": "Two", "last_read_at": "2026-01-01"},
            {"id": 3, "title": "Three", "last_read_at": "2024-01-01"},
        ]

        result = list_books(
            search=None,
            virtual_library_id=None,
            q=None,
            page=99,
            page_size=1,
            sort="last_read_at",
            exclude_ids=None,
        )

        self.assertEqual(result["total"], 3)
        self.assertEqual(result["page"], 3)
        self.assertEqual([book["id"] for book in result["books"]], [3])


if __name__ == "__main__":
    unittest.main()
