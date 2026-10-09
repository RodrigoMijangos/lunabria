/**
 * ReaderTextHighlightController.js
 * Owns pointer-driven text selection and commits one annotation per gesture.
 */
class ReaderTextHighlightController {
  constructor(model, getAnnotationCoordinator) {
    this.model = model;
    this.getAnnotationCoordinator = getAnnotationCoordinator;
    this.loupe = new ReaderSelectionLoupeView();
    this.gesture = null;
  }

  get isSelecting() {
    return Boolean(this.gesture);
  }

  ownsPointer(pointerId) {
    return Boolean(this.gesture && this.gesture.pointerId === pointerId);
  }

  buildTextRecords(pageWrapper) {
    const textLayer = pageWrapper.querySelector('.textLayer');
    if (!textLayer) return [];

    const records = [];
    const walker = document.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let node;
    while ((node = walker.nextNode())) {
      const text = node.textContent || '';
      const words = /\S+/g;
      let match;
      while ((match = words.exec(text)) !== null) {
        const start = match.index;
        const end = start + match[0].length;
        range.setStart(node, start);
        range.setEnd(node, end);
        for (const rect of range.getClientRects()) {
          if (rect.width > 0 && rect.height > 0) records.push({ node, start, end, rect });
        }
      }
    }
    return records;
  }

  textPositionAtPoint(clientX, clientY, pageWrapper, textRecords, allowNearby = false) {
    let position = null;
    if (document.caretRangeFromPoint) {
      const range = document.caretRangeFromPoint(clientX, clientY);
      if (range) position = { node: range.startContainer, offset: range.startOffset };
    } else if (document.caretPositionFromPoint) {
      const caret = document.caretPositionFromPoint(clientX, clientY);
      if (caret) position = { node: caret.offsetNode, offset: caret.offset };
    }

    const distanceToRect = rect => {
      const dx = clientX < rect.left ? rect.left - clientX : clientX > rect.right ? clientX - rect.right : 0;
      const dy = clientY < rect.top ? rect.top - clientY : clientY > rect.bottom ? clientY - rect.bottom : 0;
      return dx * dx + dy * dy;
    };

    if (position?.node?.nodeType === Node.TEXT_NODE &&
        pageWrapper.contains(position.node) &&
        position.node.parentElement?.closest('.textLayer')) {
      position.offset = Math.max(0, Math.min(position.node.textContent.length, position.offset));
      const wordRecord = textRecords.find(record =>
        record.node === position.node &&
        position.offset >= record.start && position.offset <= record.end
      );
      if (wordRecord) {
        const tolerance = allowNearby ? Math.max(3, wordRecord.rect.height * 0.2) : 0;
        if (distanceToRect(wordRecord.rect) <= tolerance * tolerance) return position;
      }
    }

    let nearest = null;
    let nearestDistance = Infinity;
    for (const record of textRecords) {
      const distance = distanceToRect(record.rect);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = record;
      }
    }

    if (!nearest) return null;
    const tolerance = allowNearby ? Math.max(3, nearest.rect.height * 0.2) : 0;
    if (nearestDistance > tolerance * tolerance) return null;

    const ratio = nearest.rect.width
      ? Math.max(0, Math.min(1, (clientX - nearest.rect.left) / nearest.rect.width))
      : 0;
    return {
      node: nearest.node,
      offset: Math.round(nearest.start + ratio * (nearest.end - nearest.start))
    };
  }

  setSelection(anchor, focus) {
    const selection = window.getSelection();
    if (!selection || !anchor || !focus) return;
    try {
      if (typeof selection.setBaseAndExtent === 'function') {
        selection.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
      } else {
        selection.removeAllRanges();
        selection.collapse(anchor.node, anchor.offset);
        selection.extend(focus.node, focus.offset);
      }
    } catch (error) {
      console.warn('[ReaderTextHighlightController] Could not update selection:', error);
    }
  }

  handlePointerDown(event, pageNumber, pageWrapper) {
    if (event.isPrimary === false || (event.pointerType !== 'pen' && event.button !== 0)) return false;

    const textRecords = this.buildTextRecords(pageWrapper);
    const anchor = this.textPositionAtPoint(event.clientX, event.clientY, pageWrapper, textRecords);
    if (!anchor) return false;

    event.preventDefault();
    event.stopPropagation();
    this.gesture = { pointerId: event.pointerId, pageNumber, pageWrapper, anchor, focus: anchor, textRecords };
    this.setSelection(anchor, anchor);
    try { pageWrapper.setPointerCapture(event.pointerId); } catch (error) {}
    this.updateGesture(event);
    return true;
  }

  handlePointerMove(event) {
    if (!this.ownsPointer(event.pointerId)) return false;
    event.preventDefault();
    event.stopPropagation();
    this.updateGesture(event);
    return true;
  }

  updateGesture(event) {
    const gesture = this.gesture;
    if (!gesture) return;

    const focus = this.textPositionAtPoint(
      event.clientX,
      event.clientY,
      gesture.pageWrapper,
      gesture.textRecords,
      true
    );
    if (focus && (focus.node !== gesture.focus.node || focus.offset !== gesture.focus.offset)) {
      gesture.focus = focus;
      this.setSelection(gesture.anchor, focus);
    }
    this.loupe.update(event.clientX, event.clientY, gesture.pageWrapper);
  }

  async handlePointerUp(event) {
    if (!this.ownsPointer(event.pointerId)) return false;
    event.preventDefault();
    event.stopPropagation();
    if (event.type === 'pointercancel') {
      this.cancel();
      return true;
    }

    const gesture = this.gesture;
    this.updateGesture(event);
    this.gesture = null;
    this.loupe.hide();
    try { gesture.pageWrapper.releasePointerCapture(event.pointerId); } catch (error) {}

    const selection = window.getSelection();
    const text = selection?.toString().trim() || '';
    if (!text || !selection?.rangeCount) {
      selection?.removeAllRanges();
      return true;
    }

    this.model.selectedRange = selection.getRangeAt(0).cloneRange();
    this.model.selectedText = text;
    try {
      const colorId = this.model.getHighlightColorIdFromHex(this.model.drawColor);
      const annotations = this.getAnnotationCoordinator();
      if (annotations) await annotations.applyHighlight(colorId, '', { showQuickPalette: true });
    } catch (error) {
      console.error('[ReaderTextHighlightController] Could not save highlight:', error);
      selection.removeAllRanges();
    } finally {
      this.model.selectedRange = null;
      this.model.selectedText = '';
    }
    return true;
  }

  cancel() {
    const gesture = this.gesture;
    this.gesture = null;
    this.loupe.hide();
    if (!gesture) return;
    try { gesture.pageWrapper.releasePointerCapture(gesture.pointerId); } catch (error) {}
    window.getSelection()?.removeAllRanges();
    this.model.selectedRange = null;
    this.model.selectedText = '';
  }
}

window.ReaderTextHighlightController = ReaderTextHighlightController;
