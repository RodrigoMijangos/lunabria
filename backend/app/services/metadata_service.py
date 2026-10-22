import base64
import json
import os
import re
import subprocess
import tempfile
import xml.etree.ElementTree as ET
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.config import FETCH_METADATA_BIN
from app.database import get_db

class MetadataService:
    """
    Fetches online metadata using Calibre's fetch-ebook-metadata CLI tool.
    Parses OPF XML responses and extracts covers.
    """

    OPTIONAL_METADATA_SOURCES = ("Goodreads",)

    @staticmethod
    @lru_cache(maxsize=1)
    def get_available_sources() -> List[str]:
        """Read the metadata plugins available in the installed Calibre CLI."""
        result = subprocess.run(
            [FETCH_METADATA_BIN, "--help"],
            capture_output=True,
            text=True,
            timeout=15,
            check=False
        )
        if result.returncode != 0:
            raise RuntimeError(f"Could not detect Calibre sources: {result.stderr.strip()}")

        help_text = f"{result.stdout}\n{result.stderr}"
        marker_match = re.search(r"All\s+plugin names:\s*", help_text)
        if not marker_match:
            raise RuntimeError("Calibre help does not include the list of available plugins")

        plugin_section = re.split(r"\n\s*\n", help_text[marker_match.end():], maxsplit=1)[0]
        sources = list(dict.fromkeys(
            source.strip() for source in plugin_section.split(",") if source.strip()
        ))
        if not sources:
            raise RuntimeError("Calibre did not report any available metadata sources")
        return sources

    @classmethod
    def get_source_preferences(cls) -> Dict[str, List[str]]:
        available = cls.get_available_sources()
        with get_db() as conn:
            row = conn.execute(
                "SELECT value FROM user_settings WHERE key = 'metadata_sources'"
            ).fetchone()

        try:
            configured = json.loads(row["value"]) if row else available
        except (TypeError, json.JSONDecodeError):
            configured = available

        if not isinstance(configured, list):
            configured = available
        selected = [source for source in available if source in configured] or available
        unavailable = [
            source for source in cls.OPTIONAL_METADATA_SOURCES if source not in available
        ]
        return {
            "available_sources": available,
            "selected_sources": selected,
            "unavailable_sources": unavailable,
        }

    @classmethod
    def save_source_preferences(cls, selected_sources: List[str]) -> Dict[str, List[str]]:
        available = cls.get_available_sources()
        if not selected_sources:
            raise ValueError("Select at least one metadata source")

        unknown = [source for source in selected_sources if source not in available]
        if unknown:
            raise ValueError(f"Unavailable metadata sources: {', '.join(unknown)}")

        selected_set = set(selected_sources)
        selected = [source for source in available if source in selected_set]
        with get_db() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO user_settings (key, value) VALUES ('metadata_sources', ?)",
                (json.dumps(selected),)
            )
            conn.commit()
        unavailable = [
            source for source in cls.OPTIONAL_METADATA_SOURCES if source not in available
        ]
        return {
            "available_sources": available,
            "selected_sources": selected,
            "unavailable_sources": unavailable,
        }

    @classmethod
    def fetch_online_metadata(
        cls,
        isbn: Optional[str] = None,
        title: Optional[str] = None,
        authors: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Uses Calibre's fetch-ebook-metadata CLI to scrape online metadata by ISBN or title/authors.
        Returns parsed title, authors, publisher, tags, comments/synopsis, and cover if available.
        """
        selected_sources = cls.get_source_preferences()["selected_sources"]
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as cover_file:
            cover_path = cover_file.name

        cmd = [FETCH_METADATA_BIN, "--opf", "--cover", cover_path]
        for source in selected_sources:
            cmd.extend(["--allowed-plugin", source])
        if isbn and isbn.strip():
            cmd.extend(["--isbn", isbn.strip()])
        if title and title.strip():
            cmd.extend(["--title", title.strip()])
        if authors and authors.strip():
            cmd.extend(["--author", authors.strip()])

        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=35, check=False)
            output_xml = result.stdout
            if not output_xml or "<package" not in output_xml:
                return {
                    "title": title,
                    "authors": [authors] if authors else [],
                    "isbn": isbn,
                    "publisher": None,
                    "tags": [],
                    "comments": None,
                    "has_cover": False,
                    "cover_data_base64": None,
                    "matched": False,
                }

            root = ET.fromstring(output_xml)
            metadata_elem = root.find('{http://www.idpf.org/2007/opf}metadata')
            if metadata_elem is None:
                metadata_elem = root.find('metadata')

            parsed_title = None
            parsed_authors = []
            parsed_publisher = None
            parsed_comments = None
            parsed_tags = []
            parsed_isbn = isbn

            if metadata_elem is not None:
                title_elem = metadata_elem.find('{http://purl.org/dc/elements/1.1/}title')
                if title_elem is not None and title_elem.text:
                    parsed_title = title_elem.text

                for creator in metadata_elem.findall('{http://purl.org/dc/elements/1.1/}creator'):
                    if creator.text:
                        parsed_authors.append(creator.text)

                pub_elem = metadata_elem.find('{http://purl.org/dc/elements/1.1/}publisher')
                if pub_elem is not None and pub_elem.text:
                    parsed_publisher = pub_elem.text

                desc_elem = metadata_elem.find('{http://purl.org/dc/elements/1.1/}description')
                if desc_elem is not None and desc_elem.text:
                    parsed_comments = desc_elem.text

                for subject in metadata_elem.findall('{http://purl.org/dc/elements/1.1/}subject'):
                    if subject.text:
                        parsed_tags.append(subject.text)

                for ident in metadata_elem.findall('{http://purl.org/dc/elements/1.1/}identifier'):
                    if ident.attrib.get('{http://www.idpf.org/2007/opf}scheme', '').lower() == 'isbn' or 'isbn' in ident.attrib.values():
                        parsed_isbn = ident.text

            has_cover = Path(cover_path).exists() and Path(cover_path).stat().st_size > 0
            cover_b64 = None
            if has_cover:
                with open(cover_path, "rb") as cf:
                    cover_b64 = base64.b64encode(cf.read()).decode("utf-8")

            return {
                "title": parsed_title or title,
                "authors": parsed_authors if parsed_authors else ([authors] if authors else []),
                "isbn": parsed_isbn or isbn,
                "publisher": parsed_publisher,
                "tags": parsed_tags,
                "comments": parsed_comments,
                "has_cover": has_cover,
                "cover_data_base64": cover_b64,
                "matched": True,
            }
        except Exception as e:
            print(f"Warning in fetch_metadata: {e}")
            return {
                "title": title,
                "authors": [authors] if authors else [],
                "isbn": isbn,
                "publisher": None,
                "tags": [],
                "comments": None,
                "has_cover": False,
                "cover_data_base64": None,
                "matched": False,
            }
        finally:
            if os.path.exists(cover_path):
                try:
                    os.remove(cover_path)
                except OSError:
                    pass



    @classmethod
    def fetch_metadata_cascade(
        cls,
        candidate_isbns: Optional[List[str]] = None,
        pdf_title: Optional[str] = None,
        pdf_author: Optional[str] = None,
        clean_title: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Executes online metadata search in cascade order:
        1. Explicit/candidate ISBNs (up to 3 best candidates)
        2. Book title extracted from PDF (and pdf_author if available)
        3. Clean filename (clean_title)
        If none match or an error occurs, returns matched: False with fallback values.
        """
        # 1. Try candidate ISBNs sequentially
        if candidate_isbns:
            for isbn in candidate_isbns[:3]:
                if not isbn or not str(isbn).strip():
                    continue
                result = cls.fetch_online_metadata(isbn=str(isbn).strip())
                if result.get("matched"):
                    return result

        # 2. Try book title from PDF
        if pdf_title and pdf_title.strip():
            result = cls.fetch_online_metadata(
                title=pdf_title.strip(),
                authors=pdf_author.strip() if pdf_author and pdf_author.strip() else None,
            )
            if result.get("matched"):
                return result

        # 3. Try filename clean title
        if clean_title and clean_title.strip():
            if not pdf_title or clean_title.strip().lower() != pdf_title.strip().lower():
                result = cls.fetch_online_metadata(title=clean_title.strip())
                if result.get("matched"):
                    return result

        # 4. Safe fallback: no match found
        return {
            "title": clean_title or pdf_title,
            "authors": [pdf_author] if pdf_author else [],
            "isbn": candidate_isbns[0] if candidate_isbns else None,
            "publisher": None,
            "tags": [],
            "comments": None,
            "has_cover": False,
            "cover_data_base64": None,
            "matched": False,
        }

metadata_service = MetadataService()
