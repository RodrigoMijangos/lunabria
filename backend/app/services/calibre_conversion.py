"""PDF conversion and cache operations using the public service lock state."""

from pathlib import Path


def convert_epub_to_pdf(
    self,
    book_id: int,
    epub_path: Path,
    *,
    EBOOK_CONVERT_BIN,
    Path,
    os,
    subprocess,
    tempfile,
    threading,
) -> Path:
    """Converts an EPUB into a cached PDF without modifying the Calibre library."""
    source_stats = epub_path.stat()
    cache_path = self.converted_pdf_dir / (
        f"{book_id}-{source_stats.st_size}-{source_stats.st_mtime_ns}.pdf"
    )
    if self._is_valid_pdf(cache_path):
        return cache_path

    with self._conversion_locks_guard:
        conversion_lock = self._conversion_locks.setdefault(book_id, threading.Lock())

    with conversion_lock:
        if self._is_valid_pdf(cache_path):
            return cache_path

        self.converted_pdf_dir.mkdir(parents=True, exist_ok=True)
        temp_fd, temp_name = tempfile.mkstemp(
            prefix=f"{book_id}-", suffix=".pdf", dir=self.converted_pdf_dir
        )
        os.close(temp_fd)
        temp_path = Path(temp_name)
        temp_path.unlink()

        try:
            subprocess.run(
                [EBOOK_CONVERT_BIN, str(epub_path), str(temp_path)],
                capture_output=True,
                text=True,
                check=True,
            )
            if not self._is_valid_pdf(temp_path):
                raise RuntimeError("Calibre did not generate a valid PDF when converting the EPUB.")
            temp_path.replace(cache_path)
        except FileNotFoundError as error:
            raise RuntimeError(
                "ebook-convert was not found. Please install Calibre or set EBOOK_CONVERT_BIN."
            ) from error
        except subprocess.CalledProcessError as error:
            detail = (error.stderr or error.stdout or "").strip()
            message = "Calibre could not convert the EPUB to PDF."
            if detail:
                message = f"{message} {detail}"
            raise RuntimeError(message) from error
        except OSError as error:
            raise RuntimeError(f"Could not execute ebook-convert: {error}") from error
        finally:
            temp_path.unlink(missing_ok=True)

        return cache_path


def _is_valid_pdf(file_path: Path) -> bool:
    try:
        with file_path.open("rb") as pdf_file:
            return pdf_file.read(5) == b"%PDF-"
    except OSError:
        return False


def _cleanup_converted_pdfs(self, book_id: int) -> None:
    if not self.converted_pdf_dir.exists():
        return
    for pdf_path in self.converted_pdf_dir.glob(f"{book_id}-*.pdf"):
        try:
            pdf_path.unlink()
        except OSError:
            pass
