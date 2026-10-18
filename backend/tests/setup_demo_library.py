"""
Script to curate, download, and build a 50-book demo Calibre library for Lunabria.
Contains:
- 25 Standard Ebooks titles (English, museum-quality covers, clean CSS/typography)
- 25 Project Gutenberg titles (Verified Spanish literary classics)
"""

import os
import sys
import time
import shutil
import zipfile
import subprocess
import urllib.request
from pathlib import Path

# Paths
ROOT_DIR = Path(__file__).resolve().parent.parent.parent
DATA_DIR = ROOT_DIR / "data"
DOWNLOAD_DIR = DATA_DIR / "demo_downloads"
DEMO_LIBRARY_DIR = DATA_DIR / "demo_library"

# Standard Ebooks (25 curated titles)
STANDARD_EBOOKS = [
    ("f-scott-fitzgerald", "the-great-gatsby", "The Great Gatsby", "F. Scott Fitzgerald"),
    ("mary-shelley", "frankenstein", "Frankenstein", "Mary Shelley"),
    ("bram-stoker", "dracula", "Dracula", "Bram Stoker"),
    ("oscar-wilde", "the-picture-of-dorian-gray", "The Picture of Dorian Gray", "Oscar Wilde"),
    ("h-g-wells", "the-time-machine", "The Time Machine", "H. G. Wells"),
    ("h-g-wells", "the-war-of-the-worlds", "The War of the Worlds", "H. G. Wells"),
    ("h-g-wells", "the-invisible-man", "The Invisible Man", "H. G. Wells"),
    ("robert-louis-stevenson", "the-strange-case-of-dr-jekyll-and-mr-hyde", "The Strange Case of Dr. Jekyll and Mr. Hyde", "Robert Louis Stevenson"),
    ("arthur-conan-doyle", "the-adventures-of-sherlock-holmes", "The Adventures of Sherlock Holmes", "Arthur Conan Doyle"),
    ("jane-austen", "pride-and-prejudice", "Pride and Prejudice", "Jane Austen"),
    ("charles-dickens", "a-tale-of-two-cities", "A Tale of Two Cities", "Charles Dickens"),
    ("charlotte-bronte", "jane-eyre", "Jane Eyre", "Charlotte Brontë"),
    ("emily-bronte", "wuthering-heights", "Wuthering Heights", "Emily Brontë"),
    ("jack-london", "the-call-of-the-wild", "The Call of the Wild", "Jack London"),
    ("joseph-conrad", "heart-of-darkness", "Heart of Darkness", "Joseph Conrad"),
    ("oscar-wilde", "the-importance-of-being-earnest", "The Importance of Being Earnest", "Oscar Wilde"),
    ("james-joyce", "dubliners", "Dubliners", "James Joyce"),
    ("henry-david-thoreau", "walden", "Walden", "Henry David Thoreau"),
    ("kahlil-gibran", "the-prophet", "The Prophet", "Kahlil Gibran"),
    ("j-m-barrie", "peter-and-wendy", "Peter and Wendy", "J. M. Barrie"),
    ("herman-melville", "moby-dick", "Moby Dick", "Herman Melville"),
    ("virginia-woolf", "mrs-dalloway", "Mrs Dalloway", "Virginia Woolf"),
    ("agatha-christie", "the-mysterious-affair-at-styles", "The Mysterious Affair at Styles", "Agatha Christie"),
    ("mark-twain", "the-adventures-of-tom-sawyer", "The Adventures of Tom Sawyer", "Mark Twain"),
    ("rudyard-kipling", "the-jungle-book", "The Jungle Book", "Rudyard Kipling"),
]

# Project Gutenberg Spanish Classics (25 verified classics)
GUTENBERG_SPANISH = [
    (2000, "Don Quijote de la Mancha", "Miguel de Cervantes Saavedra"),
    (17073, "La Regenta", "Leopoldo Alas Clarín"),
    (17013, "Fortunata y Jacinta", "Benito Pérez Galdós"),
    (15725, "Doña Perfecta", "Benito Pérez Galdós"),
    (17340, "Marianela", "Benito Pérez Galdós"),
    (49836, "Niebla", "Miguel de Unamuno"),
    (78052, "Andanzas y visiones españolas", "Miguel de Unamuno"),
    (55514, "Cuentos de amor", "Emilia Pardo Bazán"),
    (52597, "Insolación y Morriña", "Emilia Pardo Bazán"),
    (60464, "El árbol de la ciencia", "Pío Baroja"),
    (13507, "Cuentos de Amor de Locura y de Muerte", "Horacio Quiroga"),
    (9980, "Platero y Yo", "Juan Ramón Jiménez"),
    (320, "La vida de Lazarillo de Tormes", "Anónimo"),
    (1619, "La Celestina", "Fernando de Rojas"),
    (5201, "Don Juan Tenorio", "José Zorrilla"),
    (60198, "Fuente Ovejuna", "Lope de Vega"),
    (16625, "Libro de Buen Amor", "Juan Ruiz"),
    (24536, "Los cuatro jinetes del apocalipsis", "Vicente Blasco Ibáñez"),
    (25640, "Los argonautas", "Vicente Blasco Ibáñez"),
    (52894, "Azul...", "Rubén Darío"),
    (28106, "Los intereses creados", "Jacinto Benavente"),
    (47287, "El libro de las mil noches y una noche", "Anónimo"),
    (57303, "La Divina Comedia", "Dante Alighieri"),
    (58221, "La Odisea", "Homero"),
    (57654, "La Ilíada", "Homero"),
]


