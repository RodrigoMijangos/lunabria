# 📜 Changelog

All notable changes to **Lunabria** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> [!NOTE]
> All changes prior to version **1.0.0** were consolidated into a clean initial production release on `main`. This changelog preserves the full development history and functional evolution from the pre-release development milestones.

---

## [1.0.0] - Official Release

### Added
- Official production release of Lunabria unifying the modern e-reader and Calibre library management system.
- Automated GitHub Actions CI/CD workflows for testing and multi-stage deployment.
- Out-of-the-box support for offline PWA caching, freehand stylus inking, and dual-mode virtual libraries.

---

## Pre-1.0 Releases & Historical Milestones

---

## [0.13.0 - 0.13.3] - Localization, Showcase & CI/CD Workflows

### Added
- Complete GitHub Actions CI/CD automation workflows targeting `develop` and `staging` branches.
- Freehand stylus drawing and hardware palm rejection showcase screenshots in documentation.
- Public domain demo book library (featuring classics like *Frankenstein* from Project Gutenberg) with showcase fixtures.
- Copyright and content policy documentation.

---

## [0.12.0] - Lunabria Rebranding & Open Source Foundations

### Added
- Environment configuration template (`.env.example`) with documented environment variables.
- Comprehensive English `README.md` covering architecture, development setup, systemd deployment, and reverse proxy configuration.

### Changed
- Officially rebranded project to **Lunabria** and licensed under the **GNU Affero General Public License v3.0 (AGPLv3)**.
- Decoupled hardcoded local paths into portable relative paths and configurable environment variables.

---

## [0.11.0 - 0.11.2] - Catalog Pagination & Recents Deduplication

### Added
- Numbered pagination controls for large Calibre book catalogs.
- Direct catalog page selector to jump instantly to any catalog page.

### Fixed
- Prevented duplicate entries from appearing in the "Continue Reading" recent books row.

---

## [0.10.0] - On-Demand EPUB to PDF Conversion

### Added
- Transparent, on-demand conversion of EPUB files to PDF format upon opening, caching the rendered PDF without altering original Calibre library files.

---

## [0.9.0 - 0.9.1] - Virtual Library Management & Carousel Polish

### Added
- Support for deleting virtual libraries directly from the UI.

### Fixed
- Constrained the recent books carousel to a single responsive, horizontally-scrollable row across all viewport sizes.

---

## [0.8.0 - 0.8.1] - Metadata Operations & Selection Guard

### Added
- Enhanced book catalog controls and metadata editing capabilities.

### Fixed
- Prevented accidental text selection triggers when clicking or dragging across blank areas of a page.
- Fixed layout jitter and card alignment in the recents list.

---

## [0.6.1 - 0.6.22] - Reader Refinements, Inking Polish & Navigation

### Added
- Five-page quick scrubber navigation bar for swift document traversal.
- Direct cover-based book editing from catalog and recents cards.
- Quick highlight color palette for rapid annotations.
- Full layout pre-caching in IndexedDB for completely offline books.
- SVG icons replacing emoji placeholders across drawing and reader toolbars.
- Keyboard shortcuts tooltip shown on hover over drawing controls.
- Configurable autosave interval settings directly accessible from the reader header.
- Highlighting visibility inside the text selection magnifier loupe.
- Expanded catalog view displaying 20 books per page and 10 recent books.

### Changed
- Improved dashboard catalog layout and enhanced search query parsing.
- Refined digital pencil status indicator alignment and clarity.

### Fixed
- Resolved PDF byte-range handling and streaming media delivery.
- Prevented duplicate page layout requests during rapid navigation.
- Stabilized reader zoom and pan controls when holding the Spacebar.
- Allowed opening and interacting with existing text highlights while in drawing mode.
- Ensured stylus annotations maintain correct coordinate alignment regardless of canvas zoom.
- Cleared stale text selection overlays when switching pages or clicking away.
- Fixed empty-page click triggers causing phantom selection boxes.

---

## [0.6.0] - Modular Architecture Granularization

### Refactored
- Decomposed core monoliths into granular, single-responsibility files across the frontend and backend architectures.

---

## [0.5.0 - 0.5.1] - MVVM Architecture & Stylus Accessibility

### Added
- Dedicated stylus accessibility settings, hardware palm rejection toggles, and gesture sensitivity controls.

