# 🌙 Lunabria (PWA Everywhere)

A modern reading and library management web application connected to Calibre, featuring **HTTP/2** streaming and an ergonomic reading experience inspired by modern e-readers. Accessible from any modern browser and device (desktop, tablet, mobile) as an **offline-capable Progressive Web App (PWA)**.

> [!IMPORTANT]
> **Copyright & Content Policy**: Lunabria is an open-source, self-hosted reading platform and personal library manager. All book titles, covers, and excerpts shown in the screenshots, demo fixtures, and documentation are strictly works in the **public domain** (courtesy of Project Gutenberg and open archives). Lunabria does **not** host, distribute, or bundle copyrighted books. Users must not share or distribute copyrighted materials without appropriate authorization, and are solely responsible for ensuring that all files in their personal Calibre libraries comply with applicable intellectual property laws.

---

## 📸 Screenshots & UI Showcase

### Library Control Center & Continue Reading
Adaptive paginated book grid, collection filters, and live reading progress indicators.

![Library Catalog & Continue Reading Carousel](docs/screenshots/01_library_catalog.png)

---

### PDF Reader & Real-Time Highlights
Ergonomic reading interface with full text layer selection, page scrubber, and digital stylus support.

![PDF Reader Interface](docs/screenshots/04_pdf_reader.png)

---

### Customizable Highlight Palette & Semantic Labels
Personalized color palette with custom semantic categories (*Key Idea*, *Definition*, *Reference*, *Question / Important*, *Quote*).

![Highlight Colors Customization Modal](docs/screenshots/02_highlight_palette_modal.png)

---

### Calibre Metadata Editor & Online Assistant
In-app metadata editor connected to Calibre CLI with ISBN auto-fetch, tag editor, and cover artwork preview.

![Calibre Metadata Editor](docs/screenshots/03_metadata_editor_modal.png)

---

### Slide-Out Annotations Drawer & Multi-Format Export
Interactive lateral notes drawer with real-time color filtering and deterministic export to Markdown, JSON, JSONL, YAML, and TOML.

![Lateral Annotations Drawer](docs/screenshots/05_reader_annotations_drawer.png)

---

### Full-Screen Annotations Notebook
Dedicated editorial study view organizing quotes, personal notes, and chapter reflections.

![Annotations Notebook](docs/screenshots/06_annotations_notebook.png)

---

### Freehand Stylus Drawing & Smart Pencil Toolbar
Integrated drawing canvas with pressure sensitivity, customizable pen colors, highlighter mode, and instant sync.

![Freehand Stylus Drawing Mode](docs/screenshots/07_stylus_drawing_canvas.png)

---

### Stylus Hardware & Palm Rejection Settings
Tailored stylus interactions with strict palm rejection, double-tap pen/highlighter toggle, and custom pressure dynamics.

![Stylus & Palm Rejection Settings](docs/screenshots/08_stylus_palm_rejection_settings.png)

---

## 🌟 Key Features

### 1. Core System Views

1. **Home (Library Control Center):**
   - **"Continue Reading" Carousel:** Displays the **10 most recently read books** with live progress, reading percentage, and current page. One click resumes reading right where you left off.
   - **Adaptive Paginated Catalog:** Dynamic grid view that adapts to your screen width, supporting customizable page sizes, responsive column layouts, and default pagination across the entire library (including "Last opened"). Users can browse and navigate locally cached books without re-downloading them.
   - **Virtual Library Switcher:** Filter your book collection on the fly without duplicating files on disk.
   - **Batch Book Selection:** Pick multiple books from search results or the catalog to group them into manual virtual collections.
   - **Real-Time Search:** Instant filtering across titles, authors, and tags.
   - **Local Cover Caching & Offline Fallback:** Book covers viewed in the library are cached locally for fast retrieval and offline reuse; books without an embedded or reachable cover fall back seamlessly to an offline vector cover.
   - **Auto-Reconnection Detection:** Automatically detects when a lost server connection is restored, refreshing the catalog and synchronizing queued reading data and annotations.
   - **Ergonomic Reading Themes:** **Sepia** (warm editorial daylight), **AMOLED Black** (pure `#000000` for OLED displays), and **Dark** (slate).
   - **Modern Brand Identity & PWA Installation:** Open-book lunar brand insignia, dynamic SVG favicon, and maskable touch icons for mobile home-screen installation with theme-adaptive browser header colors.

