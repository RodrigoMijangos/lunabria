/**
 * ReaderViewModel.js
 * Master ViewModel & Coordinator for Moon-Calibre PDF Reader
 * Implements MVVM Architecture & Single Responsibility Principle (SRP)
 *
 * Coordinates granular sub-viewmodels:
 * - ReaderNavigationViewModel (frontend/js/viewmodels/reader/ReaderNavigationViewModel.js)
 * - ReaderPageRenderer (frontend/js/viewmodels/reader/ReaderPageRenderer.js)
 * - ReaderDrawingViewModel (frontend/js/viewmodels/reader/ReaderDrawingViewModel.js)
 * - ReaderAnnotationViewModel (frontend/js/viewmodels/reader/ReaderAnnotationViewModel.js)
 * - ReaderNotesViewModel (frontend/js/viewmodels/reader/ReaderNotesViewModel.js)
 * - ReaderToolbarManager (frontend/js/viewmodels/reader/ReaderToolbarManager.js)
 */
class ReaderViewModel {
  constructor() {
    this.model = new ReaderModel();

    // Core DOM Elements
    this.container = document.getElementById('reader-container');
    this.viewportEl = document.getElementById('pdf-viewport');
    this.bodyEl = document.getElementById('reader-body');
    this.pageText = document.getElementById('reader-page-text');
    this.scrubber = document.getElementById('reader-scrubber');
    this.floatingToolbar = document.getElementById('floating-toolbar');
    this.highlightActionMenu = document.getElementById('highlight-action-menu');
    this.drawer = document.getElementById('reader-drawer');
    this.drawerBackdrop = document.getElementById('drawer-backdrop');

    // Granular Sub-ViewModels / Coordinators
    this.nav = new ReaderNavigationViewModel(
      this.model,
      {
        viewportEl: this.viewportEl,
        bodyEl: this.bodyEl,
        scrubber: this.scrubber,
        pageText: this.pageText,
        pageShortcuts: document.getElementById('reader-page-shortcuts')
      },
      {
        onRenderRequest: (page) => this.renderCurrentViewMode(page).catch((error) => {
          console.error('[ReaderViewModel] Error rendering page:', error);
        }),
        onSaveProgress: () => this.debounceSaveProgress()
      }
    );

    this.drawing = new ReaderDrawingViewModel(
      this.model,
      this.viewportEl,
      this.bodyEl,
      () => this.annotations
    );
    this.selectionLoupe = new ReaderNativeSelectionLoupeController(this.model, this.viewportEl);

    this.annotations = new ReaderAnnotationViewModel(
      this.model,
      {
        viewportEl: this.viewportEl,
        floatingToolbar: this.floatingToolbar,
        highlightActionMenu: this.highlightActionMenu,
        notesDrawer: this.drawer
      },
      {
        getDrawingCoordinator: () => this.drawing,
        onPageNeedsRefresh: (page) => this.goToPage(page)
      }
    );

    this.renderer = new ReaderPageRenderer(
      this.model,
      this.viewportEl,
      this.bodyEl,
      this.annotations,
      this.drawing
    );

    this.notes = new ReaderNotesViewModel(
      this.model,
      this.viewportEl,
      {
        onJumpToPage: (page) => {
          this.nav.setViewMode('paginated');
          this.nav.goToPage(page);
        },
        onRefreshAnnotations: () => this.annotations.refreshAnnotations()
      }
    );

    this.toolbar = new ReaderToolbarManager(
      this.model,
      {
        container: this.container,
        viewportEl: this.viewportEl,
        bodyEl: this.bodyEl,
        drawer: this.drawer,
        drawerBackdrop: this.drawerBackdrop
      },
      {
        nav: this.nav,
        drawing: this.drawing,
        annotations: this.annotations,
        notes: this.notes,
        onClose: () => this.close(),
        onDownloadOffline: (onProgress) => this.cacheCurrentPdf(onProgress)
      }
    );

    this.progressDebounceTimer = null;
    this.openSequence = 0;
    this.loadingTask = null;
    this.initGlobalEvents();
  }

