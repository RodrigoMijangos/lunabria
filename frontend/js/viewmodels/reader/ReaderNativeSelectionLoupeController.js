/**
 * ReaderNativeSelectionLoupeController.js
 * Shows the selection loupe during native text selection in reading mode.
 */
const LOUPE_IGNORED_SELECTOR =
  "#reader-header, #reader-footer, #floating-toolbar, #highlight-action-menu, .drawing-toolbar, .drawer, button, select, input";

class ReaderNativeSelectionLoupeController {
  constructor(model, viewportEl, bodyEl) {
    this.model = model;
    this.viewportEl = viewportEl;
    this.bodyEl = bodyEl || viewportEl?.parentElement;
    this.loupe = new ReaderSelectionLoupeView();
    this.pointerId = null;
    this.pageWrapper = null;
    this.anchor = null;
    this.anchorWord = null;
    this.clickDetail = 1;
    this.isMouseDown = false;
    this.startX = 0;
    this.startY = 0;
    this.isSelecting = false;
    this.didDrag = false;
    this.completedSelectionDrag = false;
  }

  comparePositions(nodeA, offsetA, nodeB, offsetB) {
    return ReaderTextTargetGeometry.comparePositions(nodeA, offsetA, nodeB, offsetB);
  }

  getWordBoundaries(targetInfo) {
    return ReaderTextTargetGeometry.getWordBoundaries(targetInfo);
  }

  textTargetInWord(wordSpan, clientX, clientY) {
    return ReaderTextTargetGeometry.textTargetInWord(wordSpan, clientX, clientY);
  }

  directWordTarget(eventTarget, clientX, clientY) {
    const wordSpan = eventTarget?.closest?.(".precise-word");
    if (!wordSpan || !wordSpan.closest(".textLayer")) return null;
    return this.textTargetInWord(wordSpan, clientX, clientY);
  }

  getPageWrapperAt(clientX, clientY) {
    if (!this.viewportEl) return null;
    const el = document.elementFromPoint(clientX, clientY);
    const wrapper = el?.closest?.('.pdf-page-wrapper, [id^="pdf-page-"]');
    if (wrapper && this.viewportEl.contains(wrapper)) return wrapper;

    const allWrappers = Array.from(this.viewportEl.querySelectorAll('.pdf-page-wrapper, [id^="pdf-page-"]'));
    if (!allWrappers.length) {
      const fallback = this.viewportEl.querySelector(".textLayer")?.parentElement;
      return fallback && this.viewportEl.contains(fallback) ? fallback : null;
    }
    if (allWrappers.length === 1) return allWrappers[0];

    for (const pw of allWrappers) {
      const r = pw.getBoundingClientRect();
      if (clientY >= r.top && clientY <= r.bottom) return pw;
    }

    return allWrappers.reduce((closest, pw) => {
      const cr = closest.getBoundingClientRect();
      const pr = pw.getBoundingClientRect();
      const distC = Math.min(Math.abs(clientY - cr.top), Math.abs(clientY - cr.bottom));
      const distP = Math.min(Math.abs(clientY - pr.top), Math.abs(clientY - pr.bottom));
      return distP < distC ? pw : closest;
    }, allWrappers[0]);
  }

  bindEvents() {
    const targetContainer = this.bodyEl || this.viewportEl;

    targetContainer.addEventListener("pointerdown", (event) => this.startSelection(event), true);
    targetContainer.addEventListener("mousedown", (event) => this.handleMouseDown(event), true);
    targetContainer.addEventListener("click", (event) => this.handleDoubleClick(event), true);

    window.addEventListener("pointermove", (event) => this.updateSelection(event), true);
    window.addEventListener("mousemove", (event) => this.updateSelection(event), true);
    window.addEventListener("pointerup", (event) => this.endSelection(event), true);
    window.addEventListener("mouseup", (event) => this.endSelection(event), true);
    window.addEventListener("pointercancel", (event) => this.endSelection(event), true);
    window.addEventListener("blur", () => this.cancelSelection());
    targetContainer.addEventListener("dragstart", (event) => event.preventDefault(), true);
  }

  handleMouseDown(event) {
    if (this.model.isDrawMode || event.button !== 0 || !(event.target instanceof Element)) return;
    if (event.target.closest(LOUPE_IGNORED_SELECTOR)) return;

    const pageWrapper = this.getPageWrapperAt(event.clientX, event.clientY);
    const textLayer = pageWrapper?.querySelector(".textLayer");
    if (!textLayer || !pageWrapper) return;

    const targetInfo =
      this.directWordTarget(event.target, event.clientX, event.clientY) ||
      this.findTextTargetWithinGap(event.clientX, event.clientY, textLayer, 80, 40, false);
    if (!targetInfo?.node) {
      event.preventDefault();
      this.cancelSelection();
      return;
    }

    this.anchor = targetInfo;
    this.pageWrapper = pageWrapper;
    this.clickDetail = event.detail || 1;
    this.anchorWord = this.getWordBoundaries(targetInfo);
    this.startX = event.clientX;
    this.startY = event.clientY;
    this.isMouseDown = true;
    this.isSelecting = false;
    this.didDrag = false;
    this.completedSelectionDrag = false;

    event.preventDefault();
    const selection = window.getSelection();
    if (!selection) return;
    try {
      if (this.clickDetail === 2 && this.anchorWord) {
        selection.setBaseAndExtent(
          this.anchorWord.startNode,
          this.anchorWord.startOffset,
          this.anchorWord.endNode,
          this.anchorWord.endOffset,
        );
      } else if (this.clickDetail === 1) {
        selection.collapse(targetInfo.node, targetInfo.offset);
      }
    } catch (_) {}
  }

