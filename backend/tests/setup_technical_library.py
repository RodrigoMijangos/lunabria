"""
Verification and ingestion script for 50 public-domain / open-source technical books
with verified real Table of Contents (TOC).
"""

import os
import re
import sys
import time
import zipfile
import subprocess
import urllib.request
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent.parent
DATA_DIR = ROOT_DIR / "data"
DOWNLOAD_DIR = DATA_DIR / "demo_downloads" / "technical"
DEMO_LIBRARY_DIR = DATA_DIR / "demo_library"

# 1. Custom / Open Access
SPECIAL_BOOKS = [
    (
        "https://github.com/progit/progit2/releases/download/2.1.430/progit.epub",
        "Pro_Git_2nd_Edition.epub",
        "Pro Git (2nd Edition)",
        "Scott Chacon & Ben Straub",
    ),
    (
        "https://standardebooks.org/ebooks/charles-babbage/passages-from-the-life-of-a-philosopher/downloads/charles-babbage_passages-from-the-life-of-a-philosopher.epub?source=download",
        "SE_Babbage_Passages.epub",
        "Passages from the Life of a Philosopher",
        "Charles Babbage",
    ),
    (
        "https://standardebooks.org/ebooks/charles-darwin/the-origin-of-species/downloads/charles-darwin_the-origin-of-species.epub?source=download",
        "SE_Darwin_Origin_of_Species.epub",
        "The Origin of Species",
        "Charles Darwin",
    ),
    (
        "https://standardebooks.org/ebooks/charles-darwin/the-voyage-of-the-beagle/downloads/charles-darwin_the-voyage-of-the-beagle.epub?source=download",
        "SE_Darwin_Voyage_Beagle.epub",
        "The Voyage of the Beagle",
        "Charles Darwin",
    ),
]

