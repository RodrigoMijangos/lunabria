# 📜 Changelog

All notable changes to **Lunabria** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> [!NOTE]
> All changes prior to version **1.0.0** were consolidated into a clean initial production release on `main`. This changelog preserves the full development history and functional evolution from the pre-release development milestones.

---

## [Unreleased]

## [1.10.0] - 2026-10-23

### Added
- Choose continuous one-page or two-page reading in the desktop browser.
- Keep uploads and Calibre processing running while you use the app, with live progress in a dock and a readable queue even after closing the dialog.
- Import books through a compact horizontal dropzone.
- Get a warning before adding a book with an existing ISBN and format; different formats remain allowed.
- Create virtual libraries with cover cards, live query previews, preselected matches, quick bulk controls, and preserved position while loading more.

### Fixed
- The desktop reader title and author stay centered in the top header.
- The navbar search clear button works on the first click and keeps the search field width stable.

## [1.9.0] - 2026-10-22

### Added
- Book uploads now look up matching online metadata in the background, prioritizing ISBN, document title, and filename while preserving the uploaded details if no match is found.
- Export notes by chapter, page or page range, or select individual annotations on desktop and mobile.

## [1.8.0] - 2026-10-18

Interactive table of contents, in-text cross references and touch-optimized navigation.

### Added
- Interactive table of contents in the reader with nested chapter hierarchy, current section tracking and real-time chapter search.
- Dedicated reader top-bar buttons and keyboard shortcuts (`T` for contents, `N` for notes).
- Mobile bottom sheet with grab handle and generous touch targets for chapter and note browsing on smaller screens.
- Internal PDF link navigation and in-text cross-reference recognition with back-navigation breadcrumb to return to the previous reading point.

### Fixed
- Local HTTPS certificate generation on Windows automatically detects OpenSSL installations bundled with Git when OpenSSL is not in the system PATH.

## [1.7.0] - 2026-10-16

Mobile PWA, responsive reader and offline capabilities.

[Unreleased]: https://github.com/RodrigoMijangos/lunabria/compare/v1.10.0...HEAD
[1.10.0]: https://github.com/RodrigoMijangos/lunabria/compare/v1.9.0...v1.10.0
[1.9.0]: https://github.com/RodrigoMijangos/lunabria/compare/v1.8.0...v1.9.0
