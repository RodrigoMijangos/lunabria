/** DOM text-target geometry shared by native and mobile selection controllers. */
class ReaderTextTargetGeometry {
  static COLUMN_STICKINESS_PX = 24;

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

    const wordSpan =
      targetInfo.span?.closest?.(".precise-word") ||
      node.parentElement?.closest?.(".precise-word");
    if (wordSpan && (wordSpan.contains(node) || wordSpan === node)) {
      const actualNode = node.nodeType === 3 ? node : (wordSpan.firstChild || node);
      const nodeText = actualNode.textContent || "";
      const trimmed = nodeText.trimEnd();
      return {
        startNode: actualNode,
        startOffset: 0,
        endNode: actualNode,
        endOffset: trimmed.length,
        fullText: trimmed,
      };
    }

    let offset = Math.max(0, Math.min(text.length, targetInfo.offset || 0));
    if (offset >= text.length && text.length > 0) offset = text.length - 1;
    if (text.length > 0 && /\s/.test(text[offset])) {
      let left = offset;
      while (left >= 0 && /\s/.test(text[left])) left--;
      let right = offset;
      while (right < text.length && /\s/.test(text[right])) right++;
      if (left >= 0 && (right >= text.length || offset - left <= right - offset)) {
        offset = left;
      } else if (right < text.length) {
        offset = right;
      }
    }

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
      const rect = element.getBoundingClientRect?.();
      if (!element.textContent?.trim()) continue;
      if (!rect || (rect.width <= 0 && rect.height <= 0)) continue;

