/**
 * ReaderDrawingViewModel.js
 * Manages drawing canvas layer, stylus pressure engine, gestures, and palm rejection.
 */
class ReaderDrawingViewModel {
  constructor(model, viewportEl, bodyEl, getAnnotationCoordinator, reader = null) {
    this.model = model;
    this.viewportEl = viewportEl;
    this.bodyEl = bodyEl;
    this.getAnnotationCoordinator = getAnnotationCoordinator;
    this.reader = reader;

    this.isDrawing = false;
    this.currentStroke = null;
    this.strokePoints = [];
    this.activeDrawPage = null;

    // Gesture & Double-Tap State
    this.lastTapTime = 0;
    this.lastTapX = 0;
    this.lastTapY = 0;

    // Pan state
    this.isPanning = false;
    this.panStartX = 0;
    this.panStartY = 0;
    this.scrollStartLeft = 0;
    this.scrollStartTop = 0;

    this.textHighlight = new ReaderTextHighlightController(model, getAnnotationCoordinator);
    this.drawingSyncTimers = new Map();
  }

  async setupDrawingLayer(drawCanvas, pageWrapper, pageNumber, effectiveScale, outputScale) {
    if (!this.model.pageStrokes.has(pageNumber)) {
      try {
        const cached = await localDB.getPageDrawings(this.model.bookId, pageNumber);
        if (cached && Array.isArray(cached)) {
          this.model.setPageStrokes(pageNumber, cached);
        } else {
          const serverStrokes = await api.getPageDrawings(this.model.bookId, pageNumber);
          this.model.setPageStrokes(pageNumber, serverStrokes || []);
          localDB.savePageDrawings(this.model.bookId, pageNumber, serverStrokes || []).catch(() => {});
        }
      } catch (err) {
        this.model.setPageStrokes(pageNumber, []);
      }
    }

    this.renderStrokes(drawCanvas, pageNumber, effectiveScale, outputScale);

    const onPointerDown = (e) => this.handleDrawingPointerDown(e, pageNumber, pageWrapper, drawCanvas, effectiveScale, outputScale);
    const onPointerMove = (e) => this.handleDrawingPointerMove(e, pageNumber, pageWrapper, drawCanvas, effectiveScale, outputScale);
    const onPointerUp = (e) => this.handleDrawingPointerUp(e, pageNumber, pageWrapper, drawCanvas, effectiveScale, outputScale);

    pageWrapper.addEventListener('pointerdown', onPointerDown, { passive: false });
    pageWrapper.addEventListener('pointermove', onPointerMove, { passive: false });
    pageWrapper.addEventListener('pointerup', onPointerUp, { passive: false });
    pageWrapper.addEventListener('pointercancel', onPointerUp, { passive: false });
  }

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

