# 📜 Changelog

All notable changes to **Lunabria** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> [!NOTE]
> All changes prior to version **1.0.0** were consolidated into a clean initial production release on `main`. This changelog preserves the full development history and functional evolution from the pre-release development milestones.

---

## [Unreleased]

## [1.3.0] - 2026-10-05

### Added
- Pressing E while using the eraser returns to the previously selected drawing tool.

### Changed
- Drawing tool labels and tooltips are now displayed in English.

### Removed
- Opening books on mobile no longer automatically switches to fullscreen.

### Fixed
- Highlight category and color changes now refresh annotations without reloading the page.
- Text highlights render correctly while drawing.
- Clearing the canvas removes drawings from the currently visible page.
- Double-clicking with the highlighter selected switches back to the pen on desktop.
- Spacebar panning in drawing mode works with toolbar focus and no longer triggers browser auto-scroll when held.
- Drawing mode returns to the pen after leaving the reader or opening another book.

---

## [1.2.0] - 2026-10-04

### Added
- Multi-format deterministic annotations export (Hierarchical Markdown, Markdown by color/page, JSON, JSONL, YAML, and TOML) driven by PDF table of contents hierarchy and high-fidelity text reconstruction.

### Changed
- Smooth, continuous pinch-to-zoom for trackpads and touchscreens with real-time GPU preview during gestures that scales dynamically with finger velocity and commits crisp vector rendering on release.

---

## [1.1.1] - 2026-10-04

### Fixed
- Prevented long-press text selection in the mobile reader from resetting the viewport to the first page.
- Restored touch scrolling and gestures on the mobile home screen catalog when the reader is closed.
- Prevented mobile page scrolling and cancelled gestures while dragging the text selection magnifying loupe.
- Supported custom host binding addresses and command-line options so local network devices can access the server.

---

## [1.1.0] - 2026-10-03

### Added
- Dedicated mobile reader experience tailored for touchscreens and small displays.
- Collapsible floating action button for drawing tools with an active tool indicator and quick color palette.
- Freehand touch drawing support for finger and stylus annotations on mobile devices.
- Long-press text selection with a circular magnifying loupe and contextual color picker.
- Offline library catalog allowing fully cached books to be browsed and opened without an internet connection.
- One-tap page stroke wipe button in the mobile toolbar to clear annotations on the active page.
- Progressive Web App (PWA) enhancements including install prompts and maskable application icons.
- Automatic fullscreen reading mode when opening a book on mobile devices.

### Changed
- Streamlined mobile reader topbar into a compact single row with pinch-to-zoom gestures.
- Enabled freehand navigation by default while keeping drawing and highlight tools accessible.

---

## [1.0.11] - 2026-10-03

### Changed
- Refined selection and annotation toolbars with consistent icon sizing, theme colors, and responsive placement.

### Fixed
- Fixed an issue where selecting text across multiple lines rendered an unwanted highlight block at the start of the line.
- Improved single-click and double-click word selection accuracy so selections snap to the intended word instead of jumping to the line start.
- Sized annotation toolbars dynamically based on actual content to prevent clipping.

---

## [1.0.10] - Selection Loupe Drag Activation, Fast Ctrl+Wheel Zoom & 3-Phase Subpixel Text Selection

### Fixed
- **Text Selection Micro-Offsets & Cumulative Font Drift**: Resolved layout micro-desfases during single-word and phrase text selection in the PDF reader by structuring layout rendering into 3 distinct phases:
  - *Phase 1 (Word & Content Layouts)*: Renders individual `.precise-word` elements positioned at exact relative subpixel offsets with dedicated per-word `scaleX` horizontal transforms, preventing horizontal drift caused by browser/embedded PDF font metric variations.
  - *Phase 2 (Inter-Word Spaces)*: Generates explicit `.precise-space` elements with `role="presentation"` matching the exact geometric gap between words, eliminating artificial gaps or overlaps.
  - *Phase 3 (Line Break Delimiters)*: Appends trailing newline (`\n`) text nodes to line containers to maintain clean paragraph structure and native clipboard copy/paste formatting.
