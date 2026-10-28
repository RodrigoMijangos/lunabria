/**
 * MobileSelectionController.js
 * Implements touch text selection and magnifying loupe for mobile PDF reading.
 */
const MOBILE_SELECTION_IGNORED_SELECTOR =
  "#mobile-draw-fab-container, #floating-toolbar, #highlight-action-menu, .mobile-color-contextual-menu, #reader-header, #reader-footer, button, select, input";
const MOBILE_READER_AREA_SELECTOR = "#reader-body, #pdf-viewport, .pdf-page-wrapper, .textLayer";

class MobileSelectionController {
  constructor(readerViewModel, model) {
    this.reader = readerViewModel;
    this.model = model;

    this.longPressTimer = null;
    this.touchStartX = 0;
    this.touchStartY = 0;
    this.targetPoint = null;
    this.isSelecting = false;
    this.anchorTarget = null;
    this.pageWrapper = null;
    this.loupe =
      this.reader?.selectionLoupe?.loupe ||
      (typeof ReaderSelectionLoupeView !== "undefined" ? new ReaderSelectionLoupeView() : null);
    this.activePointerId = null;
    this.lockedScrollLeft = null;
    this.lockedScrollTop = null;
  }

  init() {
    if (!this.loupe && typeof ReaderSelectionLoupeView !== "undefined") {
      this.loupe = new ReaderSelectionLoupeView();
    }
    this.bindTouchEvents();
  }

  isMobileActive() {
    return Boolean(
      this.reader?.mobile?.device?.isMobileReaderActive?.() ||
        document.body?.classList?.contains("mobile-reader-active") ||
        (typeof window !== "undefined" && window.innerWidth <= 850),
    );
  }

  restoreLockedScroll() {
    const readerBody = document.getElementById("reader-body");
    if (!readerBody || this.lockedScrollLeft == null) return;
    if (readerBody.scrollLeft !== this.lockedScrollLeft) {
      readerBody.scrollLeft = this.lockedScrollLeft;
    }
    if (readerBody.scrollTop !== this.lockedScrollTop) {
      readerBody.scrollTop = this.lockedScrollTop;
    }
  }

  handleTouchStart(clientX, clientY, target, pointerId = null) {
    if (this.model.drawTool === "pen" || this.model.drawTool === "eraser") return;
    if (target?.closest?.(MOBILE_SELECTION_IGNORED_SELECTOR)) return;

    if (pointerId != null) this.activePointerId = pointerId;
    this.touchStartX = clientX;
    this.touchStartY = clientY;
    this.targetPoint = { x: clientX, y: clientY };

    if (!this.longPressTimer) {
      this.longPressTimer = setTimeout(() => {
        this.startLongPressSelection(this.targetPoint);
      }, 400);
    }
  }

  handleTouchMove(clientX, clientY, e) {
    if (this.longPressTimer) {
      if (Math.hypot(clientX - this.touchStartX, clientY - this.touchStartY) > 12) {
        clearTimeout(this.longPressTimer);
        this.longPressTimer = null;
      }
    }

    if (!this.isSelecting) return;
    if (e?.cancelable) e.preventDefault?.();
    e?.stopPropagation?.();

    this.restoreLockedScroll();
    const activeWrapper = this.getPageWrapperAt(clientX, clientY) || this.pageWrapper;
    if (this.loupe && activeWrapper) {
      this.loupe.update(clientX, clientY, activeWrapper);
    }
    this.updateSelectionToPoint(clientX, clientY, activeWrapper);
  }

  handleTouchEnd() {
    clearTimeout(this.longPressTimer);
    this.longPressTimer = null;
    if (!this.isSelecting) return;

    this.isSelecting = false;
    this.loupe?.hide();
    document.body?.classList?.remove("mobile-text-selecting");

    const vp = this.reader?.viewportEl || document.getElementById("pdf-viewport");
    if (this.activePointerId != null && vp?.releasePointerCapture) {
      try {
        vp.releasePointerCapture(this.activePointerId);
      } catch (_) {}
    }
    this.activePointerId = null;
    this.lockedScrollLeft = null;
    this.lockedScrollTop = null;

    if (this.model.drawTool !== "pan") {
      this.reader.drawing?.setDrawTool("pan");
    }

    const sel = window.getSelection();
    const text = sel ? sel.toString().trim() : "";
    if (text && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      this.model.selectedRange = range.cloneRange();
      this.model.selectedText = text;
      this.model.selectedPage = this.pageWrapper?.dataset?.page
        ? Number(this.pageWrapper.dataset.page)
        : this.model.currentPage;
      if (this.reader.annotations?.computeSelectionRects) {
        this.model.selectedRects = this.reader.annotations.computeSelectionRects(
          range,
          this.pageWrapper,
          this.model.scale,
        );
      }
      this.reader.annotations?.updateFloatingToolbar?.();
    }
    this.anchorTarget = null;
  }

