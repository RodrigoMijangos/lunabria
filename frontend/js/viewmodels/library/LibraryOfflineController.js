/**
 * LibraryOfflineController.js
 * Coordinates Service Worker lifecycle, offline catalog fallback, cover blob caching,
 * and offline/update banner state for LibraryViewModel.
 */
class LibraryOfflineController {
  constructor(vm) {
    this.vm = vm;
  }

  canSafelyReloadForUpdate() {
    const reader = typeof window !== "undefined" ? window.reader : null;
    const isReadingBook = Boolean(reader?.model?.bookId && reader?.container?.style?.display === "flex");
    const isUploading = Boolean(
      this.vm.uploadManager?.isUploading ||
        this.vm.uploadManager?.activeUploadXhrs?.size > 0 ||
        this.vm.uploadManager?.activeJobs?.size > 0,
    );
    return !isReadingBook && !isUploading;
  }

  flushPendingAppReload() {
    if (
      this.vm.pendingAppReload &&
      this.vm.canSafelyReloadForUpdate() &&
      typeof window !== "undefined" &&
      window.location?.reload
    ) {
      this.vm.pendingAppReload = false;
      window.location.reload();
      return true;
    }
    return false;
  }

  initServiceWorker() {
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker
      .register("./sw.js", { updateViaCache: "none" })
      .then((reg) => {
        if (reg.waiting) {
          reg.waiting.postMessage?.({ action: "SKIP_WAITING" });
        }
        reg.addEventListener("updatefound", () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener("statechange", () => {
            if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
              newWorker.postMessage?.({ action: "SKIP_WAITING" });
            }
          });
        });
        reg.update().catch(() => {});

        if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
          document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible") {
              reg.update().catch(() => {});
            }
          });
        }
        if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
          window.addEventListener("focus", () => {
            reg.update().catch(() => {});
          });
        }
      })
      .catch((err) => {
        console.warn("[LibraryViewModel] Service worker registration failed:", err);
      });

    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      if (this.vm.canSafelyReloadForUpdate()) {
        refreshing = true;
        window.location.reload();
      } else {
        this.vm.pendingAppReload = true;
      }
    });
  }

  async preloadCachedCatalog(requestSequence) {
    if (typeof localDB === "undefined" || !localDB || typeof localDB.getAllCachedBooks !== "function") {
      return [];
    }
    try {
      const cached = await localDB.getAllCachedBooks();
      if (this.vm.isStaleCatalogRequest(requestSequence)) return [];
      const cachedBooks = Array.isArray(cached) ? cached : [];
      if (cachedBooks.length > 0 && (!this.vm.model.allBooks || this.vm.model.allBooks.length === 0)) {
        this.vm.model.setBooks(cachedBooks);
        this.vm.renderBooks();
      }
      return cachedBooks;
    } catch (_) {
      return [];
    }
  }

  shouldClearLocalCache(pageTotal) {
    return Boolean(
      typeof localDB !== "undefined" &&
        localDB &&
        pageTotal === 0 &&
        !this.vm.model.searchQuery &&
        !this.vm.model.activeVirtualLibraryId &&
        typeof localDB.clearCachedBooks === "function",
    );
  }

  shouldSaveLocalCache(books) {
    return Boolean(
      typeof localDB !== "undefined" &&
        localDB &&
        typeof localDB.saveCachedBooks === "function" &&
        Array.isArray(books) &&
        books.length > 0,
    );
  }

  syncLocalCatalogCache(pageTotal, books) {
    if (this.shouldClearLocalCache(pageTotal)) {
      localDB.clearCachedBooks().catch(() => {});
    } else if (this.shouldSaveLocalCache(books)) {
      localDB
        .saveCachedBooks(books)
        .then(() => this.cacheMissingOfflineCovers(books))
        .catch((err) => {
          console.warn("[LibraryViewModel] Could not refresh the local book cache:", err);
        });
    }
  }

  async handleCatalogLoadError(error, requestSequence, operation) {
    const monitor = window.serverConnectivity;
    let serverAvailable = false;
    if (typeof monitor?.checkServer === "function") {
      try {
        serverAvailable = await monitor.checkServer();
      } catch (_) {}
    }
    if (this.vm.isStaleCatalogRequest(requestSequence)) return;

    if (serverAvailable) {
      this.vm.hideOfflineBanner();
      console.error(`[LibraryViewModel] ${operation} failed while the server is reachable:`, error);
      return;
    }

    console.warn(`[LibraryViewModel] ${operation} failed; checking offline books:`, error);
    await this.vm.showOfflineBooks();
  }

  async showOfflineBooks() {
    const requestSequence = ++this.vm.catalogRequestSequence;
    if (this.vm.catalogSearchTimeout !== null) {
      window.clearTimeout(this.vm.catalogSearchTimeout);
      this.vm.catalogSearchTimeout = null;
    }
    this.vm.catalogServerPage = null;
    if (typeof localDB !== "undefined" && localDB && typeof localDB.getOfflineCompleteBooks === "function") {
      let offlineBooks = [];
      try {
        offlineBooks = await localDB.getOfflineCompleteBooks();
      } catch (dbErr) {
        console.error("[LibraryViewModel] Error retrieving offline complete books:", dbErr);
      }
      if (this.vm.isStaleCatalogRequest(requestSequence)) return;
      offlineBooks = Array.isArray(offlineBooks) ? offlineBooks : [];
      this.vm.model.setBooks(offlineBooks);
      this.vm.model.setRecentBooks([]);
      this.vm.showOfflineBanner(offlineBooks.length);
    } else {
      this.vm.showOfflineBanner(0);
    }
    this.vm.renderRecents();
    this.vm.renderBooks();
    this.vm.updateActiveCollectionChip();
  }

  async cacheMissingOfflineCovers(books) {
    if (
      !Array.isArray(books) ||
      books.length === 0 ||
      typeof localDB === "undefined" ||
      !localDB ||
      typeof localDB.getOfflineCompleteBooks !== "function" ||
      typeof localDB.saveCachedBook !== "function" ||
      typeof fetch !== "function"
    ) {
      return;
    }

    const offlineBooks = await localDB.getOfflineCompleteBooks();
    if (!Array.isArray(offlineBooks)) return;
    const offlineById = new Map(offlineBooks.map((book) => [Number(book.id), book]));

    for (const book of books) {
      const id = Number(book.id);
      const cachedBook = offlineById.get(id);
      if (!Number.isSafeInteger(id) || !cachedBook || cachedBook.coverBlob || (!book.cover_url && !book.has_cover)) {
        continue;
      }

      try {
        const coverUrl = book.cover_url || `/api/books/${id}/cover`;
        const response = await fetch(coverUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const coverBlob = await response.blob();
        if (!coverBlob.size || (coverBlob.type && !coverBlob.type.startsWith("image/"))) {
          throw new Error("The cover response is not a valid image");
        }
        await localDB.saveCachedBook({ ...book, coverBlob });
        cachedBook.coverBlob = coverBlob;
      } catch (err) {
        console.warn(`[LibraryViewModel] Could not cache the offline cover for book ${id}:`, err);
      }
    }
  }

  async attachCachedCovers(books, cachedBooks = null) {
    if (
      !Array.isArray(books) ||
      !books.length ||
      typeof localDB === "undefined" ||
      !localDB ||
      typeof localDB.getAllCachedBooks !== "function"
    ) {
      return books;
    }

    let storedBooks = cachedBooks;
    if (!Array.isArray(storedBooks)) {
      try {
        storedBooks = await localDB.getAllCachedBooks();
      } catch (_) {
        return books;
      }
    }
    const coverBlobs = new Map(
      (storedBooks || []).filter((book) => book?.coverBlob).map((book) => [Number(book.id), book.coverBlob]),
    );
    return books.map((book) => {
      const coverBlob = coverBlobs.get(Number(book.id));
      return !book.coverBlob && coverBlob ? { ...book, coverBlob } : book;
    });
  }

  showOfflineBanner(count = 0) {
    let banner = document.getElementById("offline-catalog-banner");
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "offline-catalog-banner";
      banner.className = "offline-catalog-banner";
      const container = document.querySelector(".container") || document.querySelector("main");
      if (container) container.prepend(banner);
    }
    const message =
      count > 0
        ? `Modo sin conexión: mostrando ${count} libro(s) disponible(s) con PDF y lectura completa`
        : "Modo sin conexión: sin libros descargados para lectura completa";
    banner.innerHTML = `<svg class="ui-icon" aria-hidden="true" focusable="false"><use href="./icons.svg#circle-check"></use></svg> <span>${message}</span>`;
    banner.style.display = "flex";
  }

  hideOfflineBanner() {
    const banner = document.getElementById("offline-catalog-banner");
    if (banner) banner.style.display = "none";
  }

  showUpdateBanner(worker) {
    if (worker && typeof worker.postMessage === "function") {
      worker.postMessage({ action: "SKIP_WAITING" });
    } else if (typeof navigator !== "undefined" && navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ action: "SKIP_WAITING" });
    } else if (typeof window !== "undefined" && window.location?.reload) {
      window.location.reload();
    }
  }

  hideUpdateBanner() {
    const banner = typeof document !== "undefined" ? document.getElementById("app-update-banner") : null;
    if (banner) banner.style.display = "none";
  }
}

window.LibraryOfflineController = LibraryOfflineController;
