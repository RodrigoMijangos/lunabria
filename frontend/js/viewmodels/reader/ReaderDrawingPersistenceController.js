/**
 * Drawing rendering, page targeting and persistence.
 * Methods run with ReaderDrawingViewModel as their receiver to retain its live state.
 */
class ReaderDrawingPersistenceController {
  renderStrokes(canvas, pageNumber, customScale = null, customOutputScale = null) {
    const strokes = this.model.getPageStrokes(pageNumber);
    const effScale = customScale || this.model.scale;
    const outScale = customOutputScale || (window.devicePixelRatio || 1);
    const pressureSens = this.model.getAccessibilitySetting('pressureSensitivity') || 'normal';
    DrawingCanvasView.renderStrokes(canvas, strokes, this.currentStroke, this.activeDrawPage, pageNumber, effScale, outScale, pressureSens);
  }

  reRenderAllCanvasStrokes() {
    const canvases = this.viewportEl.querySelectorAll('.pdf-drawing-canvas');
    canvases.forEach(canvas => {
      const pageNum = Number(canvas.dataset.page);
      if (pageNum) {
        this.renderStrokes(canvas, pageNum);
      }
    });
  }

  getVisiblePageNumber() {
    if (this.model.viewMode !== 'flow') {
      return this.model.currentPage || 1;
    }
    const wrappers = Array.from(this.viewportEl?.querySelectorAll ? this.viewportEl.querySelectorAll('.pdf-page-wrapper') : []);
    if (!wrappers.length) return this.model.currentPage || 1;
    const bodyRect = this.bodyEl?.getBoundingClientRect ? this.bodyEl.getBoundingClientRect() : { top: 0, height: (typeof window !== 'undefined' ? window.innerHeight : 800) };
    const center = bodyRect.top + bodyRect.height / 2;
    let closestPage = this.model.currentPage || 1;
    let minDistance = Infinity;
    for (const wrapper of wrappers) {
      if (typeof wrapper.getBoundingClientRect !== 'function') continue;
      const rect = wrapper.getBoundingClientRect();
      const pageNum = Number(wrapper.dataset?.page || (wrapper.id && wrapper.id.replace('pdf-page-', '')));
      if (!pageNum) continue;
      const dist = Math.abs((rect.top + rect.height / 2) - center);
      if (dist < minDistance) {
        minDistance = dist;
        closestPage = pageNum;
      }
    }
    return closestPage;
  }

  isPageVisible(pageNum) {
    const wrapper = this.viewportEl?.querySelector ? this.viewportEl.querySelector(`.pdf-page-wrapper[data-page="${pageNum}"], #pdf-page-${pageNum}`) : null;
    if (!wrapper || typeof wrapper.getBoundingClientRect !== 'function') return false;
    const rect = wrapper.getBoundingClientRect();
    const vHeight = typeof window !== 'undefined' ? window.innerHeight : 800;
    return rect.bottom > 60 && rect.top < vHeight - 60;
  }

  resolveTargetDrawPage(pageNumber = null) {
    if (pageNumber) return Number(pageNumber);
    const visiblePage = this.getVisiblePageNumber();
    if (this.model.getPageStrokes(visiblePage)?.length > 0) {
      return Number(visiblePage);
    }
    if (this.activeDrawPage && this.model.getPageStrokes(this.activeDrawPage)?.length > 0) {
      return Number(this.activeDrawPage);
    }
    return Number(visiblePage || this.activeDrawPage || this.model.currentPage || 1);
  }

  undoLastStroke(pageNumber = null) {
    const targetPage = this.resolveTargetDrawPage(pageNumber);
    const removed = this.model.removeLastStrokeFromPage(targetPage);
    if (removed) {
      const canvases = this.viewportEl?.querySelectorAll
        ? this.viewportEl.querySelectorAll(`.pdf-drawing-canvas[data-page="${targetPage}"]`)
        : (typeof document !== 'undefined' && document.querySelectorAll ? document.querySelectorAll(`.pdf-drawing-canvas[data-page="${targetPage}"]`) : []);
      canvases.forEach(canvas => this.renderStrokes(canvas, targetPage));
      this.persistPageDrawings(targetPage);
    }
  }

  async clearCurrentPageDrawings(pageNumber = null) {
    const targetPage = this.resolveTargetDrawPage(pageNumber);
    this.isDrawing = false;
    this.currentStroke = null;
    this.strokePoints = [];
    if (this.activeDrawPage === targetPage) {
      this.activeDrawPage = null;
    }

    this.model.clearPageStrokes(targetPage);
    const canvases = this.viewportEl?.querySelectorAll
      ? this.viewportEl.querySelectorAll(`.pdf-drawing-canvas[data-page="${targetPage}"]`)
      : (typeof document !== 'undefined' && document.querySelectorAll ? document.querySelectorAll(`.pdf-drawing-canvas[data-page="${targetPage}"]`) : []);
    canvases.forEach(canvas => this.renderStrokes(canvas, targetPage));

    clearTimeout(this.drawingSyncTimers.get(targetPage));
    if (typeof localDB !== 'undefined' && typeof localDB.clearPageDrawings === 'function') {
      await localDB.clearPageDrawings(this.model.bookId, targetPage).catch(() => {});
    }
    if (typeof localDB !== 'undefined' && typeof localDB.enqueueOutboxOp === 'function') {
      await localDB.enqueueOutboxOp({
        id: `drawing_${this.model.bookId}_${targetPage}`,
        type: 'drawing',
        action: 'clear',
        bookId: this.model.bookId,
        page: targetPage,
        payload: null
      }).catch(() => {});
    }
    if (typeof api !== 'undefined' && typeof api.clearPageDrawings === 'function') {
      api.clearPageDrawings(this.model.bookId, targetPage).then(() => {
        if (typeof localDB !== 'undefined' && typeof localDB.removeOutboxOp === 'function') {
          localDB.removeOutboxOp(`drawing_${this.model.bookId}_${targetPage}`).catch(() => {});
        }
      }).catch(e => {
        console.warn('[ReaderDrawingViewModel] Clearing page drawings:', e);
      });
    }
  }

  async persistPageDrawings(pageNumber) {
    const strokes = this.model.getPageStrokes(pageNumber);
    await localDB.savePageDrawings(this.model.bookId, pageNumber, strokes);

    if (typeof localDB !== 'undefined' && typeof localDB.enqueueOutboxOp === 'function') {
      await localDB.enqueueOutboxOp({
        id: `drawing_${this.model.bookId}_${pageNumber}`,
        type: 'drawing',
        action: 'save',
        bookId: this.model.bookId,
        page: pageNumber,
        payload: { strokes }
      }).catch(() => {});
    }

    clearTimeout(this.drawingSyncTimers.get(pageNumber));
    this.drawingSyncTimers.set(pageNumber, setTimeout(() => {
      api.savePageDrawings(this.model.bookId, pageNumber, strokes).then(res => {
        if (res !== null && typeof localDB !== 'undefined' && typeof localDB.removeOutboxOp === 'function') {
          localDB.removeOutboxOp(`drawing_${this.model.bookId}_${pageNumber}`).catch(() => {});
        }
      }).catch(e => {
        console.warn('[ReaderDrawingViewModel] Syncing page drawings:', e);
      });
    }, 400));
  }
}

window.ReaderDrawingPersistenceController = ReaderDrawingPersistenceController;