- **Backend Geometric Word Preservation**: Updated `PdfLayoutService` line grouping to retain per-word coordinate bounding boxes (`x0, y0, x1, y1`) inside line layout payloads.
- **Double-Click Word Preservation & Word-by-Word Drag Selection**: Fixed an issue where double-clicking a word and immediately dragging collapsed the selection to the click character offset, losing characters from the beginning of the initial word. Selection now captures the complete initial word (`this.anchorWord`) and expands word-by-word forward and backward while keeping the entire originating word selected.
- **Selection Container Boundary Containment**: Enforced container-level `user-select: none` with child-level `user-select: text` on `.textLayer` and page wrappers, preventing double-clicking in empty page margins from accidentally highlighting whole-screen containers.
- **Selection Loupe Trigger on Click**: Prevented the magnifying selection loupe from displaying on simple clicks, taps, or stationary pointer holds. Loupe rendering is now exclusively activated when active drag selection begins and spans across characters or exceeds drag thresholds, eliminating visual flicker on simple click/deselect gestures.
- **Stylus Highlighter Tap Loupe Suppression**: Extended drag-only activation to `ReaderTextHighlightController` so tapping with stylus or mouse highlighter does not flash the loupe before dragging.

### Changed
- **Ctrl + Scroll Zoom Speed & Responsiveness**: Increased base wheel zoom scaling step from `0.10` to `0.25` with wheel velocity intensity scaling in `ReaderToolbarManager`, enabling fast, responsive, and smooth zooming across documents with Ctrl + Scroll.
- **Release Metadata**: Bumped API version metadata and PWA shell cache (`lunabria-v1.0.10`) along with asset revisions for modified reader viewmodels and views.

### Added
- **3-Phase Text Layer, Double-Click Word Drag & Zoom/Loupe Regressions**: Added test coverage verifying that `TextLayerView` constructs `.precise-word`, `.precise-space`, and newline delimiters with exact coordinate scaling, `ReaderNativeSelectionLoupeController` preserves full anchor words and expands word-by-word on double-click drag forward and backward, the loupe remains suppressed on simple pointer clicks and activates during drag selection, and wheel zoom applies the accelerated scale factor.

---

## [1.0.9] - Consistent SVG Icons Across Menus

### Changed
- Replaced remaining interface emojis with reusable, theme-aware SVG icons across the library, reader toolbar, annotations drawer/notebook, upload and metadata dialogs, sync settings, and stylus accessibility controls.
- Converted loading, success, offline and retry states to consistent animated or status SVG icons. Added accessible names for icon-only actions and retained descriptive labels in native select options.
- **Release Metadata**: Aligned API metadata with `1.0.9` and bumped the shell cache/frontend asset revisions so updated icons refresh online and remain available offline.

### Added
- Regression checks for emoji-free interface markup, valid sprite references and accessible icon-only controls.

---

## [1.0.8] - Responsibility Separation & Theme-Aware UI Polish

### Changed
- **Library MVVM**: Extracted catalog presentation, pagination and selection views, plus a selection workflow coordinator. Existing `LibraryViewModel` methods, element references and model state remain compatible.
- **Reader Coordination**: Extracted event binding, document lifecycle and offline download services. Selection and toolbar positioning calculations now live in a pure geometry service, preserving the existing algorithms and scheduling.
- **API Services**: Split the API client into eight domain services behind the unchanged global `api` facade. Request payloads, error handling, progress synchronization, beacons and layout caching are preserved.
- **Backend Services**: Separated Calibre CLI and conversion operations; split reader progress, annotations/export, settings and drawings behind the original service interfaces and patch points. No database migration or API contract change.
- **Stylesheet Architecture**: Split the 3,275-line stylesheet into ten ordered, responsibility-focused sheets. Their concatenation is byte-identical to the previous stylesheet; intentional visual refinements are isolated in an eleventh sheet.
- **UI Polish**: Replaced search, clear, palette, settings and upload glyphs with reusable local SVG icons. Upload and sync accents now follow Sepia, Dark and AMOLED theme colors. Document filters and user highlight colors are unchanged.
- **Release Metadata**: Set API metadata and the PWA shell cache to `1.0.8`; updated asset revisions only for changed/new frontend modules.

### Added
- Dependency-free Node regression tests covering compatibility with frozen originals, selection geometry, events, document cleanup, API effects, stylesheet extraction, classic-script startup and PWA asset coverage.
- Twenty backend service regression tests plus a dedicated SQLite connection-lifecycle test, covering persistence, conversion, concurrency, markdown and existing monkeypatch contracts.
- Frontend regression execution in develop, staging and production verification workflows.
- [Architecture and refactor audit](docs/architecture.md), including file-size comparisons, module ownership and verification limitations.

