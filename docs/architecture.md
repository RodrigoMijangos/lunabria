# Architecture & 1.0.9 interface audit

## Scope and size audit

Counts are physical source lines, including comments and blank lines, not executable-statement counts. The baseline is the repository before this refactor. Generated data, images and test fixtures are excluded from this production-source ranking.

| Original rank | File | Before | After | Decision |
| --- | --- | ---: | ---: | --- |
| 1 | `frontend/css/style.css` | 3,275 | 11 | Ordered entry point for ten extracted sheets and isolated UI polish |
| 2 | `frontend/index.html` | 758 | 774 | Keep static shell/IDs intact; integrate collaborators and the local SVG icon sprite |
| 3 | `frontend/js/viewmodels/LibraryViewModel.js` | 603 | 333 | Delegate catalog presentation and selection workflows |
| 4 | `frontend/js/viewmodels/ReaderViewModel.js` | 551 | 227 | Delegate events, document lifecycle and offline download |
| 5 | `frontend/js/api.js` | 531 | 34 | Compatibility facade over eight domain services |
| 6 | `frontend/js/viewmodels/reader/ReaderAnnotationViewModel.js` | 512 | 457 | Extract numerical selection/toolbar geometry |
| 7 | `frontend/js/viewmodels/reader/ReaderToolbarManager.js` | 465 | 465 | Already a focused control-binding collaborator; unchanged |
| 8 | `frontend/js/viewmodels/reader/ReaderDrawingViewModel.js` | 457 | 457 | Leave pointer/stylus timing unchanged in this pass |
| 9 | `backend/app/services/calibre_service.py` | 455 | 324 | Delegate CLI and conversion/cache work |
| 10 | `frontend/js/viewmodels/reader/ReaderPageRenderer.js` | 315 | 315 | Preserve focal zoom, double buffering and rendering unchanged |
| 11 | `backend/app/services/reader_service.py` | 311 | 117 | Compatibility facade over four persistence domains |
| 12 | `frontend/js/models/ReaderModel.js` | 302 | 302 | Preserve state and model transformations unchanged |

Reducing a file's line count is not itself the objective. Existing, already-cohesive collaborators and the static HTML shell are deliberately retained. This pass introduces responsibility boundaries without templating, a framework migration or new production dependencies.

## Frontend responsibility boundaries

### Library

- `LibraryModel`: books, collections, filters, pagination state and theme state.
- `LibraryViewModel`: data loading, model commands, feature coordination and compatible entry points.
- `CatalogView`: element capture, responsive column measurements, page-size controls, catalog/search presentation and counts.
- `CatalogPaginationView`: pagination buttons, ellipses, accessible attributes and page input presentation.
- `CatalogSelectionView`: selection controls, collection options, card state and status presentation.
- `CatalogSelectionManager`: selection workflows and collection commands, using the ViewModel's existing live state rather than duplicating it.

### Reader

- `ReaderViewModel`: composes the existing navigation, annotation, drawing, notes, renderer and toolbar collaborators; retains public methods and progress scheduling.
- `ReaderEventBindings`: registrations and event dispatch, including capture/passive flags and existing debounce timing.
- `ReaderDocumentLifecycle`: document opening, metadata, stale-open guards, PDF loading/fallback and cleanup through the reader facade.
- `ReaderOfflineService`: PDF download validation and batched layout caching.
- `ReaderSelectionGeometry`: pure numeric scoring, coordinate conversion and toolbar/palette positioning. DOM measurement and state remain in `ReaderAnnotationViewModel`.

Existing reader selection, zoom, rendering, annotation persistence and stylus algorithms are not redesigned.

### API and storage

`api.js` composes factories in `frontend/js/services/`:

1. `books.js`
2. `virtual-libraries.js`
3. `metadata.js`
4. `progress.js`
5. `layouts.js`
6. `annotations.js`
7. `colors.js`
8. `drawings.js`

The global `api` object and `window.api` still identify the same facade. Methods are not bound to individual service objects: internal calls, overrides and mutable progress/layout state continue to use the caller's receiver. The domain methods are mechanically extracted to preserve payloads, response handling, logs, errors and synchronization behavior.

`db.js` and IndexedDB schema version **5** are unchanged. No persisted-data migration is required.

## Backend responsibility boundaries

The Python HTTP layer remains router/service based; MVVM applies to the browser presentation layer, not to HTTP endpoints.

- `CalibreService`: original public interface, library queries and resource lookup.
- `calibre_cli.py`: library initialization, Calibre search and mutations through the CLI.
- `calibre_conversion.py`: EPUB conversion, cache validation and per-book conversion locks.
- `ReaderService`: original router-facing interface.
- `reader_progress.py`: reading progress and recent-book queries.
- `reader_annotations.py`: text normalization, annotation persistence and Markdown export.
- `reader_settings.py`: highlight settings and legacy-name compatibility.
- `reader_drawings.py`: drawing persistence.

