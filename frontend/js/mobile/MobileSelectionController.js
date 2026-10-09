/**
 * MobileSelectionController.js
 * Implements touch text selection and magnifying loupe for mobile PDF reading:
 * - Detects touch hold (~450ms) on text in the textLayer
 * - Activates magnifying loupe during selection drag
 * - Allows user to adjust and expand text selection at will
 * - Hides the loupe when the selection gesture finishes
 * - Preserves/restores 'pan' navigation mode (never forces highlighter tool)
 * - Presents the contextual highlight menu (#floating-toolbar) upon completion
 *   to allow selecting the highlight color
 */
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
    this.loupe = this.reader?.selectionLoupe?.loupe || (typeof ReaderSelectionLoupeView !== 'undefined' ? new ReaderSelectionLoupeView() : null);
    this.activePointerId = null;
    this.lockedScrollLeft = null;
    this.lockedScrollTop = null;
  }

  init() {
    if (!this.loupe && typeof ReaderSelectionLoupeView !== 'undefined') {
      this.loupe = new ReaderSelectionLoupeView();
    }
    this.bindTouchEvents();
  }

  bindTouchEvents() {
    const viewport = this.reader?.viewportEl || document.getElementById('pdf-viewport');
    if (!viewport) return;

    const handleStart = (clientX, clientY, target, pointerId = null) => {
      // If user is actively drawing with pen or eraser, do not trigger text selection
      if (this.model.drawTool === 'pen' || this.model.drawTool === 'eraser') {
        return;
      }
      if (target && typeof target.closest === 'function') {
        if (target.closest('#mobile-draw-fab-container') ||
            target.closest('#floating-toolbar') ||
            target.closest('#highlight-action-menu') ||
            target.closest('.mobile-color-contextual-menu') ||
            target.closest('#reader-header') ||
            target.closest('#reader-footer') ||
            target.closest('button, select, input')) {
          return;
        }
      }

      this.activePointerId = pointerId;
      this.touchStartX = clientX;
      this.touchStartY = clientY;
      this.targetPoint = { x: clientX, y: clientY };

      clearTimeout(this.longPressTimer);
      this.longPressTimer = setTimeout(() => {
        this.startLongPressSelection(this.targetPoint);
      }, 450);
    };

    const handleMove = (clientX, clientY, e) => {
      if (this.longPressTimer) {
        const dist = Math.hypot(clientX - this.touchStartX, clientY - this.touchStartY);
        if (dist > 12) {
          clearTimeout(this.longPressTimer);
          this.longPressTimer = null;
        }
      }

      if (this.isSelecting) {
        if (e && e.cancelable && typeof e.preventDefault === 'function') {
          e.preventDefault();
        }
        if (e && typeof e.stopPropagation === 'function') {
          e.stopPropagation();
        }

        // Prevent horizontal and vertical scroll drift on reader-body
        const readerBody = document.getElementById('reader-body');
        if (readerBody && this.lockedScrollLeft != null) {
          if (readerBody.scrollLeft !== this.lockedScrollLeft) {
            readerBody.scrollLeft = this.lockedScrollLeft;
          }
          if (readerBody.scrollTop !== this.lockedScrollTop) {
            readerBody.scrollTop = this.lockedScrollTop;
          }
        }

        const activeWrapper = this.getPageWrapperAt(clientX, clientY) || this.pageWrapper;
        if (this.loupe && activeWrapper) {
          this.loupe.update(clientX, clientY, activeWrapper);
        }

        this.updateSelectionToPoint(clientX, clientY, activeWrapper);
      }
    };

    const handleEnd = () => {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;

      if (this.isSelecting) {
        this.isSelecting = false;
        this.loupe?.hide();

        if (typeof document !== 'undefined' && document.body?.classList) {
          document.body.classList.remove('mobile-text-selecting');
        }

        const vp = this.reader?.viewportEl || document.getElementById('pdf-viewport');
        if (this.activePointerId != null && vp && typeof vp.releasePointerCapture === 'function') {
          try {
            vp.releasePointerCapture(this.activePointerId);
          } catch (err) {}
        }
        this.activePointerId = null;
        this.lockedScrollLeft = null;
        this.lockedScrollTop = null;

        // Always keep or return to 'pan' mode
        if (this.model.drawTool !== 'pan') {
          this.reader.drawing?.setDrawTool('pan');
        }

        // Present contextual highlight menu (floating toolbar)
        const sel = window.getSelection();
        const text = sel ? sel.toString().trim() : '';
        if (text && text.length > 0 && sel.rangeCount > 0) {
          const range = sel.getRangeAt(0);
          this.model.selectedRange = range.cloneRange();
          this.model.selectedText = text;
          const pageNum = this.pageWrapper?.dataset?.page ? Number(this.pageWrapper.dataset.page) : this.model.currentPage;
          this.model.selectedPage = pageNum;
          if (this.reader.annotations?.computeSelectionRects) {
            this.model.selectedRects = this.reader.annotations.computeSelectionRects(range, this.pageWrapper, this.model.scale);
          }
          if (this.reader.annotations?.updateFloatingToolbar) {
            this.reader.annotations.updateFloatingToolbar();
          }
        }
        this.anchorTarget = null;
      }
    };

    // 1. Pointer events
    viewport.addEventListener('pointerdown', (e) => {
      const isMobile = this.reader?.mobile?.device?.isMobileReaderActive?.() ||
        document.body.classList.contains('mobile-reader-active') ||
        (typeof window !== 'undefined' && window.innerWidth <= 850);
      const isTouch = e.pointerType === 'touch';
      if (!isTouch && !isMobile) return;
      handleStart(e.clientX, e.clientY, e.target, e.pointerId);
    }, { passive: true });

    viewport.addEventListener('pointermove', (e) => {
      const isMobile = this.reader?.mobile?.device?.isMobileReaderActive?.() ||
        document.body.classList.contains('mobile-reader-active') ||
        (typeof window !== 'undefined' && window.innerWidth <= 850);
      const isTouch = e.pointerType === 'touch';
      if (!isTouch && !isMobile) return;
      handleMove(e.clientX, e.clientY, e);
    }, { passive: false });

    viewport.addEventListener('pointerup', handleEnd, { passive: true });
    viewport.addEventListener('pointercancel', (e) => {
      // Do not abort active selection if pointer was merely canceled by browser scroll heuristic
      if (!this.isSelecting) {
        handleEnd();
      }
    }, { passive: true });

    // 2. Native touch events (for touch devices and Firefox touch simulation)
    viewport.addEventListener('touchstart', (e) => {
      if (e.touches && e.touches.length === 1) {
        const touch = e.touches[0];
        handleStart(touch.clientX, touch.clientY, e.target, null);
      } else {
        handleEnd();
      }
    }, { passive: true });

    viewport.addEventListener('touchmove', (e) => {
      if (e.touches && e.touches.length === 1) {
        const touch = e.touches[0];
        handleMove(touch.clientX, touch.clientY, e);
      } else {
        handleEnd();
      }
    }, { passive: false });

    viewport.addEventListener('touchend', handleEnd, { passive: true });
    viewport.addEventListener('touchcancel', (e) => {
      if (!this.isSelecting || !e.touches || e.touches.length === 0) {
        handleEnd();
      }
    }, { passive: true });

    // 3. Window-level capture interceptors for touchmove/pointermove to guarantee zero page displacement during drag
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('touchmove', (e) => {
        if (this.isSelecting) {
          if (e && e.cancelable && typeof e.preventDefault === 'function') {
            e.preventDefault();
          }
          if (e && typeof e.stopPropagation === 'function') {
            e.stopPropagation();
          }
          if (e.touches && e.touches.length === 1) {
            const touch = e.touches[0];
            handleMove(touch.clientX, touch.clientY, e);
          }
        }
      }, { passive: false, capture: true });

      window.addEventListener('pointermove', (e) => {
        if (this.isSelecting && e.pointerType === 'touch') {
          if (e && e.cancelable && typeof e.preventDefault === 'function') {
            e.preventDefault();
          }
          if (e && typeof e.stopPropagation === 'function') {
            e.stopPropagation();
          }
          handleMove(e.clientX, e.clientY, e);
        }
      }, { passive: false, capture: true });

      window.addEventListener('touchend', () => {
        if (this.isSelecting) handleEnd();
      }, { passive: true });

      window.addEventListener('pointerup', () => {
        if (this.isSelecting) handleEnd();
      }, { passive: true });
    }

    const readerBody = document.getElementById('reader-body');
    if (readerBody && typeof readerBody.addEventListener === 'function') {
      readerBody.addEventListener('scroll', () => {
        if (this.isSelecting && this.lockedScrollLeft != null) {
          readerBody.scrollLeft = this.lockedScrollLeft;
          readerBody.scrollTop = this.lockedScrollTop;
        }
      }, { passive: true });
    }

    // Suppress system context menu on mobile reader viewport
    viewport.addEventListener('contextmenu', (e) => {
      const isMobile = this.reader?.mobile?.device?.isMobileReaderActive?.() ||
        document.body.classList.contains('mobile-reader-active') ||
        (typeof window !== 'undefined' && window.innerWidth <= 850);
      if (isMobile) {
        e.preventDefault();
      }
    });
  }

  startLongPressSelection(point) {
    if (!point) return;

    const pageWrapper = this.getPageWrapperAt(point.x, point.y);
    if (!pageWrapper) return;

    // Haptic feedback if supported
    try {
      if (navigator.vibrate) navigator.vibrate(40);
    } catch (err) {}

    // First try direct position under touch
    let targetProbe = this.getTextPositionAt(point.x, point.y, pageWrapper);
    if (!targetProbe || !targetProbe.node) {
      // Apply spatial tolerance slack (holgura) of 44px horizontally, 30px vertically
      targetProbe = this.findNearbyTarget(point.x, point.y, pageWrapper, 44, 30);
    }

    let range = null;
    let text = '';

    if (targetProbe && targetProbe.node && targetProbe.node.nodeType === (typeof Node !== 'undefined' ? Node.TEXT_NODE : 3)) {
      const full = targetProbe.node.textContent || '';
      let start = Math.max(0, Math.min(full.length, targetProbe.offset || 0));
      let end = start;
      while (start > 0 && !/\s/.test(full[start - 1])) start--;
      while (end < full.length && !/\s/.test(full[end])) end++;
      if (end > start) {
        try {
          range = document.createRange();
          range.setStart(targetProbe.node, start);
          range.setEnd(targetProbe.node, end);
          text = range.toString().trim();
        } catch (e) {}
      }
    }

    // Fallback: If word boundary extraction didn't yield text, select entire target span
    if (!range || !text) {
      const targetSpan = targetProbe?.span || this.findTargetElementUnderPoint(point.x, point.y, pageWrapper);
      if (targetSpan) {
        try {
          range = document.createRange();
          range.selectNodeContents(targetSpan);
          text = range.toString().trim();
        } catch (err) {
          console.warn('[MobileSelectionController] Selection creation failed:', err);
        }
      }
    }

    if (!range || !text) return;

    // Lock page scroll and prevent mobile browser from hijacking drag to scroll.
    // Record current scroll position BEFORE modifying DOM selection or classes.
    const readerBody = document.getElementById('reader-body');
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
      initialEndOffset: range.endOffset
    };
    this.pageWrapper = pageWrapper;
    this.isSelecting = true;

    if (typeof document !== 'undefined' && document.body?.classList) {
      document.body.classList.add('mobile-text-selecting');
    }

    // Re-verify that scroll position was not displaced by selection creation
    if (readerBody && this.lockedScrollTop != null) {
      if (readerBody.scrollLeft !== this.lockedScrollLeft) {
        readerBody.scrollLeft = this.lockedScrollLeft;
      }
      if (readerBody.scrollTop !== this.lockedScrollTop) {
        readerBody.scrollTop = this.lockedScrollTop;
      }
    }

    const vp = this.reader?.viewportEl || document.getElementById('pdf-viewport');
    if (this.activePointerId != null && vp && typeof vp.setPointerCapture === 'function') {
      try {
        vp.setPointerCapture(this.activePointerId);
      } catch (err) {}
    }

    // Always keep or return to 'pan' mode
    if (this.model.drawTool !== 'pan') {
      this.reader.drawing?.setDrawTool('pan');
    }

    // Show selection loupe
    if (this.loupe) {
      this.loupe.update(point.x, point.y, pageWrapper);
    }

    // Keep floating toolbar hidden while dragging
    const floatingToolbar = this.reader?.floatingToolbar || document.getElementById('floating-toolbar');
    if (floatingToolbar) {
      floatingToolbar.style.opacity = '0';
      floatingToolbar.style.pointerEvents = 'none';
    }
  }

  updateSelectionToPoint(clientX, clientY, pageWrapper) {
    if (!this.anchorTarget || !pageWrapper) return;
    let currentPos = this.getTextPositionAt(clientX, clientY, pageWrapper);
    if (!currentPos || !currentPos.node) {
      // Spatial tolerance slack of 52px horizontally and 36px vertically while dragging
      currentPos = this.findNearbyTarget(clientX, clientY, pageWrapper, 52, 36);
    }
    if (!currentPos || !currentPos.node) return;

    const sel = window.getSelection();
    if (!sel) return;

    try {
      const cmp = this.comparePositions(
        this.anchorTarget.node,
        this.anchorTarget.offset,
        currentPos.node,
        currentPos.offset
      );
      if (cmp <= 0) {
        if (typeof sel.setBaseAndExtent === 'function') {
          sel.setBaseAndExtent(
            this.anchorTarget.node,
            this.anchorTarget.offset,
            currentPos.node,
            currentPos.offset
          );
        }
      } else {
        if (typeof sel.setBaseAndExtent === 'function') {
          sel.setBaseAndExtent(
            currentPos.node,
            currentPos.offset,
            this.anchorTarget.initialEndNode || this.anchorTarget.node,
            this.anchorTarget.initialEndOffset || this.anchorTarget.offset
          );
        }
      }
    } catch (err) {}
  }

  findNearbyTarget(clientX, clientY, pageWrapper, slackX = 44, slackY = 30) {
    if (!pageWrapper) return null;
    const textLayer = pageWrapper.querySelector?.('.textLayer') || pageWrapper.querySelector?.('.pdf-text-layer');
    if (!textLayer) return null;

    // 1. Leverage ReaderNativeSelectionLoupeController findTextTargetWithinGap if available
    if (typeof ReaderNativeSelectionLoupeController !== 'undefined' &&
        typeof ReaderNativeSelectionLoupeController.prototype?.findTextTargetWithinGap === 'function') {
      const probe = ReaderNativeSelectionLoupeController.prototype.findTextTargetWithinGap.call(
        null, clientX, clientY, textLayer, slackX, slackY, false
      );
      if (probe && probe.node) {
        return probe;
      }
    }

    // 2. Direct geometric proximity over candidate word and line spans
    const words = Array.from(textLayer.querySelectorAll?.('.precise-word') || []);
    const lines = words.length > 0 ? [] : Array.from(textLayer.querySelectorAll?.('.precise-line, span') || []);
    const candidates = words.length > 0 ? words : lines;
    if (!candidates.length) return null;

    const maxDistSq = (slackX * slackX) + (slackY * slackY);
    const nearest = ReaderTextTargetGeometry.nearestElement(candidates, clientX, clientY);

    if (nearest && nearest.distanceSq <= maxDistSq) {
      const textNode = nearest.element.firstChild || nearest.element;
      const offset = ReaderTextTargetGeometry.textOffsetAtX(textNode, nearest.rect, clientX);
      return { node: textNode, offset, span: nearest.element, rect: nearest.rect };
    }

    return null;
  }

  findTargetElementUnderPoint(clientX, clientY, pageWrapper) {
    const elements = document.elementsFromPoint
      ? document.elementsFromPoint(clientX, clientY)
      : (document.elementFromPoint ? [document.elementFromPoint(clientX, clientY)] : []);
    for (const el of elements) {
      if (!el) continue;
      const found = (el.closest && (el.closest('.precise-word') || el.closest('.precise-line') || el.closest('.textLayer span'))) ||
        (el.classList?.contains('precise-word') || el.classList?.contains('precise-line') ? el : null);
      if (found) return found;
    }
    return null;
  }

  comparePositions(nodeA, offsetA, nodeB, offsetB) {
    if (!nodeA || !nodeB) return 0;
    if (nodeA === nodeB) return offsetA - offsetB;
    if (typeof Node !== 'undefined' && nodeA.compareDocumentPosition) {
      const pos = nodeA.compareDocumentPosition(nodeB);
      if (pos & (Node.DOCUMENT_POSITION_FOLLOWING | Node.DOCUMENT_POSITION_CONTAINED_BY)) return -1;
      if (pos & (Node.DOCUMENT_POSITION_PRECEDING | Node.DOCUMENT_POSITION_CONTAINS)) return 1;
    }
    return 0;
  }

  getTextPositionAt(clientX, clientY, pageWrapper) {
    if (!pageWrapper) return null;

    const caret = ReaderTextTargetGeometry.caretPosition(clientX, clientY);
    if (caret &&
        caret.node.nodeType === (typeof Node !== 'undefined' ? Node.TEXT_NODE : 3) &&
        pageWrapper.contains(caret.node)) {
      return caret;
    }

    const elements = document.elementsFromPoint
      ? document.elementsFromPoint(clientX, clientY)
      : (document.elementFromPoint ? [document.elementFromPoint(clientX, clientY)] : []);
    for (const el of elements) {
      if (!el) continue;
      const wordSpan = el.closest ? el.closest('.precise-word') : (el.classList?.contains('precise-word') ? el : null);
      const textSpan = wordSpan || (el.closest ? (el.closest('.precise-line') || el.closest('.textLayer span')) : null);
      if (textSpan && pageWrapper.contains(textSpan)) {
        const textNode = textSpan.firstChild || textSpan;
        if (textNode) {
          const rect = textSpan.getBoundingClientRect ? textSpan.getBoundingClientRect() : { left: 0, width: 100 };
          return {
            node: textNode,
            offset: ReaderTextTargetGeometry.textOffsetAtX(textNode, rect, clientX)
          };
        }
      }
    }
    return null;
  }

  getPageWrapperAt(clientX, clientY) {
    const viewport = this.reader?.viewportEl || document.getElementById('pdf-viewport');
    if (!viewport) return null;

    const elements = document.elementsFromPoint
      ? document.elementsFromPoint(clientX, clientY)
      : (document.elementFromPoint ? [document.elementFromPoint(clientX, clientY)] : []);
    for (const el of elements) {
      if (!el) continue;
      const wrapper = el.closest ? el.closest('.pdf-page-wrapper, [id^="pdf-page-"]') : null;
      if (wrapper) return wrapper;
      if (el.classList?.contains('pdf-page-wrapper')) return el;
    }

    const queryWrappers = Array.from(viewport.querySelectorAll ? viewport.querySelectorAll('.pdf-page-wrapper, [id^="pdf-page-"]') : []);
    const childWrappers = Array.from(viewport.children || []).filter(c => c.classList?.contains('pdf-page-wrapper') || (c.id && c.id.startsWith('pdf-page-')));
    const allWrappers = queryWrappers.length > 0 ? queryWrappers : childWrappers;
    if (!allWrappers.length) {
      const fallback = viewport.querySelector ? viewport.querySelector('.textLayer')?.parentElement : null;
      return fallback || null;
    }

    for (const w of allWrappers) {
      const rect = w.getBoundingClientRect ? w.getBoundingClientRect() : null;
      if (rect && clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
        return w;
      }
    }

    let nearestWrapper = null;
    let minVerticalDist = Infinity;
    for (const w of allWrappers) {
      const rect = w.getBoundingClientRect ? w.getBoundingClientRect() : null;
      if (!rect) continue;
      const dist = clientY < rect.top ? rect.top - clientY : (clientY > rect.bottom ? clientY - rect.bottom : 0);
      if (dist < minVerticalDist) {
        minVerticalDist = dist;
        nearestWrapper = w;
      }
    }
    if (nearestWrapper) return nearestWrapper;

    const currentWrapper = document.getElementById(`pdf-page-${this.model.currentPage}`) ||
      (viewport.querySelector ? viewport.querySelector(`.pdf-page-wrapper[data-page="${this.model.currentPage}"]`) : null);
    if (currentWrapper) return currentWrapper;

    return allWrappers[0] || null;
  }
}

window.MobileSelectionController = MobileSelectionController;