### Fixed
- **PWA Asset Integration**: Precache the newly extracted scripts, imported stylesheets and local icon sprite. Match versioned HTML resource URLs exactly so offline cache lookups use the correct keys.
- **Reader Selection Without Prior State**: Initialize the matching line locally instead of relying on an undeclared global left behind by a previous selection. Selection now also works when the first text segment does not overlap a previously matched line.
- **SQLite Connection Lifecycle**: Database connections returned by `get_db()` now close when their transaction context exits, while retaining its existing commit/rollback behavior. This prevents unbounded connection/file-lock accumulation during requests and makes SQLite files removable on Windows.

---

## [1.0.7] - Highlight & Note Persistence, Universal Selection, List Item Grouping, Flicker-Free Focal Zoom & Collision Avoidance

### Fixed
- **List Item & Bullet Highlight Selection**: Resolved a critical issue where selecting bulleted or numbered lists highlighted only the bullet symbols (`•`) while skipping the list item text. Updated geometric line grouping in `pdf_layout_service.py` and `TextLayerView.js` to evaluate relative vertical overlap ratios ($\ge 35\%$) and midpoint distances rather than strict height differences, unifying bullet points, symbols, and text into continuous typographic lines. Enhanced `computeSelectionRects` in `ReaderAnnotationViewModel` with 2D horizontal/vertical intersection scoring and bumped `LocalDB` IndexedDB cache version to `5` to invalidate stale layout entries.
- **Cursor & Viewport Focal-Point Zooming (Zoom to Mouse)**: Resolved the viewport scroll position resetting to the top of the document when zooming in or out via `Ctrl + Scroll`, keyboard shortcuts, or HUD zoom buttons. Implemented real-time focal point tracking that maps unscaled page coordinates under the mouse cursor during wheel zoom (or relative to the visible viewport center during HUD/shortcut zoom), preserving the exact reading position under the user's focus without scroll jumping.
- **Flicker-Free Off-DOM Rendering (Double-Buffering)**: Eliminated white flashes and blank screen flickering during zoom adjustments. Pages and high-resolution canvas bitmaps are now rendered completely off-DOM in memory and swapped atomically into the viewport via `replaceChildren()`, maintaining continuous visual display until the new zoom level is ready.
- **Highlight & Note Creation Persistence**: Resolved highlight creation failure where clicking color dots or opening the `prompt()` note modal blurred/collapsed the live DOM `Range`, causing `range.getClientRects()` to return empty arrays and creating blank highlights. Selection geometry (`selectedRects`, `selectedText`, `selectedPage`) is now pre-computed and immutably cached at selection completion, guaranteeing immediate, reliable highlight persistence and instant visual rendering.
- **Universal Reader Margin Selection (True QoL)**: Expanded selection listeners from `.pdf-viewport` to the entire `#reader-body` container with proximity page resolution (`getPageWrapperAt`). Users can now initiate text selections seamlessly from any point on the screen (including outer side margins, blank header/footer paddings, and empty line spacing), instantly snapping the selection to the nearest line with full sub-glyph precision.
- **Left Margin Blue Artifact Strip**: Removed presentation `<br>` elements from `TextLayerView` and enforced `display: none` / transparent selection on `.textLayer br`. When users selected text across lines, static inline `<br>` elements stacked at `x = 0` were receiving selection background styling, creating a phantom vertical blue stripe down the left margin.
- **Continuous Margin Drag Selection**: Restored active `selection.setBaseAndExtent` driving during `pointermove` in `ReaderNativeSelectionLoupeController` with `event.preventDefault()` on non-text `mousedown`. This prevents browser native selection from hijacking margin drags and jumping to distant lower text blocks, while utilizing `document.caretPositionFromPoint` / `document.caretRangeFromPoint` for exact sub-glyph accuracy.
- **Smart Floating Selection Toolbar Positioning**: Replaced rigid single-side positioning with dynamic collision avoidance evaluating both header HUD (`reader-header`) and footer navigation bar (`reader-footer`). The toolbar now prioritizes placement below the selection end, smoothly flips above the selection start when near the bottom footer, and strictly bounds itself inside the safe viewport zone (`z-index: 700`) without obscuring or getting trapped behind navigation controls.
- **Viewport Horizontal Clipping**: Transitioned `.pdf-viewport-container` to `margin: auto` within a flexbox layout, eliminating the unscrollable left-side clipping (blue band exposure) and right-side header overflow caused by standard block centering when scaling documents beyond screen boundaries.
- **Text Selection Inversion**: Addressed native browser text selection backwards inversion by strictly sorting extracted words by precise vertical visual coordinates in `TextLayerView.js` (using `dy > 3`), guaranteeing the DOM order strictly maps to the visual reading order and anchoring the cursor cleanly on downward drags.