2. **Reader Experience:**
   - **Contextual Floating Menu:** Select text to reveal quick action controls: highlight color palette, notes, and clipboard copy.
   - **Customizable Highlight Palette:** Freely configure your own colors and semantic labels (e.g., *Key Idea*, *Definition*, *Question*, *Quote*).
   - **Freehand Stylus & Digital Inking:** Draw notes, margin diagrams, underlines, and freehand highlights directly on book pages with pressure sensitivity, palm rejection, and dedicated stylus hardware settings.
   - **Slide-out Lateral Drawer:** Chronologically lists all highlights, annotations, and notes with interactive color filtering.
   - **Multi-Format Deterministic Export:** Export annotations, highlights, and notes directly to **Hierarchical Markdown**, **Markdown grouped by color/page**, **JSON**, **JSONL**, **YAML**, and **TOML**, driven by PDF table of contents hierarchy and high-fidelity text reconstruction ready for Obsidian, Logseq, or automated knowledge workflows.
   - **Dedicated Mobile & Touch Reader:** Tailored mobile reading interface featuring a compact single-row topbar, a collapsible Floating Action Button (FAB) for drawing and quick color selection, long-press text selection with a circular magnifying loupe, and a one-tap page stroke wipe button to clear the active page.
   - **Precision Zoom & Ergonomic Navigation:** Dedicated **Fit-to-Width** (`W`), **Fit-to-Page** (`H`), and **Actual Size (1:1 / 100%)** (`Ctrl+0`) modes. Smooth **Ctrl + Wheel** and continuous trackpad/touchscreen pinch-to-zoom with real-time GPU preview and dynamic velocity scaling across an expanded range from **25% to 500%**. Viewport and cursor focal-point tracking prevents scroll jumping, with flicker-free off-DOM double-buffering.
   - **Universal Text & Margin Selection:** Initiate selections smoothly from page margins, paragraph padding, or between lines with sub-glyph precision, edge-to-edge word expansion on double-click drag, and smart collision-avoiding floating HUD placement.
   - **Fault-Tolerant Rendering:** If a PDF page canvas render encounters an issue, a recoverable error card with an inline retry button displays instead of an unrecoverable blank page.
   - **Offline Reading (PWA):** Cached books appear in the library immediately on startup without network timeouts. Download books, their cover art, and pre-buffered page layouts into IndexedDB; an offline banner communicates connectivity status and the number of books available offline.
   - **Persistent Outbox Annotation Sync:** Saved annotations and highlight colors remain available offline. Highlights, notes, freehand drawings, and reading progress created without a connection are queued locally in an outbox and synchronize automatically when connectivity returns.
   - **In-App Update Notification:** An in-app banner alerts readers whenever an updated version of the application is available for one-click reload.
   - **On-Demand Format Conversion:** If a book has no PDF, an available format supported by Calibre (beyond EPUB) is automatically converted to PDF when opened and cached without altering the original library.

3. **Add New Books:**
   - Drag-and-drop or select one or multiple PDF files.
   - **Verification Wizard:** Optional ISBN lookup before importing to automatically retrieve official title, authors, tags, and summary via Calibre, or direct import without metadata scraping.

4. **Calibre Metadata Editor:**
   - Modify title, authors, tags, series, series index, and synopsis.
   - **"Download Metadata" Assistant:** Runs Calibre CLI (`fetch-ebook-metadata`) to scrape summaries and high-resolution book covers.
   - Configure metadata sources (Google Books, Open Library, Amazon, Goodreads).
   - Commits changes directly to Calibre's `metadata.db` via `calibredb set_metadata`.

---

## 📚 Virtual Libraries (2 Creation Modes)

- **Query / Regex Mode:** Define Calibre-native search syntax (e.g., `tags:"=University"` or regular expressions).
- **Manual Mode:** Check off specific books from the catalog or search queries to create curated reading lists.
- **Zero Duplication:** No physical files are moved or duplicated.

---

## ⚠️ Important Considerations & Calibre Prerequisites

Lunabria interfaces directly with your Calibre library and CLI utilities. Keep the following external requirements and Calibre behavioral details in mind:

> [!WARNING]
> **Calibre Desktop Concurrency & Database Locks**:
> Calibre maintains an exclusive lock on `metadata.db` while running. If the Calibre desktop application (`calibre.exe`) or `calibre-server` is open, write operations from Lunabria (such as uploading new books or saving metadata updates via `calibredb`) will return a conflict error.
> **Recommendation:** Keep desktop Calibre closed when uploading books or modifying metadata in Lunabria. Browsing, streaming, and reading existing books remain fully functional regardless.

> [!NOTE]
> **Library Path Length on Windows (< 75 characters)**:
> Calibre's Windows backend enforces a legacy constraint requiring library paths to be shorter than 75 characters. Avoid placing your library inside deep nested user folders (e.g., `AppData\Local\...` or nested OneDrive folders). Keep library paths compact (e.g., `C:\Calibre Library` or relative project paths like `./data/calibre_library`).