      const distanceSq = this.distanceToRect(clientX, clientY, rect);
      if (distanceSq < minDistanceSq) {
        minDistanceSq = distanceSq;
        nearest = { element, rect, distanceSq };
      }
    }

    return nearest;
  }

  static distanceToRect(clientX, clientY, rect) {
    const dx = Math.max(rect.left - clientX, 0, clientX - rect.right);
    const dy = Math.max(rect.top - clientY, 0, clientY - rect.bottom);
    return dx * dx + dy * dy;
  }

  static textOffsetAtX(textNode, rect, clientX) {
    const ratio = rect?.width > 0 ? Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) : 0;
    return Math.round(ratio * (textNode?.textContent || "").length);
  }

  static textTargetInWord(wordSpan, clientX, clientY) {
    if (!wordSpan) return null;
    const rect = wordSpan.getBoundingClientRect();
    const showText = typeof NodeFilter !== "undefined" ? NodeFilter.SHOW_TEXT : 4;
    const walker = document.createTreeWalker?.(wordSpan, showText);
    const node = walker?.nextNode?.() || wordSpan.firstChild;
    if (!node) return null;

    const caret = this.caretPosition(clientX, clientY);
    const pointerInsideWord =
      clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
    if (pointerInsideWord && caret?.node?.nodeType === Node.TEXT_NODE && wordSpan.contains(caret.node)) {
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

  static lastTextNodeIn(walker, fallbackNode) {
    let lastNode = fallbackNode;
    let next = walker.nextNode();
    while (next) {
      lastNode = next;
      next = walker.nextNode();
    }
    return lastNode;
  }

  static isVerticalElement(element) {
    if (!element) return false;
    if (element.dataset?.isVertical === "true") return true;
    const line = element.closest?.(".precise-line");
    return line?.dataset?.isVertical === "true";
  }

  static findAnchorLine(anchor, preciseLines) {
    if (!anchor) return null;
    const span = anchor.span || anchor.node?.parentElement;
    const closestLine = span?.closest?.(".precise-line");
    if (closestLine) return closestLine;
    for (const line of preciseLines) {
      if (line === span || line.contains?.(span) || (anchor.node && line.contains?.(anchor.node))) {
        return line;
      }
    }
    return null;
  }

  static computeHorizontalLineColumns(horizontalLines) {
    const items = [];
    for (const line of horizontalLines) {
      const rect = line.getBoundingClientRect?.();
      if (!rect || (rect.width <= 0 && rect.height <= 0)) continue;
      items.push({
        line,
        rect,
        colLeft: rect.left,
        colRight: rect.right,
        colTop: rect.top,
        colBottom: rect.bottom,
        columnIndex: -1,
        isBridge: false,
        hasSidePartner: false,
      });
    }
    if (items.length <= 1) return items;

    const pageLeft = Math.min(...items.map((item) => item.rect.left));
    const pageRight = Math.max(...items.map((item) => item.rect.right));
    const sideBySidePairs = [];
    for (let i = 0; i < items.length; i++) {
      const a = items[i];
      if (a.rect.width <= 25) continue;
      for (let j = i + 1; j < items.length; j++) {
        const b = items[j];
        if (b.rect.width <= 25) continue;
        const vOverlap = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
        if (vOverlap <= 2) continue;
        if (a.rect.right + 4 < b.rect.left) {
          a.hasSidePartner = true;
          b.hasSidePartner = true;
          sideBySidePairs.push({ leftEnd: a.rect.right, rightStart: b.rect.left });
        } else if (b.rect.right + 4 < a.rect.left) {
          a.hasSidePartner = true;
          b.hasSidePartner = true;
          sideBySidePairs.push({ leftEnd: b.rect.right, rightStart: a.rect.left });
        }
      }
    }

    if (sideBySidePairs.length === 0) {
      for (const item of items) {
        item.isBridge = true;
        item.colLeft = pageLeft;
        item.colRight = pageRight;
        item.columnIndex = 0;
      }
      return items;
    }

    const straddlesAnyGutter = (left, right) => {
      for (const pair of sideBySidePairs) {
        if (left < pair.leftEnd - 4 && right > pair.rightStart + 4) return true;
      }
      return false;
    };

    for (const item of items) {
      if (straddlesAnyGutter(item.rect.left, item.rect.right)) {
        item.isBridge = true;
        item.colLeft = pageLeft;
        item.colRight = pageRight;
      }
    }

    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.isBridge || item.hasSidePartner) continue;
        const block = item.line.dataset?.block;
        const sameBlockBridge =
          block !== undefined &&
          block !== "" &&
          items.some((other) => other.isBridge && other.line.dataset?.block === block);
        const prev = items[i - 1];
        const next = items[i + 1];
        const adjacentToBridge =
          (prev?.isBridge && Math.abs(item.rect.top - prev.rect.bottom) <= 18) ||
          (next?.isBridge && Math.abs(next.rect.top - item.rect.bottom) <= 18);
        if (sameBlockBridge || adjacentToBridge) {
          item.isBridge = true;
          item.colLeft = pageLeft;
          item.colRight = pageRight;
        }
      }
    }

    const columns = [];
    for (const item of items) {
      if (item.isBridge) continue;
      let matchedCol = null;
      for (const col of columns) {
        const hOverlap = Math.min(item.rect.right, col.colRight) - Math.max(item.rect.left, col.colLeft);
        const vGap = Math.max(item.rect.top - col.colBottom, col.colTop - item.rect.bottom, 0);
        const combinedLeft = Math.min(col.colLeft, item.rect.left);
        const combinedRight = Math.max(col.colRight, item.rect.right);
        if (hOverlap > -2 && vGap <= 35 && !straddlesAnyGutter(combinedLeft, combinedRight)) {
          matchedCol = col;
          break;
        }
      }
      if (matchedCol) {
        matchedCol.colLeft = Math.min(matchedCol.colLeft, item.rect.left);
        matchedCol.colRight = Math.max(matchedCol.colRight, item.rect.right);
        matchedCol.colTop = Math.min(matchedCol.colTop, item.rect.top);
        matchedCol.colBottom = Math.max(matchedCol.colBottom, item.rect.bottom);
        matchedCol.items.push(item);
      } else {
        columns.push({
          colLeft: item.rect.left,
          colRight: item.rect.right,
          colTop: item.rect.top,
          colBottom: item.rect.bottom,
          items: [item],
        });
      }
    }

    columns.forEach((col, index) => {
      for (const item of col.items) {
        item.colLeft = col.colLeft;
        item.colRight = col.colRight;
        item.colTop = col.colTop;
        item.colBottom = col.colBottom;
        item.columnIndex = index;
      }
    });
    return items;
  }

  static findBestHorizontalLine(items, clientX, clientY, isDragging, anchorLine) {
    if (!items.length) return null;
    const anchorItem = anchorLine ? items.find((item) => item.line === anchorLine) : null;
    let candidates = items;
    let lockedColumnIndex = -1;

    if (isDragging && anchorItem && anchorItem.columnIndex >= 0) {
      const stickiness = ReaderTextTargetGeometry.COLUMN_STICKINESS_PX;
      const inAnchorX = clientX >= anchorItem.colLeft - stickiness && clientX <= anchorItem.colRight + stickiness;
      if (inAnchorX) {
        lockedColumnIndex = anchorItem.columnIndex;
        const sameColumn = items.filter((item) => item.columnIndex === anchorItem.columnIndex || item.isBridge);
        if (sameColumn.length > 0) candidates = sameColumn;
      }
    }

    let bestItem = null;
    let bestScore = Infinity;
    let bestLineDx = Infinity;

    for (const item of candidates) {
      const dy = Math.max(item.rect.top - clientY, 0, clientY - item.rect.bottom);
      const rawColDx = Math.max(item.colLeft - clientX, 0, clientX - item.colRight);
      const colDx = lockedColumnIndex >= 0 && item.columnIndex === lockedColumnIndex ? 0 : rawColDx;
      const lineDx = Math.max(item.rect.left - clientX, 0, clientX - item.rect.right);
      const weightedDy = dy * 4;
      const score = colDx * colDx + weightedDy * weightedDy;

      if (score < bestScore || (score === bestScore && lineDx < bestLineDx)) {
        bestScore = score;
        bestLineDx = lineDx;
        bestItem = item;
      }
    }

    return bestItem;
  }

  static resolveTargetInLine(lineItem, clientX, clientY, gapX, gapY, isDragging) {
    if (!lineItem) return null;
    const lineWords = Array.from(lineItem.line.querySelectorAll?.(".precise-word") || []).filter((span) =>
      span.textContent?.trim(),
    );
    if (lineWords.length > 0) {
      return this.findWordTarget(clientX, clientY, lineWords, gapX, gapY, isDragging);
    }
    const distanceSq = this.distanceToRect(clientX, clientY, lineItem.rect);
    if (!this.isWithinGap(distanceSq, gapX, gapY, isDragging)) return null;
    return this.targetInNearestSpan(clientX, clientY, { element: lineItem.line, rect: lineItem.rect, distanceSq });
  }

  static preciseWordSpans(textLayer, preciseLines) {
    const wordSpans = Array.from(textLayer.querySelectorAll(".precise-word")).filter((span) =>
      span.textContent?.trim(),
    );
    if (wordSpans.length > 0) return wordSpans;
    return preciseLines.flatMap((line) =>
      Array.from(line.querySelectorAll(".precise-word")).filter((span) => span.textContent?.trim()),
    );
  }

  static isPointInRect(clientX, clientY, rect) {
    return Boolean(
      rect && clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom,
    );
  }

  static isWithinGap(distanceSq, gapX, gapY, isDragging) {
    return isDragging || distanceSq <= gapX * gapX + gapY * gapY;
  }

  static findWordTarget(clientX, clientY, wordSpans, gapX, gapY, isDragging) {
    const nearest = this.nearestElement(wordSpans, clientX, clientY);
    if (!nearest || !this.isWithinGap(nearest.distanceSq, gapX, gapY, isDragging)) return null;
    return this.textTargetInWord(nearest.element, clientX, clientY);
  }

  static findNativeTargetAtPoint(clientX, clientY, textLayer) {
    const position = this.caretPosition(clientX, clientY);
    const node = position?.node;
    const span = node?.parentElement?.closest?.("span") || node?.parentElement;
    const rect = span?.getBoundingClientRect?.();
    const textNodeType = typeof Node !== "undefined" ? Node.TEXT_NODE : 3;
    if (node?.nodeType !== textNodeType || !textLayer.contains(node) || !this.isPointInRect(clientX, clientY, rect)) {
      return null;
    }
    return {
      node,
      offset: Math.max(0, Math.min(node.textContent.length, position.offset)),
      span,
      rect,
    };
  }

  static targetInNearestSpan(clientX, clientY, nearest) {
    const { element, rect } = nearest;
    const showText = typeof NodeFilter !== "undefined" ? NodeFilter.SHOW_TEXT : 4;
    const walker = document.createTreeWalker(element, showText);
    const textNode = walker.nextNode();
    if (!textNode) return null;

    const position = this.caretPosition(clientX, clientY);
    const textNodeType = typeof Node !== "undefined" ? Node.TEXT_NODE : 3;
    if (
      position?.node?.nodeType === textNodeType &&
      element.contains(position.node) &&
      this.isPointInRect(clientX, clientY, rect)
    ) {
      const wordSpan = position.node.parentElement?.closest?.(".precise-word");
      return {
        node: position.node,
        offset: Math.max(0, Math.min(position.node.textContent.length, position.offset)),
        span: wordSpan || element,
        rect: wordSpan?.getBoundingClientRect?.() || rect,
      };
    }

    if (clientX <= rect.left) return { node: textNode, offset: 0, span: element, rect };
    if (clientX >= rect.right) {
      const lastNode = this.lastTextNodeIn(walker, textNode);
      return { node: lastNode, offset: (lastNode.textContent || "").length, span: element, rect };
    }
    return {
      node: textNode,
      offset: this.textOffsetAtX(textNode, rect, clientX),
      span: element,
      rect,
    };
  }

  static findNearestSpanTarget(clientX, clientY, spans, gapX, gapY, isDragging) {
    const nearest = this.nearestElement(spans, clientX, clientY);
    if (!nearest || !this.isWithinGap(nearest.distanceSq, gapX, gapY, isDragging)) return null;
    return this.targetInNearestSpan(clientX, clientY, nearest);
  }

  static findTextTargetWithinGap(
    clientX,
    clientY,
    textLayer,
    gapX = Infinity,
    gapY = Infinity,
    isDragging = false,
    anchor = null,
  ) {
    if (!textLayer) return null;

    const preciseLines = Array.from(textLayer.querySelectorAll(".precise-line")).filter((s) => s.textContent?.trim());
    if (preciseLines.length > 0) {
      const horizontalLines = preciseLines.filter((line) => !this.isVerticalElement(line));
      const verticalLines = preciseLines.filter((line) => this.isVerticalElement(line));
      const anchorLine = this.findAnchorLine(anchor, preciseLines);
      const anchorIsVertical = anchorLine ? this.isVerticalElement(anchorLine) : false;

      if (verticalLines.length > 0) {
        const verticalWords = verticalLines.flatMap((line) =>
          Array.from(line.querySelectorAll?.(".precise-word") || []).filter((span) => span.textContent?.trim()),
        );
        if (horizontalLines.length === 0 || (isDragging && anchorIsVertical)) {
          if (verticalWords.length > 0) {
            return this.findWordTarget(clientX, clientY, verticalWords, gapX, gapY, isDragging);
          }
          return this.findNearestSpanTarget(clientX, clientY, verticalLines, gapX, gapY, isDragging);
        }
        if (!isDragging || !anchorLine) {
          const nearestVertical = this.nearestElement(
            verticalWords.length > 0 ? verticalWords : verticalLines,
            clientX,
            clientY,
          );
          const maxDirectVerticalDistSq = isDragging ? 0 : 9;
          if (nearestVertical && nearestVertical.distanceSq <= maxDirectVerticalDistSq) {
            const nearestHorizontal = this.nearestElement(horizontalLines, clientX, clientY);
            if (!nearestHorizontal || nearestVertical.distanceSq < nearestHorizontal.distanceSq) {
              return verticalWords.length > 0
                ? this.textTargetInWord(nearestVertical.element, clientX, clientY)
                : this.targetInNearestSpan(clientX, clientY, nearestVertical);
            }
          }
        }
      }

      const columnItems = this.computeHorizontalLineColumns(horizontalLines);
      const bestLineItem = this.findBestHorizontalLine(columnItems, clientX, clientY, isDragging, anchorLine);
      const resolved = this.resolveTargetInLine(bestLineItem, clientX, clientY, gapX, gapY, isDragging);
      if (resolved) return resolved;
    }

    const wordSpans = this.preciseWordSpans(textLayer, preciseLines).filter((span) => !this.isVerticalElement(span));
    if (wordSpans.length > 0) return this.findWordTarget(clientX, clientY, wordSpans, gapX, gapY, isDragging);

    if (!preciseLines.length) {
      const nativeTarget = this.findNativeTargetAtPoint(clientX, clientY, textLayer);
      if (nativeTarget) return nativeTarget;
    }

    const spans = preciseLines.length
      ? preciseLines
      : Array.from(textLayer.querySelectorAll("span")).filter((span) => span.textContent?.trim());
    return this.findNearestSpanTarget(clientX, clientY, spans, gapX, gapY, isDragging);
  }
}

window.ReaderTextTargetGeometry = ReaderTextTargetGeometry;
