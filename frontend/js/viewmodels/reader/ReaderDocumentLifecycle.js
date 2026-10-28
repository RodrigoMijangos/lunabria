/** Coordinates document opening, metadata and cleanup through the reader facade. */
class ReaderDocumentLifecycle {
  constructor(reader) {
    this.reader = reader;
    this.reconciler = new ReaderBookReconciler(reader);
  }

  readCachedColors() {
    return this.reconciler.readCachedColors();
  }

  resolveBookColors(isOfflineComplete) {
    return this.reconciler.resolveBookColors(isOfflineComplete);
  }

  resolveOfflineStatus(bookId, numPages, isOfflineComplete) {
    return this.reconciler.resolveOfflineStatus(bookId, numPages, isOfflineComplete);
  }

  resolveInitialProgress(bookId, isOfflineComplete) {
    return this.reconciler.resolveInitialProgress(bookId, isOfflineComplete);
  }

  resolveBookAnnotations(bookId, isOfflineComplete) {
    return this.reconciler.resolveBookAnnotations(bookId, isOfflineComplete);
  }

  async applyInitialFitScale(initialPage) {
    const reader = this.reader;
    if (reader.model.fitMode === "page") {
      reader.model.setScale(await reader.nav.calculateFitPageScale(initialPage));
    } else if (reader.model.fitMode === "width" || !reader.model.scale) {
      reader.model.setScale(await reader.nav.calculateFitWidthScale(initialPage));
      if (!reader.model.fitMode) reader.model.setFitMode("width");
    }
  }

  async open(bookId, startPage = null) {
    const reader = this.reader;
    const sequence = ++reader.openSequence;
    reader.hideJumpBreadcrumb?.(true);
    const previousDocument = reader.model.pdfDoc;
    const previousLoadingTask = reader.loadingTask;
    reader.loadingTask = null;
    reader.renderer.resetViewportDOM();
    reader.model.reset();
    reader.mobile?.prepareForBookOpen();
    reader.toolbar.setOfflineStatus({ pdfCached: false, layoutsCached: false });
    reader.container.style.display = "flex";
    document.body.style.overflow = "hidden";
    reader.drawing?.toggleDrawMode?.(false);
    reader.drawing?.setDrawTool?.("pen", false);
    reader.updateBookInfo(bookId, sequence);

    reader.destroyPdfResource(previousLoadingTask);
    reader.destroyPdfResource(previousDocument);

    try {
      const isOfflineComplete =
        typeof localDB !== "undefined" && typeof localDB?.isBookOfflineComplete === "function"
          ? await localDB.isBookOfflineComplete(bookId).catch(() => false)
          : false;

      const colors = await this.resolveBookColors(isOfflineComplete);
      if (sequence !== reader.openSequence) return;
      reader.model.setColors(colors);
      reader.annotations.renderFloatingColors();

      const pdfDoc = await reader.loadPdfDocument(bookId, sequence);
      if (sequence !== reader.openSequence) {
        reader.destroyPdfResource(pdfDoc);
        return;
      }
      reader.loadingTask = null;
      reader.model.setBook(bookId, pdfDoc, pdfDoc.numPages);
      await this.loadNavigationMap(pdfDoc, sequence);
      if (sequence !== reader.openSequence) return;

      const offlineStatus = await this.resolveOfflineStatus(bookId, pdfDoc.numPages, isOfflineComplete);
      if (sequence !== reader.openSequence) return;
      reader.toolbar.setOfflineStatus(offlineStatus);

      let initialPage = startPage != null && startPage > 0 ? startPage : 1;
      const progress = await this.resolveInitialProgress(bookId, isOfflineComplete);
      if (sequence !== reader.openSequence) return;
      if (progress?.current_page && (startPage == null || progress.current_page > initialPage)) {
        initialPage = progress.current_page;
      }
      reader.model.setCurrentPage(initialPage);

      if (!isOfflineComplete) {
        try {
          await api.markBookOpened(bookId, {
            current_page: reader.model.currentPage,
            total_pages: reader.model.totalPages,
            percentage: LibraryModel.formatReadingProgress(reader.model.currentPage, reader.model.totalPages),
          });
        } catch (error) {
          console.warn("[ReaderViewModel] Could not record opening of book:", error);
        }
      }
      if (sequence !== reader.openSequence) return;

      const annots = await this.resolveBookAnnotations(bookId, isOfflineComplete);
      if (sequence !== reader.openSequence) return;
      reader.model.setAnnotations(annots);
      reader.annotations.renderDrawerAnnotations();

      await this.applyInitialFitScale(initialPage);
      reader.nav.syncViewModeUI();
      reader.nav.updateHUD();
      await reader.renderCurrentViewMode(initialPage);
      if (sequence !== reader.openSequence) return;
      reader.mobile?.onBookOpened();

      if (isOfflineComplete) {
        this.reconcileOfflineCompleteBookInBackground(bookId, sequence, initialPage);
      }
    } catch (err) {
      if (sequence !== reader.openSequence) return;
      console.error("[ReaderViewModel] Error opening book:", err);
      alert(`Error opening book: ${err.message}`);
      reader.close();
    }
  }

