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
                    "cover_data_base64": None
                }

            root = ET.fromstring(output_xml)
            metadata_elem = root.find('{http://www.idpf.org/2007/opf}metadata') or root.find('metadata')

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
                "cover_data_base64": cover_b64
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
                "cover_data_base64": None
            }
        finally:
            if os.path.exists(cover_path):
                try:
                    os.remove(cover_path)
                except OSError:
                    pass

metadata_service = MetadataService()
