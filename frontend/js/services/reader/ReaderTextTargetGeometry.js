/** DOM text-target geometry shared by native and mobile selection controllers. */
class ReaderTextTargetGeometry {
  static caretPosition(clientX, clientY) {
    const position = document.caretPositionFromPoint
      ? document.caretPositionFromPoint(clientX, clientY)
      : document.caretRangeFromPoint?.(clientX, clientY);
    const node = position?.offsetNode || position?.startContainer;
    const offset = position?.offset ?? position?.startOffset;
    return node ? { node, offset } : null;
  }

  static comparePositions(nodeA, offsetA, nodeB, offsetB) {
    if (!nodeA || !nodeB) return 0;
    if (nodeA === nodeB) return offsetA - offsetB;
    if (typeof Node !== "undefined" && nodeA.compareDocumentPosition) {
      const pos = nodeA.compareDocumentPosition(nodeB);
      if (pos & (Node.DOCUMENT_POSITION_FOLLOWING | Node.DOCUMENT_POSITION_CONTAINED_BY)) return -1;
      if (pos & (Node.DOCUMENT_POSITION_PRECEDING | Node.DOCUMENT_POSITION_CONTAINS)) return 1;
    }
    return 0;
  }

  static getWordBoundaries(targetInfo) {
    if (!targetInfo?.node) return null;
    const node = targetInfo.node;
    const text = node.textContent || "";

    const wordSpan = targetInfo.span?.closest?.(".precise-word");
    if (wordSpan?.contains(node)) {
      const trimmed = text.trimEnd();
      return {
        startNode: node,
        startOffset: 0,
        endNode: node,
        endOffset: trimmed.length,
        fullText: trimmed,
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
      fullText: text.slice(start, end),
    };
  }

  static nearestElement(elements, clientX, clientY) {
    let nearest = null;
    let minDistanceSq = Infinity;

    for (const element of elements) {
      if (!element.textContent?.trim()) continue;
      const rect = element.getBoundingClientRect?.();
      if (!rect || (rect.width <= 0 && rect.height <= 0)) continue;

      const dx = clientX < rect.left ? rect.left - clientX : clientX > rect.right ? clientX - rect.right : 0;
      const dy = clientY < rect.top ? rect.top - clientY : clientY > rect.bottom ? clientY - rect.bottom : 0;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq < minDistanceSq) {
        minDistanceSq = distanceSq;
        nearest = { element, rect, distanceSq };
      }
    }

    return nearest;
  }

