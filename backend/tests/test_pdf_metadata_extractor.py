import tempfile
import unittest
from pathlib import Path

import pymupdf

from app.services.pdf_metadata_extractor import (
    clean_pdf_author,
    clean_pdf_title,
    extract_candidate_isbns_from_text,
    extract_pdf_metadata,
    isbn_10_to_13,
    normalize_isbn,
    score_candidate,
    validate_isbn_10,
    validate_isbn_13,
)


class TestPdfMetadataExtractor(unittest.TestCase):
    def test_validate_isbn_10(self):
        # Valid ISBN-10 with numeric check digit
        self.assertTrue(validate_isbn_10("0-306-40615-2"))
        self.assertTrue(validate_isbn_10("0306406152"))
        # Valid ISBN-10 with X check digit
        self.assertTrue(validate_isbn_10("0-8044-2957-X"))
        self.assertTrue(validate_isbn_10("080442957x"))

        # Invalid checksum
        self.assertFalse(validate_isbn_10("0-306-40615-3"))
        # Invalid lengths and characters
        self.assertFalse(validate_isbn_10("12345"))
        self.assertFalse(validate_isbn_10("0-306-40615-A"))
        self.assertFalse(validate_isbn_10("2026-10-18-01"))

    def test_validate_isbn_13(self):
        # Valid 978 and 979
        self.assertTrue(validate_isbn_13("978-0-306-40615-7"))
        self.assertTrue(validate_isbn_13("9780306406157"))
        self.assertTrue(validate_isbn_13("979-10-90636-07-1"))

        # Invalid checksum
        self.assertFalse(validate_isbn_13("978-0-306-40615-8"))
        # Invalid prefix
        self.assertFalse(validate_isbn_13("977-0-306-40615-7"))
        # Non-numeric
        self.assertFalse(validate_isbn_13("978-0-306-40615-X"))
        self.assertFalse(validate_isbn_13("1234567890123"))

    def test_isbn_10_to_13_and_normalization(self):
        self.assertEqual(isbn_10_to_13("0-306-40615-2"), "9780306406157")
        self.assertEqual(isbn_10_to_13("080442957X"), "9780804429573")

        self.assertEqual(normalize_isbn("0-306-40615-2"), "9780306406157")
        self.assertEqual(normalize_isbn("978-0-306-40615-7"), "9780306406157")
        self.assertIsNone(normalize_isbn("invalid-isbn"))

    def test_extract_candidate_isbns_from_text_disambiguation(self):
        text = """
        Published by Academic Press
        Print edition ISBN-10: 0-306-40615-2
        eBook ISBN-13: 978-0-13-235088-4
        Also by this author: 978-0-201-61622-4
        Bogus code: 123-456-789-0
        """
        candidates = extract_candidate_isbns_from_text(text, page_index=1, total_pages=10)
        # Should contain canonical 13 versions
        found_isbns = [can for can, _ in candidates]
        self.assertIn("9780306406157", found_isbns)  # from print 0-306-40615-2
        self.assertIn("9780132350884", found_isbns)  # from ebook 978-0-13-235088-4
        self.assertIn("9780201616224", found_isbns)  # also by

        # eBook candidate should have higher score than print and also-by
        scores = {can: sc for can, sc in candidates}
        self.assertGreater(scores["9780132350884"], scores["9780306406157"])
        self.assertGreater(scores["9780306406157"], scores["9780201616224"])

    def test_clean_pdf_title_and_author(self):
        self.assertIsNone(clean_pdf_title(None))
        self.assertIsNone(clean_pdf_title("   "))
        self.assertIsNone(clean_pdf_title("Untitled"))
        self.assertIsNone(clean_pdf_title("Microsoft Word - Document1.docx"))
        self.assertIsNone(clean_pdf_title("sample_book.pdf"))
        self.assertEqual(clean_pdf_title("Clean Architecture"), "Clean Architecture")

        self.assertIsNone(clean_pdf_author("Administrator"))
        self.assertIsNone(clean_pdf_author("Calibre"))
        self.assertEqual(clean_pdf_author("Robert C. Martin"), "Robert C. Martin")

    def test_extract_pdf_metadata_from_document(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            pdf_path = Path(temp_dir) / "test_book.pdf"
            doc = pymupdf.open()

            # Page 0: Cover with large title
            page0 = doc.new_page()
            page0.insert_text((50, 100), "Designing Data-Intensive Applications", fontsize=28)
            page0.insert_text((50, 150), "Martin Kleppmann", fontsize=14)

            # Page 1: Copyright page with multiple ISBNs
            page1 = doc.new_page()
            page1.insert_text((50, 50), "Copyright © 2017 Martin Kleppmann", fontsize=9)
            page1.insert_text((50, 70), "Print ISBN-10: 0-306-40615-2", fontsize=9)
            page1.insert_text((50, 90), "eBook PDF ISBN-13: 978-0-13-235088-4", fontsize=9)
            page1.insert_text((50, 110), "Other books in series: ISBN 978-0-201-61622-4", fontsize=9)

            doc.save(str(pdf_path))
            doc.close()

            result = extract_pdf_metadata(pdf_path)
            self.assertEqual(result["title"], "Designing Data-Intensive Applications")
            self.assertEqual(result["isbns"][0], "9780132350884")  # eBook prioritized
            self.assertEqual(result["isbns"][1], "9780306406157")  # Print second
            self.assertIn("9780201616224", result["isbns"])


if __name__ == "__main__":
    unittest.main()
