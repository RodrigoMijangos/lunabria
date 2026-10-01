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

  zoomIn() {
    this.setZoom(this.model.calculateZoomInScale());
  }

  zoomOut() {
    this.setZoom(this.model.calculateZoomOutScale());
  }

  resetZoom() {
    this.setZoom(1.3);
  }

  setZoom(scale) {
    this.model.setScale(scale);
    this.updateHUD();
    if (this.callbacks.onRenderRequest) {
      this.callbacks.onRenderRequest(this.model.currentPage);
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
  }

  currentEffectiveScale(pageNumber) {
    return this.model.scale;
  }
}

window.ReaderNavigationViewModel = ReaderNavigationViewModel;
