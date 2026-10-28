import base64
import json
import os
import re
import subprocess
import tempfile
import xml.etree.ElementTree as ET
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from app.config import FETCH_METADATA_BIN
from app.database import get_db

_DC_NS = "{http://purl.org/dc/elements/1.1/}"
_OPF_NS = "{http://www.idpf.org/2007/opf}"


def _build_unmatched_metadata(
    isbn: Optional[str], title: Optional[str], authors: Optional[str]
) -> Dict[str, Any]:
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


def _find_dc_text(metadata_elem: ET.Element, tag: str) -> Optional[str]:
    elem = metadata_elem.find(f"{_DC_NS}{tag}")
    return elem.text if elem is not None and elem.text else None


def _find_dc_list(metadata_elem: ET.Element, tag: str) -> List[str]:
    return [elem.text for elem in metadata_elem.findall(f"{_DC_NS}{tag}") if elem.text]


def _extract_isbn_from_opf(metadata_elem: ET.Element, fallback_isbn: Optional[str]) -> Optional[str]:
    parsed_isbn = fallback_isbn
    for ident in metadata_elem.findall(f"{_DC_NS}identifier"):
        scheme = ident.attrib.get(f"{_OPF_NS}scheme", "").lower()
        if scheme == "isbn" or "isbn" in ident.attrib.values():
            parsed_isbn = ident.text
    return parsed_isbn


def _parse_opf_metadata_xml(
    output_xml: str, fallback_isbn: Optional[str]
) -> Tuple[Optional[str], List[str], Optional[str], Optional[str], List[str], Optional[str]]:
    root = ET.fromstring(output_xml)
    metadata_elem = root.find(f"{_OPF_NS}metadata")
    if metadata_elem is None:
        metadata_elem = root.find("metadata")
    if metadata_elem is None:
        return None, [], None, None, [], fallback_isbn

    return (
        _find_dc_text(metadata_elem, "title"),
        _find_dc_list(metadata_elem, "creator"),
        _find_dc_text(metadata_elem, "publisher"),
        _find_dc_text(metadata_elem, "description"),
        _find_dc_list(metadata_elem, "subject"),
        _extract_isbn_from_opf(metadata_elem, fallback_isbn),
    )


def _read_cover_base64(cover_path: str) -> Tuple[bool, Optional[str]]:
    path_obj = Path(cover_path)
    if not path_obj.exists() or path_obj.stat().st_size <= 0:
        return False, None
    with open(cover_path, "rb") as cf:
        return True, base64.b64encode(cf.read()).decode("utf-8")


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
    def _build_fetch_cmd(
        cls,
        cover_path: str,
        isbn: Optional[str],
        title: Optional[str],
        authors: Optional[str],
    ) -> List[str]:
        selected_sources = cls.get_source_preferences()["selected_sources"]
        cmd = [FETCH_METADATA_BIN, "--opf", "--cover", cover_path]
        for source in selected_sources:
            cmd.extend(["--allowed-plugin", source])
        for flag, val in (("--isbn", isbn), ("--title", title), ("--author", authors)):
            if val and val.strip():
                cmd.extend([flag, val.strip()])
        return cmd

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
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as cover_file:
            cover_path = cover_file.name

        cmd = cls._build_fetch_cmd(cover_path, isbn, title, authors)

        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=35, check=False)
            output_xml = result.stdout
            if not output_xml or "<package" not in output_xml:
                return _build_unmatched_metadata(isbn, title, authors)

            (
                parsed_title,
                parsed_authors,
                parsed_publisher,
                parsed_comments,
                parsed_tags,
                parsed_isbn,
            ) = _parse_opf_metadata_xml(output_xml, isbn)

            has_cover, cover_b64 = _read_cover_base64(cover_path)

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
            return _build_unmatched_metadata(isbn, title, authors)
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
        if candidate_isbns:
            for isbn in candidate_isbns[:3]:
                if isbn and str(isbn).strip():
                    result = cls.fetch_online_metadata(isbn=str(isbn).strip())
                    if result.get("matched"):
                        return result

        if pdf_title and pdf_title.strip():
            result = cls.fetch_online_metadata(
                title=pdf_title.strip(),
                authors=pdf_author.strip() if pdf_author and pdf_author.strip() else None,
            )
            if result.get("matched"):
                return result

        if clean_title and clean_title.strip():
            if not pdf_title or clean_title.strip().lower() != pdf_title.strip().lower():
                result = cls.fetch_online_metadata(title=clean_title.strip())
                if result.get("matched"):
                    return result

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
