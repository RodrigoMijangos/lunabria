/** Coordinates document opening, metadata and cleanup through the reader facade. */
class ReaderDocumentLifecycle {
  constructor(reader) {
    this.reader = reader;
  }

  async open(bookId, startPage = null) {
    const reader = this.reader;
    const sequence = ++reader.openSequence;
    const previousDocument = reader.model.pdfDoc;
    const previousLoadingTask = reader.loadingTask;
    reader.loadingTask = null;
    reader.renderer.resetViewportDOM();
    reader.model.reset();
    reader.toolbar.setOfflineStatus({ pdfCached: false, layoutsCached: false });
    reader.container.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    if (typeof reader.drawing?.toggleDrawMode === 'function') reader.drawing.toggleDrawMode(false);
    if (typeof reader.drawing?.setDrawTool === 'function') reader.drawing.setDrawTool('pen', false);
    reader.updateBookInfo(bookId, sequence);

    reader.destroyPdfResource(previousLoadingTask);
    reader.destroyPdfResource(previousDocument);

    try {
      let colors;
      try {
        colors = await api.getColors();
        if (Array.isArray(colors) && colors.length > 0 && typeof localStorage !== 'undefined' && localStorage) {
          try { localStorage.setItem('moon_cached_colors', JSON.stringify(colors)); } catch (_) {}
        }
      } catch (err) {
        let cached = null;
        if (typeof localStorage !== 'undefined' && localStorage) {
          try {
            const raw = localStorage.getItem('moon_cached_colors');
            if (raw) cached = JSON.parse(raw);
          } catch (_) {}
        }
        if (cached && Array.isArray(cached) && cached.length > 0) {
          colors = cached;
        } else {
          throw err;
        }
      }
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
      const [isPdfCached, areLayoutsCached] = await Promise.all([
        localDB.isPdfCached(bookId).catch(() => false),
        localDB.hasAllLayoutsCached(bookId, pdfDoc.numPages).catch(() => false)
      ]);
      if (sequence !== reader.openSequence) return;
      reader.toolbar.setOfflineStatus({ pdfCached: isPdfCached, layoutsCached: areLayoutsCached });

      let initialPage = (startPage != null && startPage > 0) ? startPage : 1;
      const progress = await api.getProgress(bookId);
      if (sequence !== reader.openSequence) return;
      if (progress && progress.current_page) {
        if (startPage == null || progress.current_page > initialPage) {
          initialPage = progress.current_page;
        }
      }
      reader.model.setCurrentPage(initialPage);
      try {
        await api.markBookOpened(bookId, {
          current_page: reader.model.currentPage,
          total_pages: reader.model.totalPages,
          percentage: LibraryModel.formatReadingProgress(reader.model.currentPage, reader.model.totalPages)
        });
      } catch (error) {
        console.warn('[ReaderViewModel] Could not record opening of book:', error);
      }
      if (sequence !== reader.openSequence) return;

      let annots = [];
      try {
        annots = await api.getAnnotations(bookId);
        if (!Array.isArray(annots)) throw new Error('Invalid annotations response');
        if (typeof localDB !== 'undefined' && localDB && typeof localDB.saveCachedAnnotations === 'function') {
          try {
            await localDB.saveCachedAnnotations(bookId, annots);
          } catch (cacheError) {
            console.warn('[ReaderViewModel] Could not cache annotations:', cacheError);
          }
        }
      } catch (err) {
        console.warn('[ReaderViewModel] Failed to fetch annotations from server, trying cached annotations:', err);
        if (typeof localDB !== 'undefined' && localDB && typeof localDB.getCachedAnnotations === 'function') {
          annots = (await localDB.getCachedAnnotations(bookId).catch(() => null)) || [];
        }
      }
      if (sequence !== reader.openSequence) return;
      reader.model.setAnnotations(annots);
      reader.annotations.renderDrawerAnnotations();

      if (reader.model.fitMode === 'page') {
        const fitScale = await reader.nav.calculateFitPageScale(initialPage);
        reader.model.setScale(fitScale);
      } else if (reader.model.fitMode === 'width' || !reader.model.scale) {
        const fitScale = await reader.nav.calculateFitWidthScale(initialPage);
        reader.model.setScale(fitScale);
        if (!reader.model.fitMode) reader.model.setFitMode('width');
      }

      reader.nav.syncViewModeUI();
      reader.nav.updateHUD();
      await reader.renderCurrentViewMode(initialPage);
      reader.mobile?.onBookOpened();
    } catch (err) {
      if (sequence !== reader.openSequence) return;
      console.error('[ReaderViewModel] Error opening book:', err);
      alert('Error opening book: ' + err.message);
      reader.close();
    }
  }

