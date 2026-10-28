/**
 * ReaderAnnotationViewModel.js
 * Manages text selections, precise word/line highlights, annotations sidebar, and highlight menus.
 */
class ReaderAnnotationViewModel {
  constructor(model, elements, callbacks) {
    this.model = model;
    this.viewportEl = elements.viewportEl;
    this.floatingToolbar = elements.floatingToolbar;
    this.highlightActionMenu = elements.highlightActionMenu;
    this.notesDrawer = elements.notesDrawer;
    this.getDrawingCoordinator = callbacks.getDrawingCoordinator;
    this.onPageNeedsRefresh = callbacks.onPageNeedsRefresh;
    this.toolbarView = new ReaderAnnotationToolbarView(this);
  }

  computeSelectionRects(range, pageWrapper, currentScale) {
    return this.toolbarView.computeSelectionRects(range, pageWrapper, currentScale);
  }

  _persistCachedAnnotations(annotations) {
    if (typeof localDB !== "undefined" && typeof localDB.saveCachedAnnotations === "function") {
      return localDB.saveCachedAnnotations(this.model.bookId, annotations);
    }
    return Promise.resolve();
  }

  _enqueueAnnotationOp(op) {
    if (typeof localDB !== "undefined" && typeof localDB.enqueueOutboxOp === "function") {
      return localDB.enqueueOutboxOp(op).catch(() => {});
    }
    return Promise.resolve();
  }

  _removeAnnotationOp(opId) {
    if (typeof localDB !== "undefined" && typeof localDB.removeOutboxOp === "function") {
      return localDB.removeOutboxOp(opId).catch(() => {});
    }
    return Promise.resolve();
  }

  _resolvePageWrapper(pageNumber, preferredWrapper = null) {
    return (
      preferredWrapper ||
      document.getElementById(`pdf-page-${pageNumber}`) ||
      this.viewportEl.querySelector(`.pdf-page-wrapper[data-page="${pageNumber}"]`) ||
      this.viewportEl.querySelector(".pdf-page-wrapper")
    );
  }