# 2. Project Gutenberg verified pool of technical/scientific works
GUTENBERG_POOL = [
    # Computing Pioneers & Foundations
    (72159, "Giant Brains; or, Machines That Think", "Edmund Callis Berkeley"),
    (1238, "Sketch of the Analytical Engine", "L. F. Menabrea & Ada Lovelace"),
    (47348, "Babbage's Calculating Engines", "H. P. Babbage"),
    (101, "The Hacker Crackdown: Law and Disorder on the Electronic Frontier", "Bruce Sterling"),
    (3008, "The Jargon File", "Eric S. Raymond"),

    # Physics, Relativity & Quantum
    (5001, "Relativity: The Special and General Theory", "Albert Einstein"),
    (33504, "Opticks", "Isaac Newton"),
    (76404, "Newton's Principia: Mathematical Principles of Natural Philosophy", "Isaac Newton"),
    (63372, "Einstein's Theories of Relativity and Gravitation", "J. Malcolm Bird"),
    (37157, "Science and Hypothesis", "Henri Poincaré"),
    (46036, "The Sidereal Messenger (Sidereus Nuncius)", "Galileo Galilei & Johannes Kepler"),

    # Mathematics, Geometry & Logic
    (33283, "Calculus Made Easy", "Silvanus P. Thompson"),
    (21076, "The First Six Books of the Elements of Euclid", "Euclid & John Casey"),
    (71655, "Mathematical Problems (Paris 1900)", "David Hilbert"),
    (17384, "The Foundations of Geometry", "David Hilbert"),
    (36884, "The Mathematical Analysis of Logic", "George Boole"),
    (69512, "The Calculus of Logic", "George Boole"),
    (28696, "Symbolic Logic", "Lewis Carroll"),
    (78050, "Principia Mathematica (Volume 1)", "Bertrand Russell & Alfred North Whitehead"),
    (25447, "Mysticism and Logic and Other Essays", "Bertrand Russell"),
    (26839, "Mathematical Recreations and Essays", "W. W. Rouse Ball"),
    (16713, "Amusements in Mathematics", "Henry Ernest Dudeney"),
    (201, "Flatland: A Romance of Many Dimensions", "Edwin Abbott Abbott"),
    (37681, "The Teaching of Geometry", "David Eugene Smith"),

    # Astronomy & Cosmology
    (25267, "Astronomy for Amateurs", "Camille Flammarion"),
    (27378, "The Story of the Heavens", "Robert S. Ball"),
    (28247, "A Popular History of Astronomy During the 19th Century", "Agnes M. Clerke"),
    (78112, "Astronomy for Beginners", "Hereward Carrington"),

    # Electricity, Electromagnetism & Wireless
    (39272, "The Inventions, Researches and Writings of Nikola Tesla", "Thomas Commerford Martin & Nikola Tesla"),
    (14474, "The Chemical History of a Candle", "Michael Faraday"),
    (14986, "Experimental Researches in Electricity (Volume 1)", "Michael Faraday"),
    (63207, "The Boy Electrician", "Alfred Powell Morgan"),
    (22766, "Electricity for Boys", "James Slough Zerbe"),

    # Chemistry & Material Science
    (30775, "Elements of Chemistry", "Antoine Laurent Lavoisier"),
    (51326, "The Principles of Chemistry (Volume 1)", "Dmitry Ivanovich Mendeleyev"),
    (20848, "An Elementary Study of Chemistry", "William McPherson & W. E. Henderson"),
    (28739, "Familiar Letters on Chemistry", "Justus von Liebig"),
    (22914, "The Sceptical Chymist", "Robert Boyle"),

    # Mechanics, Engineering & Invention
    (22298, "Practical Mechanics for Boys", "James Slough Zerbe"),
    (23319, "Mechanical Drawing Self-Taught", "Joshua Rose"),
    (27106, "Kinematics of Mechanisms from the Time of Watt", "Eugene S. Ferguson"),
    (28553, "How It Works: Steam, Electricity, Optics, Hydraulics", "Archibald Williams"),
    (6435, "The Principles of Scientific Management", "Frederick Winslow Taylor"),
    (24855, "Concrete Construction: Methods and Costs", "Halbert Gillette & Charles Hill"),
    (25420, "The Early History of the Airplane", "Orville Wright & Wilbur Wright"),
    (5000, "The Notebooks of Leonardo Da Vinci", "Leonardo da Vinci"),

    # Scientific Method, Philosophy of Science & Logic Systems
    (45988, "Novum Organum", "Francis Bacon"),
    (5500, "The Advancement of Learning", "Francis Bacon"),
    (27942, "A System of Logic (Volume 1)", "John Stuart Mill"),
    (26495, "A System of Logic (Volume 2)", "John Stuart Mill"),
]


def count_toc_items(epub_path: Path) -> int:
    """Check whether the EPUB contains a real Table of Contents and count items."""
    if not epub_path.is_file() or not zipfile.is_zipfile(epub_path):
        return 0
    try:
        with zipfile.ZipFile(epub_path, "r") as zf:
            toc_files = [n for n in zf.namelist() if "toc." in n.lower() or "nav." in n.lower()]
            total_items = 0
            for tf in toc_files:
                content = zf.read(tf).decode("utf-8", errors="ignore")
                anchors = len(re.findall(r"<a\s+href=", content))
                navpoints = len(re.findall(r"<navPoint", content))
                items = max(anchors, navpoints)
                if items > total_items:
                    total_items = items
            return total_items
    except Exception:
        return 0


def download_url(url: str, dest_path: Path, min_size: int = 10000, retries: int = 3) -> bool:
    """Download a file with User-Agent and retry logic."""
    if dest_path.is_file() and dest_path.stat().st_size >= min_size:
        if zipfile.is_zipfile(dest_path):
            return True
        dest_path.unlink(missing_ok=True)

    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) LunabriaBot/1.0"}
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=35) as resp:
                content = resp.read()
                if len(content) >= min_size:
                    with open(dest_path, "wb") as f:
                        f.write(content)
                    if zipfile.is_zipfile(dest_path):
                        return True
                    dest_path.unlink(missing_ok=True)
            time.sleep(1)
        except Exception:
            time.sleep(2)
    return False