  updateBookInfo(bookId, sequence) {
    const reader = this.reader;
    const titleElement = document.getElementById('reader-book-title');
    const authorElement = document.getElementById('reader-book-author');
    let cachedBook = window.app?.model?.getBookById(Number(bookId));
    const fallbackTitle = `Book ${bookId}` || 'Untitled';

    ReaderHUDView.updateBookInfo(titleElement, authorElement, cachedBook, fallbackTitle);

    if (!cachedBook && typeof localDB !== 'undefined' && localDB && typeof localDB.open === 'function') {
      localDB.open().then(db => {
        const tx = db.transaction('cached_books', 'readonly');
        const store = tx.objectStore('cached_books');
        const req = store.get(Number(bookId));
        req.onsuccess = () => {
          if (req.result && sequence === reader.openSequence && !cachedBook) {
            ReaderHUDView.updateBookInfo(titleElement, authorElement, req.result, fallbackTitle);
          }
        };
      }).catch(() => {});
    }

    api.getBook(bookId).then(book => {
      if (sequence !== reader.openSequence) return;
      ReaderHUDView.updateBookInfo(titleElement, authorElement, book, fallbackTitle);
    }).catch(error => {
      console.warn('[ReaderViewModel] Could not load book metadata:', error);
    });
  }

  async loadPdfDocument(bookId, sequence) {
    const reader = this.reader;
    let cachedBlob = null;
    let isComplete = false;
    try {
      if (typeof localDB !== 'undefined' && localDB && typeof localDB.isBookOfflineComplete === 'function') {
        isComplete = await localDB.isBookOfflineComplete(bookId);
      }
    } catch (_) {}

    if (navigator.onLine === false || isComplete) {
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
      cachedBlob = cachedBlob || await localDB.getPdfBlob(bookId).catch(() => null);
      if (!cachedBlob) throw networkError;

      task = pdfjsLib.getDocument({ data: new Uint8Array(await cachedBlob.arrayBuffer()) });
      reader.loadingTask = task;
      return task.promise;
    }
  }

  destroyPdfResource(resource) {
    const reader = this.reader;
    if (!resource || typeof resource.destroy !== 'function') return;
    try {
      const result = resource.destroy();
      if (result && typeof result.catch === 'function') {
        result.catch(error => console.warn('[ReaderViewModel] Error liberando recursos PDF:', error));
      }
    } catch (error) {
      console.warn('[ReaderViewModel] Error liberando recursos PDF:', error);
    }
  }

  async close() {
    const reader = this.reader;
    reader.openSequence += 1;
    const loadingTask = reader.loadingTask;
    const pdfDoc = reader.model.pdfDoc;
    reader.loadingTask = null;

    reader.mobile?.exitFullscreen();
    if (typeof reader.drawing?.toggleDrawMode === 'function') reader.drawing.toggleDrawMode(false);
    if (typeof reader.drawing?.setDrawTool === 'function') reader.drawing.setDrawTool('pen', false);
    reader.container.style.display = 'none';
    document.body.style.overflow = '';
    reader.mobile?.onBookClosed();

    // 1. Immediately persist locally
    await reader.persistProgressNow();

    // 2. Guarantee synchronization to server upon book close
    try {
      await api.syncPendingProgress('book close');
    } catch (e) {
      console.warn('[ReaderViewModel] Failed to sync progress on close:', e);
    }

    reader.renderer.resetViewportDOM();
    reader.model.reset();
    reader.destroyPdfResource(loadingTask);
    reader.destroyPdfResource(pdfDoc);

    if (window.app && typeof window.app.loadHome === 'function') {
      await window.app.loadHome();
    }
  }

}

window.ReaderDocumentLifecycle = ReaderDocumentLifecycle;