  handleDrawingPointerDown(e, pageNumber, pageWrapper, drawCanvas, effectiveScale, outputScale) {
    if (e.target && typeof e.target.closest === 'function') {
      if (e.target.closest('#floating-toolbar') || e.target.closest('#highlight-action-menu') || e.target.closest('#drawing-toolbar') || e.target.closest('#stylus-accessibility-modal') || e.target.closest('#mobile-draw-fab-container')) {
        return;
      }
    }

    const fab = this.reader?.mobile?.drawingFAB || this.reader?.drawingFAB || (typeof window !== 'undefined' && window.reader?.mobile?.drawingFAB);
    if (fab && (fab.isExpanded || fab.isColorMenuOpen)) {
      fab.setExpanded(false);
      fab.closeColorMenu();
      if (e) {
        if (typeof e.preventDefault === 'function') e.preventDefault();
        if (typeof e.stopPropagation === 'function') e.stopPropagation();
      }
      return;
    }

    const isPen = e.pointerType === 'pen';
    const isTouch = e.pointerType === 'touch';
    this.detectInputDevice(isPen ? 'pen' : (isTouch ? 'touch' : 'mouse'));

    // Accessibility Setting: Palm Rejection & Touch Pan Mode
    const palmSetting = this.model.getAccessibilitySetting('palmRejection') || 'strict';

    // Dedicated Pan Action: Space hold, or Pan tool active
    const isMiddleClick = (e.button === 1 || e.buttons === 4) && !isPen;
    const isPanToolActive = this.model.isSpacePanActive || this.model.drawTool === 'pan' || isMiddleClick;

    const isMobileReader = Boolean(
      (this.reader?.mobile?.device || window.reader?.mobile?.device)?.isMobileReaderActive?.() ||
      document.body.classList.contains('mobile-reader-active') ||
      (typeof window !== 'undefined' && window.innerWidth <= 850)
    );

    if (isPanToolActive) {
      if (isTouch || isMobileReader) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      this.isPanning = true;
      this.panStartX = e.clientX;
      this.panStartY = e.clientY;
      this.scrollStartLeft = this.bodyEl.scrollLeft;
      this.scrollStartTop = this.bodyEl.scrollTop;
      this.viewportEl.classList.add('panning');
      try { drawCanvas.setPointerCapture(e.pointerId); } catch(err) {}
      return;
    }

    const clickedHighlight = e.target instanceof Element && e.target.closest('.pdf-highlight-rect');
    if (this.model.isDrawMode && this.model.drawTool === 'highlighter' && clickedHighlight) {
      this.lastTapTime = 0;
      return;
    }

    // Touch handling according to Palm Rejection setting (bypassed on mobile reader to allow finger drawing):
    if (isTouch && this.model.drawTool !== 'highlighter' && !isMobileReader) {
      if (palmSetting === 'strict') {
        e.preventDefault();
        e.stopPropagation();
        return;
      } else if (palmSetting === 'hybrid') {
        e.preventDefault();
        e.stopPropagation();
        this.isPanning = true;
        this.panStartX = e.clientX;
        this.panStartY = e.clientY;
        this.scrollStartLeft = this.bodyEl.scrollLeft;
        this.scrollStartTop = this.bodyEl.scrollTop;
        this.viewportEl.classList.add('panning');
        try { drawCanvas.setPointerCapture(e.pointerId); } catch(err) {}
        return;
      }
    }

    if (this.model.drawTool === 'highlighter') {
      if (!this.model.isDrawMode) return;

      const now = Date.now();
      if (this.isDoubleTap(e, now)) {
        e.preventDefault();
        e.stopPropagation();
        this.clearTextSelection();
        this.setDrawTool('pen');
        return;
      }

      const startedSelection = this.textHighlight.handlePointerDown(e, pageNumber, pageWrapper);
      if (startedSelection) this.recordTap(e, now);
      else this.lastTapTime = 0;
      return;
    }

    // Ensure draw mode is active when pen or eraser is selected
    if ((this.model.drawTool === 'pen' || this.model.drawTool === 'eraser') && !this.model.isDrawMode) {
      this.model.isDrawMode = true;
      this.viewportEl.classList.add('draw-mode-active');
      this.bodyEl.classList.add('draw-mode-active');
    }

    const shouldDraw = isPen || this.model.isDrawMode;
    if (!shouldDraw) return;

    // Double-Click / Double-Tap toggles from freehand drawing to text selection.
    const doubleClickAction = this.model.getAccessibilitySetting('doubleClickAction') || 'toggle';
    const now = Date.now();
    const isDoubleTap = this.isDoubleTap(e, now);

    e.preventDefault();
    e.stopPropagation();

    // In Pen / Drawing mode: Double-Tap toggles to Highlighter
    if (isDoubleTap) {
      this.model.removeLastStrokeFromPage(pageNumber);
      this.renderStrokes(drawCanvas, pageNumber, effectiveScale, outputScale);
      this.persistPageDrawings(pageNumber);

      this.setDrawTool('highlighter');
      this.isDrawing = false;
      this.lastTapTime = 0;

      if (doubleClickAction === 'toggle_and_highlight') {
        const annotCoord = this.getAnnotationCoordinator();
        if (annotCoord) annotCoord.detectAndHighlightWordAtPoint(e.clientX, e.clientY, drawCanvas);
      }
      return;
    }

    this.recordTap(e, now);

    this.isDrawing = true;
    this.activeDrawPage = pageNumber;

    const isTabletEraser = isPen && (e.buttons === 2 || e.buttons === 32 || e.button === 2);
    const effectiveTool = isTabletEraser ? 'eraser' : this.model.drawTool;

    try { drawCanvas.setPointerCapture(e.pointerId); } catch(err) {}

    const pt = this.getNormalizedCoordinates(e, pageWrapper);
    this.strokePoints = [pt];

    if (effectiveTool === 'eraser') {
      this.model.filterStrokesNearPoint(pageNumber, pt.x, pt.y);
      this.renderStrokes(drawCanvas, pageNumber, effectiveScale, outputScale);
    } else {
      this.currentStroke = {
        tool: effectiveTool,
        color: this.model.drawColor,
        width: this.model.drawWidth,
        points: this.strokePoints
      };
      this.renderStrokes(drawCanvas, pageNumber, effectiveScale, outputScale);
    }
  }

