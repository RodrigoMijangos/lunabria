"""PDF conversion and cache operations using the public service lock state."""

from pathlib import Path


class SourceConversionError(RuntimeError):
    """Raised when Calibre cannot turn a particular source file into a PDF."""


def convert_to_pdf(
    self,
    book_id: int,
    source_path: Path,
    source_format: str,
    *,
    EBOOK_CONVERT_BIN,
    Path,
    os,
    subprocess,
    tempfile,
    threading,
) -> Path:
    """Converts a Calibre source file into a cached PDF without changing the library."""
    source_format = source_format.strip().upper()
    source_stats = source_path.stat()
    cache_path = self.converted_pdf_dir / (
        f"{book_id}-{source_format.lower()}-{source_stats.st_size}-"
        f"{source_stats.st_mtime_ns}.pdf"
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
                [EBOOK_CONVERT_BIN, str(source_path), str(temp_path)],
                capture_output=True,
                text=True,
                check=True,
            )
            if not self._is_valid_pdf(temp_path):
                raise SourceConversionError(
                    f"Calibre did not generate a valid PDF when converting {source_format}."
                )
            temp_path.replace(cache_path)
        except FileNotFoundError as error:
            raise RuntimeError(
                "ebook-convert was not found. Please install Calibre or set EBOOK_CONVERT_BIN."
            ) from error
        except subprocess.CalledProcessError as error:
            detail = (error.stderr or error.stdout or "").strip()
            message = f"Calibre could not convert the {source_format} to PDF."
            if detail:
                message = f"{message} {detail}"
            raise SourceConversionError(message) from error
        except OSError as error:
            raise RuntimeError(f"Could not execute ebook-convert: {error}") from error
        finally:
            temp_path.unlink(missing_ok=True)

        return cache_path


def convert_epub_to_pdf(
    self,
    book_id: int,
    epub_path: Path,
    **dependencies,
) -> Path:
    """Compatibility wrapper for callers that explicitly convert EPUB files."""
    return convert_to_pdf(
        self,
        book_id,
        epub_path,
        "EPUB",
        **dependencies,
    )


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