  async applyHighlight(colorId, comment = "", options = {}) {
    const text = this.model.selectedText;
    const pageNumber = Number(options.pageNumber || this.model.selectedPage || this.model.currentPage || 1);
    const pageWrapper = this._resolvePageWrapper(pageNumber, options.pageWrapper);
    let rects = options.rects?.length ? options.rects : this.model.selectedRects;

    if (!rects?.length && this.model.selectedRange && pageWrapper) {
      rects = this.computeSelectionRects(this.model.selectedRange, pageWrapper, this.model.scale);
    }

    if (!text || !rects?.length) {
      console.warn("[ReaderAnnotationViewModel] Cannot apply highlight: missing text or rects", { text, rects });
      return;
    }

    const colorMeta = this.model.getColorMetadata(colorId);
    const annotId =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `annot_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    const fullAnnot = {
      id: annotId,
      book_id: this.model.bookId,
      page: pageNumber,
      color: colorId,
      category: colorMeta?.name || "",
      text: ReaderModel.normalizeText(text),
      comment,
      rects,
    };

    const existingAnnots = Array.isArray(this.model.annotations) ? [...this.model.annotations] : [];
    existingAnnots.push(fullAnnot);
    this.model.setAnnotations(existingAnnots);
    this._persistCachedAnnotations(existingAnnots).catch(() => {});

    await this._enqueueAnnotationOp({
      id: `op_create_${annotId}`,
      type: "annotation",
      action: "create",
      bookId: this.model.bookId,
      entityId: annotId,
      payload: fullAnnot,
    });

    this.toolbarView.hideFloatingToolbar();
    this.clearTextSelection();
    this.renderDrawerAnnotations();

    const refreshed = this.refreshPageHighlights(pageNumber);
    const isFlow = this.model.viewMode === "flow" || this.model.viewMode === "dual-flow";
    if (!refreshed && !isFlow && this.onPageNeedsRefresh) {
      this.onPageNeedsRefresh(pageNumber);
    }
    if (options.showQuickPalette) {
      this.openQuickHighlightPalette(fullAnnot, pageNumber);
    }

    try {
      await api.createAnnotation(this.model.bookId, fullAnnot);
      await this._removeAnnotationOp(`op_create_${annotId}`);
      await this.refreshAnnotations();
      this.refreshPageHighlights(pageNumber);
    } catch (err) {
      console.warn("[ReaderAnnotationViewModel] Network save failed, kept in outbox queue:", err);
    }
  }

  async refreshAnnotations() {
    try {
      const annots = await api.getAnnotations(this.model.bookId);
      if (!Array.isArray(annots)) throw new Error("Invalid annotations response");
      this.model.setAnnotations(annots);
      try {
        await this._persistCachedAnnotations(annots);
      } catch (error) {
        console.warn("[ReaderAnnotationViewModel] Could not cache annotations:", error);
      }
      this.renderDrawerAnnotations();
      return annots;
    } catch (err) {
      if (typeof localDB !== "undefined" && typeof localDB?.getCachedAnnotations === "function") {
        const cached = await localDB.getCachedAnnotations(this.model.bookId).catch(() => null);
        if (Array.isArray(cached)) {
          this.model.setAnnotations(cached);
          this.renderDrawerAnnotations();
          return cached;
        }
      }
      throw err;
    }
  }

  renderPageHighlights(layer, pageNumber) {
    const targetPage = pageNumber || this.model.currentPage;
    const annots = this.model.getPageAnnotations(targetPage);
    HighlightOverlayView.renderPageHighlights(layer, annots, this.model.scale, this.model.colors, (annot, el) => {
      this.openHighlightMenu(annot, el);
    });
  }

  refreshPageHighlights(pageNumber) {
    const targetPage = Number(pageNumber || this.model.currentPage);
    const wrapper =
      document.getElementById(`pdf-page-${targetPage}`) ||
      this.viewportEl.querySelector(`.pdf-page-wrapper[data-page="${targetPage}"]`);
    if (!wrapper) return false;

    let hlLayer = wrapper.querySelector(".pdf-highlight-layer");
    if (!hlLayer) {
      hlLayer = HighlightOverlayView.createHighlightLayerContainer();
      const drawCanvas = wrapper.querySelector(".pdf-drawing-canvas");
      if (drawCanvas) wrapper.insertBefore(hlLayer, drawCanvas);
      else wrapper.appendChild(hlLayer);
    }
    this.renderPageHighlights(hlLayer, targetPage);
    return true;
  }

  openHighlightMenu(annot, highlightEl) {
    this.toolbarView.openHighlightMenu(annot, highlightEl);
  }

  openQuickHighlightPalette(annot, pageNumber, fallbackBounds = null) {
    this.toolbarView.openQuickHighlightPalette(annot, pageNumber, fallbackBounds);
  }

  hideQuickHighlightPalette() {
    this.toolbarView.hideQuickHighlightPalette();
  }

  async changeHighlightColor(annotId, newColorId, pageNumber = null) {
    const annot = this.model.annotations.find((a) => String(a.id) === String(annotId)) || this.model.activeHighlight;
    const targetPage = Number(annot?.page || pageNumber || this.model.currentPage);
    const colorMeta = this.model.getColorMetadata(newColorId);
    const categoryName = colorMeta?.name || "";

    if (annot) {
      annot.color = newColorId;
      annot.category = categoryName;
    }
    if (this.model.activeHighlight && String(this.model.activeHighlight.id) === String(annotId)) {
      this.model.activeHighlight.color = newColorId;
      this.model.activeHighlight.category = categoryName;
    }

    for (const el of document.querySelectorAll(`.pdf-highlight-rect[data-annotation-id="${annotId}"]`)) {
      el.style.backgroundColor = colorMeta ? colorMeta.color : "#ffeb3b";
    }

    if (this.highlightActionMenu) this.highlightActionMenu.style.display = "none";
    this.hideQuickHighlightPalette();
    this.model.activeHighlight = null;

    this._persistCachedAnnotations(this.model.annotations).catch(() => {});

    const payload = { color: newColorId, category: categoryName };
    await this._enqueueAnnotationOp({
      id: `op_update_${annotId}`,
      type: "annotation",
      action: "update",
      bookId: this.model.bookId,
      entityId: annotId,
      payload,
    });

    try {
      await api.updateAnnotation(annotId, payload);
      await this._removeAnnotationOp(`op_update_${annotId}`);
      await this.refreshAnnotations();
    } catch (err) {
      console.warn("[ReaderAnnotationViewModel] Error updating annotation color, queued in outbox:", err);
    }

    this.refreshPageHighlights(targetPage);
  }

  async deleteAnnotationItem(annot) {
    this.model.setAnnotations((this.model.annotations || []).filter((a) => String(a.id) !== String(annot.id)));
    this._persistCachedAnnotations(this.model.annotations).catch(() => {});
    await this._enqueueAnnotationOp({
      id: `op_del_${annot.id}`,
      type: "annotation",
      action: "delete",
      bookId: this.model.bookId,
      entityId: annot.id,
    });
    this.renderDrawerAnnotations();
    this.refreshPageHighlights(annot.page);
    try {
      await api.deleteAnnotation(annot.id);
      await this._removeAnnotationOp(`op_del_${annot.id}`);
      await this.refreshAnnotations();
    } catch (delErr) {
      console.warn("[ReaderAnnotationViewModel] Delete failed, queued in outbox:", delErr);
    }
    this.refreshPageHighlights(annot.page);
  }

  detectAndHighlightWordAtPoint(clientX, clientY, drawCanvas) {
    try {
      drawCanvas.style.pointerEvents = "none";
      const wordRange = this.toolbarView.resolveWordRangeAtPoint(clientX, clientY, drawCanvas);
      const sel = wordRange ? window.getSelection() : null;
      if (!wordRange || !sel) return;

      sel.removeAllRanges();
      sel.addRange(wordRange);
      this.model.selectedRange = wordRange;
      this.model.selectedText = wordRange.toString().trim();
      const pageWrapper = drawCanvas.parentElement?.closest?.(".pdf-page-wrapper") || drawCanvas.parentElement;
      const pageNumber = pageWrapper?.dataset?.page ? Number(pageWrapper.dataset.page) : this.model.currentPage;
      this.model.selectedPage = pageNumber;
      const rects = pageWrapper ? this.computeSelectionRects(wordRange, pageWrapper, this.model.scale) : [];
      this.model.selectedRects = rects;
      const colorId = this.model.getHighlightColorIdFromHex(this.model.drawColor);
      this.applyHighlight(colorId, "", { showQuickPalette: true, pageNumber, pageWrapper, rects });
    } catch (err) {
      console.warn("[ReaderAnnotationViewModel] Caret detection:", err);
    }
  }

  renderFloatingColors() {
    this.toolbarView.renderFloatingColors();
  }

  clearTextSelection() {
    window.getSelection()?.removeAllRanges();
    this.model.selectedRange = null;
    this.model.selectedText = "";
    this.model.selectedRects = [];
    this.model.selectedPage = null;
    this.toolbarView.hideFloatingToolbar();
  }

  toolbarSafeBounds() {
    return this.toolbarView.toolbarSafeBounds();
  }

  positionAnnotationToolbar(toolbar, firstRect, lastRect, safeTop, safeBottom) {
    this.toolbarView.positionAnnotationToolbar(toolbar, firstRect, lastRect, safeTop, safeBottom);
  }

  updateFloatingToolbar() {
    return this.toolbarView.updateFloatingToolbar();
  }

  renderDrawerAnnotations() {
    this.toolbarView.renderDrawerAnnotations();
  }
}

window.ReaderAnnotationViewModel = ReaderAnnotationViewModel;