  async loadNavigationMap(pdfDoc, sequence) {
    const reader = this.reader;
    const navigationMap = reader.model.navigationMap;
    navigationMap.reset();
    if (!pdfDoc || typeof pdfDoc.getOutline !== "function") return false;

    try {
      const outline = await pdfDoc.getOutline();
      if (sequence !== reader.openSequence) return false;
      if (!Array.isArray(outline)) return true;

      const destinations = new Map();
      const toc = [];
      for (const item of outline) {
        const entry = await this.createNavigationEntry(item, 0, pdfDoc, destinations);
        if (entry) toc.push(entry);
      }

      if (sequence !== reader.openSequence) return false;
      navigationMap.setTableOfContents(toc, destinations);
      return true;
    } catch (error) {
      if (sequence === reader.openSequence) {
        navigationMap.reset();
        console.warn("[ReaderViewModel] Could not load the PDF table of contents:", error);
      }
      return false;
    }
  }

  async createNavigationEntry(item, level, pdfDoc, destinations) {
    if (!item || typeof item !== "object") return null;

    let page = null;
    if (item.dest != null) {
      try {
        page = await this.resolveDestinationPage(pdfDoc, item.dest);
        if (page !== null && typeof item.dest === "string") {
          destinations.set(item.dest, page);
        }
      } catch (error) {
        console.warn("[ReaderViewModel] Could not resolve a PDF outline destination:", error);
      }
    }

    const children = [];
    if (Array.isArray(item.items)) {
      for (const child of item.items) {
        const entry = await this.createNavigationEntry(child, level + 1, pdfDoc, destinations);
        if (entry) children.push(entry);
      }
    }

    return { title: String(item.title ?? ""), page, level, children };
  }

  async resolveDestinationPage(pdfDoc, destination) {
    const resolved =
      typeof destination === "string"
        ? typeof pdfDoc.getDestination === "function"
          ? await pdfDoc.getDestination(destination)
          : null
        : destination;
    if (!Array.isArray(resolved) || resolved.length === 0) return null;

    const pageReference = resolved[0];
    const pageIndex = Number.isInteger(pageReference) ? pageReference : await pdfDoc.getPageIndex(pageReference);
    if (!Number.isInteger(pageIndex) || pageIndex < 0) return null;
    if (Number.isInteger(pdfDoc.numPages) && pageIndex >= pdfDoc.numPages) return null;
    return pageIndex + 1;
  }

  reconcileServerConnection() {
    return this.reconciler.reconcileServerConnection();
  }

  reconcileOpenBook(bookId, sequence) {
    return this.reconciler.reconcileOpenBook(bookId, sequence);
  }

  reconcileOfflineCompleteBookInBackground(bookId, sequence, initialPage) {
    return this.reconciler.reconcileOfflineCompleteBookInBackground(bookId, sequence, initialPage);
  }

  updateBookInfo(bookId, sequence) {
    return this.reconciler.updateBookInfo(bookId, sequence);
  }

  async loadPdfDocument(bookId, sequence) {
    const reader = this.reader;
    let cachedBlob = null;
    let isComplete = false;
    try {
      if (typeof localDB !== "undefined" && typeof localDB?.isBookOfflineComplete === "function") {
        isComplete = await localDB.isBookOfflineComplete(bookId);
      }
    } catch (_) {}

    if (isComplete) {
      cachedBlob = await localDB.getPdfBlob(bookId).catch(() => null);
      if (cachedBlob) {
        const task = pdfjsLib.getDocument({ data: new Uint8Array(await cachedBlob.arrayBuffer()) });
        reader.loadingTask = task;
        return task.promise;
      }
    }

    let task = pdfjsLib.getDocument(`/api/books/${bookId}/pdf`);
    reader.loadingTask = task;
    try {
      return await task.promise;
    } catch (networkError) {
      reader.destroyPdfResource(task);
      if (sequence !== reader.openSequence) throw networkError;
      cachedBlob = cachedBlob || (await localDB.getPdfBlob(bookId).catch(() => null));
      if (!cachedBlob) throw networkError;

      task = pdfjsLib.getDocument({ data: new Uint8Array(await cachedBlob.arrayBuffer()) });
      reader.loadingTask = task;
      return task.promise;
    }
  }

  destroyPdfResource(resource) {
    if (!resource || typeof resource.destroy !== "function") return;
    try {
      const result = resource.destroy();
      result?.catch?.((error) => console.warn("[ReaderViewModel] Error liberando recursos PDF:", error));
    } catch (error) {
      console.warn("[ReaderViewModel] Error liberando recursos PDF:", error);
    }
  }

  async close() {
    const reader = this.reader;
    reader.openSequence += 1;
    reader.hideJumpBreadcrumb?.(true);
    const loadingTask = reader.loadingTask;
    const pdfDoc = reader.model.pdfDoc;
    reader.loadingTask = null;

    reader.mobile?.exitFullscreen();
    reader.drawing?.toggleDrawMode?.(false);
    reader.drawing?.setDrawTool?.("pen", false);
    reader.container.style.display = "none";
    document.body.style.overflow = "";
    reader.mobile?.onBookClosed();

    await reader.persistProgressNow();

    try {
      await api.syncPendingProgress("book close");
    } catch (e) {
      console.warn("[ReaderViewModel] Failed to sync progress on close:", e);
    }

    reader.renderer.resetViewportDOM();
    reader.model.reset();
    reader.destroyPdfResource(loadingTask);
    reader.destroyPdfResource(pdfDoc);

    if (typeof window.app?.loadHome === "function") {
      await window.app.loadHome();
    }
  }
}

window.ReaderDocumentLifecycle = ReaderDocumentLifecycle;