  bindTouchEvents() {
    const viewport = this.reader?.viewportEl || document.getElementById("pdf-viewport");
    if (!viewport) return;

    const handleStart = (x, y, t, id = null) => this.handleTouchStart(x, y, t, id);
    const handleMove = (x, y, e) => this.handleTouchMove(x, y, e);
    const handleEnd = () => this.handleTouchEnd();

    viewport.addEventListener(
      "pointerdown",
      (e) => {
        if (e.pointerType !== "touch" && !this.isMobileActive()) return;
        handleStart(e.clientX, e.clientY, e.target, e.pointerId);
      },
      { passive: true },
    );

    viewport.addEventListener(
      "pointermove",
      (e) => {
        if (e.pointerType !== "touch" && !this.isMobileActive()) return;
        handleMove(e.clientX, e.clientY, e);
      },
      { passive: false },
    );

    viewport.addEventListener("pointerup", handleEnd, { passive: true });
    viewport.addEventListener(
      "pointercancel",
      () => {
        if (!this.isSelecting && !this.longPressTimer) handleEnd();
      },
      { passive: true },
    );

    viewport.addEventListener(
      "touchstart",
      (e) => {
        if (e.touches?.length === 1) {
          handleStart(e.touches[0].clientX, e.touches[0].clientY, e.target, null);
        } else {
          handleEnd();
        }
      },
      { passive: true },
    );

    viewport.addEventListener(
      "touchmove",
      (e) => {
        if (e.touches?.length === 1) {
          handleMove(e.touches[0].clientX, e.touches[0].clientY, e);
        } else {
          handleEnd();
        }
      },
      { passive: false },
    );

    viewport.addEventListener("touchend", handleEnd, { passive: true });
    viewport.addEventListener(
      "touchcancel",
      (e) => {
        if ((!this.isSelecting && !this.longPressTimer) || !e.touches?.length) handleEnd();
      },
      { passive: true },
    );

    this.bindWindowAndSuppressionEvents(viewport, handleMove, handleEnd);
  }

  bindWindowAndSuppressionEvents(viewport, handleMove, handleEnd) {
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener(
        "touchmove",
        (e) => {
          if (!this.isSelecting) return;
          if (e?.cancelable) e.preventDefault?.();
          e?.stopPropagation?.();
          if (e.touches?.length === 1) handleMove(e.touches[0].clientX, e.touches[0].clientY, e);
        },
        { passive: false, capture: true },
      );

      window.addEventListener(
        "pointermove",
        (e) => {
          if (!this.isSelecting || e.pointerType !== "touch") return;
          if (e?.cancelable) e.preventDefault?.();
          e?.stopPropagation?.();
          handleMove(e.clientX, e.clientY, e);
        },
        { passive: false, capture: true },
      );

      window.addEventListener(
        "touchend",
        () => {
          if (this.isSelecting) handleEnd();
        },
        { passive: true },
      );
      window.addEventListener(
        "pointerup",
        () => {
          if (this.isSelecting) handleEnd();
        },
        { passive: true },
      );
    }

    const readerBody = document.getElementById("reader-body");
    readerBody?.addEventListener?.(
      "scroll",
      () => {
        if (this.isSelecting) this.restoreLockedScroll();
      },
      { passive: true },
    );

    const suppressContextMenu = (e) => {
      if (!this.isMobileActive()) return;
      const isReaderArea = e.target?.closest ? Boolean(e.target.closest(MOBILE_READER_AREA_SELECTOR)) : true;
      if (isReaderArea || this.isSelecting || this.longPressTimer) e.preventDefault();
    };
    viewport.addEventListener("contextmenu", suppressContextMenu);
    window?.addEventListener?.("contextmenu", suppressContextMenu, { capture: true });