  initGlobalEvents() {
    this.toolbar.bindAllEvents();
    this.selectionLoupe.bindEvents();
    this.annotations.renderFloatingColors();

    document.addEventListener('selectionchange', () => {
      if (this.drawing.textHighlight.isSelecting) return;
      clearTimeout(this.selectionTimeout);
      this.selectionTimeout = setTimeout(() => this.annotations.updateFloatingToolbar(), 80);
    });

    document.addEventListener('pointerdown', (e) => {
      const target = e.target instanceof Element ? e.target : null;
      if (!target) return;

      if (!target.closest('#reader-quick-highlight-palette')) {
        this.annotations.hideQuickHighlightPalette();
      }

      if (!target.closest('#highlight-action-menu') && !target.closest('.pdf-highlight-rect')) {
        if (this.highlightActionMenu) {
          this.highlightActionMenu.style.display = 'none';
          this.model.activeHighlight = null;
        }
      }

      const clickedSelectionToolbar = target.closest('#floating-toolbar');
      const clickedText = target.closest('.textLayer span');
      if (!clickedSelectionToolbar && !clickedText) this.annotations.clearTextSelection();
    });

    this.bodyEl.addEventListener('scroll', () => this.annotations.hideQuickHighlightPalette(), { passive: true });
    window.addEventListener('resize', () => this.annotations.hideQuickHighlightPalette());

    // Dismiss floating toolbar copy/note buttons
    document.getElementById('floating-copy-btn')?.addEventListener('click', () => {
      if (this.model.selectedText) {
        navigator.clipboard.writeText(ReaderModel.normalizeText(this.model.selectedText));
        this.floatingToolbar.style.opacity = '0';
        this.floatingToolbar.style.pointerEvents = 'none';
      }
    });

    document.getElementById('floating-note-btn')?.addEventListener('click', () => {
      const note = prompt('Add note to this quote:');
      if (note !== null) {
        this.annotations.applyHighlight(this.model.colors[0]?.id || 'yellow', note);
      }
    });

    // Highlight action menu: delete & edit
    document.getElementById('highlight-action-delete-btn')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (this.model.activeHighlight) {
        const id = this.model.activeHighlight.id;
        const page = this.model.activeHighlight.page;
        await api.deleteAnnotation(id);
        this.highlightActionMenu.style.display = 'none';
        this.model.activeHighlight = null;
        await this.annotations.refreshAnnotations();
        this.annotations.refreshPageHighlights(page);
      }
    });

    document.getElementById('highlight-action-note-btn')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (this.model.activeHighlight) {
        const annot = this.model.activeHighlight;
        const currentNote = annot.comment || '';
        const newNote = prompt('Edit / Add note to this highlight:', currentNote);
        if (newNote !== null) {
          await api.updateAnnotation(annot.id, { comment: newNote });
          this.highlightActionMenu.style.display = 'none';
          this.model.activeHighlight = null;
          await this.annotations.refreshAnnotations();
          this.annotations.refreshPageHighlights(annot.page);
        }
      }
    });
  }

  // ============================================================
  // Lifecycle & Master Entry Points
  // ============================================================
  async open(bookId, startPage = null) {
    const sequence = ++this.openSequence;
    const previousDocument = this.model.pdfDoc;
    const previousLoadingTask = this.loadingTask;
    this.loadingTask = null;
    this.renderer.resetViewportDOM();
    this.model.reset();
    this.toolbar.setOfflineStatus({ pdfCached: false, layoutsCached: false });
    this.container.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    this.updateBookInfo(bookId, sequence);

    this.destroyPdfResource(previousLoadingTask);
    this.destroyPdfResource(previousDocument);

    try {
      const colors = await api.getColors();
      if (sequence !== this.openSequence) return;
      this.model.setColors(colors);
      this.annotations.renderFloatingColors();

      const pdfDoc = await this.loadPdfDocument(bookId, sequence);
      if (sequence !== this.openSequence) {
        this.destroyPdfResource(pdfDoc);
        return;
      }
      this.loadingTask = null;
      this.model.setBook(bookId, pdfDoc, pdfDoc.numPages);
      const [isPdfCached, areLayoutsCached] = await Promise.all([
        localDB.isPdfCached(bookId).catch(() => false),
        localDB.hasAllLayoutsCached(bookId, pdfDoc.numPages).catch(() => false)
      ]);
      if (sequence !== this.openSequence) return;
      this.toolbar.setOfflineStatus({ pdfCached: isPdfCached, layoutsCached: areLayoutsCached });

      let initialPage = startPage || 1;
      const progress = await api.getProgress(bookId);
      if (sequence !== this.openSequence) return;
      if (progress && progress.current_page && startPage == null) {
        initialPage = progress.current_page;
      }
      this.model.setCurrentPage(initialPage);
      try {
        await api.markBookOpened(bookId, {
          current_page: this.model.currentPage,
          total_pages: this.model.totalPages,
          percentage: LibraryModel.formatReadingProgress(this.model.currentPage, this.model.totalPages)
        });
      } catch (error) {
        console.warn('[ReaderViewModel] Could not record opening of book:', error);
      }
      if (sequence !== this.openSequence) return;

      const annots = await api.getAnnotations(bookId);
      if (sequence !== this.openSequence) return;
      this.model.setAnnotations(annots);
      this.annotations.renderDrawerAnnotations();

      this.nav.syncViewModeUI();
      this.nav.updateHUD();
      await this.renderCurrentViewMode(initialPage);
    } catch (err) {
      if (sequence !== this.openSequence) return;
      console.error('[ReaderViewModel] Error opening book:', err);
      alert('Error opening book: ' + err.message);
      this.close();
    }
  }

  updateBookInfo(bookId, sequence) {
    const titleElement = document.getElementById('reader-book-title');
    const authorElement = document.getElementById('reader-book-author');
    const cachedBook = window.app?.model?.getBookById(Number(bookId));
    const fallbackTitle = `Book ${bookId}`;

    ReaderHUDView.updateBookInfo(titleElement, authorElement, cachedBook, fallbackTitle);
    api.getBook(bookId).then(book => {
      if (sequence !== this.openSequence) return;
      ReaderHUDView.updateBookInfo(titleElement, authorElement, book, fallbackTitle);
    }).catch(error => {
      console.warn('[ReaderViewModel] Could not load book metadata:', error);
    });
  }

  async loadPdfDocument(bookId, sequence) {
    let cachedBlob = null;
    if (navigator.onLine === false) {
      cachedBlob = await localDB.getPdfBlob(bookId).catch(() => null);
      if (cachedBlob) {
        const task = pdfjsLib.getDocument({ data: new Uint8Array(await cachedBlob.arrayBuffer()) });
        this.loadingTask = task;
        return task.promise;
      }
    }

    let task = pdfjsLib.getDocument(`/api/books/${bookId}/pdf`);
    this.loadingTask = task;
    try {
      return await task.promise;
    } catch (networkError) {
      this.destroyPdfResource(task);
      if (sequence !== this.openSequence) throw networkError;
      cachedBlob = cachedBlob || await localDB.getPdfBlob(bookId).catch(() => null);
      if (!cachedBlob) throw networkError;

      task = pdfjsLib.getDocument({ data: new Uint8Array(await cachedBlob.arrayBuffer()) });
      this.loadingTask = task;
      return task.promise;
    }
  }

  async cacheCurrentPdf(onProgress = () => {}) {
    const bookId = this.model.bookId;
    const totalPages = this.model.pdfDoc?.numPages;
    if (!bookId || !totalPages) throw new Error('No book is currently open to save.');

    const isPdfCached = await localDB.isPdfCached(bookId);
    if (!isPdfCached) {
      onProgress({ stage: 'pdf' });
      const response = await fetch(`/api/books/${bookId}/pdf`);
      if (!response.ok) throw new Error(`Could not download PDF (HTTP ${response.status}).`);

      const blob = await response.blob();
      const signature = new TextDecoder().decode(await blob.slice(0, 5).arrayBuffer());
      if (blob.size < 5 || (!response.headers.get('content-type')?.includes('application/pdf') && signature !== '%PDF-')) {
        throw new Error('Server did not return a valid PDF.');
      }

      await localDB.savePdfBlob(bookId, blob);
    }
    onProgress({ stage: 'pdf-complete' });

    const cachedPages = await localDB.getCachedLayoutPages(bookId);
    const isPageCached = (page) => cachedPages.has(page);
    let completedPages = 0;
    for (let page = 1; page <= totalPages; page += 1) {
      if (isPageCached(page)) completedPages += 1;
    }
    onProgress({ stage: 'layouts', completed: completedPages, total: totalPages });

    const batchSize = 10;
    for (let startPage = 1; startPage <= totalPages; startPage += batchSize) {
      const endPage = Math.min(totalPages, startPage + batchSize - 1);
      let batchIsCached = true;
      for (let page = startPage; page <= endPage; page += 1) {
        if (!isPageCached(page)) {
          batchIsCached = false;
          break;
        }
      }
      if (batchIsCached) continue;

      const downloaded = await api.prefetchLayouts(bookId, startPage, endPage);
      if (!downloaded) {
        throw new Error(`Could not save layouts for pages ${startPage}-${endPage}.`);
      }

      for (let page = startPage; page <= endPage; page += 1) {
        if (!isPageCached(page)) {
          cachedPages.add(page);
          completedPages += 1;
        }
      }
      onProgress({ stage: 'layouts', completed: completedPages, total: totalPages });
    }

    if (!(await localDB.hasAllLayoutsCached(bookId, totalPages))) {
      throw new Error('Download completed, but some layouts could not be saved. Please try again.');
    }
    return true;
  }

  destroyPdfResource(resource) {
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

  close() {
    this.openSequence += 1;
    const loadingTask = this.loadingTask;
    const pdfDoc = this.model.pdfDoc;
    this.loadingTask = null;

    this.container.style.display = 'none';
    document.body.style.overflow = '';
    this.persistProgressNow();
    this.renderer.resetViewportDOM();
    this.model.reset();
    this.destroyPdfResource(loadingTask);
    this.destroyPdfResource(pdfDoc);

    if (window.app && typeof window.app.loadHome === 'function') {
      window.app.loadHome();
    }
  }

  async renderCurrentViewMode(pageNumber) {
    if (this.model.viewMode === 'notes') {
      this.notes.renderNotesMode();
    } else if (this.model.viewMode === 'flow') {
      await this.renderer.renderFlowMode((p) => {
        if (p === this.model.currentPage) return;
        this.model.setCurrentPage(p);
        this.nav.updateHUD();
        this.debounceSaveProgress();
      }, pageNumber);
    } else if (this.model.viewMode === 'dual') {
      await this.renderer.renderDualPage(pageNumber);
    } else {
      await this.renderer.renderPage(pageNumber);
    }
  }

  // ============================================================
  // Delegation Facades (Backward Compatibility for Window/DOM)
  // ============================================================
  goToPage(num) { this.nav.goToPage(num); }
  nextPage() { this.nav.nextPage(); }
  prevPage() { this.nav.prevPage(); }
  handlePageInputSubmit() { this.nav.handlePageInputSubmit(); }
  setZoom(scale) { this.nav.setZoom(scale); }
  zoomIn() { this.nav.zoomIn(); }
  zoomOut() { this.nav.zoomOut(); }
  resetZoom() { this.nav.resetZoom(); }
  setViewMode(mode) { this.nav.setViewMode(mode); }
  updateHUD() { this.nav.updateHUD(); }
  currentEffectiveScale(pageNumber) { return this.nav.currentEffectiveScale(pageNumber); }

  renderPage(num) { return this.renderer.renderPage(num); }
  renderDualPage(num) { return this.renderer.renderDualPage(num); }
  renderFlowMode() { return this.renderer.renderFlowMode(); }

  toggleDrawMode(forceState = null) { return this.drawing.toggleDrawMode(forceState); }
  setDrawTool(tool) { this.drawing.setDrawTool(tool); }
  setDrawColor(hex) { this.drawing.setDrawColor(hex); }
  setDrawWidth(w) { this.drawing.setDrawWidth(w); }
  cycleDrawWidth(dir) { this.drawing.cycleDrawWidth(dir); }
  toggleDrawingTool() { this.drawing.toggleDrawingTool(); }
  undoLastStroke(page) { this.drawing.undoLastStroke(page); }
  clearCurrentPageDrawings(page) { this.drawing.clearCurrentPageDrawings(page); }
  renderStrokes(canvas, page, scale, outScale) { this.drawing.renderStrokes(canvas, page, scale, outScale); }

  applyHighlight(colorId, comment) { return this.annotations.applyHighlight(colorId, comment); }
  refreshAnnotations() { return this.annotations.refreshAnnotations(); }
  renderPageHighlights(layer, page) { this.annotations.renderPageHighlights(layer, page); }
  refreshPageHighlights(page) { return this.annotations.refreshPageHighlights(page); }
  openHighlightMenu(annot, el) { this.annotations.openHighlightMenu(annot, el); }
  changeHighlightColor(id, color) { return this.annotations.changeHighlightColor(id, color); }
  detectAndHighlightWordAtPoint(x, y, canvas) { this.annotations.detectAndHighlightWordAtPoint(x, y, canvas); }

  renderNotesMode() { this.notes.renderNotesMode(); }
  toggleDrawer(forceState) { this.toolbar.toggleDrawer(forceState); }
  openStylusAccessibilityModal() { this.toolbar.openStylusAccessibilityModal(); }
  closeStylusAccessibilityModal() { this.toolbar.closeStylusAccessibilityModal(); }

  debounceSaveProgress() {
    clearTimeout(this.progressDebounceTimer);
    this.progressDebounceTimer = setTimeout(() => {
      this.persistProgressNow();
    }, 400);
  }

  persistProgressNow() {
    if (!this.model.bookId || !this.model.totalPages) return;
    const pct = LibraryModel.formatReadingProgress(this.model.currentPage, this.model.totalPages);
    api.saveProgress(this.model.bookId, {
      current_page: this.model.currentPage,
      total_pages: this.model.totalPages,
      percentage: pct
    });
  }
}

window.ReaderViewModel = ReaderViewModel;
