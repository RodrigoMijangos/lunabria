"""Best-effort PDF linearization for faster first-page range loading."""

import logging
import os
import tempfile
from pathlib import Path

logger = logging.getLogger(__name__)


def linearize_pdf(file_path: Path) -> bool:
    """Rewrite a PDF for Fast Web View; leave the original intact on failure."""
    file_path = Path(file_path)
    if not file_path.is_file():
        return False

    temporary_path = None
    try:
        import pikepdf

        file_descriptor, temporary_name = tempfile.mkstemp(
            prefix=f"{file_path.stem}-", suffix=".linearized.pdf", dir=file_path.parent
        )
        os.close(file_descriptor)
        temporary_path = Path(temporary_name)

        with pikepdf.open(file_path) as document:
            if document.is_linearized:
                return False
            document.save(temporary_path, linearize=True)

        with pikepdf.open(temporary_path) as linearized:
            if not linearized.is_linearized:
                return False
        os.replace(temporary_path, file_path)
        temporary_path = None
        return True
    except Exception as error:
        logger.warning("Could not linearize PDF %s; preserving the original: %s", file_path, error)
        return False
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)
