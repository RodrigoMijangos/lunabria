/**
 * ReaderDrawingViewModel.js
 * Backward-compatible facade for drawing state and collaborator APIs.
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
    this.interactionController = new ReaderDrawingInteractionController();
    this.persistenceController = new ReaderDrawingPersistenceController();
    this.toolController = new ReaderDrawingToolController();
  }

  isMobileReader() {
    return this.interactionController.isMobileReader.call(this);
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
    pageWrapper.addEventListener('dblclick', (e) => { if (this.model.isDrawMode) e.preventDefault(); }, { passive: false });
  }

  renderStrokes(canvas, pageNumber, customScale = null, customOutputScale = null) {
    return this.persistenceController.renderStrokes.call(this, canvas, pageNumber, customScale, customOutputScale);
  }

  reRenderAllCanvasStrokes() {
    return this.persistenceController.reRenderAllCanvasStrokes.call(this);
  }

  handleDrawingPointerDown(e, pageNumber, pageWrapper, drawCanvas, effectiveScale, outputScale) {
    return this.interactionController.handleDrawingPointerDown.call(this, e, pageNumber, pageWrapper, drawCanvas, effectiveScale, outputScale);
  }

  handleDrawingPointerMove(e, pageNumber, pageWrapper, drawCanvas, effectiveScale, outputScale) {
    return this.interactionController.handleDrawingPointerMove.call(this, e, pageNumber, pageWrapper, drawCanvas, effectiveScale, outputScale);
  }

  async handleDrawingPointerUp(e, pageNumber, pageWrapper, drawCanvas, effectiveScale, outputScale) {
    return this.interactionController.handleDrawingPointerUp.call(this, e, pageNumber, pageWrapper, drawCanvas, effectiveScale, outputScale);
  }

  isDoubleTap(event, now) {
    return this.interactionController.isDoubleTap.call(this, event, now);
  }

  recordTap(event, now) {
    return this.interactionController.recordTap.call(this, event, now);
  }

  cancelTapSequenceOnMovement(event) {
    return this.interactionController.cancelTapSequenceOnMovement.call(this, event);
  }

  getNormalizedCoordinates(e, pageWrapper) {
    return this.interactionController.getNormalizedCoordinates.call(this, e, pageWrapper);
  }

  toggleDrawMode(forceState = null) {
    return this.toolController.toggleDrawMode.call(this, forceState);
  }

  clearTextSelection() {
    return this.toolController.clearTextSelection.call(this);
  }

  setDrawTool(tool, autoActivateMobile = true) {
    return this.toolController.setDrawTool.call(this, tool, autoActivateMobile);
  }

  setDrawColor(hex) {
    return this.toolController.setDrawColor.call(this, hex);
  }

  setDrawWidth(width) {
    return this.toolController.setDrawWidth.call(this, width);
  }

  cycleDrawWidth(direction = 1) {
    return this.toolController.cycleDrawWidth.call(this, direction);
  }

  toggleDrawingTool() {
    return this.toolController.toggleDrawingTool.call(this);
  }

  toggleEraser() {
    return this.toolController.toggleEraser.call(this);
  }

  getVisiblePageNumber() {
    return this.persistenceController.getVisiblePageNumber.call(this);
  }

  isPageVisible(pageNum) {
    return this.persistenceController.isPageVisible.call(this, pageNum);
  }

  resolveTargetDrawPage(pageNumber = null) {
    return this.persistenceController.resolveTargetDrawPage.call(this, pageNumber);
  }

  undoLastStroke(pageNumber = null) {
    return this.persistenceController.undoLastStroke.call(this, pageNumber);
  }

  async clearCurrentPageDrawings(pageNumber = null) {
    return this.persistenceController.clearCurrentPageDrawings.call(this, pageNumber);
  }

  async persistPageDrawings(pageNumber) {
    return this.persistenceController.persistPageDrawings.call(this, pageNumber);
  }

  detectInputDevice(type) {
    return this.toolController.detectInputDevice.call(this, type);
  }
}

window.ReaderDrawingViewModel = ReaderDrawingViewModel;