  handleDrawingPointerMove(e, pageNumber, pageWrapper, drawCanvas, effectiveScale, outputScale) {
    if (this.textHighlight.handlePointerMove(e)) {
      this.cancelTapSequenceOnMovement(e);
      return;
    }
    if (this.model.drawTool === 'highlighter' && !this.isPanning) return;

    if (this.isPanning) {
      e.preventDefault();
      e.stopPropagation();
      this.lastTapTime = 0;
      const dx = e.clientX - this.panStartX;
      const dy = e.clientY - this.panStartY;
      this.bodyEl.scrollLeft = this.scrollStartLeft - dx;
      this.bodyEl.scrollTop = this.scrollStartTop - dy;
      return;
    }

    if (!this.isDrawing) return;
    this.cancelTapSequenceOnMovement(e);
    e.preventDefault();
    e.stopPropagation();

    const pt = this.getNormalizedCoordinates(e, pageWrapper);
    const last = this.strokePoints[this.strokePoints.length - 1];

    if (last) {
      const dx = (pt.x - last.x) * drawCanvas.width;
      const dy = (pt.y - last.y) * drawCanvas.height;
      if (dx * dx + dy * dy < 2.0) return;
    }

    this.strokePoints.push(pt);
    const effectiveTool = this.currentStroke?.tool || this.model.drawTool;

    if (effectiveTool === 'eraser') {
      this.model.filterStrokesNearPoint(pageNumber, pt.x, pt.y);
      this.renderStrokes(drawCanvas, pageNumber, effectiveScale, outputScale);
    } else if (this.currentStroke) {
      this.currentStroke.points = this.strokePoints;
      this.renderStrokes(drawCanvas, pageNumber, effectiveScale, outputScale);
    }
  }

  async handleDrawingPointerUp(e, pageNumber, pageWrapper, drawCanvas, effectiveScale, outputScale) {
    if (this.textHighlight.ownsPointer(e.pointerId)) {
      await this.textHighlight.handlePointerUp(e);
      return;
    }

    if (this.isPanning) {
      e.preventDefault();
      e.stopPropagation();
      this.isPanning = false;
      this.viewportEl.classList.remove('panning');
      try { drawCanvas.releasePointerCapture(e.pointerId); } catch(err) {}
      return;
    }

    if (this.model.drawTool === 'highlighter') return;

    if (!this.isDrawing) return;
    this.isDrawing = false;
    try { drawCanvas.releasePointerCapture(e.pointerId); } catch(err) {}

    const effectiveTool = this.currentStroke?.tool || this.model.drawTool;

    if (effectiveTool !== 'eraser' && this.strokePoints.length > 0) {
      this.model.addStrokeToPage(pageNumber, {
        tool: effectiveTool,
        color: this.model.drawColor,
        width: this.model.drawWidth,
        points: this.strokePoints
      });
      this.currentStroke = null;
      this.renderStrokes(drawCanvas, pageNumber, effectiveScale, outputScale);
      await this.persistPageDrawings(pageNumber);
    } else if (effectiveTool === 'eraser') {
      await this.persistPageDrawings(pageNumber);
    }

    this.currentStroke = null;
    this.strokePoints = [];
  }