def download_file(url: str, dest_path: Path, retries: int = 3) -> bool:
    """Download a file with User-Agent and retry logic."""
    if dest_path.is_file() and dest_path.stat().st_size > 10000:
        if zipfile.is_zipfile(dest_path):
            return True
        else:
            dest_path.unlink()

    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) LunabriaBot/1.0"}
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=30) as resp:
                content = resp.read()
                if len(content) > 5000:
                    with open(dest_path, "wb") as f:
                        f.write(content)
                    if zipfile.is_zipfile(dest_path):
                        return True
                    else:
                        dest_path.unlink(missing_ok=True)
            time.sleep(1)
        except Exception:
            time.sleep(2)
    return False


def main():
    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

    # Re-create clean demo library directory
    if DEMO_LIBRARY_DIR.exists():
        shutil.rmtree(DEMO_LIBRARY_DIR, ignore_errors=True)
    DEMO_LIBRARY_DIR.mkdir(parents=True, exist_ok=True)

    print("==================================================================")
    print(" LUNABRIA DEMO LIBRARY BUILDER (50 CURATED BOOKS)")
    print(f" Target Library: {DEMO_LIBRARY_DIR}")
    print(f" Temp Downloads: {DOWNLOAD_DIR}")
    print("==================================================================\n")

    downloaded_files = []

    # 1. Download Standard Ebooks (25 books)
    print("--> [1/3] Downloading Standard Ebooks (25 high-quality English editions)...")
    for idx, (author_slug, title_slug, title, author) in enumerate(STANDARD_EBOOKS, start=1):
        filename = f"SE_{author_slug}_{title_slug}.epub"
        dest_file = DOWNLOAD_DIR / filename
        url = f"https://standardebooks.org/ebooks/{author_slug}/{title_slug}/downloads/{author_slug}_{title_slug}.epub?source=download"

        print(f"  [{idx:02d}/25] {title} - {author} ...", end=" ", flush=True)
        if download_file(url, dest_file):
            size_kb = dest_file.stat().st_size // 1024
            print(f"OK ({size_kb} KB)")
            downloaded_files.append((dest_file, title, author))
        else:
            print("FAILED")
        time.sleep(0.2)

    print()
    # 2. Download Gutenberg Spanish Classics (25 books)
    print("--> [2/3] Downloading Project Gutenberg (25 Spanish classics)...")
    for idx, (gid, title, author) in enumerate(GUTENBERG_SPANISH, start=1):
        filename = f"PG_{gid}_{title.replace(' ', '_').replace('.', '')}.epub"
        dest_file = DOWNLOAD_DIR / filename
        url = f"https://www.gutenberg.org/ebooks/{gid}.epub3.images"

        print(f"  [{idx:02d}/25] {title} - {author} ...", end=" ", flush=True)
        if download_file(url, dest_file):
            size_kb = dest_file.stat().st_size // 1024
            print(f"OK ({size_kb} KB)")
            downloaded_files.append((dest_file, title, author))
        else:
            fallback_url = f"https://www.gutenberg.org/ebooks/{gid}.epub.images"
            if download_file(fallback_url, dest_file):
                size_kb = dest_file.stat().st_size // 1024
                print(f"OK ({size_kb} KB)")
                downloaded_files.append((dest_file, title, author))
            else:
                fallback_no_images = f"https://www.gutenberg.org/ebooks/{gid}.epub.noimages"
                if download_file(fallback_no_images, dest_file):
                    size_kb = dest_file.stat().st_size // 1024
                    print(f"OK noimages ({size_kb} KB)")
                    downloaded_files.append((dest_file, title, author))
                else:
                    print("FAILED")
        time.sleep(0.2)

    print(f"\nSuccessfully verified/downloaded {len(downloaded_files)} books.\n")

    # 3. Import books into Calibre library using calibredb
    print(f"--> [3/3] Importing books into Calibre library at {DEMO_LIBRARY_DIR}...")
    calibredb_bin = "calibredb.exe" if sys.platform == "win32" else "calibredb"

    for idx, (epub_path, title, author) in enumerate(downloaded_files, start=1):
        print(f"  [{idx:02d}/{len(downloaded_files)}] Adding: {title}...", end=" ", flush=True)
        cmd = [
            calibredb_bin,
            "add",
            "--library-path",
            str(DEMO_LIBRARY_DIR),
            str(epub_path),
        ]
        res = subprocess.run(cmd, capture_output=True, text=True)
        if res.returncode == 0:
            print("ADDED")
        else:
            print(f"ERROR ({res.stderr.strip()[:80]})")

    print("\n==================================================================")
    print(" LIBRARY BUILD COMPLETE")
    print(" Listing Calibre library summary:")
    list_cmd = [
        calibredb_bin,
        "list",
        "--library-path",
        str(DEMO_LIBRARY_DIR),
        "--fields",
        "id,title,authors",
    ]
    summary_res = subprocess.run(list_cmd, capture_output=True, text=True)
    print(summary_res.stdout)
    print("==================================================================")


if __name__ == "__main__":
    main()
