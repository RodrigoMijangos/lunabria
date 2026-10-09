import sys
from pathlib import Path

import pymupdf as fitz  # PyMuPDF

# Add backend directory to sys.path
backend_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_dir))

import app.config as config
from app.services.calibre_service import calibre_service

def create_sample_pdf(filename: str, title: str, author: str, content: list) -> Path:
    pdf_path = config.DATA_DIR / filename
    doc = fitz.open()
    
    for page_num, text_paragraphs in enumerate(content, start=1):
        page = doc.new_page()
        # Add header
        page.insert_text((50, 50), f"{title} - {author}", fontsize=14, color=(0.2, 0.2, 0.5))
        page.insert_text((50, 70), f"Page {page_num}", fontsize=10, color=(0.5, 0.5, 0.5))
        
        y = 120
        for p in text_paragraphs:
            rect = fitz.Rect(50, y, 550, y + 150)
            page.insert_textbox(rect, p, fontsize=11, fontname="helv", color=(0.1, 0.1, 0.1))
            y += 80

    doc.save(str(pdf_path))
    doc.close()
    return pdf_path

def main():
    print(f"Initializing test library at: {config.CALIBRE_LIBRARY_PATH}")
    calibre_service.ensure_library()

    # Create Book 1: Distributed Systems
    b1_path = create_sample_pdf(
        "sistemas_distribuidos.pdf",
        "Distributed Systems Fundamentals",
        "Andrew Tanenbaum",
        [
            [
                "A distributed system is a collection of autonomous computing entities that appears to its users as a single coherent system.",
                "Transparency is a key goal: hiding the fact that processes and resources are physically distributed across multiple computers.",
                "The CAP theorem states that it is impossible for a distributed data store to simultaneously provide Consistency, Availability, and Partition tolerance."
            ],
            [
                "Chapter 2: Consensus Algorithms and Paxos.",
                "In an asynchronous environment with node failures, reaching consensus is the foundation of state machine replication.",
                "Raft is a consensus algorithm designed as a more understandable alternative to Paxos, splitting the problem into leader election and log replication."
            ]
        ]
    )

    # Create Book 2: Clean Architecture
    b2_path = create_sample_pdf(
        "clean_architecture.pdf",
        "Clean Architecture in Practice",
        "Robert C. Martin",
        [
            [
                "The dependency rule is the central principle: source code dependencies must point only inward, toward higher-level policies.",
                "Entities encapsulate Enterprise wide critical business rules and are the least likely to change when something external changes.",
                "The database is a technical detail. The web framework is a technical detail. Do not let details dominate your core architecture."
            ],
            [
                "Chapter 2: Use Cases and Architectural Boundaries.",
                "Use cases orchestrate the flow of data to and from entities, representing the actions an actor can execute in the system.",
                "Separating the UI from business rules enables automated tests without needing an active web browser or server."
            ]
        ]
    )

    layout_doc = fitz.open()
    for page_num in range(1, 20):
        page = layout_doc.new_page()
        page.insert_text((50, 50), "INTRODUCTION" if page_num == 19 else f"Test page {page_num}")
    layout_pdf = config.DATA_DIR / "layout_test_book.pdf"
    layout_doc.save(str(layout_pdf))
    layout_doc.close()

    print("Adding sample books to Calibre...")
    id1 = calibre_service.add_book(str(b1_path), title="Distributed Systems Fundamentals", authors="Andrew Tanenbaum", tags="Systems,University,Computing")
    id2 = calibre_service.add_book(str(b2_path), title="Clean Architecture in Practice", authors="Robert C. Martin", tags="Architecture,Development,Engineering")
    id3 = calibre_service.add_book(str(layout_pdf), title="Layout Test Book", authors="Lunabria Tester")

    print(f"Books added with IDs: {id1}, {id2}, {id3}")
    
    books = calibre_service.list_books()
    print(f"Total books listed in library: {len(books)}")
    for b in books:
        safe_title = str(b.get('title', '')).encode('ascii', 'replace').decode('ascii')
        safe_authors = str(b.get('authors', '')).encode('ascii', 'replace').decode('ascii')
        print(f" - [{b['id']}] {safe_title} by {safe_authors} | Tags: {b['tags']}")

if __name__ == "__main__":
    main()