---

## [1.0.6] - Firefox Zoom Crash Resilience, Precise Selection Alignment & Floating Toolbar Refinements

### Added
- **Expanded Zoom Range (25% - 500%)**: Broadened minimum and maximum zoom scale from 25% (`0.25`) to 500% (`5.0`) with safe bounding in `ReaderModel`, `ReaderNavigationViewModel`, and wheel zoom interactions.
- **Window-Level Wheel Interception**: Registered non-passive wheel event listener on `window` to cleanly intercept `Ctrl + Wheel` gestures and cancel Firefox's native full-page browser zoom multiplication.
- **Non-Destructive Canvas Allocation Guard**: Added strict dimension bounds (`8192px` max dimension and `16MP` max area) and graceful error handling in `ReaderPageRenderer` to prevent canvas allocation crashes from wiping out the page DOM on high zoom levels in Firefox.

### Fixed
- **Floating Selection Toolbar Obscuration & Drift**:
  - Re-anchored toolbar positioning to the end of the text selection (`lastRect`) rather than the starting coordinate, placing it comfortably below the active reading focus.
  - Eliminated upward negative percentage translate shifts (`translateX(-50%)`) and enforced strict clamping against the reader header HUD (`headerBottom + 10px`), ensuring the toolbar is never hidden behind the header or scrolled out of view.
  - Suppressed floating toolbar visibility during active drag operations, displaying only when selection gestures complete (`pointerup`).
  - Added dynamic scroll tracking so the toolbar moves synchronously with the selected text or hides cleanly when scrolled out of the viewport.
- **Trailing Highlight Margin Rectangles**: Converted `.textLayer .precise-line` elements to `display: inline-block` with explicit line widths and appended `<br role="presentation">` line delimiters, preventing browser selection engines from painting trailing gray carriage-return blocks across empty paragraph margins.
- **Intermittent Text Selection Skips**:
  - Removed destructive `selection.setBaseAndExtent` overriding from `pointermove` in `ReaderNativeSelectionLoupeController`, allowing the browser's native text selection engine to preserve continuous word boundaries without truncating phrases.
  - Added standard `document.caretPositionFromPoint` support for Firefox alongside `document.caretRangeFromPoint` for Chromium browsers in proximity hit-testing.
- **IndexedDB Layout Cache Invalidation**: Bumped local storage database version to `4` to purge legacy cached layouts and ensure newly extracted geometric typographical lines are loaded.

---

## [1.0.5] - Comprehensive Text Selection Cursor, 90% Width Alignment & Ctrl+Wheel Zoom

### Added
- **Ctrl + Wheel Smooth Zooming**: Implemented `Ctrl + Wheel` (and trackpad pinch-to-zoom) across the reader container with `requestAnimationFrame` coalescing and default browser page zoom prevention.
- **Universal Text Selection Cursor (QoL)**: Extended `cursor: text` to all layout elements where selection can be initiated (`.pdf-page-wrapper`, `.pdf-page-canvas`, `.textLayer`, and outer margins), communicating immediate selection readiness before reaching exact glyph coordinates.
- **90% Width Alignment for Toolbar & Fit-Width**: Synchronized the reader HUD header toolbar and the Fit-to-Width mode to utilize 90% of available viewport width, creating a balanced and visually cohesive reader frame.
- **Actual Size (100% Zoom)**: Clarified 100% zoom to strictly represent the actual 1:1 unscaled PDF document size (`scale = 1.0`), accessible via the HUD reset button and `Ctrl + 0`.

---

## [1.0.4] - Fit-to-Width / Fit-to-Page Zoom Modes & Selection Drag Inconsistency Fixes

### Added
- **Fit to Width & Fit to Page Modes**: Added dedicated buttons in the reader HUD and keyboard shortcuts (`W` for Fit Width, `H` for Fit Page) matching Microsoft Edge / modern PDF viewers.
- **Dynamic Initial Zoom**: Replaced the arbitrary 130% zoom default with dynamic calculation based on viewport dimensions and aspect ratio, persisting the user's preferred fit mode (`width` or `page`) across reading sessions.
- **Responsive Dynamic Resizing**: Added debounced viewport resize handling that automatically updates scale when the browser window is resized while an active fit mode is selected.

