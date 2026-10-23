import asyncio
import concurrent.futures
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import database
from app.routers.books import router
from app.services.ingestion_queue import IngestionQueue


def upload_job(job_id, staging_path, filename=None):
    return {
        "job_id": job_id,
        "filename": filename or f"{job_id}.pdf",
        "staging_path": str(staging_path),
        "auto_fetch_metadata": False,
        "isbn": None,
    }


class TestUploadJobDatabase(unittest.TestCase):
    def test_job_creation_status_updates_and_fifo_order(self):
        with tempfile.TemporaryDirectory(prefix="lunabria-upload-db-") as temp_dir:
            database_path = Path(temp_dir) / "app_state.db"
            with patch("app.database.APP_STATE_DB_PATH", str(database_path)):
                database.init_db()
                database.create_upload_jobs([
                    upload_job("first", Path(temp_dir) / "first.pdf"),
                    upload_job("second", Path(temp_dir) / "second.pdf"),
                ])

                active = database.get_active_upload_jobs()
                self.assertEqual([job["job_id"] for job in active], ["first", "second"])
                self.assertEqual(active[0]["status"], "queued")

                database.update_upload_job("first", "processing")
                database.update_upload_job("first", "completed", book_id=42)
                completed = database.get_upload_job("first")
                self.assertEqual(completed["status"], "completed")
                self.assertEqual(completed["book_id"], 42)
                self.assertEqual([job["job_id"] for job in database.get_active_upload_jobs()], ["second"])

                with self.assertRaises(ValueError):
                    database.update_upload_job("second", "unknown")


class TestIngestionQueue(unittest.IsolatedAsyncioTestCase):
    async def test_worker_processes_fifo_sequentially_off_the_event_loop(self):
        with tempfile.TemporaryDirectory(prefix="lunabria-ingestion-") as temp_dir:
            database_path = Path(temp_dir) / "app_state.db"
            staged_files = [Path(temp_dir) / "first.pdf", Path(temp_dir) / "second.pdf"]
            for staged_file in staged_files:
                staged_file.write_bytes(b"%PDF")

            with patch("app.database.APP_STATE_DB_PATH", str(database_path)):
                database.init_db()
                database.create_upload_jobs([
                    upload_job("first", staged_files[0]),
                    upload_job("second", staged_files[1]),
                ])

                order = []
                active = 0
                max_active = 0
                active_lock = threading.Lock()

                def processor(job):
                    nonlocal active, max_active
                    with active_lock:
                        active += 1
                        max_active = max(max_active, active)
                    order.append(job["job_id"])
                    time.sleep(0.06)
                    with active_lock:
                        active -= 1
                    return 42 if job["job_id"] == "first" else 43

                worker = IngestionQueue(processor)
                await worker.start()
                heartbeat_count = 0
                stop_heartbeat = asyncio.Event()

                async def heartbeat():
                    nonlocal heartbeat_count
                    while not stop_heartbeat.is_set():
                        heartbeat_count += 1
                        await asyncio.sleep(0.005)

                heartbeat_task = asyncio.create_task(heartbeat())
                await asyncio.wait_for(worker._queue.join(), timeout=2)
                stop_heartbeat.set()
                await heartbeat_task
                await worker.stop()

                self.assertEqual(order, ["first", "second"])
                self.assertEqual(max_active, 1)
                self.assertGreaterEqual(heartbeat_count, 5)
                self.assertEqual(database.get_upload_job("first")["book_id"], 42)
                self.assertEqual(database.get_upload_job("second")["book_id"], 43)
                self.assertTrue(all(database.get_upload_job(job_id)["status"] == "completed" for job_id in ("first", "second")))
                self.assertTrue(all(not staged_file.exists() for staged_file in staged_files))

    async def test_startup_requeues_interrupted_work_and_fails_missing_staging_files(self):
        with tempfile.TemporaryDirectory(prefix="lunabria-ingestion-recovery-") as temp_dir:
            database_path = Path(temp_dir) / "app_state.db"
            staged_file = Path(temp_dir) / "interrupted.pdf"
            staged_file.write_bytes(b"%PDF")
            missing_file = Path(temp_dir) / "missing.pdf"

            with patch("app.database.APP_STATE_DB_PATH", str(database_path)):
                database.init_db()
                database.create_upload_jobs([
                    upload_job("interrupted", staged_file),
                    upload_job("missing", missing_file),
                ])
                database.update_upload_job("interrupted", "processing")

                worker = IngestionQueue(lambda job: 99)
                await worker.start()
                await asyncio.wait_for(worker._queue.join(), timeout=2)
                await worker.stop()

                self.assertEqual(database.get_upload_job("interrupted")["status"], "completed")
                missing = database.get_upload_job("missing")
                self.assertEqual(missing["status"], "failed")
                self.assertIn("missing", missing["error"])


