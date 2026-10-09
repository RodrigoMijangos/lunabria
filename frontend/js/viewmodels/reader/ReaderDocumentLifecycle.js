/** Coordinates document opening, metadata and cleanup through the reader facade. */
class ReaderDocumentLifecycle {
  constructor(reader) {
    this.reader = reader;
    this._reconciliationPromise = null;
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
      const isOfflineComplete = (typeof localDB !== 'undefined' && localDB && typeof localDB.isBookOfflineComplete === 'function')
        ? await localDB.isBookOfflineComplete(bookId).catch(() => false)
        : false;

      let colors;
      if (isOfflineComplete && typeof localStorage !== 'undefined' && localStorage) {
        try {
          const raw = localStorage.getItem('moon_cached_colors');
          if (raw) colors = JSON.parse(raw);
        } catch (_) {}
      }

      if (!colors || !Array.isArray(colors) || colors.length === 0) {
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

      let isPdfCached = false;
      let areLayoutsCached = false;
      if (isOfflineComplete) {
        isPdfCached = true;
        areLayoutsCached = true;
      } else {
        [isPdfCached, areLayoutsCached] = await Promise.all([
          localDB.isPdfCached(bookId).catch(() => false),
          localDB.hasAllLayoutsCached(bookId, pdfDoc.numPages).catch(() => false)
        ]);
      }
      if (sequence !== reader.openSequence) return;
      reader.toolbar.setOfflineStatus({ pdfCached: isPdfCached, layoutsCached: areLayoutsCached });

      let initialPage = (startPage != null && startPage > 0) ? startPage : 1;
      let progress = null;
      if (isOfflineComplete) {
        if (typeof localDB !== 'undefined' && localDB && typeof localDB.getLocalProgress === 'function') {
          progress = await localDB.getLocalProgress(bookId).catch(() => null);
        }
      } else {
        progress = await api.getProgress(bookId);
      }
      if (sequence !== reader.openSequence) return;
      if (progress && progress.current_page) {
        if (startPage == null || progress.current_page > initialPage) {
          initialPage = progress.current_page;
        }
      }
      reader.model.setCurrentPage(initialPage);

      if (!isOfflineComplete) {
        try {
          await api.markBookOpened(bookId, {
            current_page: reader.model.currentPage,
            total_pages: reader.model.totalPages,
            percentage: LibraryModel.formatReadingProgress(reader.model.currentPage, reader.model.totalPages)
          });
        } catch (error) {
          console.warn('[ReaderViewModel] Could not record opening of book:', error);
        }
      }
      if (sequence !== reader.openSequence) return;

      let annots = [];
      if (isOfflineComplete) {
        if (typeof localDB !== 'undefined' && localDB && typeof localDB.getCachedAnnotations === 'function') {
          annots = (await localDB.getCachedAnnotations(bookId).catch(() => null)) || [];
        }
      } else {
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

      // Reconcile offline-complete books in the background; failed requests are harmless here.
      if (isOfflineComplete) {
        this.reconcileOfflineCompleteBookInBackground(bookId, sequence, initialPage);
      }
    } catch (err) {
      if (sequence !== reader.openSequence) return;
      console.error('[ReaderViewModel] Error opening book:', err);
      alert('Error opening book: ' + err.message);
      reader.close();
    }
  }

  reconcileServerConnection() {
    const reader = this.reader;
    const bookId = reader.model.bookId;
    const sequence = reader.openSequence;
    if (!bookId || reader.container?.style.display !== 'flex') return Promise.resolve(false);

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
    const isCurrentBook = () => sequence === reader.openSequence &&
      Number(reader.model.bookId) === Number(bookId) && reader.container?.style.display === 'flex';

    try {
      if (typeof localDB !== 'undefined' && typeof localDB.processOutboxQueue === 'function') {
        await localDB.processOutboxQueue();
      }
      if (!isCurrentBook()) return false;

      const pendingOps = typeof localDB !== 'undefined' && typeof localDB.getPendingOutboxOps === 'function'
        ? (await localDB.getPendingOutboxOps().catch(() => [])) || []
        : [];
      const bookOps = pendingOps.filter(op => Number(op.bookId) === Number(bookId));
      const hasPendingAnnotations = bookOps.some(op => op.type === 'annotation');
      const hasPendingProgress = bookOps.some(op => op.type === 'progress');
      const [annotations, progress] = await Promise.all([
        hasPendingAnnotations || typeof api.getAnnotations !== 'function'
          ? null
          : api.getAnnotations(bookId),
        hasPendingProgress || typeof api.getProgress !== 'function'
          ? null
          : api.getProgress(bookId)
      ]);
      if (!isCurrentBook()) return false;

      if (annotations !== null) {
        if (!Array.isArray(annotations)) throw new Error('Invalid annotations response');
        reader.model.setAnnotations(annotations);
        if (typeof localDB !== 'undefined' && typeof localDB.saveCachedAnnotations === 'function') {
          await localDB.saveCachedAnnotations(bookId, annotations).catch(() => {});
        }
        if (!isCurrentBook()) return false;
        reader.annotations.renderDrawerAnnotations();
        reader.annotations.refreshPageHighlights?.(reader.model.currentPage);
        if (reader.model.viewMode === 'notes') reader.notes?.renderNotesMode();
      }

      const serverPage = Number(progress?.current_page);
      if (serverPage > Number(reader.model.currentPage) && typeof reader.nav?.goToPage === 'function') {
        await reader.nav.goToPage(serverPage);
      }
      return true;
    } catch (error) {
      console.warn('[ReaderViewModel] Could not reconcile the open book after reconnecting:', error);
      return false;
    }
  }

  reconcileOfflineCompleteBookInBackground(bookId, sequence, initialPage) {
    const reader = this.reader;
    if (typeof api !== 'undefined' && api) {
      if (typeof api.markBookOpened === 'function') {
        api.markBookOpened(bookId, {
          current_page: reader.model.currentPage,
          total_pages: reader.model.totalPages,
          percentage: LibraryModel.formatReadingProgress(reader.model.currentPage, reader.model.totalPages)
        }).catch(() => {});
      }
      if (typeof api.getProgress === 'function') {
        api.getProgress(bookId).then(progress => {
          if (sequence !== reader.openSequence) return;
          if (progress && progress.current_page && progress.current_page > reader.model.currentPage) {
            reader.nav.goToPage(progress.current_page);
          }
        }).catch(() => {});
      }
      if (typeof api.getAnnotations === 'function') {
        api.getAnnotations(bookId).then(async serverAnnots => {
          if (sequence !== reader.openSequence) return;
          if (Array.isArray(serverAnnots) && serverAnnots.length > 0) {
            reader.model.setAnnotations(serverAnnots);
            reader.annotations.renderDrawerAnnotations();
            if (typeof localDB !== 'undefined' && localDB && typeof localDB.saveCachedAnnotations === 'function') {
              await localDB.saveCachedAnnotations(bookId, serverAnnots).catch(() => {});
            }
            if (reader.annotations.refreshPageHighlights) {
              reader.annotations.refreshPageHighlights(reader.model.currentPage);
            }
          }
        }).catch(() => {});
      }
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