> [!TIP]
> **Cloud Storage & Network Drives**:
> Following official Calibre project guidance, avoid hosting your active `CALIBRE_LIBRARY_PATH` directly inside real-time cloud-sync folders (Google Drive, OneDrive, Dropbox) or unbuffered SMB/NFS network shares, as concurrent sync activity can trigger SQLite locking anomalies or database corruption.

> [!IMPORTANT]
> **Calibre CLI in System PATH**:
> Lunabria uses Calibre CLI binaries (`calibredb`, `ebook-convert`, `fetch-ebook-metadata`) for library indexing, format conversion, and online metadata retrieval. Make sure Calibre is installed on your host system and accessible in your `PATH`, or specify their custom binary paths in your `.env` configuration file.

---

## 🔍 Known Issues & Typography Limitations

For a detailed technical overview of book compatibility edge cases—such as scanned books without OCR, custom font ligatures, code blocks, or temporary layout desyncs (and their workarounds)—please consult:

👉 **[Docs: Known Issues & Typography Limitations](docs/known_issues.md)**

---

## 🖥️ Run on a Windows desktop

1. Install Python 3.11 or later and Calibre for Windows. Make sure `calibredb`, `ebook-convert`, and `fetch-ebook-metadata` are available in `PATH`.
2. Create a `.env` file in the repository root and point it to your Calibre library. For a local-only desktop instance, use:

   ```dotenv
   CALIBRE_LIBRARY_PATH=C:\Calibre Library
   APP_DATA_DIR=.\data
   HOST=127.0.0.1
   PORT=8000
   ```

   Keep the Calibre library path under 75 characters and outside cloud-synced or network folders. If you omit `CALIBRE_LIBRARY_PATH`, Lunabria uses `data/calibre_library`. If Calibre's command-line tools are not in `PATH`, set `CALIBREDB_BIN`, `EBOOK_CONVERT_BIN`, and `FETCH_METADATA_BIN` to their executable paths in `.env`.
3. In PowerShell, from the repository root, install the runtime packages and start Lunabria:

   ```powershell
   Set-Location backend
   py -3 -m venv .venv
   .\.venv\Scripts\python.exe -m pip install -r requirements.txt
   .\.venv\Scripts\python.exe run.py
   ```

4. Open `http://localhost:8000` in Edge, Chrome, or another modern browser. You can install Lunabria as a desktop app from the browser's install-app menu. Leave the terminal running while using the app; press `Ctrl+C` to stop it.

Close the Calibre desktop application before uploading books or saving metadata, since Calibre locks its library database while open.

---

## 🐧 Server Deployment (Linux / systemd / Caddy)

1. **Install Calibre and system dependencies:**
   ```bash
   sudo apt update
   sudo apt install -y calibre python3-venv python3-pip caddy
   ```

2. **Prepare the project environment:**
   ```bash
   cd backend
   python3 -m venv .venv
   ./.venv/bin/pip install -r requirements.txt
   cd ..
   ```

3. **Configure environment variables:**
   ```bash
   cp .env.example .env
   ```
   Key environment variables:
   ```bash
   CALIBRE_LIBRARY_PATH=./data/calibre_library
   APP_DATA_DIR=./data
   HOST=0.0.0.0
   PORT=8000
   ```

4. **Enable the systemd service:**
   Run the automated installer (detects the current directory and user):
   ```bash
   bash systemd/install.sh
   ```
   If the repository is on `/mnt/c` and its `.venv` is a Windows environment, create a Linux virtual environment and pass it with `LUNABRIA_VENV`:
   ```bash
   python3 -m venv "$HOME/.venvs/lunabria"
   "$HOME/.venvs/lunabria/bin/pip" install -r backend/requirements.txt
   LUNABRIA_VENV="$HOME/.venvs/lunabria" bash systemd/install.sh
   ```
   *Or configure manually by copying `systemd/lunabria.service` to `/etc/systemd/system/` with your absolute paths.*


5. **Start Caddy Reverse Proxy (with HTTP/2 support):**
   ```bash
   sudo cp caddy/Caddyfile /etc/caddy/Caddyfile
   sudo systemctl restart caddy
   ```

Once running, access the application locally at `http://localhost:8000` or through Caddy at `https://localhost:8443` (or `http://<SERVER-IP>:8085`).

---

## 📜 Changelog

Release history and notable changes are documented in [CHANGELOG.md](CHANGELOG.md).

---

## 📄 License

This project is licensed under the **GNU Affero General Public License v3.0 (GNU AGPL v3)**. See the [LICENSE](LICENSE) file for the full license text.
