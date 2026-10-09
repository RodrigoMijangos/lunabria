/**
 * ReaderNativeSelectionLoupeController.js
 * Shows the selection loupe during native text selection in reading mode.
 */
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
    if (!nodeA || !nodeB) return 0;
    if (nodeA === nodeB) return offsetA - offsetB;
    if (typeof Node !== 'undefined' && nodeA.compareDocumentPosition) {
      const pos = nodeA.compareDocumentPosition(nodeB);
      if (pos & (Node.DOCUMENT_POSITION_FOLLOWING | Node.DOCUMENT_POSITION_CONTAINED_BY)) return -1;
      if (pos & (Node.DOCUMENT_POSITION_PRECEDING | Node.DOCUMENT_POSITION_CONTAINS)) return 1;
    }
    return 0;
  }

  getWordBoundaries(targetInfo) {
    if (!targetInfo || !targetInfo.node) return null;
    const node = targetInfo.node;
    const text = node.textContent || '';

    const wordSpan = targetInfo.span?.closest?.('.precise-word');
    if (wordSpan && wordSpan.contains(node)) {
      return {
        startNode: node,
        startOffset: 0,
        endNode: node,
        endOffset: text.trimEnd().length,
        fullText: text.trimEnd()
      };
    }

    const offset = Math.max(0, Math.min(text.length, targetInfo.offset || 0));
    let start = offset;
    while (start > 0 && !/\s/.test(text[start - 1])) start--;
    let end = offset;
    while (end < text.length && !/\s/.test(text[end])) end++;
    return {
      startNode: node,
      startOffset: start,
      endNode: node,
      endOffset: end,
      fullText: text.slice(start, end)
    };
  }

  textTargetInWord(wordSpan, clientX, clientY) {
    return ReaderTextTargetGeometry.textTargetInWord(wordSpan, clientX, clientY);
  }

  directWordTarget(eventTarget, clientX, clientY) {
    const wordSpan = eventTarget?.closest?.('.precise-word');
    if (!wordSpan || !wordSpan.closest('.textLayer')) return null;
    return this.textTargetInWord(wordSpan, clientX, clientY);
  }

  getPageWrapperAt(clientX, clientY) {
    if (!this.viewportEl) return null;
    const el = document.elementFromPoint(clientX, clientY);
    const wrapper = el?.closest?.('.pdf-page-wrapper, [id^="pdf-page-"]');
    if (wrapper && this.viewportEl.contains(wrapper)) return wrapper;

    const allWrappers = Array.from(this.viewportEl.querySelectorAll('.pdf-page-wrapper, [id^="pdf-page-"]'));
    if (!allWrappers.length) {
      const fallback = this.viewportEl.querySelector('.textLayer')?.parentElement;
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

    targetContainer.addEventListener('pointerdown', event => this.startSelection(event), true);
    targetContainer.addEventListener('mousedown', event => {
      if (this.model.isDrawMode || event.button !== 0 || !(event.target instanceof Element)) return;

      if (event.target.closest('#reader-header, #reader-footer, #floating-toolbar, #highlight-action-menu, .drawing-toolbar, .drawer, button, select, input')) {
        return;
      }

      const pageWrapper = this.getPageWrapperAt(event.clientX, event.clientY);
      const textLayer = pageWrapper?.querySelector('.textLayer');
      if (!textLayer || !pageWrapper) return;

      const targetInfo = this.directWordTarget(event.target, event.clientX, event.clientY) ||
        this.findTextTargetWithinGap(event.clientX, event.clientY, textLayer, 80, 40, false);
      if (!targetInfo || !targetInfo.node) {
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

      // The native mousedown default can re-anchor a selection at the first
      // absolutely positioned text span; all reader selection is driven below.
      event.preventDefault();
      const selection = window.getSelection();
      if (selection) {
        if (this.clickDetail === 2 && this.anchorWord) {
          try {
            selection.setBaseAndExtent(
              this.anchorWord.startNode,
              this.anchorWord.startOffset,
              this.anchorWord.endNode,
              this.anchorWord.endOffset
            );
          } catch (e) {}
        } else if (this.clickDetail === 1) {
          try {
            selection.collapse(targetInfo.node, targetInfo.offset);
          } catch (e) {}
        }
      }
    }, true);

    targetContainer.addEventListener('click', event => {
      if (event.detail !== 2 || this.model.isDrawMode || !(event.target instanceof Element)) return;
      if (event.target.closest('#reader-header, #reader-footer, #floating-toolbar, #highlight-action-menu, .drawing-toolbar, .drawer, button, select, input')) return;

      const pageWrapper = this.getPageWrapperAt(event.clientX, event.clientY);
      const textLayer = pageWrapper?.querySelector('.textLayer');
      const target = this.directWordTarget(event.target, event.clientX, event.clientY) ||
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
      } catch (e) {}
    }, true);

    window.addEventListener('pointermove', event => this.updateSelection(event), true);
    window.addEventListener('mousemove', event => this.updateSelection(event), true);
    window.addEventListener('pointerup', event => this.endSelection(event), true);
    window.addEventListener('mouseup', event => this.endSelection(event), true);
    window.addEventListener('pointercancel', event => this.endSelection(event), true);
    window.addEventListener('blur', () => this.cancelSelection());
    targetContainer.addEventListener('dragstart', event => event.preventDefault(), true);
  }

  findTextTargetWithinGap(clientX, clientY, textLayer, gapX = Infinity, gapY = Infinity, isDragging = false) {
    if (!textLayer) return null;

    const preciseLines = Array.from(textLayer.querySelectorAll('.precise-line')).filter(s => s.textContent?.trim());
    if (!preciseLines.length) {
      const nativePosition = ReaderTextTargetGeometry.caretPosition(clientX, clientY);
      const nativeNode = nativePosition?.node;
      const nativeOffset = nativePosition?.offset;
      const nativeSpan = nativeNode?.parentElement?.closest?.('span') || nativeNode?.parentElement;
      const nativeRect = nativeSpan?.getBoundingClientRect?.();
      const pointerIsOverCaretSpan = nativeRect && clientX >= nativeRect.left && clientX <= nativeRect.right &&
        clientY >= nativeRect.top && clientY <= nativeRect.bottom;

      // PDF.js fallback layers use independent spans, not one .precise-line per row.
      // Trust the browser caret in the span under the pointer instead of treating
      // the first span on that row as the whole line.
      if (nativeNode?.nodeType === Node.TEXT_NODE && textLayer.contains(nativeNode) && pointerIsOverCaretSpan) {
        return {
          node: nativeNode,
          offset: Math.max(0, Math.min(nativeNode.textContent.length, nativeOffset)),
          span: nativeSpan,
          rect: nativeRect
        };
      }
    }

    const lineSpans = preciseLines;
    const rawSpans = lineSpans.length > 0 ? lineSpans : Array.from(textLayer.querySelectorAll('span')).filter(s => s.textContent?.trim());
    if (!rawSpans.length) return null;

    // Collect and sort lines geometrically from top to bottom
    const lineEntries = rawSpans.map(span => ({ span, rect: span.getBoundingClientRect() }))
                               .filter(e => e.rect.width > 0 && e.rect.height > 0)
                               .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);

    if (!lineEntries.length) return null;

    // Find the best line using inter-line midpoint boundaries (identical to MS Edge / Chromium PDF)
    let bestEntry = null;

    if (clientY <= lineEntries[0].rect.top) {
      if (isDragging || (lineEntries[0].rect.top - clientY <= gapY)) {
        bestEntry = lineEntries[0];
      }
    } else if (clientY >= lineEntries[lineEntries.length - 1].rect.bottom) {
      if (isDragging || (clientY - lineEntries[lineEntries.length - 1].rect.bottom <= gapY)) {
        bestEntry = lineEntries[lineEntries.length - 1];
      }
    } else {
      for (let i = 0; i < lineEntries.length; i++) {
        const curr = lineEntries[i];
        const next = lineEntries[i + 1];
        if (!next) {
          bestEntry = curr;
          break;
        }
        // Vertical threshold is the midpoint between line N and line N+1
        const midY = (curr.rect.bottom + next.rect.top) / 2;
        if (clientY < midY) {
          bestEntry = curr;
          break;
        }
      }
    }

    if (!bestEntry) return null;

    const bestSpan = bestEntry.span;
    const bestRect = bestEntry.rect;

    // Find primary text node
    const walker = document.createTreeWalker(bestSpan, NodeFilter.SHOW_TEXT);
    const textNode = walker.nextNode();
    if (!textNode) return null;

    const fullText = bestSpan.textContent || '';

    // If dragging vertically past the top or bottom of the entire text container
    if (isDragging) {
      if (clientY < lineEntries[0].rect.top) {
        return { node: textNode, offset: 0, span: bestSpan, rect: bestRect };
      }
      if (clientY > lineEntries[lineEntries.length - 1].rect.bottom) {
        let lastNode = textNode;
        let next;
        while ((next = walker.nextNode())) lastNode = next;
        return { node: lastNode, offset: (lastNode.textContent || '').length, span: bestSpan, rect: bestRect };
      }
    }

    // Horizontal snapping:
    // Left margin snap (MS Edge behavior: clicking/dragging in left margin snaps to start of line)
    if (clientX <= bestRect.left) {
      if (isDragging || (bestRect.left - clientX <= gapX)) {
        return { node: textNode, offset: 0, span: bestSpan, rect: bestRect };
      }
      return null;
    }

    // Right margin snap (MS Edge behavior: past end of line snaps to full line)
    if (clientX >= bestRect.right) {
      if (isDragging || (clientX - bestRect.right <= gapX)) {
        let lastNode = textNode;
        let next;
        while ((next = walker.nextNode())) lastNode = next;
        return { node: lastNode, offset: (lastNode.textContent || '').length, span: bestSpan, rect: bestRect };
      }
      return null;
    }

    // Within horizontal bounds: probe exact character position.
    const wordSpans = Array.from(bestSpan.querySelectorAll('.precise-word'));
    const clampedY = Math.min(bestRect.bottom - 2, Math.max(bestRect.top + 2, bestRect.top + bestRect.height / 2));
    const nativePosition = ReaderTextTargetGeometry.caretPosition(clientX, clampedY);
    const nativeNode = nativePosition?.node;
    const nativeOffset = nativePosition?.offset;

    if (nativeNode?.nodeType === Node.TEXT_NODE && bestSpan.contains(nativeNode)) {
      const wordSpan = nativeNode.parentElement?.closest?.('.precise-word');
      const wordRect = wordSpan?.getBoundingClientRect();
      const positionMatchesPointer = wordSpan && clientX >= wordRect.left && clientX <= wordRect.right &&
        clientY >= wordRect.top && clientY <= wordRect.bottom;

      // A caret API can return an element offset instead of a text node. Never
      // substitute the line's first text node for it; use geometric word hit
      // testing below, and reject text nodes whose word is not under the pointer.
      if (!wordSpans.length || positionMatchesPointer) {
        return {
          node: nativeNode,
          offset: nativeOffset,
          span: nativeNode.parentElement || bestSpan,
          rect: nativeNode.parentElement?.getBoundingClientRect() || bestRect
        };
      }
    }

    // Resolve gaps against the nearest actual word. Returning the line's first
    // text node here creates a range anchored at the beginning of every line.
    if (wordSpans.length > 0) {
      const nearest = ReaderTextTargetGeometry.nearestElement(wordSpans, clientX, clientY);
      return ReaderTextTargetGeometry.textTargetInWord(nearest?.element, clientX, clientY);
    }

    // Line-level ratio fallback
    const ratio = bestRect.width > 0 ? Math.max(0, Math.min(1, (clientX - bestRect.left) / bestRect.width)) : 0;
    const offset = Math.round(ratio * fullText.length);
    return { node: textNode, offset, span: bestSpan, rect: bestRect };
  }

  startSelection(event) {
    if (this.model.isDrawMode || event.pointerType === 'pen' || event.isPrimary === false || event.button !== 0) return;
    this.completedSelectionDrag = false;
    this.didDrag = false;
    if (!(event.target instanceof Element)) return;

    if (event.target.closest('#reader-header, #reader-footer, #floating-toolbar, #highlight-action-menu, .drawing-toolbar, .drawer, button, select, input')) {
      return;
    }

    const pageWrapper = this.getPageWrapperAt(event.clientX, event.clientY);
    const textLayer = pageWrapper?.querySelector('.textLayer');
    if (!textLayer || !pageWrapper) return;

    const targetInfo = this.directWordTarget(event.target, event.clientX, event.clientY) ||
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

  isPointerOverText(clientX, clientY, textElement) {
    const pageWrapper = this.getPageWrapperAt(clientX, clientY);
    const textLayer = pageWrapper?.querySelector('.textLayer');
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

    if (this.pointerId === event.pointerId || this.isMouseDown) {
      if (this.anchor && this.anchor.node) {
        const activeWrapper = this.getPageWrapperAt(event.clientX, event.clientY) || this.pageWrapper;
        const textLayer = activeWrapper?.querySelector('.textLayer') || this.pageWrapper.querySelector('.textLayer');
        if (textLayer) {
          const focus = this.findTextTargetWithinGap(event.clientX, event.clientY, textLayer, Infinity, Infinity, true);
          if (focus && focus.node) {
            const selection = window.getSelection();
            if (selection) {
              try {
                if (this.clickDetail === 2 && this.anchorWord) {
                  const focusWord = this.getWordBoundaries(focus) || {
                    startNode: focus.node,
                    startOffset: focus.offset,
                    endNode: focus.node,
                    endOffset: focus.offset
                  };
                  const cmp = this.comparePositions(
                    this.anchorWord.startNode,
                    this.anchorWord.startOffset,
                    focusWord.startNode,
                    focusWord.startOffset
                  );
                  if (cmp <= 0) {
                    selection.setBaseAndExtent(
                      this.anchorWord.startNode,
                      this.anchorWord.startOffset,
                      focusWord.endNode,
                      focusWord.endOffset
                    );
                  } else {
                    selection.setBaseAndExtent(
                      this.anchorWord.endNode,
                      this.anchorWord.endOffset,
                      focusWord.startNode,
                      focusWord.startOffset
                    );
                  }
                } else {
                  selection.setBaseAndExtent(this.anchor.node, this.anchor.offset, focus.node, focus.offset);
                }
              } catch (e) {}
            }

            const pointerTravel = Math.hypot(event.clientX - this.startX, event.clientY - this.startY);
            const hasMoved = pointerTravel > 3;
            const hasSelectionSpan = focus.node !== this.anchor.node || focus.offset !== this.anchor.offset;
            if (pointerTravel > 8) this.didDrag = true;

            if (this.isSelecting || hasMoved || hasSelectionSpan) {
              this.isSelecting = true;
              this.loupe.update(event.clientX, event.clientY, activeWrapper);
            }
          }
        }
      }
    }
  }

  endSelection(event) {
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