    const suppressSelectStart = (e) => {
      if (!this.isMobileActive() || (!this.isSelecting && !this.longPressTimer)) return;
      if (!e.target?.closest || e.target.closest(MOBILE_READER_AREA_SELECTOR)) {
        e.preventDefault();
      }
    };
    viewport.addEventListener("selectstart", suppressSelectStart);
    window?.addEventListener?.("selectstart", suppressSelectStart, { capture: true });
  }

  startLongPressSelection(point) {
    if (!point) return;
    const pageWrapper = this.getPageWrapperAt(point.x, point.y);
    if (!pageWrapper) return;

    try {
      navigator.vibrate?.(40);
    } catch (_) {}

    const range = MobileSelectionTargetResolver.resolveInitialSelectionRange(this, point, pageWrapper);
    if (!range) return;

    const readerBody = document.getElementById("reader-body");
    if (readerBody) {
      this.lockedScrollLeft = readerBody.scrollLeft;
      this.lockedScrollTop = readerBody.scrollTop;
    }

    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }

    this.anchorTarget = {
      node: range.startContainer,
      offset: range.startOffset,
      initialEndNode: range.endContainer,
      initialEndOffset: range.endOffset,
    };
    this.pageWrapper = pageWrapper;
    this.isSelecting = true;
    document.body?.classList?.add("mobile-text-selecting");
    this.restoreLockedScroll();

    const vp = this.reader?.viewportEl || document.getElementById("pdf-viewport");
    if (this.activePointerId != null && vp?.setPointerCapture) {
      try {
        vp.setPointerCapture(this.activePointerId);
      } catch (_) {}
    }

    if (this.model.drawTool !== "pan") {
      this.reader.drawing?.setDrawTool("pan");
    }
    this.loupe?.update(point.x, point.y, pageWrapper);

    const floatingToolbar = this.reader?.floatingToolbar || document.getElementById("floating-toolbar");
    if (floatingToolbar) {
      floatingToolbar.style.opacity = "0";
      floatingToolbar.style.pointerEvents = "none";
    }
  }

  updateSelectionToPoint(clientX, clientY, pageWrapper) {
    if (!this.anchorTarget || !pageWrapper) return;
    const currentPos =
      this.getTextPositionAt(clientX, clientY, pageWrapper) ||
      this.findNearbyTarget(clientX, clientY, pageWrapper, 52, 36);
    if (!currentPos?.node) return;

    const sel = window.getSelection();
    if (!sel || typeof sel.setBaseAndExtent !== "function") return;

    try {
      const cmp = this.comparePositions(
        this.anchorTarget.node,
        this.anchorTarget.offset,
        currentPos.node,
        currentPos.offset,
      );
      if (cmp <= 0) {
        sel.setBaseAndExtent(this.anchorTarget.node, this.anchorTarget.offset, currentPos.node, currentPos.offset);
      } else {
        sel.setBaseAndExtent(
          currentPos.node,
          currentPos.offset,
          this.anchorTarget.initialEndNode || this.anchorTarget.node,
          this.anchorTarget.initialEndOffset || this.anchorTarget.offset,
        );
      }
    } catch (_) {}
  }

  findNearbyTarget(clientX, clientY, pageWrapper, slackX = 44, slackY = 30) {
    return MobileSelectionTargetResolver.findNearbyTarget(clientX, clientY, pageWrapper, slackX, slackY);
  }

  findTargetElementUnderPoint(clientX, clientY, _pageWrapper) {
    return MobileSelectionTargetResolver.findTargetElementUnderPoint(clientX, clientY);
  }

  comparePositions(nodeA, offsetA, nodeB, offsetB) {
    return ReaderTextTargetGeometry.comparePositions(nodeA, offsetA, nodeB, offsetB);
  }

  getTextPositionAt(clientX, clientY, pageWrapper) {
    return MobileSelectionTargetResolver.getTextPositionAt(this, clientX, clientY, pageWrapper);
  }

  getPageWrapperAt(clientX, clientY) {
    return MobileSelectionTargetResolver.getPageWrapperAt(this, clientX, clientY);
  }
}

window.MobileSelectionController = MobileSelectionController;
