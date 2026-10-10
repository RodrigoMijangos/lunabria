import asyncio
import logging
from pathlib import Path
from typing import Callable, Optional

from app import database
from app.services.calibre_service import calibre_service

logger = logging.getLogger(__name__)


def process_upload_job(job):
    file_path = job["staging_path"]
    clean_title = Path(job["filename"]).stem.replace("_", " ").replace("-", " ")
    book_id = calibre_service.add_book(
        file_path=file_path,
        title=clean_title,
        isbn=job.get("isbn"),
    )

    if job.get("auto_fetch_metadata"):
        try:
            metadata = calibre_service.fetch_metadata(
                isbn=job.get("isbn"),
                title=clean_title,
            )
            calibre_service.update_metadata(
                book_id=book_id,
                title=metadata.get("title") or clean_title,
                authors=", ".join(metadata.get("authors") or []) or None,
                tags=", ".join(metadata.get("tags") or []) or None,
                comments=metadata.get("comments"),
                isbn=metadata.get("isbn") or job.get("isbn"),
            )
        except Exception:
            logger.warning(
                "Could not fetch metadata for uploaded book job %s",
                job["job_id"],
                exc_info=True,
            )

    return book_id


class IngestionQueue:
    def __init__(self, processor: Optional[Callable] = None):
        self._processor = processor or process_upload_job
        self._queue = None
        self._worker_task = None
        self._accepting = False

    @property
    def is_running(self):
        return (
            self._accepting
            and self._worker_task is not None
            and not self._worker_task.done()
        )

    async def start(self):
        if self.is_running:
            return

        queue = asyncio.Queue()
        for job in database.get_active_upload_jobs():
            if not Path(job["staging_path"]).is_file():
                database.update_upload_job(
                    job["job_id"],
                    "failed",
                    error="The staged upload file is missing and cannot be resumed.",
                )
                continue
            if job["status"] == "processing":
                database.update_upload_job(job["job_id"], "queued")
                job["status"] = "queued"
            queue.put_nowait(job)

        self._queue = queue
        self._worker_task = asyncio.create_task(
            self._run(queue),
            name="lunabria-book-ingestion",
        )
        self._accepting = True

    async def enqueue_many(self, jobs):
        if not self.is_running or self._queue is None:
            raise RuntimeError("Book ingestion worker is not running.")
        for job in jobs:
            self._queue.put_nowait(job)

    async def stop(self):
        self._accepting = False
        queue = self._queue
        worker_task = self._worker_task
        if queue is not None and worker_task is not None and not worker_task.done():
            while True:
                try:
                    queue.get_nowait()
                except asyncio.QueueEmpty:
                    break
                else:
                    queue.task_done()
            queue.put_nowait(None)
            await worker_task

        self._queue = None
        self._worker_task = None

    async def _run(self, queue):
        while True:
            job = await queue.get()
            if job is None:
                queue.task_done()
                return

            cancelled = False
            try:
                database.update_upload_job(job["job_id"], "processing")
                book_id = await asyncio.to_thread(self._processor, job)
                database.update_upload_job(
                    job["job_id"],
                    "completed",
                    book_id=book_id,
                )
            except asyncio.CancelledError:
                cancelled = True
                raise
            except Exception as error:
                logger.exception("Book ingestion job %s failed", job["job_id"])
                try:
                    database.update_upload_job(
                        job["job_id"],
                        "failed",
                        error=str(error)[:2000],
                    )
                except Exception:
                    logger.exception(
                        "Could not record failure for book ingestion job %s",
                        job["job_id"],
                    )
            finally:
                if not cancelled:
                    try:
                        Path(job["staging_path"]).unlink(missing_ok=True)
                    except OSError:
                        logger.exception(
                            "Could not remove staged upload for job %s",
                            job["job_id"],
                        )
                queue.task_done()


ingestion_queue = IngestionQueue()