  handleDoubleClick(event) {
    if (event.detail !== 2 || this.model.isDrawMode || !(event.target instanceof Element)) return;
    if (event.target.closest(LOUPE_IGNORED_SELECTOR)) return;

    const pageWrapper = this.getPageWrapperAt(event.clientX, event.clientY);
    const textLayer = pageWrapper?.querySelector(".textLayer");
    const target =
      this.directWordTarget(event.target, event.clientX, event.clientY) ||
      this.findTextTargetWithinGap(event.clientX, event.clientY, textLayer, 80, 40, false);
    const word = this.getWordBoundaries(target);
    if (!word) return;

    if (this.completedSelectionDrag) {
      this.completedSelectionDrag = false;
      return;
    }

    event.preventDefault();
    try {
      window.getSelection()?.setBaseAndExtent(word.startNode, word.startOffset, word.endNode, word.endOffset);
    } catch (_) {}
  }

  findTextTargetWithinGap(clientX, clientY, textLayer, gapX = Infinity, gapY = Infinity, isDragging = false) {
    return ReaderTextTargetGeometry.findTextTargetWithinGap(clientX, clientY, textLayer, gapX, gapY, isDragging);
  }

  startSelection(event) {
    if (this.model.isDrawMode || event.pointerType === "pen" || event.isPrimary === false || event.button !== 0) {
      return;
    }
    this.completedSelectionDrag = false;
    this.didDrag = false;
    if (!(event.target instanceof Element) || event.target.closest(LOUPE_IGNORED_SELECTOR)) return;

    const pageWrapper = this.getPageWrapperAt(event.clientX, event.clientY);
    const textLayer = pageWrapper?.querySelector(".textLayer");
    if (!textLayer || !pageWrapper) return;

    const targetInfo =
      this.directWordTarget(event.target, event.clientX, event.clientY) ||
      this.findTextTargetWithinGap(event.clientX, event.clientY, textLayer, 80, 40, false);
    if (!targetInfo) {
      this.cancelSelection();
      return;
    }

    this.pointerId = event.pointerId;
    this.pageWrapper = pageWrapper;
    this.anchor = targetInfo;
    this.clickDetail = event.detail || 1;
    this.anchorWord = this.getWordBoundaries(targetInfo);
    this.startX = event.clientX;
    this.startY = event.clientY;
    this.isMouseDown = true;
    this.isSelecting = false;
  }

  isPointerOverText(clientX, clientY, _textElement) {
    const pageWrapper = this.getPageWrapperAt(clientX, clientY);
    const textLayer = pageWrapper?.querySelector(".textLayer");
    if (!textLayer) return false;
    return Boolean(this.findTextTargetWithinGap(clientX, clientY, textLayer, Infinity, Infinity, false));
  }

  updateSelection(event) {
    if (this.model.isDrawMode || !this.pageWrapper?.isConnected) {
      this.cancelSelection();
      return;
    }
    if (event.buttons === 0) {
      this.endSelection(event);
      return;
    }
    if ((this.pointerId !== event.pointerId && !this.isMouseDown) || !this.anchor?.node) return;

    const activeWrapper = this.getPageWrapperAt(event.clientX, event.clientY) || this.pageWrapper;
    const textLayer = activeWrapper?.querySelector(".textLayer") || this.pageWrapper.querySelector(".textLayer");
    if (!textLayer) return;

    const focus = this.findTextTargetWithinGap(event.clientX, event.clientY, textLayer, Infinity, Infinity, true);
    if (!focus?.node) return;

    this.applySelectionExtent(focus);

    const pointerTravel = Math.hypot(event.clientX - this.startX, event.clientY - this.startY);
    const hasSelectionSpan = focus.node !== this.anchor.node || focus.offset !== this.anchor.offset;
    if (pointerTravel > 8) this.didDrag = true;

    if (this.isSelecting || pointerTravel > 3 || hasSelectionSpan) {
      this.isSelecting = true;
      this.loupe.update(event.clientX, event.clientY, activeWrapper);
    }
  }

  applySelectionExtent(focus) {
    const selection = window.getSelection();
    if (!selection) return;
    try {
      if (this.clickDetail === 2 && this.anchorWord) {
        const focusWord = this.getWordBoundaries(focus) || {
          startNode: focus.node,
          startOffset: focus.offset,
          endNode: focus.node,
          endOffset: focus.offset,
        };
        const cmp = this.comparePositions(
          this.anchorWord.startNode,
          this.anchorWord.startOffset,
          focusWord.startNode,
          focusWord.startOffset,
        );
        if (cmp <= 0) {
          selection.setBaseAndExtent(
            this.anchorWord.startNode,
            this.anchorWord.startOffset,
            focusWord.endNode,
            focusWord.endOffset,
          );
        } else {
          selection.setBaseAndExtent(
            this.anchorWord.endNode,
            this.anchorWord.endOffset,
            focusWord.startNode,
            focusWord.startOffset,
          );
        }
      } else {
        selection.setBaseAndExtent(this.anchor.node, this.anchor.offset, focus.node, focus.offset);
      }
    } catch (_) {}
  }

  endSelection(_event) {
    this.completedSelectionDrag = this.completedSelectionDrag || this.didDrag;
    this.didDrag = false;
    this.isMouseDown = false;
    this.isSelecting = false;
    this.anchor = null;
    this.anchorWord = null;
    this.clickDetail = 1;
    this.cancelSelection();
  }

  cancelSelection() {
    this.pointerId = null;
    this.isMouseDown = false;
    this.isSelecting = false;
    this.anchor = null;
    this.anchorWord = null;
    this.clickDetail = 1;
    this.pageWrapper = null;
    this.loupe.hide();
  }
}

window.ReaderNativeSelectionLoupeController = ReaderNativeSelectionLoupeController;