  static textOffsetAtX(textNode, rect, clientX) {
    const ratio = rect?.width > 0 ? Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) : 0;
    return Math.round(ratio * (textNode?.textContent || "").length);
  }

  static textTargetInWord(wordSpan, clientX, clientY) {
    if (!wordSpan) return null;
    const rect = wordSpan.getBoundingClientRect();
    const walker = document.createTreeWalker(wordSpan, NodeFilter.SHOW_TEXT);
    const node = walker.nextNode();
    if (!node) return null;

    const caret = this.caretPosition(clientX, clientY);
    if (caret?.node?.nodeType === Node.TEXT_NODE && wordSpan.contains(caret.node)) {
      return {
        node: caret.node,
        offset: Math.max(0, Math.min(caret.node.textContent.length, caret.offset)),
        span: wordSpan,
        rect,
      };
    }

    return {
      node,
      offset: this.textOffsetAtX(node, rect, clientX),
      span: wordSpan,
      rect,
    };
  }

  static selectLineEntry(lineEntries, clientY, gapY, isDragging) {
    const first = lineEntries[0];
    const last = lineEntries[lineEntries.length - 1];
    if (clientY <= first.rect.top) {
      return isDragging || first.rect.top - clientY <= gapY ? first : null;
    }
    if (clientY >= last.rect.bottom) {
      return isDragging || clientY - last.rect.bottom <= gapY ? last : null;
    }
    for (let i = 0; i < lineEntries.length; i++) {
      const curr = lineEntries[i];
      const next = lineEntries[i + 1];
      if (!next || clientY < (curr.rect.bottom + next.rect.top) / 2) {
        return curr;
      }
    }
    return null;
  }

  static lastTextNodeIn(walker, fallbackNode) {
    let lastNode = fallbackNode;
    let next = walker.nextNode();
    while (next) {
      lastNode = next;
      next = walker.nextNode();
    }
    return lastNode;
  }

  static findTextTargetWithinGap(clientX, clientY, textLayer, gapX = Infinity, gapY = Infinity, isDragging = false) {
    if (!textLayer) return null;

    const preciseLines = Array.from(textLayer.querySelectorAll(".precise-line")).filter((s) => s.textContent?.trim());
    if (!preciseLines.length) {
      const nativePos = this.caretPosition(clientX, clientY);
      const nativeNode = nativePos?.node;
      const nativeSpan = nativeNode?.parentElement?.closest?.("span") || nativeNode?.parentElement;
      const nativeRect = nativeSpan?.getBoundingClientRect?.();
      const overSpan =
        nativeRect &&
        clientX >= nativeRect.left &&
        clientX <= nativeRect.right &&
        clientY >= nativeRect.top &&
        clientY <= nativeRect.bottom;
      if (nativeNode?.nodeType === Node.TEXT_NODE && textLayer.contains(nativeNode) && overSpan) {
        return {
          node: nativeNode,
          offset: Math.max(0, Math.min(nativeNode.textContent.length, nativePos.offset)),
          span: nativeSpan,
          rect: nativeRect,
        };
      }
    }

    const rawSpans =
      preciseLines.length > 0
        ? preciseLines
        : Array.from(textLayer.querySelectorAll("span")).filter((s) => s.textContent?.trim());
    if (!rawSpans.length) return null;

    const lineEntries = rawSpans
      .map((span) => ({ span, rect: span.getBoundingClientRect() }))
      .filter((e) => e.rect.width > 0 && e.rect.height > 0)
      .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);
    if (!lineEntries.length) return null;

    const bestEntry = this.selectLineEntry(lineEntries, clientY, gapY, isDragging);
    if (!bestEntry) return null;

    const { span: bestSpan, rect: bestRect } = bestEntry;
    const walker = document.createTreeWalker(bestSpan, NodeFilter.SHOW_TEXT);
    const textNode = walker.nextNode();
    if (!textNode) return null;

    if (isDragging) {
      if (clientY < lineEntries[0].rect.top) {
        return { node: textNode, offset: 0, span: bestSpan, rect: bestRect };
      }
      if (clientY > lineEntries[lineEntries.length - 1].rect.bottom) {
        const lastNode = this.lastTextNodeIn(walker, textNode);
        return {
          node: lastNode,
          offset: (lastNode.textContent || "").length,
          span: bestSpan,
          rect: bestRect,
        };
      }
    }

    if (clientX <= bestRect.left) {
      return isDragging || bestRect.left - clientX <= gapX
        ? { node: textNode, offset: 0, span: bestSpan, rect: bestRect }
        : null;
    }

    if (clientX >= bestRect.right) {
      if (isDragging || clientX - bestRect.right <= gapX) {
        const lastNode = this.lastTextNodeIn(walker, textNode);
        return {
          node: lastNode,
          offset: (lastNode.textContent || "").length,
          span: bestSpan,
          rect: bestRect,
        };
      }
      return null;
    }

    const wordSpans = Array.from(bestSpan.querySelectorAll(".precise-word"));
    const clampedY = Math.min(bestRect.bottom - 2, Math.max(bestRect.top + 2, bestRect.top + bestRect.height / 2));
    const nativePosition = this.caretPosition(clientX, clampedY);
    const nativeNode = nativePosition?.node;

    if (nativeNode?.nodeType === Node.TEXT_NODE && bestSpan.contains(nativeNode)) {
      const wordSpan = nativeNode.parentElement?.closest?.(".precise-word");
      const wordRect = wordSpan?.getBoundingClientRect();
      const matchesPointer =
        wordSpan &&
        clientX >= wordRect.left &&
        clientX <= wordRect.right &&
        clientY >= wordRect.top &&
        clientY <= wordRect.bottom;
      if (!wordSpans.length || matchesPointer) {
        return {
          node: nativeNode,
          offset: nativePosition.offset,
          span: nativeNode.parentElement || bestSpan,
          rect: nativeNode.parentElement?.getBoundingClientRect() || bestRect,
        };
      }
    }

    if (wordSpans.length > 0) {
      const nearest = this.nearestElement(wordSpans, clientX, clientY);
      return this.textTargetInWord(nearest?.element, clientX, clientY);
    }

    return {
      node: textNode,
      offset: this.textOffsetAtX(bestSpan, bestRect, clientX),
      span: bestSpan,
      rect: bestRect,
    };
  }
}

window.ReaderTextTargetGeometry = ReaderTextTargetGeometry;