### Fixed
- Resolved stylus drawing gesture lock conflicts during touch scrolling.

### Refactored
- Restructured frontend architecture into Model-View-ViewModel (MVVM / MVP) patterns, enforcing Single Responsibility Principle (SRP) across reader and catalog controllers.

---

## [0.4.0 - 0.4.6] - Freehand Stylus Drawing & Annotations View

### Added
- Freehand drawing canvas layer with smart pencil, graphic tablet support, pressure sensitivity, and automatic input device detection.
- Excalidraw-inspired floating drawing palette with Bézier curve stroke smoothing, double-tap tool toggles, and pan navigation.
- Dedicated full-screen Annotations view mode featuring real-time search, color filtering, inline note editing, and one-click page navigation.
- Unified Edge-style current page / total page jump box in the reader header with real-time sync.
- Dual-option "Add Books" modal supporting drag-and-drop file uploads and filesystem browsing.
- Double-click text highlight annotation selector and contextual floating toolbar.

### Changed
- Refined highlight blending mode with 0.35 opacity and isolated layer composition to preserve text legibility underneath.

---

## [0.3.0 - 0.3.9] - HTTP/2 ASGI Server & Reading Modes

### Added
- Dual-page spread view and continuous vertical flow reading modes.
- Continuous line-based selection and typographical text snapping matching Microsoft Edge reader ergonomics without inter-word gaps.
- 10-page predictive layout buffering with offline IndexedDB storage and automatic reading progress persistence.
- Upgraded ASGI backend server to Hypercorn with native HTTP/2 (ALPN h2) and dual-port SSL support.
- Seamless continuous-mode page transitions featuring dashed dividers and page number badges.
- Configurable autosave intervals and guaranteed sync on book close, eliminating unnecessary network round-trips.
- Hot-swapping offline PDF blobs without requiring a full browser reload.
- Direct page jump input with strict numeric boundary validation.
- Live terminal access logs in Hypercorn alongside client-side diagnostic logging.

### Fixed
- Document zoom re-rendering synchronization across single, dual, and continuous view modes.
- Eliminated selection flickering and stabilized navigation button proportions.

---

## [0.2.0 - 0.2.9] - Virtual Libraries, Metadata Fetcher & 3D UI

### Added
- Dual-mode Virtual Libraries: Calibre regex query syntax and manual checkbox-based curated collections without duplicating disk storage.
- Moon+ Reader service integration with customizable highlight color palette and Markdown (`.md`) export for Obsidian and Logseq.
- Online metadata fetcher integration with Calibre CLI (`fetch-ebook-metadata`) for automated ISBN scraping and book cover retrieval.
- Dedicated frontend views for Home, Reader, Assisted Upload, and Calibre Metadata Editor.
- Interactive highlight contextual popup for instant color changes, note additions, and deletions.
- Precise word-level text layer and line-merging highlights.
- Desktop-only book deletion capability from the Calibre library with synchronized application state cleanup.
- Modernized UI design featuring 3D paperback book cards, collections filter chips, and editorial typography.
- Production readiness: automated test suite, Caddy reverse proxy HTTP/2 configuration, systemd service unit, and setup documentation.

### Fixed
- Locked PDF canvas aspect ratios to prevent flexbox vertical squashing across variable window sizes.
- Synchronized embedded PDF font loading with `document.fonts.ready` and restored jsdelivr CMap assets.
- Automatically de-hyphenated line-broken words and merged tracked title characters.
- Fixed `calibredb set_metadata` invocation with explicit `identifiers:isbn` format and propagated ISBN throughout API models.
- Resolved PWA service worker stale cache bugs with cache invalidation strategies and asset version queries.
- Eliminated text selection ghosting during rapid highlight modifications.

---

## [0.1.0] - Offline PWA Core Shell

### Added
- Progressive Web App (PWA) shell with service worker caching, IndexedDB offline storage, and web application manifest.
- Offline-first capabilities for opening and reading cached book files without active network access.

---

## [alpha] - Foundations & Core Services

### Added
- Initial project structure and configuration.
- SQLite database schema initialization for user states, reading recents, highlights, and annotations.
- Calibre CLI service layer and direct `metadata.db` SQLite connector.
- FastAPI REST API routers for catalog browsing, reading progress tracking, and media streaming.