### Fixed
- **Selection Drag Hijacking (🚫 Cursor)**: Prevented native HTML5 text drag-and-drop hijacking when clicking or dragging over active selections by setting `-webkit-user-drag: none` and blocking default `dragstart` events.
- **Text Layer Double-Scale Distortion**: Fixed an issue in `TextLayerView` where setting element width while `scaleX` was applied resulted in compounded scaling, resolving misaligned selection bounding boxes and stretched hit areas.
- **Continuous Drag Snapping**: Enhanced `findTextTargetWithinGap` during active mouse/touch drag (`isDragging=true`) to smoothly clamp to line start/end and document top/bottom without freezing when the cursor moves deep into margins or between lines.
- **Word Concatenation in Layout Extraction**: Removed the flawed `merged_raw` concatenation in `pdf_layout_service.py` that erroneously merged discrete words without spaces, restoring true typographical word boundaries and accurate character measurements.

---

## [1.0.3] - Edge-Style Margin Selection & Geometric Reading Order

### Added
- **Edge-Style Margin Selection**: Supported starting text selection from the outer page margin (up to 65px left/right tolerance), matching Microsoft Edge PDF reader behavior where clicking in the margin snaps to the start or end of the typographical line.
- **Inter-Line Midpoint Jumping**: Implemented smooth vertical line/paragraph transition tracking during mouse/touch drag. Crossing the vertical midpoint between lines or paragraphs dynamically snaps the selection to the subsequent line up to the cursor's horizontal position, eliminating skipped lines or disjointed text artifacts.

### Fixed
- **Geometric Word and Line Grouping**: Refactored `pdf_layout_service.py` and `TextLayerView.js` to group words into lines based on vertical geometric overlap rather than raw PyMuPDF `block` identifiers. Prevents bold words, code spans, and formatted inline phrases from splitting visual lines into out-of-order DOM blocks.

---

## [1.0.2] - Selection Hit Gap & Calibre Documentation

### Added
- **Selection Proximity Hit-Testing (QoL)**: Implemented `findTextTargetWithinGap` in `ReaderNativeSelectionLoupeController` with a generous hit area (28px horizontal, 16px vertical). Users can point near the beginning of a line, in line spacing gaps, or on spaces between words without needing subpixel accuracy.
- **Visual Highlight Integrity**: Preserved exact typographic character bounds and highlight rectangles (`pdf-highlight-rect`) so the expanded interactive radius does not distort or inflate visual selection or annotation rendering.
- **Stylus & Highlighter Hit Tolerance**: Extended proximity tolerance in `ReaderTextHighlightController` and `ReaderAnnotationViewModel` to make freehand text highlighting and double-tap gesture lookups effortless.
- **Calibre Prerequisites Documentation**: Added clear guidance and warnings in `README.md` and `.env.example` regarding Calibre desktop SQLite database locks, Windows path length limitations (< 75 characters), and cloud storage synchronization hazards.

---

## [1.0.1] - Stability & Lifecycle Fixes

### Fixed
- **Reader Progress Persistence**: Fixed reading progress persistence when closing the reader, navigating away, or refreshing via lifecycle hooks (`beforeunload`/`pagehide` beacon) and robust progress reconciliation in `api.getProgress()`.
- **Recents Grid Layout**: Fixed single-book display bug in "Continue Reading" where a single card stretched across the entire width of the screen by switching from `auto-fit` to `auto-fill` in CSS Grid.
- **Book Uploads & Calibre Concurrency**: Handled Calibre database locking gracefully when `calibre.exe` or `calibre-server` is open, returning a descriptive HTTP 409 Conflict error to inform the user instead of failing with an unhandled exception.
- **Backend & Windows Compatibility**: Fixed UTF-8 console output crashes on Windows terminals and prevented socket reload crashes during uvicorn reload on non-Linux platforms.
- **Systemd Portability**: Made systemd service paths relative to `WORKSPACE_DIR` and provided an automated `install.sh` script for Linux deployments (WSL, native Linux, Raspberry Pi).

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

[Unreleased]: https://github.com/RodrigoMijangos/lunabria/compare/v1.3.0...HEAD
[1.3.0]: https://github.com/RodrigoMijangos/lunabria/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/RodrigoMijangos/lunabria/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/RodrigoMijangos/lunabria/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/RodrigoMijangos/lunabria/compare/v1.0.11...v1.1.0
[1.0.11]: https://github.com/RodrigoMijangos/lunabria/compare/v1.0.0...v1.0.11
[1.0.0]: https://github.com/RodrigoMijangos/lunabria/releases/tag/v1.0.0
