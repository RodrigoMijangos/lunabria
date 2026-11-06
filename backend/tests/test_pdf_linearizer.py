import tempfile
import unittest
from pathlib import Path

import fitz

try:
    import pikepdf
except ImportError:
    pikepdf = None

from app.services.pdf_linearizer import linearize_pdf


@unittest.skipIf(pikepdf is None, "pikepdf is required for PDF linearization")
class TestPdfLinearizer(unittest.TestCase):
    def test_linearizes_pdf_in_place_and_preserves_readability(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            pdf_path = Path(temporary_directory) / "sample.pdf"
            document = fitz.open()
            document.new_page()
            document.save(pdf_path)
            document.close()

            self.assertTrue(linearize_pdf(pdf_path))
            with pikepdf.open(pdf_path) as linearized:
                self.assertTrue(linearized.is_linearized)
                self.assertEqual(len(linearized.pages), 1)

    def test_invalid_pdf_is_preserved_when_linearization_is_not_possible(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            pdf_path = Path(temporary_directory) / "invalid.pdf"
            original = b"%PDF-not-a-valid-document"
            pdf_path.write_bytes(original)

            self.assertFalse(linearize_pdf(pdf_path))
            self.assertEqual(pdf_path.read_bytes(), original)


if __name__ == "__main__":
    unittest.main()