class TestUploadEndpoint(unittest.TestCase):
    def test_upload_returns_accepted_job_after_staging_and_exposes_status(self):
        class FakeQueue:
            is_running = True

            def __init__(self):
                self.jobs = []

            async def enqueue_many(self, jobs):
                self.jobs.extend(jobs)

        with tempfile.TemporaryDirectory(prefix="lunabria-upload-api-") as temp_dir:
            root = Path(temp_dir)
            staging_root = root / "uploads"
            database_path = root / "app_state.db"
            queue = FakeQueue()
            app = FastAPI()
            app.include_router(router)

            with (
                patch("app.database.APP_STATE_DB_PATH", str(database_path)),
                patch("app.routers.books.UPLOAD_DIR", staging_root),
                patch("app.routers.books.ingestion_queue", queue),
            ):
                database.init_db()
                with TestClient(app) as client:
                    response = client.post(
                        "/api/books/upload",
                        data={"auto_fetch_metadata": "true", "isbns": "9780123456789"},
                        files=[("files", ("../../A book.pdf", b"%PDF-1.7 test", "application/pdf"))],
                    )
                    self.assertEqual(response.status_code, 202)
                    result = response.json()
                    self.assertEqual(result["status"], "queued")
                    self.assertEqual(result["filename"], "A book.pdf")
                    self.assertEqual(result["job_id"], result["jobs"][0]["job_id"])

                    job = database.get_upload_job(result["job_id"])
                    self.assertEqual(job["status"], "queued")
                    self.assertEqual(job["auto_fetch_metadata"], 1)
                    self.assertEqual(job["isbn"], "9780123456789")
                    staged_path = Path(job["staging_path"])
                    self.assertTrue(staged_path.is_file())
                    self.assertEqual(staged_path.read_bytes(), b"%PDF-1.7 test")
                    self.assertEqual(queue.jobs[0]["job_id"], result["job_id"])

                    active = client.get("/api/books/upload/jobs")
                    status = client.get(f"/api/books/upload/jobs/{result['job_id']}")
                    missing = client.get("/api/books/upload/jobs/unknown")
                    self.assertEqual(active.status_code, 200)
                    self.assertEqual(active.json()[0]["job_id"], result["job_id"])
                    self.assertEqual(status.json()["status"], "queued")
                    self.assertEqual(missing.status_code, 404)

    def test_upload_metadata_fetch_defaults_true_and_explicit_false_is_preserved(self):
        class FakeQueue:
            is_running = True

            def __init__(self):
                self.jobs = []

            async def enqueue_many(self, jobs):
                self.jobs.extend(jobs)

        with tempfile.TemporaryDirectory(prefix="lunabria-upload-default-") as temp_dir:
            root = Path(temp_dir)
            staging_root = root / "uploads"
            database_path = root / "app_state.db"
            queue = FakeQueue()
            app = FastAPI()
            app.include_router(router)

            with (
                patch("app.database.APP_STATE_DB_PATH", str(database_path)),
                patch("app.routers.books.UPLOAD_DIR", staging_root),
                patch("app.routers.books.ingestion_queue", queue),
            ):
                database.init_db()
                with TestClient(app) as client:
                    response = client.post(
                        "/api/books/upload",
                        files=[("files", ("book.pdf", b"%PDF-1.7 sample", "application/pdf"))],
                    )
                    self.assertEqual(response.status_code, 202)
                    result = response.json()
                    job = database.get_upload_job(result["job_id"])
                    self.assertEqual(job["auto_fetch_metadata"], 1)

                    response = client.post(
                        "/api/books/upload",
                        data={"auto_fetch_metadata": "false"},
                        files=[("files", ("manual.pdf", b"%PDF-1.7 sample", "application/pdf"))],
                    )
                    self.assertEqual(response.status_code, 202)
                    result = response.json()
                    job = database.get_upload_job(result["job_id"])
                    self.assertEqual(job["auto_fetch_metadata"], 0)

    def test_upload_rejects_non_pdf_files(self):
        class FakeQueue:
            is_running = True

            async def enqueue_many(self, jobs):
                self.jobs = jobs

        with tempfile.TemporaryDirectory(prefix="lunabria-upload-invalid-") as temp_dir:
            app = FastAPI()
            app.include_router(router)
            with patch("app.routers.books.UPLOAD_DIR", Path(temp_dir)), patch(
                "app.routers.books.ingestion_queue", FakeQueue()
            ):
                with TestClient(app) as client:
                    response = client.post(
                        "/api/books/upload",
                        files=[("files", ("not-a-book.txt", b"content", "text/plain"))],
                    )
            self.assertEqual(response.status_code, 400)

    def test_accepted_response_does_not_wait_for_the_calibre_worker(self):
        worker_started = threading.Event()
        release_worker = threading.Event()

        def slow_processor(_job):
            worker_started.set()
            if not release_worker.wait(timeout=3):
                raise TimeoutError("test worker was not released")
            return 7

        with tempfile.TemporaryDirectory(prefix="lunabria-upload-async-") as temp_dir:
            root = Path(temp_dir)
            database_path = root / "app_state.db"
            staging_root = root / "uploads"
            queue = IngestionQueue(slow_processor)
            app = FastAPI()
            app.include_router(router)

            @app.on_event("startup")
            def initialize_database():
                database.init_db()

            @app.on_event("startup")
            async def start_worker():
                await queue.start()

            @app.on_event("shutdown")
            async def stop_worker():
                await queue.stop()

            with (
                patch("app.database.APP_STATE_DB_PATH", str(database_path)),
                patch("app.routers.books.UPLOAD_DIR", staging_root),
                patch("app.routers.books.ingestion_queue", queue),
                TestClient(app) as client,
            ):
                try:
                    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                        request = executor.submit(
                            client.post,
                            "/api/books/upload",
                            files=[("files", ("slow.pdf", b"%PDF", "application/pdf"))],
                        )
                        response = request.result(timeout=1)
                        self.assertTrue(worker_started.wait(timeout=1))
                        self.assertEqual(response.status_code, 202)
                        self.assertEqual(response.json()["status"], "queued")
                finally:
                    release_worker.set()