  isDoubleTap(event, now) {
    const delay = Number(this.model.getAccessibilitySetting('doubleClickDelay'));
    return delay > 0 && this.lastTapTime > 0 && now - this.lastTapTime < delay &&
      Math.hypot(event.clientX - this.lastTapX, event.clientY - this.lastTapY) < 50;
  }

  recordTap(event, now) {
    this.lastTapTime = now;
    this.lastTapX = event.clientX;
    this.lastTapY = event.clientY;
  }

  cancelTapSequenceOnMovement(event) {
    if (this.lastTapTime && Math.hypot(event.clientX - this.lastTapX, event.clientY - this.lastTapY) > 12) {
      this.lastTapTime = 0;
    }
  }

  getNormalizedCoordinates(e, pageWrapper) {
    const rect = pageWrapper.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    const pressure = (e.pressure !== undefined && e.pressure > 0) ? e.pressure : 0.5;
    return {
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y)),
      p: pressure
    };
  }

  toggleDrawMode(forceState = null) {
    const isActive = this.model.toggleDrawMode(forceState);
    const toggleBtn = document.getElementById('reader-draw-toggle-btn');
    if (toggleBtn) {
      toggleBtn.classList.toggle('active', isActive);
      const toggleLabel = toggleBtn.querySelector('.reader-draw-toggle-label');
      if (toggleLabel) toggleLabel.textContent = isActive ? 'Dibujando' : 'Dibujo';
    }

    const drawingToolbar = document.getElementById('drawing-toolbar');
    if (drawingToolbar) {
      drawingToolbar.style.display = isActive ? 'flex' : 'none';
    }

    if (isActive) {
      this.clearTextSelection();
      const annotCoord = this.getAnnotationCoordinator();
      if (annotCoord && annotCoord.floatingToolbar) {
        annotCoord.floatingToolbar.style.opacity = '0';
        annotCoord.floatingToolbar.style.pointerEvents = 'none';
      }
      this.viewportEl.classList.add('draw-mode-active');
      this.bodyEl.classList.add('draw-mode-active');
      this.viewportEl.classList.toggle('text-highlight-mode', this.model.drawTool === 'highlighter');
      this.bodyEl.classList.toggle('text-highlight-mode', this.model.drawTool === 'highlighter');
    } else {
      this.textHighlight.cancel();
      this.viewportEl.classList.remove('draw-mode-active', 'text-highlight-mode', 'pan-mode-active', 'pan-tool-active', 'panning');
      this.bodyEl.classList.remove('draw-mode-active', 'text-highlight-mode');
      this.model.setSpacePanActive(false);
    }
    return isActive;
  }

  clearTextSelection() {
    this.textHighlight.cancel();
    window.getSelection()?.removeAllRanges();
    this.model.selectedRange = null;
    this.model.selectedText = '';
  }

  setDrawTool(tool) {
    if (tool !== 'highlighter' && this.textHighlight.isSelecting) this.textHighlight.cancel();
    this.lastTapTime = 0;
    this.model.setDrawTool(tool);

    if ((tool === 'pen' || tool === 'eraser') && !this.model.isDrawMode) {
      this.toggleDrawMode(true);
    }

    const toolButtons = {
      penBtn: document.getElementById('draw-tool-pen'),
      highlighterBtn: document.getElementById('draw-tool-highlighter'),
      eraserBtn: document.getElementById('draw-tool-eraser'),
      panBtn: document.getElementById('draw-tool-pan')
    };
    ReaderHUDView.updateDrawToolButtons(toolButtons, tool);

    this.viewportEl.classList.toggle('pan-tool-active', tool === 'pan');
    this.viewportEl.classList.toggle('text-highlight-mode', tool === 'highlighter');
    this.bodyEl.classList.toggle('text-highlight-mode', tool === 'highlighter');

    if (tool === 'highlighter' && this.model.drawColor === '#1e293b') {
      this.setDrawColor('#eab308');
    }
    window.reader?.mobile?.drawingFAB?.render();
  }

  setDrawColor(hex) {
    this.model.setDrawColor(hex);
    const colorDots = document.querySelectorAll('.drawing-color-dot');
    ReaderHUDView.updateColorDots(colorDots, hex);

    if (this.model.drawTool === 'eraser' || this.model.drawTool === 'pan') {
      this.setDrawTool('pen');
    }
    window.reader?.mobile?.drawingFAB?.render();
  }

  setDrawWidth(width) {
    this.model.setDrawWidth(width);
    const widthBtns = document.querySelectorAll('.drawing-width-btn');
    ReaderHUDView.updateWidthButtons(widthBtns, width);
    window.reader?.mobile?.drawingFAB?.render();
  }

  cycleDrawWidth(direction = 1) {
    const widths = [2, 4, 9];
    let idx = widths.indexOf(this.model.drawWidth);
    if (idx === -1) idx = 1;
    let nextIdx = Math.max(0, Math.min(widths.length - 1, idx + direction));
    this.setDrawWidth(widths[nextIdx]);
  }

  toggleDrawingTool() {
    const nextTool = this.model.drawTool === 'highlighter' ? 'pen' : 'highlighter';
    this.setDrawTool(nextTool);
  }

  undoLastStroke(pageNumber = null) {
    const targetPage = pageNumber || this.model.currentPage;
    const removed = this.model.removeLastStrokeFromPage(targetPage);
    if (removed) {
      const canvas = document.querySelector(`.pdf-drawing-canvas[data-page="${targetPage}"]`);
      if (canvas) this.renderStrokes(canvas, targetPage);
      this.persistPageDrawings(targetPage);
    }
  }

  clearCurrentPageDrawings(pageNumber = null) {
    const targetPage = Number(pageNumber || this.model.currentPage || 1);
    this.isDrawing = false;
    this.currentStroke = null;
    this.strokePoints = [];

    this.model.clearPageStrokes(targetPage);
    const canvas = document.querySelector(`.pdf-drawing-canvas[data-page="${targetPage}"]`);
    if (canvas) this.renderStrokes(canvas, targetPage);
    this.persistPageDrawings(targetPage);
  }

  async persistPageDrawings(pageNumber) {
    const strokes = this.model.getPageStrokes(pageNumber);
    await localDB.savePageDrawings(this.model.bookId, pageNumber, strokes);

    clearTimeout(this.drawingSyncTimers.get(pageNumber));
    this.drawingSyncTimers.set(pageNumber, setTimeout(() => {
      api.savePageDrawings(this.model.bookId, pageNumber, strokes).catch(e => {
        console.warn('[ReaderDrawingViewModel] Syncing page drawings:', e);
      });
    }, 400));
  }

  detectInputDevice(type) {
    if (this.model.detectedInputType === type) return;
    this.model.setInputDevice(type);

    const pill = document.getElementById('drawing-device-pill');
    const icon = document.getElementById('drawing-device-icon');
    const label = document.getElementById('drawing-device-label');
    ReaderHUDView.updateDevicePill(pill, icon, label, type);
  }
}

window.ReaderDrawingViewModel = ReaderDrawingViewModel;
