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
    this.jumpBreadcrumb = document.getElementById('reader-jump-breadcrumb');
    this.jumpReturnLabel = document.getElementById('reader-jump-return-label');
    this.jumpAnnouncement = document.getElementById('reader-jump-announcement');
    this.jumpBreadcrumbElements = {
      breadcrumb: this.jumpBreadcrumb,
      readerContainer: this.container,
      returnButton: document.getElementById('reader-jump-return-btn'),
      returnLabel: this.jumpReturnLabel,
      announcement: this.jumpAnnouncement
    };
    this.jumpBreadcrumbTimer = null;
    this.jumpBreadcrumbTransitionTimer = null;
    this.jumpBreadcrumb?.addEventListener('focusout', event => {
      if (this.jumpBreadcrumb.contains?.(event.relatedTarget)) return;
      if (!this.jumpBreadcrumbTimer && !this.jumpBreadcrumb.hidden) this.scheduleJumpBreadcrumbHide();
    });

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
        onRenderRequest: (page, focalPoint) => this.renderCurrentViewMode(page, focalPoint).catch((error) => {
          console.error('[ReaderViewModel] Error rendering page:', error);
        }),
        onSaveProgress: () => this.debounceSaveProgress(),
        onPageChanged: page => this.tableOfContents?.updateActivePage(page)
      }
    );

    this.tableOfContents = new TableOfContentsView(this.model, {
      onNavigate: page => {
        this.navigateToAssistedDestination(page);
        if (this.mobile?.device?.isMobileReaderActive()) this.toolbar?.toggleDrawer(false);
      }
    });

    this.drawing = new ReaderDrawingViewModel(
      this.model,
      this.viewportEl,
      this.bodyEl,
      () => this.annotations,
      this
    );
    this.selectionLoupe = new ReaderNativeSelectionLoupeController(this.model, this.viewportEl, this.bodyEl);

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
      this.drawing,
      {
        onInternalLinkNavigate: (targetPage, sourcePage) =>
          this.navigateToAssistedDestination(targetPage, sourcePage),
        onTextReferenceNavigate: (targetPage, sourcePage) =>
          this.navigateToAssistedDestination(targetPage, sourcePage)
      }
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
        tableOfContents: this.tableOfContents,
        onClose: () => this.close(),
        onDownloadOffline: (onProgress) => this.cacheCurrentPdf(onProgress),
        onReturnToPreviousReadingPoint: () => this.returnToPreviousReadingPoint(),
        onDismissJumpBreadcrumb: () => this.dismissJumpBreadcrumb()
      }
    );

    this.progressDebounceTimer = null;
    this.openSequence = 0;
    this.loadingTask = null;
    this.eventBindings = new ReaderEventBindings(this);
    this.documentLifecycle = new ReaderDocumentLifecycle(this);
    this.offlineService = new ReaderOfflineService(this.model);
    this.mobile = (typeof MobileReaderController !== 'undefined')
      ? new MobileReaderController(this, this.model)
      : null;
    this.initGlobalEvents();
    this.mobile?.init();
  }

  initGlobalEvents() {
    this.eventBindings.bind();
  }

  // ============================================================
  // Lifecycle & Master Entry Points
  // ============================================================
  open(bookId, startPage = null) {
    return this.documentLifecycle.open(bookId, startPage);
  }

  updateBookInfo(bookId, sequence) {
    this.documentLifecycle.updateBookInfo(bookId, sequence);
  }

  loadPdfDocument(bookId, sequence) {
    return this.documentLifecycle.loadPdfDocument(bookId, sequence);
  }

  reconcileServerConnection() {
    return this.documentLifecycle.reconcileServerConnection();
  }

  cacheCurrentPdf(onProgress = () => {}) {
    return this.offlineService.cacheCurrentPdf(onProgress);
  }

  destroyPdfResource(resource) {
    this.documentLifecycle.destroyPdfResource(resource);
  }

  close() {
    return this.documentLifecycle.close();
  }

  navigateToAssistedDestination(targetPage, sourcePage = this.model.currentPage) {
    if (!Number.isInteger(targetPage) || targetPage < 1) return false;

    const recorded = targetPage !== sourcePage &&
      typeof this.model.navigationMap?.pushJump === 'function' &&
      this.model.navigationMap.pushJump(sourcePage);
    this.nav.goToPage(targetPage);
    if (recorded) {
      this.showJumpBreadcrumb(`Jumped to page ${targetPage}. Return to page ${sourcePage}.`);
    }
    return true;
  }

  returnToPreviousReadingPoint() {
    const originPage = this.model.navigationMap?.popJump?.() ?? null;
    if (!Number.isInteger(originPage) || originPage < 1) {
      this.hideJumpBreadcrumb(true);
      return false;
    }

    const breadcrumbHadFocus = this.jumpBreadcrumb?.contains?.(document.activeElement);
    this.nav.goToPage(originPage);
    if (this.model.navigationMap?.hasJumpHistory?.()) {
      const nextOrigin = this.model.navigationMap.peekJumpOrigin();
      this.showJumpBreadcrumb(`Returned to page ${originPage}. Return to page ${nextOrigin}.`);
    } else {
      this.hideJumpBreadcrumb(true);
      if (breadcrumbHadFocus) document.getElementById('reader-page-input')?.focus?.();
      if (this.jumpAnnouncement) this.jumpAnnouncement.textContent = `Returned to page ${originPage}.`;
    }
    return true;
  }

  dismissJumpBreadcrumb() {
    const breadcrumbHadFocus = this.jumpBreadcrumb?.contains?.(document.activeElement);
    this.hideJumpBreadcrumb(true);
    if (breadcrumbHadFocus) document.getElementById('reader-page-input')?.focus?.();
  }

  showJumpBreadcrumb(announcement) {
    if (!this.jumpBreadcrumb) return false;
    const originPage = this.model.navigationMap?.peekJumpOrigin?.();
    if (!Number.isInteger(originPage) || originPage < 1) return false;

    clearTimeout(this.jumpBreadcrumbTimer);
    clearTimeout(this.jumpBreadcrumbTransitionTimer);
    this.jumpBreadcrumbTimer = null;
    this.jumpBreadcrumbTransitionTimer = null;
    ReaderHUDView.showJumpBreadcrumb(
      this.jumpBreadcrumbElements,
      originPage,
      this.model.currentPage,
      announcement
    );
    this.scheduleJumpBreadcrumbHide();
    return true;
  }

  scheduleJumpBreadcrumbHide() {
    if (!this.jumpBreadcrumb || this.jumpBreadcrumb.hidden) return;
    clearTimeout(this.jumpBreadcrumbTimer);
    this.jumpBreadcrumbTimer = setTimeout(() => {
      this.jumpBreadcrumbTimer = null;
      if (this.jumpBreadcrumb.contains?.(document.activeElement)) return;
      this.hideJumpBreadcrumb();
    }, 12000);
  }

  hideJumpBreadcrumb(immediate = false) {
    clearTimeout(this.jumpBreadcrumbTimer);
    clearTimeout(this.jumpBreadcrumbTransitionTimer);
    this.jumpBreadcrumbTimer = null;
    this.jumpBreadcrumbTransitionTimer = null;
    if (!this.jumpBreadcrumb) return;

    if (!immediate && this.jumpBreadcrumb.contains?.(document.activeElement)) return;
    const hideImmediately = immediate || window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (hideImmediately) {
      ReaderHUDView.hideJumpBreadcrumb(this.jumpBreadcrumbElements, true);
      return;
    }

    ReaderHUDView.hideJumpBreadcrumb(this.jumpBreadcrumbElements);
    this.jumpBreadcrumbTransitionTimer = setTimeout(() => {
      ReaderHUDView.hideJumpBreadcrumb(this.jumpBreadcrumbElements, true);
      this.jumpBreadcrumbTransitionTimer = null;
    }, 200);
  }

  async renderCurrentViewMode(pageNumber, focalPoint = null) {
    if (this.model.viewMode === 'notes') {
      this.notes.renderNotesMode();
    } else if (this.model.viewMode === 'flow') {
      await this.renderer.renderFlowMode((p) => {
        if (p === this.model.currentPage) return;
        this.model.setCurrentPage(p);
        this.nav.updateHUD();
        this.tableOfContents?.updateActivePage(p);
        this.debounceSaveProgress();
      }, pageNumber, focalPoint);
    } else if (this.model.viewMode === 'dual') {
      await this.renderer.renderDualPage(pageNumber, focalPoint);
    } else {
      await this.renderer.renderPage(pageNumber, focalPoint);
    }
    this.tableOfContents?.updateActivePage(this.model.currentPage);
  }

  // ============================================================
  // Delegation Facades (Backward Compatibility for Window/DOM)
  // ============================================================
  goToPage(num) { this.nav.goToPage(num); }
  nextPage() { this.nav.nextPage(); }
  prevPage() { this.nav.prevPage(); }
  handlePageInputSubmit() { this.nav.handlePageInputSubmit(); }
  setZoom(scale, focalPoint = null) { this.nav.setZoom(scale, true, focalPoint); }
  zoomIn(focalPoint = null) { this.nav.zoomIn(focalPoint); }
  zoomOut(focalPoint = null) { this.nav.zoomOut(focalPoint); }
  resetZoom(focalPoint = null) { this.nav.resetZoom(focalPoint); }
  fitWidth() { return this.nav.fitWidth(); }
  fitPage() { return this.nav.fitPage(); }
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
    if (!this.model.bookId || !this.model.totalPages) return Promise.resolve();
    const pct = LibraryModel.formatReadingProgress(this.model.currentPage, this.model.totalPages);
    const progressData = {
      current_page: this.model.currentPage,
      total_pages: this.model.totalPages,
      percentage: pct
    };
    if (typeof localDB !== 'undefined' && typeof localDB.enqueueOutboxOp === 'function') {
      localDB.enqueueOutboxOp({
        id: `progress_${this.model.bookId}`,
        type: 'progress',
        action: 'save',
        bookId: Number(this.model.bookId),
        payload: progressData
      }).catch(() => {});
    }
    return api.saveProgress(this.model.bookId, progressData);
  }
}

window.ReaderViewModel = ReaderViewModel;