class TestProcessUploadJobCascade(unittest.TestCase):
    def test_process_upload_job_updates_metadata_on_match(self):
        job = {
            "job_id": "test-job-1",
            "staging_path": "/tmp/dummy.pdf",
            "filename": "my_test_book.pdf",
            "auto_fetch_metadata": True,
            "isbn": None,
        }

        with (
            patch("app.services.ingestion_queue.calibre_service.add_book", return_value=101) as mock_add,
            patch(
                "app.services.ingestion_queue.extract_pdf_metadata",
                return_value={"isbns": ["9780132350884"], "title": "Clean Code", "author": "Robert C. Martin"}
            ) as mock_extract,
            patch(
                "app.services.ingestion_queue.calibre_service.fetch_metadata_cascade",
                return_value={
                    "matched": True,
                    "title": "Clean Code: A Handbook of Agile Software Craftsmanship",
                    "authors": ["Robert C. Martin"],
                    "tags": ["Programming"],
                    "comments": "Great book",
                    "isbn": "9780132350884",
                }
            ) as mock_cascade,
            patch("app.services.ingestion_queue.calibre_service.update_metadata") as mock_update,
        ):
            from app.services.ingestion_queue import process_upload_job
            book_id = process_upload_job(job)
            self.assertEqual(book_id, 101)
            mock_add.assert_called_once_with(file_path="/tmp/dummy.pdf", title="my test book", isbn=None)
            mock_extract.assert_called_once_with("/tmp/dummy.pdf")
            mock_cascade.assert_called_once_with(
                candidate_isbns=["9780132350884"],
                pdf_title="Clean Code",
                pdf_author="Robert C. Martin",
                clean_title="my test book",
            )
            mock_update.assert_called_once_with(
                book_id=101,
                title="Clean Code: A Handbook of Agile Software Craftsmanship",
                authors="Robert C. Martin",
                tags="Programming",
                comments="Great book",
                isbn="9780132350884",
            )

    def test_process_upload_job_safe_fallback_keeps_book_unmodified(self):
        job = {
            "job_id": "test-job-2",
            "staging_path": "/tmp/unmatched.pdf",
            "filename": "Unknown_Doc.pdf",
            "auto_fetch_metadata": True,
            "isbn": None,
        }

        with (
            patch("app.services.ingestion_queue.calibre_service.add_book", return_value=102) as mock_add,
            patch(
                "app.services.ingestion_queue.extract_pdf_metadata",
                return_value={"isbns": [], "title": None, "author": None}
            ),
            patch(
                "app.services.ingestion_queue.calibre_service.fetch_metadata_cascade",
                return_value={"matched": False, "title": "Unknown Doc", "authors": []}
            ),
            patch("app.services.ingestion_queue.calibre_service.update_metadata") as mock_update,
        ):
            from app.services.ingestion_queue import process_upload_job
            book_id = process_upload_job(job)
            self.assertEqual(book_id, 102)
            mock_add.assert_called_once_with(file_path="/tmp/unmatched.pdf", title="Unknown Doc", isbn=None)
            # Safe fallback: update_metadata MUST NOT be called!
            mock_update.assert_not_called()

    def test_process_upload_job_skips_fetch_when_auto_fetch_is_false(self):
        job = {
            "job_id": "test-job-3",
            "staging_path": "/tmp/manual.pdf",
            "filename": "manual.pdf",
            "auto_fetch_metadata": False,
            "isbn": None,
        }

        with (
            patch("app.services.ingestion_queue.calibre_service.add_book", return_value=103) as mock_add,
            patch("app.services.ingestion_queue.extract_pdf_metadata") as mock_extract,
            patch("app.services.ingestion_queue.calibre_service.fetch_metadata_cascade") as mock_cascade,
            patch("app.services.ingestion_queue.calibre_service.update_metadata") as mock_update,
        ):
            from app.services.ingestion_queue import process_upload_job
            book_id = process_upload_job(job)
            self.assertEqual(book_id, 103)
            mock_extract.assert_not_called()
            mock_cascade.assert_not_called()
            mock_update.assert_not_called()


