/**
 * ReaderNavigationViewModel.js
 * Manages page transitions, view mode switching, zooming, and HUD updates.
 */
class ReaderNavigationViewModel {
  constructor(model, elements, callbacks) {
    this.model = model;
    this.viewportEl = elements.viewportEl;
    this.bodyEl = elements.bodyEl;
    this.scrubber = elements.scrubber;
    this.pageText = elements.pageText;
    this.pageShortcuts = elements.pageShortcuts;
    this.callbacks = callbacks; // { onRenderRequest, onSaveProgress }
  }

  goToPage(pageNumber) {
    const clamped = this.model.setCurrentPage(pageNumber);
    this.updateHUD();

    if (this.callbacks.onSaveProgress) {
      this.callbacks.onSaveProgress(clamped);
    }

    if (this.callbacks.onRenderRequest) {
      this.callbacks.onRenderRequest(clamped);
    }
  }

  nextPage() {
    if (this.model.viewMode === 'flow') {
      this.bodyEl.scrollBy({ top: window.innerHeight * 0.85, behavior: 'smooth' });
    } else if (this.model.viewMode === 'dual') {
      this.goToPage(this.model.getNextDualPageNumber());
    } else {
      this.goToPage(this.model.getNextPageNumber());
    }
  }

  prevPage() {
    if (this.model.viewMode === 'flow') {
      this.bodyEl.scrollBy({ top: -window.innerHeight * 0.85, behavior: 'smooth' });
    } else if (this.model.viewMode === 'dual') {
      this.goToPage(this.model.getPrevDualPageNumber());
    } else {
      this.goToPage(this.model.getPrevPageNumber());
    }
  }

  handlePageInputSubmit() {
    const input = document.getElementById('reader-page-input');
    if (!input) return;
    const num = parseInt(input.value.trim(), 10);
    if (isNaN(num)) {
      input.value = this.model.currentPage;
      return;
    }
    if (num !== this.model.currentPage) this.goToPage(num);
    input.value = this.model.currentPage;
    input.blur();
  }

  setViewMode(mode) {
    this.model.setViewMode(mode);
    this.syncViewModeUI();

    if (this.callbacks.onRenderRequest) {
      this.callbacks.onRenderRequest(this.model.currentPage);
    }
  }

  syncViewModeUI() {
    const select = document.getElementById('view-mode-select');
    if (select) select.value = this.model.viewMode === 'paginated' ? 'single' : this.model.viewMode;

    this.viewportEl.classList.toggle('flow-mode', this.model.viewMode === 'flow');
    this.viewportEl.classList.toggle('dual-mode', this.model.viewMode === 'dual');
    this.viewportEl.classList.toggle('notes-mode', this.model.viewMode === 'notes');
  }

  async calculateFitWidthScale(pageNumber = this.model.currentPage) {
    if (!this.model.pdfDoc) return 1.0;
    try {
      const page = await this.model.pdfDoc.getPage(pageNumber || 1);
      const unscaledViewport = page.getViewport({ scale: 1.0 });
      const availableWidth = Math.max(300, (this.bodyEl?.clientWidth || window.innerWidth) * 0.90);
      const targetWidth = this.model.viewMode === 'dual' ? (availableWidth - 24) / 2 : availableWidth;
      const calculated = targetWidth / unscaledViewport.width;
      return Math.max(0.25, Math.min(5.0, Math.round(calculated * 100) / 100));
    } catch (e) {
      return 1.0;
    }
  }

  async calculateFitPageScale(pageNumber = this.model.currentPage) {
    if (!this.model.pdfDoc) return 1.0;
    try {
      const page = await this.model.pdfDoc.getPage(pageNumber || 1);
      const unscaledViewport = page.getViewport({ scale: 1.0 });
      const availableWidth = Math.max(300, (this.bodyEl?.clientWidth || window.innerWidth) * 0.90);
      const availableHeight = Math.max(300, (this.bodyEl?.clientHeight || window.innerHeight) - 180);
      const targetWidth = this.model.viewMode === 'dual' ? (availableWidth - 24) / 2 : availableWidth;
      const scaleW = targetWidth / unscaledViewport.width;
      const scaleH = availableHeight / unscaledViewport.height;
      const calculated = Math.min(scaleW, scaleH);
      return Math.max(0.25, Math.min(5.0, Math.round(calculated * 100) / 100));
    } catch (e) {
      return 1.0;
    }
  }

  async fitWidth() {
    this.model.setFitMode('width');
    const scale = await this.calculateFitWidthScale();
    this.setZoom(scale, false, { isZoom: true });
  }

  async fitPage() {
    this.model.setFitMode('page');
    const scale = await this.calculateFitPageScale();
    this.setZoom(scale, false, { isZoom: true });
  }

  zoomIn(focalPoint = null) {
    this.model.setFitMode(null);
    this.setZoom(this.model.calculateZoomInScale(), false, focalPoint || { isZoom: true });
  }

  zoomOut(focalPoint = null) {
    this.model.setFitMode(null);
    this.setZoom(this.model.calculateZoomOutScale(), false, focalPoint || { isZoom: true });
  }

  resetZoom(focalPoint = null) {
    this.model.setFitMode(null);
    this.setZoom(1.0, true, focalPoint || { isZoom: true });
  }

  setZoom(scale, clearFitMode = true, focalPoint = null) {
    if (clearFitMode) {
      this.model.setFitMode(null);
    }
    this.model.setScale(scale);
    this.updateHUD();
    if (this.callbacks.onRenderRequest) {
      this.callbacks.onRenderRequest(this.model.currentPage, focalPoint || { isZoom: true });
    }
  }

  updateHUD() {
    const pageInput = document.getElementById('reader-page-input');
    const pageTotal = document.getElementById('reader-page-total');
    ReaderHUDView.updatePageDisplay(
      pageInput,
      pageTotal,
      this.scrubber,
      this.pageText,
      this.model.currentPage,
      this.model.totalPages
    );
    ReaderHUDView.updatePageShortcuts(
      this.pageShortcuts,
      this.model.currentPage,
      this.model.totalPages,
      (page) => this.goToPage(page)
    );
    const zoomLabel = document.getElementById('reader-zoom-reset-btn');
    if (zoomLabel) zoomLabel.textContent = `${Math.round(this.model.scale * 100)}%`;

    const fitWidthBtn = document.getElementById('reader-fit-width-btn');
    if (fitWidthBtn) fitWidthBtn.classList.toggle('active', this.model.fitMode === 'width');

    const fitPageBtn = document.getElementById('reader-fit-page-btn');
    if (fitPageBtn) fitPageBtn.classList.toggle('active', this.model.fitMode === 'page');
  }

  currentEffectiveScale(pageNumber) {
    return this.model.scale;
  }
}

window.ReaderNavigationViewModel = ReaderNavigationViewModel;
