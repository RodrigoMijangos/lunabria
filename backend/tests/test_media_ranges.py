import tempfile
import unittest
from pathlib import Path

from fastapi import HTTPException
from starlette.requests import Request

from app.routers.media import range_requests_response


class TestPdfByteRanges(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.pdf_path = Path(self.temp_dir.name) / "sample.pdf"
        self.pdf_path.write_bytes(b"0123456789")

    def tearDown(self):
        self.temp_dir.cleanup()

    def make_request(self, range_header=None):
        headers = [(b"range", range_header.encode())] if range_header else []
        scope = {
            "type": "http",
            "http_version": "1.1",
            "method": "GET",
            "scheme": "http",
            "path": "/api/books/1/pdf",
            "raw_path": b"/api/books/1/pdf",
            "query_string": b"",
            "headers": headers,
            "server": ("testserver", 80),
            "client": ("testclient", 1234),
            "root_path": "",
        }
        return Request(scope)

    async def read_response(self, response):
        return b"".join([chunk async for chunk in response.body_iterator])

    async def test_standard_range_returns_partial_content(self):
        response = range_requests_response(self.make_request("bytes=2-5"), self.pdf_path)

        self.assertEqual(response.status_code, 206)
        self.assertEqual(response.headers["content-range"], "bytes 2-5/10")
        self.assertEqual(response.headers["content-length"], "4")
        self.assertEqual(await self.read_response(response), b"2345")

    async def test_open_ended_and_suffix_ranges(self):
        open_ended = range_requests_response(self.make_request("bytes=7-"), self.pdf_path)
        suffix = range_requests_response(self.make_request("bytes=-3"), self.pdf_path)

        self.assertEqual(await self.read_response(open_ended), b"789")
        self.assertEqual(await self.read_response(suffix), b"789")

    async def test_end_is_clamped_to_file_size(self):
        response = range_requests_response(self.make_request("bytes=8-100"), self.pdf_path)

        self.assertEqual(response.headers["content-range"], "bytes 8-9/10")
        self.assertEqual(await self.read_response(response), b"89")

    async def test_invalid_or_unsatisfiable_ranges_return_416(self):
        for value in ("bytes=10-", "bytes=5-2", "bytes=1-2,4-5", "items=1-2"):
            with self.subTest(value=value):
                with self.assertRaises(HTTPException) as error:
                    range_requests_response(self.make_request(value), self.pdf_path)
                self.assertEqual(error.exception.status_code, 416)
                self.assertEqual(error.exception.headers["Content-Range"], "bytes */10")


if __name__ == "__main__":
    unittest.main()