The facades pass their existing dependencies to the extracted operations. This preserves module-level monkeypatch points, service overrides, SQL, transaction boundaries and filesystem/lock behavior.

## Styles and intentional visual changes

`style.css` imports these sheets in the original cascade order:

| Sheet | Responsibility | Lines |
| --- | --- | ---: |
| `themes.css` | Sepia, Dark and AMOLED tokens | 74 |
| `base-navbar.css` | Reset, typography, navigation and shared controls | 245 |
| `library-catalog.css` | Catalog, collections, pagination and selection | 433 |
| `library-cards.css` | Recent reads and book cards | 268 |
| `reader-pages.css` | Reader HUD, pages, text selection and highlights | 564 |
| `drawing.css` | Ink canvas and drawing toolbar | 300 |
| `reader-selection-drawer.css` | Selection toolbar, scrubber and drawer | 356 |
| `modals.css` | Dialogs, settings and uploads | 372 |
| `notebook.css` | Annotations notebook | 459 |
| `responsive.css` | Existing responsive overrides | 204 |

Concatenating these ten files without separators reproduces the original 67,143-byte stylesheet exactly. Regression tests preserve its SHA-256 fingerprint and safe rule/media boundaries.

`design.css` is appended separately for intentional visual changes:

- Search, clear, palette, settings and upload controls use the local `icons.svg` sprite, `currentColor`, decorative SVG attributes and accessible names for icon-only buttons.
- Sync/upload backgrounds and shadows use theme-specific accent RGB tokens instead of fixed Sepia colors in Dark/AMOLED.
- Layout, PDF filters, AMOLED's pure-black background and user annotation colors are not changed.

## Loading and PWA integration

The application keeps classic scripts and global compatibility facades. `index.html` loads each extracted collaborator before its consumer, without introducing asynchronous script loading. Menu and status icons use the shared SVG sprite; native `<select>` options remain descriptive text because custom per-option SVG rendering is not portable.

`sw.js` precaches the new scripts, all imported stylesheets and the local sprite. Versioned HTML URLs are listed with their **exact query strings**, since CacheStorage keys include search parameters. The shell cache is `lunabria-v1.0.9`; modules changed for the icon pass use asset revision `1.0.9`, while untouched modules retain their existing revisions.

PDF.js and Google Fonts remain existing external dependencies and are not newly bundled. The integration tests cover local shell/cache resources, not availability of those external providers.

## Regression verification

From the repository root, with Node.js 20+:

```sh
node --test frontend/tests/*.test.cjs
```

Coverage includes API contracts/effects against a frozen original, library pagination/selection, reader lifecycle and event timing, 2,898 geometry comparisons against the original, byte-identical stylesheet extraction, real classic-script order/singleton construction in a simulated DOM, and PWA install/fallback/cache coverage.

From `backend`:

```sh
python -m unittest discover -s tests -p test_service_refactor.py -v
python -m unittest discover -s tests -v
```

Develop, staging and production verification workflows now execute the frontend regression suite as well as existing backend tests.

### Results and limitations of this pass

- **296 frontend tests passed** using Node 24.11.0; all frontend JavaScript and CommonJS sources pass Node syntax checks.
- **21 backend service and SQLite lifecycle tests passed** in Python 3.12. The extraction compatibility tests passed against the original services before extraction; the SQLite-closure regression test validates the connection lifecycle fix.
- **All 44 backend tests passed previously** using the project environment with Calibre 9.13. The full suite could not be rerun in the current shell because its active Python installation lacks FastAPI; `test_full_workflow`, `test_media_ranges` and `test_metadata_sources` fail to import for that environment reason. The Windows test environment uses a short temporary root (`C:\l`) because Calibre rejects library paths of 75 characters or more.

- Existing conversion and metadata test fixtures now explicitly close setup/mock SQLite connections, fixing `WinError 32` cleanup failures on Windows.
- No real-browser visual, touch/stylus, PDF.js or IndexedDB end-to-end run was performed. VM/mocked tests cannot prove pixel-identical layout or guarantee the absence of every regression.
- Selection matching now initializes its selected line per range, removing a stale implicit global that could cause a `ReferenceError` on the first unmatched selection or reuse a previous selection's line. A dedicated regression test covers both matched and unmatched lines without setting that global.

Before publishing the release, complete a real-browser smoke test for catalog selection, reader zoom/selection/annotations, drawing, upload/metadata, all three themes and offline reading.

## Versioning decision

The **1.0.8** entry records the MVVM/backend/style refactor. The menu-wide SVG conversion and cache refresh are tracked separately as backward-compatible **1.0.9**. Historical grouped milestones are preserved rather than split without release-level evidence.
