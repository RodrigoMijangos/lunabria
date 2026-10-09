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

  static nearestElement(elements, clientX, clientY) {
    let nearest = null;
    let minDistanceSq = Infinity;

    for (const element of elements) {
      if (!element.textContent?.trim()) continue;
      const rect = element.getBoundingClientRect?.();
      if (!rect || (rect.width <= 0 && rect.height <= 0)) continue;

      const dx = clientX < rect.left ? rect.left - clientX : (clientX > rect.right ? clientX - rect.right : 0);
      const dy = clientY < rect.top ? rect.top - clientY : (clientY > rect.bottom ? clientY - rect.bottom : 0);
      const distanceSq = (dx * dx) + (dy * dy);
      if (distanceSq < minDistanceSq) {
        minDistanceSq = distanceSq;
        nearest = { element, rect, distanceSq };
      }
    }

    return nearest;
  }

  static textOffsetAtX(textNode, rect, clientX) {
    const ratio = rect?.width > 0 ? Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) : 0;
    return Math.round(ratio * (textNode?.textContent || '').length);
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
        rect
      };
    }

    return {
      node,
      offset: this.textOffsetAtX(node, rect, clientX),
      span: wordSpan,
      rect
    };
  }
}