def main():
    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

    print("==================================================================")
    print(" LUNABRIA TECHNICAL BOOKS INGESTION (EXACTLY 50 CURATED TITLES)")
    print(f" Target Library: {DEMO_LIBRARY_DIR}")
    print(f" Downloads Dir:  {DOWNLOAD_DIR}")
    print("==================================================================\n")

    verified_books = []

    # 1. Special & Modern titles
    print("--> [1/3] Downloading Special & Modern titles...")
    for url, filename, title, author in SPECIAL_BOOKS:
        dest_file = DOWNLOAD_DIR / filename
        print(f"  Downloading: {title} - {author}...", end=" ", flush=True)
        if download_url(url, dest_file, min_size=20000):
            toc_cnt = count_toc_items(dest_file)
            if toc_cnt >= 3:
                size_kb = dest_file.stat().st_size // 1024
                print(f"OK ({size_kb} KB, TOC: {toc_cnt} items)")
                verified_books.append((dest_file, title, author, toc_cnt))
            else:
                print(f"TOC too short ({toc_cnt}), skipped.")
        else:
            print("FAILED")

    # 2. Gutenberg titles
    print(f"\n--> [2/3] Downloading Gutenberg Technical Titles (Targeting total 50)...")
    for gid, title, author in GUTENBERG_POOL:
        if len(verified_books) >= 50:
            break

        safe_title = re.sub(r"[^\w\s-]", "", title).strip().replace(" ", "_")[:35]
        filename = f"PG_{gid}_{safe_title}.epub"
        dest_file = DOWNLOAD_DIR / filename

        print(f"  [{len(verified_books)+1:02d}/50] PG#{gid}: {title} - {author}...", end=" ", flush=True)
        # Try EPUB3 first
        url_epub3 = f"https://www.gutenberg.org/ebooks/{gid}.epub3.images"
        downloaded = download_url(url_epub3, dest_file, min_size=15000)
        if not downloaded:
            url_epub2 = f"https://www.gutenberg.org/ebooks/{gid}.epub.images"
            downloaded = download_url(url_epub2, dest_file, min_size=15000)
        if not downloaded:
            url_noimg = f"https://www.gutenberg.org/ebooks/{gid}.epub.noimages"
            downloaded = download_url(url_noimg, dest_file, min_size=15000)

        if downloaded:
            toc_cnt = count_toc_items(dest_file)
            if toc_cnt >= 3:
                size_kb = dest_file.stat().st_size // 1024
                print(f"OK ({size_kb} KB, TOC: {toc_cnt} items)")
                verified_books.append((dest_file, title, author, toc_cnt))
            else:
                print(f"TOC too short ({toc_cnt} items), skipped.")
                dest_file.unlink(missing_ok=True)
        else:
            print("FAILED")
        time.sleep(0.2)

    print(f"\nTotal verified technical books with real TOC ready for import: {len(verified_books)}")

    if len(verified_books) < 50:
        print(f"Warning: Only {len(verified_books)} verified books available.")

    # 3. Import books into Calibre library using calibredb
    print(f"\n--> [3/3] Importing {len(verified_books)} technical books into Calibre library at {DEMO_LIBRARY_DIR}...")
    calibredb_bin = "calibredb.exe" if sys.platform == "win32" else "calibredb"

    imported_count = 0
    for idx, (epub_path, title, author, toc_cnt) in enumerate(verified_books, start=1):
        print(f"  [{idx:02d}/{len(verified_books)}] Adding: {title} ({author})...", end=" ", flush=True)
        cmd = [
            calibredb_bin,
            "add",
            "--library-path",
            str(DEMO_LIBRARY_DIR),
            str(epub_path),
        ]
        # Avoid stdout decoding crashes on Windows
        res = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        if res.returncode == 0:
            print("ADDED")
            imported_count += 1
        else:
            err = res.stderr.decode("utf-8", errors="ignore").strip()[:80]
            print(f"ERROR: {err}")

    print("\n==================================================================")
    print(f" IMPORT COMPLETE: {imported_count} new technical books successfully added.")
    print("==================================================================")


if __name__ == "__main__":
    main()