class TestDuplicateIsbnUpload(unittest.TestCase):
    def test_upload_rejects_duplicate_isbn_with_same_pdf_format_when_not_allowed(self):
        class FakeQueue:
            is_running = True
            async def enqueue_many(self, jobs): pass

        with tempfile.TemporaryDirectory(prefix="lunabria-dup-reject-") as temp_dir:
            root = Path(temp_dir)
            staging_root = root / "uploads"
            database_path = root / "app_state.db"
            queue = FakeQueue()

            app = FastAPI()
            app.include_router(router)

            duplicate_result = {
                "id": 88,
                "title": "Clean Code",
                "isbn": "9780132350884",
                "formats": ["PDF"]
            }

            with (
                patch("app.database.APP_STATE_DB_PATH", str(database_path)),
                patch("app.routers.books.UPLOAD_DIR", staging_root),
                patch("app.routers.books.ingestion_queue", queue),
                patch("app.routers.books.calibre_service.find_duplicate_by_isbn", return_value=duplicate_result),
            ):
                database.init_db()
                with TestClient(app) as client:
                    response = client.post(
                    "/api/books/upload",
                    data={"isbns": "9780132350884", "allow_duplicate": "false"},
                    files=[("files", ("duplicate.pdf", b"%PDF-1.7 mock", "application/pdf"))]
                )
                self.assertEqual(response.status_code, 409)
                data = response.json()
                self.assertEqual(data["detail"]["code"], "DUPLICATE_ISBN_FORMAT")
                self.assertEqual(data["detail"]["isbn"], "9780132350884")
                self.assertEqual(data["detail"]["format"], "PDF")
                self.assertEqual(data["detail"]["existing_title"], "Clean Code")

    def test_upload_allows_duplicate_isbn_when_allow_duplicate_is_true(self):
        class FakeQueue:
            is_running = True
            async def enqueue_many(self, jobs): pass

        with tempfile.TemporaryDirectory(prefix="lunabria-dup-allow-") as temp_dir:
            root = Path(temp_dir)
            staging_root = root / "uploads"
            database_path = root / "app_state.db"
            queue = FakeQueue()

            app = FastAPI()
            app.include_router(router)

            duplicate_result = {
                "id": 88,
                "title": "Clean Code",
                "isbn": "9780132350884",
                "formats": ["PDF"]
            }

            with (
                patch("app.database.APP_STATE_DB_PATH", str(database_path)),
                patch("app.routers.books.UPLOAD_DIR", staging_root),
                patch("app.routers.books.ingestion_queue", queue),
                patch("app.routers.books.calibre_service.find_duplicate_by_isbn", return_value=duplicate_result),
            ):
                database.init_db()
                with TestClient(app) as client:
                    response = client.post(
                        "/api/books/upload",
                        data={"isbns": "9780132350884", "allow_duplicate": "true"},
                    files=[("files", ("duplicate.pdf", b"%PDF-1.7 mock", "application/pdf"))]
                )
                self.assertEqual(response.status_code, 202)
                self.assertEqual(response.json()["status"], "queued")

    def test_upload_allows_same_isbn_with_different_format_without_prompt(self):
        class FakeQueue:
            is_running = True
            async def enqueue_many(self, jobs): pass

        with tempfile.TemporaryDirectory(prefix="lunabria-dup-diff-format-") as temp_dir:
            root = Path(temp_dir)
            staging_root = root / "uploads"
            database_path = root / "app_state.db"
            queue = FakeQueue()

            app = FastAPI()
            app.include_router(router)

            with (
                patch("app.database.APP_STATE_DB_PATH", str(database_path)),
                patch("app.routers.books.UPLOAD_DIR", staging_root),
                patch("app.routers.books.ingestion_queue", queue),
                patch("app.routers.books.calibre_service.find_duplicate_by_isbn", return_value=None),
            ):
                database.init_db()
                with TestClient(app) as client:
                    response = client.post(
                        "/api/books/upload",
                        data={"isbns": "9780132350884", "allow_duplicate": "false"},
                    files=[("files", ("epub-twin.pdf", b"%PDF-1.7 mock", "application/pdf"))]
                )
                self.assertEqual(response.status_code, 202)
                self.assertEqual(response.json()["status"], "queued")



if __name__ == "__main__":
    unittest.main()
