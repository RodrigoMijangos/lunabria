/**
 * ReaderBookReconciler.js
 * Resolves cached/server book metadata, progress, annotations, and offline-complete background reconciliation.
 */
class ReaderBookReconciler {
  constructor(reader) {
    this.reader = reader;
    this._reconciliationPromise = null;
  }

  readCachedColors() {
    if (typeof localStorage === "undefined" || !localStorage) return null;
    try {
      const raw = localStorage.getItem("moon_cached_colors");
      const parsed = raw ? JSON.parse(raw) : null;
      return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  async resolveBookColors(isOfflineComplete) {
    if (isOfflineComplete) {
      const cached = this.readCachedColors();
      if (cached) return cached;
    }
    try {
      const colors = await api.getColors();
      if (Array.isArray(colors) && colors.length > 0 && typeof localStorage !== "undefined") {
        try {
          localStorage?.setItem("moon_cached_colors", JSON.stringify(colors));
        } catch (_) {}
      }
      return colors;
    } catch (err) {
      const cached = this.readCachedColors();
      if (cached) return cached;
      throw err;
    }
  }

  async resolveOfflineStatus(bookId, numPages, isOfflineComplete) {
    if (isOfflineComplete) return { pdfCached: true, layoutsCached: true };
    const [pdfCached, layoutsCached] = await Promise.all([
      localDB.isPdfCached(bookId).catch(() => false),
      localDB.hasAllLayoutsCached(bookId, numPages).catch(() => false),
    ]);
    return { pdfCached, layoutsCached };
  }

  async resolveInitialProgress(bookId, isOfflineComplete) {
    if (isOfflineComplete) {
      return typeof localDB !== "undefined" && typeof localDB?.getLocalProgress === "function"
        ? localDB.getLocalProgress(bookId).catch(() => null)
        : null;
    }
    return api.getProgress(bookId);
  }

  async resolveBookAnnotations(bookId, isOfflineComplete) {
    const getCached = async () =>
      typeof localDB !== "undefined" && typeof localDB?.getCachedAnnotations === "function"
        ? (await localDB.getCachedAnnotations(bookId).catch(() => null)) || []
        : [];

    if (isOfflineComplete) return getCached();
    try {
      const annots = await api.getAnnotations(bookId);
      if (!Array.isArray(annots)) throw new Error("Invalid annotations response");
      if (typeof localDB !== "undefined" && typeof localDB?.saveCachedAnnotations === "function") {
        await localDB.saveCachedAnnotations(bookId, annots).catch((cacheError) => {
          console.warn("[ReaderViewModel] Could not cache annotations:", cacheError);
        });
      }
      return annots;
    } catch (err) {
      console.warn("[ReaderViewModel] Failed to fetch annotations from server, trying cached annotations:", err);
      return getCached();
    }
  }

  reconcileServerConnection() {
    const reader = this.reader;
    const bookId = reader.model.bookId;
    const sequence = reader.openSequence;
    if (!bookId || reader.container?.style.display !== "flex") return Promise.resolve(false);

    const active = this._reconciliationPromise;
    if (active?.bookId === Number(bookId) && active.sequence === sequence) return active.promise;

    const operation = { bookId: Number(bookId), sequence };
    operation.promise = this.reconcileOpenBook(bookId, sequence).finally(() => {
      if (this._reconciliationPromise === operation) this._reconciliationPromise = null;
    });
    this._reconciliationPromise = operation;
    return operation.promise;
  }

  async reconcileOpenBook(bookId, sequence) {
    const reader = this.reader;
    const isCurrentBook = () =>
      sequence === reader.openSequence &&
      Number(reader.model.bookId) === Number(bookId) &&
      reader.container?.style.display === "flex";

    try {
      if (typeof localDB !== "undefined" && typeof localDB.processOutboxQueue === "function") {
        await localDB.processOutboxQueue();
      }
      if (!isCurrentBook()) return false;

      const pendingOps =
        typeof localDB !== "undefined" && typeof localDB.getPendingOutboxOps === "function"
          ? (await localDB.getPendingOutboxOps().catch(() => [])) || []
          : [];
      const bookOps = pendingOps.filter((op) => Number(op.bookId) === Number(bookId));
      const skipAnnots = bookOps.some((op) => op.type === "annotation") || typeof api.getAnnotations !== "function";
      const skipProgress = bookOps.some((op) => op.type === "progress") || typeof api.getProgress !== "function";
      const [annotations, progress] = await Promise.all([
        skipAnnots ? null : api.getAnnotations(bookId),
        skipProgress ? null : api.getProgress(bookId),
      ]);
      if (!isCurrentBook()) return false;

      if (annotations !== null) {
        if (!Array.isArray(annotations)) throw new Error("Invalid annotations response");
        reader.model.setAnnotations(annotations);
        if (typeof localDB !== "undefined" && typeof localDB.saveCachedAnnotations === "function") {
          await localDB.saveCachedAnnotations(bookId, annotations).catch(() => {});
        }
        if (!isCurrentBook()) return false;
        reader.annotations.renderDrawerAnnotations();
        reader.annotations.refreshPageHighlights?.(reader.model.currentPage);
        if (reader.model.viewMode === "notes") reader.notes?.renderNotesMode();
      }

      const serverPage = Number(progress?.current_page);
      if (serverPage > Number(reader.model.currentPage)) {
        await reader.nav?.goToPage?.(serverPage);
      }
      return true;
    } catch (error) {
      console.warn("[ReaderViewModel] Could not reconcile the open book after reconnecting:", error);
      return false;
    }
  }

  reconcileOfflineCompleteBookInBackground(bookId, sequence, _initialPage) {
    const reader = this.reader;
    if (typeof api === "undefined" || !api) return;
    api
      .markBookOpened?.(bookId, {
        current_page: reader.model.currentPage,
        total_pages: reader.model.totalPages,
        percentage: LibraryModel.formatReadingProgress(reader.model.currentPage, reader.model.totalPages),
      })
      .catch(() => {});

    api
      .getProgress?.(bookId)
      .then((progress) => {
        if (sequence === reader.openSequence && progress?.current_page > reader.model.currentPage) {
          reader.nav.goToPage(progress.current_page);
        }
      })
      .catch(() => {});

    api
      .getAnnotations?.(bookId)
      .then(async (serverAnnots) => {
        if (sequence !== reader.openSequence || !Array.isArray(serverAnnots) || !serverAnnots.length) {
          return;
        }
        reader.model.setAnnotations(serverAnnots);
        reader.annotations.renderDrawerAnnotations();
        if (typeof localDB !== "undefined" && typeof localDB?.saveCachedAnnotations === "function") {
          await localDB.saveCachedAnnotations(bookId, serverAnnots).catch(() => {});
        }
        reader.annotations.refreshPageHighlights?.(reader.model.currentPage);
      })
      .catch(() => {});
  }

  updateBookInfo(bookId, sequence) {
    const reader = this.reader;
    const titleElement = document.getElementById("reader-book-title");
    const authorElement = document.getElementById("reader-book-author");
    const cachedBook = window.app?.model?.getBookById(Number(bookId));
    const fallbackTitle = `Book ${bookId}` || "Untitled";

    ReaderHUDView.updateBookInfo(titleElement, authorElement, cachedBook, fallbackTitle);

    if (!cachedBook && typeof localDB !== "undefined" && typeof localDB?.open === "function") {
      localDB
        .open()
        .then((db) => {
          const req = db.transaction("cached_books", "readonly").objectStore("cached_books").get(Number(bookId));
          req.onsuccess = () => {
            if (req.result && sequence === reader.openSequence) {
              ReaderHUDView.updateBookInfo(titleElement, authorElement, req.result, fallbackTitle);
            }
          };
        })
        .catch(() => {});
    }

    api
      .getBook(bookId)
      .then((book) => {
        if (sequence === reader.openSequence) {
          ReaderHUDView.updateBookInfo(titleElement, authorElement, book, fallbackTitle);
        }
      })
      .catch((error) => {
        console.warn("[ReaderViewModel] Could not load book metadata:", error);
      });
  }
}

window.ReaderBookReconciler = ReaderBookReconciler;
