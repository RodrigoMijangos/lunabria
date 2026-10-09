/**
 * Drawing mode, tool, color, width and device operations.
 * Methods run with ReaderDrawingViewModel as their receiver to retain its live state.
 */
class ReaderDrawingToolController {
  toggleDrawMode(forceState = null) {
    const isActive = this.model.toggleDrawMode(forceState);
    const toggleBtn = document.getElementById('reader-draw-toggle-btn');
    if (toggleBtn) {
      toggleBtn.classList.toggle('active', isActive);
      const toggleLabel = toggleBtn.querySelector('.reader-draw-toggle-label');
      if (toggleLabel) toggleLabel.textContent = isActive ? 'Drawing' : 'Draw';
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
      this.setDrawTool('pen', false);
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

  setDrawTool(tool, autoActivateMobile = true) {
    if (tool !== 'highlighter' && this.textHighlight.isSelecting) this.textHighlight.cancel();
    this.lastTapTime = 0;
    this.model.setDrawTool(tool);

    if (autoActivateMobile && this.isMobileReader() && (tool === 'pen' || tool === 'eraser') && !this.model.isDrawMode) {
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

  toggleEraser() {
    if (this.model.drawTool === 'eraser') {
      const revertTool = (this.model.previousDrawTool && this.model.previousDrawTool !== 'eraser')
        ? this.model.previousDrawTool
        : 'pen';
      this.setDrawTool(revertTool);
    } else {
      this.setDrawTool('eraser');
    }
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

window.ReaderDrawingToolController = ReaderDrawingToolController;
