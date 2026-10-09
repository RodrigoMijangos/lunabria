/**
 * Pointer, gesture, pan and tap handling.
 * Methods run with ReaderDrawingViewModel as their receiver to retain its live state.
 */
class ReaderDrawingInteractionController {
  isMobileReader() {
    const mobileDevice = (this.reader?.mobile?.device || (typeof window !== 'undefined' && window.reader?.mobile?.device));
    if (typeof mobileDevice?.isMobileReaderActive === 'function') {
      return Boolean(mobileDevice.isMobileReaderActive());
    }
    if (typeof document !== 'undefined' && document.body?.classList?.contains('mobile-reader-active')) {
      return true;
    }
    if (typeof window !== 'undefined' && typeof window.innerWidth === 'number') {
      return window.innerWidth <= 850;
    }
    return false;
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

    const isMobileReader = this.isMobileReader();

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
        this.textHighlight.cancel();
        this.clearTextSelection();
        this.setDrawTool('pen');
        this.lastTapTime = 0;
        return;
      }

      this.recordTap(e, now);
      this.textHighlight.handlePointerDown(e, pageNumber, pageWrapper);
      return;
    }

    // Ensure draw mode is active when pen or eraser is selected on mobile reader
    if (isMobileReader && (isTouch || isPen) && (this.model.drawTool === 'pen' || this.model.drawTool === 'eraser') && !this.model.isDrawMode) {
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

    if (this.model.drawTool === 'highlighter') {
      const selection = window.getSelection();
      const text = selection?.toString().trim();
      if (text && selection?.rangeCount > 0) {
        const range = selection.getRangeAt(0).cloneRange();
        const targetPage = Number(pageNumber || this.model.currentPage || 1);
        const wrapper = pageWrapper ||
          document.getElementById(`pdf-page-${targetPage}`) ||
          (this.viewportEl?.querySelector ? this.viewportEl.querySelector(`.pdf-page-wrapper[data-page="${targetPage}"]`) : null);
        const annotations = this.getAnnotationCoordinator();
        if (annotations) {
          const colorId = this.model.getHighlightColorIdFromHex(this.model.drawColor);
          let rects = [];
          if (wrapper) {
            rects = annotations.computeSelectionRects(range, wrapper, this.model.scale);
          }
          this.model.selectedRange = range;
          this.model.selectedText = text;
          this.model.selectedPage = targetPage;
          this.model.selectedRects = rects;
          await annotations.applyHighlight(colorId, '', {
            showQuickPalette: true,
            pageNumber: targetPage,
            pageWrapper: wrapper,
            rects: rects
          });
          this.model.selectedRange = null;
          this.model.selectedText = '';
          this.model.selectedRects = [];
          this.model.selectedPage = null;
        }
      }
      return;
    }

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
    if (event?.detail === 2) return true;
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
}

window.ReaderDrawingInteractionController = ReaderDrawingInteractionController;
