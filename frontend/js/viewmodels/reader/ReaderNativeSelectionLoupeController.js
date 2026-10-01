/**
 * ReaderNativeSelectionLoupeController.js
 * Shows the selection loupe during native text selection in reading mode.
 */
class ReaderNativeSelectionLoupeController {
  constructor(model, viewportEl) {
    this.model = model;
    this.viewportEl = viewportEl;
    this.loupe = new ReaderSelectionLoupeView();
    this.pointerId = null;
    this.pageWrapper = null;
  }

  bindEvents() {
    this.viewportEl.addEventListener('pointerdown', event => this.startSelection(event), true);
    this.viewportEl.addEventListener('mousedown', event => {
      if (this.model.isDrawMode || event.button !== 0 || !(event.target instanceof Element)) return;
      const textLayer = event.target.closest('.textLayer');
      const textElement = event.target.closest('.textLayer span');
      if (textLayer && (!textElement || !this.isPointerOverText(event.clientX, event.clientY, textElement))) {
        event.preventDefault();
      }
    }, true);
    window.addEventListener('pointermove', event => this.updateSelection(event), true);
    window.addEventListener('pointerup', event => this.endSelection(event), true);
    window.addEventListener('pointercancel', event => this.endSelection(event), true);
    window.addEventListener('blur', () => this.cancelSelection());
  }

  startSelection(event) {
    if (this.model.isDrawMode || event.pointerType === 'pen' || event.isPrimary === false || event.button !== 0) return;
    if (!(event.target instanceof Element)) return;
    const textLayer = event.target.closest('.textLayer');
    if (!textLayer) return;

    const textElement = event.target.closest('.textLayer span');
    if (!textElement?.textContent?.trim() || !this.isPointerOverText(event.clientX, event.clientY, textElement)) {
      event.preventDefault();
      this.cancelSelection();
      return;
    }

    const pageWrapper = textLayer.closest('.pdf-page-wrapper');
    if (!pageWrapper) return;

    this.pointerId = event.pointerId;
    this.pageWrapper = pageWrapper;
    this.loupe.update(event.clientX, event.clientY, pageWrapper);
  }

  isPointerOverText(clientX, clientY, textElement) {
    let node = null;
    let offset = 0;
    if (document.caretRangeFromPoint) {
      const range = document.caretRangeFromPoint(clientX, clientY);
      if (range) {
        node = range.startContainer;
        offset = range.startOffset;
      }
    } else if (document.caretPositionFromPoint) {
      const caret = document.caretPositionFromPoint(clientX, clientY);
      if (caret) {
        node = caret.offsetNode;
        offset = caret.offset;
      }
    }

    if (node?.nodeType !== Node.TEXT_NODE || !textElement.contains(node)) return false;
    const text = node.textContent || '';
    const range = document.createRange();
    for (const index of [offset, offset - 1]) {
      if (index < 0 || index >= text.length || !text[index].trim()) continue;
      range.setStart(node, index);
      range.setEnd(node, index + 1);
      for (const rect of range.getClientRects()) {
        if (clientX >= rect.left - 1 && clientX <= rect.right + 1 &&
            clientY >= rect.top - 1 && clientY <= rect.bottom + 1) {
          return true;
        }
      }
    }
    return false;
  }

  updateSelection(event) {
    if (event.pointerId !== this.pointerId) return;
    if (this.model.isDrawMode || !this.pageWrapper?.isConnected || event.buttons === 0) {
      this.cancelSelection();
      return;
    }
    this.loupe.update(event.clientX, event.clientY, this.pageWrapper);
  }

  endSelection(event) {
    if (event.pointerId !== this.pointerId) return;
    this.cancelSelection();
  }

  cancelSelection() {
    this.pointerId = null;
    this.pageWrapper = null;
    this.loupe.hide();
  }
}

window.ReaderNativeSelectionLoupeController = ReaderNativeSelectionLoupeController;
