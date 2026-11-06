/**
 * TextLayerView.js
 * Creates textLayer container and renders precise typographical lines for text selection.
 */
const TextLayerView = {
  _round2(value) {
    return Math.round(value * 100) / 100;
  },
  _round4(value) {
    return Math.round(value * 10000) / 10000;
  },

  // Lazily created 2D context used to measure text without touching layout.
  // `null` = not probed yet, `false` = unavailable (DOM measurement fallback).
  _measureCtx: null,
  // Browser minimum font size (user/accessibility setting). `null` = not probed yet.
  _minFontSize: null,

  _ensureSelectionStyles() {
    if (typeof document === "undefined" || !document.head || typeof document.head.appendChild !== "function") return;
    if (document.getElementById("lunabria-precise-selection-styles")) return;
    const style = document.createElement("style");
    style.id = "lunabria-precise-selection-styles";
    style.textContent = `
      .textLayer {
        opacity: 0.42 !important;
        mix-blend-mode: multiply !important;
        user-select: text !important;
        -webkit-user-select: text !important;
        font-style: normal;
        font-weight: normal;
        font-variant: normal;
        font-stretch: normal;
        font-feature-settings: normal;
        letter-spacing: normal;
        word-spacing: normal;
        text-transform: none;
        text-rendering: geometricPrecision;
      }
      .textLayer :is(.precise-line, .precise-word, .precise-space, span) {
        user-select: text !important;
        -webkit-user-select: text !important;
      }
      .textLayer ::selection,
      .textLayer *::selection {
        background: #3b82f6 !important;
        color: transparent !important;
        -webkit-text-fill-color: transparent !important;
        text-shadow: none !important;
      }
      .textLayer ::-moz-selection,
      .textLayer *::-moz-selection {
        background: #3b82f6 !important;
        color: transparent !important;
        text-shadow: none !important;
      }

      [data-theme="sepia"] .textLayer {
        opacity: 0.42 !important;
        mix-blend-mode: multiply !important;
      }
      [data-theme="sepia"] .textLayer ::selection,
      [data-theme="sepia"] .textLayer *::selection {
        background: #3b82f6 !important;
        color: transparent !important;
        -webkit-text-fill-color: transparent !important;
      }

      [data-theme="dark"] .textLayer,
      [data-theme="amoled"] .textLayer {
        opacity: 0.55 !important;
        mix-blend-mode: screen !important;
      }
      [data-theme="dark"] .textLayer ::selection,
      [data-theme="dark"] .textLayer *::selection,
      [data-theme="amoled"] .textLayer ::selection,
      [data-theme="amoled"] .textLayer *::selection {
        background: #f59e0b !important;
        color: transparent !important;
        -webkit-text-fill-color: transparent !important;
      }
    `;
    document.head.appendChild(style);
  },

  createTextLayerContainer(width, height, scale) {
    this._ensureSelectionStyles();
    const div = document.createElement("div");
    div.className = "textLayer";
    div.style.width = `${width}px`;
    div.style.height = `${height}px`;
    div.style.setProperty("--scale-factor", scale);
    return div;
  },

  _measureContext() {
    if (this._measureCtx !== null) return this._measureCtx || null;
    let ctx = false;
    try {
      if (typeof OffscreenCanvas === "function") {
        ctx = new OffscreenCanvas(1, 1).getContext("2d") || false;
      }
      if (!ctx && typeof document !== "undefined" && typeof document.createElement === "function") {
        const canvas = document.createElement("canvas");
        ctx = (canvas && typeof canvas.getContext === "function" && canvas.getContext("2d")) || false;
      }
    } catch (_error) {
      ctx = false;
    }
    this._measureCtx = ctx;
    return ctx || null;
  },

  _browserMinFontSize() {
    if (this._minFontSize !== null) return this._minFontSize;
    let minFontSize = 1;
    try {
      const body = typeof document !== "undefined" ? document.body : null;
      if (body && typeof body.appendChild === "function") {
        const probe = document.createElement("div");
        probe.style.position = "absolute";
        probe.style.visibility = "hidden";
        probe.style.fontFamily = "sans-serif";
        probe.style.fontSize = "1px";
        probe.style.lineHeight = "1";
        probe.style.whiteSpace = "pre";
        probe.textContent = "X";
        body.appendChild(probe);
        const height = probe.getBoundingClientRect().height;
        if (typeof probe.remove === "function") probe.remove();
        else if (typeof body.removeChild === "function") body.removeChild(probe);
        if (Number.isFinite(height) && height > 1 && height <= 72) minFontSize = height;
      }
    } catch (_error) {
      minFontSize = 1;
    }
    this._minFontSize = minFontSize;
    return minFontSize;
  },

  _naturalTextWidth(span, text, fontSize) {
    const ctx = this._measureContext();
    if (ctx) {
      ctx.font = `normal normal ${fontSize}px sans-serif`;
      const width = ctx.measureText(text).width;
      if (Number.isFinite(width) && width > 0) return width;
    }
    if (span.isConnected === false || typeof span.getBoundingClientRect !== "function") return 0;
    const width = span.getBoundingClientRect().width;
    return Number.isFinite(width) ? width : 0;
  },

  _fitTextToBox(span, text, targetWidth, boxHeight) {
    const requestedFont = this._round2(boxHeight * 0.88);
    const renderFont = Math.max(requestedFont, this._browserMinFontSize());
    const yScale = renderFont > 0 ? requestedFont / renderFont : 1;
    const layoutHeight = this._round2(yScale > 0 && yScale < 1 ? boxHeight / yScale : boxHeight);

    span.style.fontSize = `${renderFont}px`;
    span.style.height = `${layoutHeight}px`;
    span.style.lineHeight = `${layoutHeight}px`;
    span.style.transform = "";

    const naturalWidth = this._round2(this._naturalTextWidth(span, text, renderFont));
    if (naturalWidth > 0 && targetWidth > 0) {
      const scaleX = targetWidth / naturalWidth;
      if (scaleX > 0.05 && scaleX < 20) {
        span.style.width = `${naturalWidth}px`;
        span.style.transform =
          yScale < 1 ? `scale(${this._round4(scaleX)}, ${this._round4(yScale)})` : `scaleX(${this._round4(scaleX)})`;
        span.style.transformOrigin = "0% 0%";
        return;
      }
    }
    span.style.width = `${this._round2(Math.max(0, targetWidth))}px`;
    if (yScale < 1) {
      span.style.transform = `scale(1, ${this._round4(yScale)})`;
      span.style.transformOrigin = "0% 0%";
    }
  },

  _normalizeReferenceText(value) {
    return TextLayerCrossReferenceDecorator._normalizeReferenceText(value);
  },

  _canonicalReferenceNumber(value) {
    return TextLayerCrossReferenceDecorator._canonicalReferenceNumber(value);
  },

  _referenceNumberFromTitle(title, kind, depth) {
    return TextLayerCrossReferenceDecorator._referenceNumberFromTitle(title, kind, depth);
  },

  _findReferencePage(navigationMap, kind, identifier) {
    return TextLayerCrossReferenceDecorator._findReferencePage(navigationMap, kind, identifier);
  },

  findCrossReferences(text, navigationMap) {
    return TextLayerCrossReferenceDecorator.findCrossReferences(text, navigationMap);
  },

  _collectTextNodes(container) {
    return TextLayerCrossReferenceDecorator._collectTextNodes(container);
  },

  _hasNativePdfLinkAtPoint(container, event) {
    return TextLayerCrossReferenceDecorator._hasNativePdfLinkAtPoint(container, event);
  },

  _guardReferenceGesture(link) {
    return TextLayerCrossReferenceDecorator._guardReferenceGesture(link);
  },

  decorateCrossReferences(container, navigationMap, sourcePage, onNavigate) {
    return TextLayerCrossReferenceDecorator.decorateCrossReferences(container, navigationMap, sourcePage, onNavigate);
  },

  _isVerticalWordGroup(group, maxLineHeight) {
    if (group.some((word) => Array.isArray(word.direction) && Math.abs(Number(word.direction[1])) > 0.1)) {
      return true;
    }
    const width = Math.max(...group.map((word) => word.x1)) - Math.min(...group.map((word) => word.x0));
    const height = Math.max(...group.map((word) => word.y1)) - Math.min(...group.map((word) => word.y0));
    return width <= 25 && height > maxLineHeight;
  },

  _makePreciseLine(words, vertical = false) {
    const orderedWords = vertical ? [...words] : [...words].sort((a, b) => a.x0 - b.x0);
    const line = {
      block: orderedWords[0].block,
      line: orderedWords[0].line,
      x0: Math.min(...orderedWords.map((word) => word.x0)),
      y0: Math.min(...orderedWords.map((word) => word.y0)),
      x1: Math.max(...orderedWords.map((word) => word.x1)),
      y1: Math.max(...orderedWords.map((word) => word.y1)),
      text: orderedWords.map((word) => word.text).join(" "),
      words: orderedWords,
    };
    if (vertical) {
      line.is_vertical = true;
      line.direction = orderedWords[0].direction || [0, -1];
    } else if (orderedWords[0].direction) {
      line.direction = orderedWords[0].direction;
    }
    return line;
  },

  _splitPreciseWordsByColumn(words, maxColumnGap) {
    const orderedWords = [...words].sort((a, b) => a.x0 - b.x0);
    const segments = [];
    let segment = [];
    let rightEdge = Number.NEGATIVE_INFINITY;

    for (const word of orderedWords) {
      if (segment.length && word.x0 - rightEdge > maxColumnGap) {
        segments.push(segment);
        segment = [];
        rightEdge = Number.NEGATIVE_INFINITY;
      }
      segment.push(word);
      rightEdge = Math.max(rightEdge, word.x1);
    }
    if (segment.length) segments.push(segment);
    return segments;
  },

  _mergeSameRowPreciseLines(lines, maxLineHeight = 40, maxColumnGap = 45) {
    const merged = [];
    for (const line of lines) {
      const prev = merged[merged.length - 1];
      if (!prev || line.is_vertical || prev.is_vertical) {
        merged.push(line);
        continue;
      }
      const overlap = Math.min(prev.y1, line.y1) - Math.max(prev.y0, line.y0);
      const minHeight = Math.min(Math.max(1, prev.y1 - prev.y0), Math.max(1, line.y1 - line.y0));
      const midDiff = Math.abs((prev.y0 + prev.y1) / 2 - (line.y0 + line.y1) / 2);
      const combinedHeight = Math.max(prev.y1, line.y1) - Math.min(prev.y0, line.y0);
      const gap = line.x0 - prev.x1;
      if (
        combinedHeight <= maxLineHeight &&
        (overlap / minHeight >= 0.5 || midDiff <= minHeight * 0.35) &&
        gap >= -4 &&
        gap <= maxColumnGap
      ) {
        merged[merged.length - 1] = this._makePreciseLine([...prev.words, ...line.words]);
      } else {
        merged.push(line);
      }
    }
    return merged;
  },

  _orderPreciseColumnLines(lines, maxColumnGap, maxLineHeight = 40) {
    const horizontalLines = this._mergeSameRowPreciseLines(
      lines.filter((line) => !line.is_vertical),
      maxLineHeight,
      maxColumnGap,
    );
    const verticalLines = lines.filter((line) => line.is_vertical);
    const columns = [];
    for (const line of [...horizontalLines].sort((a, b) => a.x0 - b.x0)) {
      const lastColumn = columns[columns.length - 1];
      if (!lastColumn || line.x0 - lastColumn.x1 > maxColumnGap) {
        columns.push({ x1: line.x1, lines: [line] });
      } else {
        lastColumn.x1 = Math.max(lastColumn.x1, line.x1);
        lastColumn.lines.push(line);
      }
    }
    if (columns.length < 2 || columns.some((column) => column.lines.length < 2)) {
      return [...horizontalLines, ...verticalLines];
    }

    const sharedVerticalRange =
      Math.min(...columns.map((column) => Math.max(...column.lines.map((line) => line.y1)))) -
      Math.max(...columns.map((column) => Math.min(...column.lines.map((line) => line.y0))));
    if (sharedVerticalRange <= 0) return [...horizontalLines, ...verticalLines];
    const orderedHorizontal = columns.flatMap((column) => column.lines.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0));
    return [...orderedHorizontal, ...verticalLines];
  },

  _orderPreciseHorizontalBlocks(blockEntries) {
    const ordered = [];
    const deferred = [];
    for (let index = 0; index < blockEntries.length; index++) {
      const [, blockLines] = blockEntries[index];
      if (!blockLines.length) continue;
      const blockY0 = Math.min(...blockLines.map((line) => line.y0));
      let laterMaxY1 = -1;
      for (let nextIndex = index + 1; nextIndex < blockEntries.length; nextIndex++) {
        const [, nextLines] = blockEntries[nextIndex];
        for (const nextLine of nextLines) {
          if (nextLine.y1 > laterMaxY1) laterMaxY1 = nextLine.y1;
        }
      }
      if (laterMaxY1 >= 0 && blockY0 >= laterMaxY1 - 2) {
        deferred.push(blockLines);
      } else {
        ordered.push(blockLines);
      }
    }
    return [...ordered, ...deferred];
  },

  _canJoinPreciseWord(group, word, maxLineHeight, maxColumnGap) {
    const groupY0 = Math.min(...group.map((item) => item.y0));
    const groupY1 = Math.max(...group.map((item) => item.y1));
    const groupX0 = Math.min(...group.map((item) => item.x0));
    const groupX1 = Math.max(...group.map((item) => item.x1));
    const groupHeight = Math.max(1, groupY1 - groupY0);
    const combinedHeight = Math.max(groupY1, word.y1) - Math.min(groupY0, word.y0);
    const horizontalGap = Math.max(0, word.x0 - groupX1, groupX0 - word.x1);
    if (horizontalGap > maxColumnGap || combinedHeight > maxLineHeight) return false;

    const wordHeight = Math.max(1, word.y1 - word.y0);
    const overlap = Math.min(word.y1, groupY1) - Math.max(word.y0, groupY0);
    const minHeight = Math.min(wordHeight, groupHeight);
    const overlapRatio = minHeight > 0 ? overlap / minHeight : 0;
    const groupMidY = group.reduce((sum, item) => sum + (item.y0 + item.y1) / 2, 0) / group.length;
    const wordMidY = (word.y0 + word.y1) / 2;
    const midDistance = Math.abs(wordMidY - groupMidY);
    return (
      overlapRatio >= 0.35 ||
      midDistance <= Math.max(wordHeight, groupHeight) * 0.45 ||
      (overlap > 0 && midDistance <= minHeight * 0.75)
    );
  },

  _findPreciseLineGroup(groups, word, maxLineHeight, maxColumnGap) {
    for (const group of groups) {
      if (this._canJoinPreciseWord(group, word, maxLineHeight, maxColumnGap)) return group;
    }
    return null;
  },

  _groupPreciseWordsGeometrically(words, maxLineHeight, maxColumnGap) {
    const verticalWords = words.filter((word) => this._isVerticalWordGroup([word], maxLineHeight));
    const sortedWords = words
      .filter((word) => !this._isVerticalWordGroup([word], maxLineHeight))
      .sort((a, b) => {
        const dy = a.y0 - b.y0;
        return Math.abs(dy) > 4 ? dy : a.x0 - b.x0;
      });
    const groups = [];
    for (const word of sortedWords) {
      const matched = this._findPreciseLineGroup(groups, word, maxLineHeight, maxColumnGap);
      if (matched) matched.push(word);
      else groups.push([word]);
    }

    const horizontalLines = groups
      .map((group) => this._makePreciseLine(group))
      .sort((a, b) => {
        const dy = a.y0 - b.y0;
        return Math.abs(dy) > 4 ? dy : a.x0 - b.x0;
      });
    const verticalLines = verticalWords.map((word) => this._makePreciseLine([word], true));
    return [...this._orderPreciseColumnLines(horizontalLines, maxColumnGap, maxLineHeight), ...verticalLines];
  },

  groupWordsIntoLines(words) {
    if (!words || !words.length) return [];

    const maxLineHeight = 40;
    const maxColumnGap = 45;
    const hasNativeLines = words.every(
      (word) =>
        word.block !== undefined &&
        word.block !== null &&
        word.line !== undefined &&
        word.line !== null &&
        Number.isFinite(Number(word.block)) &&
        Number.isFinite(Number(word.line)),
    );
    if (!hasNativeLines) return this._groupPreciseWordsGeometrically(words, maxLineHeight, maxColumnGap);

    const nativeGroups = new Map();
    for (const word of words) {
      const key = JSON.stringify([word.block, word.line]);
      if (!nativeGroups.has(key)) nativeGroups.set(key, []);
      nativeGroups.get(key).push(word);
    }

    const orderedGroups = [...nativeGroups.values()].sort((a, b) => {
      const blockDelta = Number(a[0].block) - Number(b[0].block);
      return blockDelta || Number(a[0].line) - Number(b[0].line);
    });
    const linesByBlock = new Map();
    const verticalLines = [];
    for (const group of orderedGroups) {
      const orderedGroup = [...group].sort((a, b) => Number(a.word ?? 0) - Number(b.word ?? 0));
      if (this._isVerticalWordGroup(orderedGroup, maxLineHeight)) {
        verticalLines.push(...orderedGroup.map((word) => this._makePreciseLine([word], true)));
        continue;
      }

      const blockKey = group[0].block;
      if (!linesByBlock.has(blockKey)) linesByBlock.set(blockKey, []);
      const lines = linesByBlock.get(blockKey);
      const height =
        Math.max(...orderedGroup.map((word) => word.y1)) - Math.min(...orderedGroup.map((word) => word.y0));
      if (height > maxLineHeight) {
        const fallbackLines = this._groupPreciseWordsGeometrically(orderedGroup, maxLineHeight, maxColumnGap);
        for (const fallbackLine of fallbackLines) {
          if (fallbackLine.is_vertical) verticalLines.push(fallbackLine);
          else lines.push(fallbackLine);
        }
        continue;
      }
      lines.push(
        ...this._splitPreciseWordsByColumn(orderedGroup, maxColumnGap).map((segment) => this._makePreciseLine(segment)),
      );
    }

    const sortedBlockEntries = [...linesByBlock.entries()]
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([blockKey, blockLines]) => [
        blockKey,
        this._orderPreciseColumnLines(blockLines, maxColumnGap, maxLineHeight),
      ]);
    const orderedHorizontal = this._orderPreciseHorizontalBlocks(sortedBlockEntries).flatMap(
      (blockLines) => blockLines,
    );
    return [...orderedHorizontal, ...verticalLines];
  },

  _positionPreciseWord(wordSpan, word, line, scale, renderedText = word.text || "", targetWidth) {
    const relativeLeft = (word.x0 - line.x0) * scale;
    const relativeTop = (word.y0 - line.y0) * scale;
    const width = targetWidth ?? (word.x1 - word.x0) * scale;
    const height = (word.y1 - word.y0) * scale;
    const isVertical = Boolean(line.is_vertical || word.is_vertical);
    const direction = word.direction || line.direction || (isVertical ? [0, -1] : null);
    const directionX = Array.isArray(direction) ? Number(direction[0]) : 1;
    const directionY = Array.isArray(direction) ? Number(direction[1]) : 0;
    const angle = (Math.atan2(directionY, directionX) * 180) / Math.PI;
    const rotateVerticalWord = isVertical && Math.abs(Math.abs(angle) - 90) < 1;

    wordSpan.style.fontFamily = "sans-serif";
    wordSpan.style.display = "inline-block";
    wordSpan.style.position = "absolute";
    wordSpan.style.whiteSpace = "pre";
    if (rotateVerticalWord) {
      const clockwise = angle > 0;
      wordSpan.style.left = `${this._round2(relativeLeft + (clockwise ? width : 0))}px`;
      wordSpan.style.top = `${this._round2(relativeTop + (clockwise ? 0 : height))}px`;
      this._fitTextToBox(wordSpan, renderedText, height, width);
      const fitTransform = wordSpan.style.transform;
      wordSpan.style.transform = `rotate(${angle}deg)${fitTransform ? ` ${fitTransform}` : ""}`;
      wordSpan.style.transformOrigin = "0% 0%";
      return;
    }

    wordSpan.style.left = `${this._round2(relativeLeft)}px`;
    wordSpan.style.top = `${this._round2(relativeTop)}px`;
    this._fitTextToBox(wordSpan, renderedText, width, height);
  },

  _renderPreciseLine(container, line, scale) {
    const lineSpan = document.createElement("span");
    lineSpan.className = "precise-line";
    lineSpan.dataset.x0 = line.x0;
    lineSpan.dataset.y0 = line.y0;
    lineSpan.dataset.x1 = line.x1;
    lineSpan.dataset.y1 = line.y1;
    lineSpan.dataset.isVertical = line.is_vertical ? "true" : "false";
    if (line.block !== undefined && line.block !== null) {
      lineSpan.dataset.block = String(line.block);
    }

    const left = line.x0 * scale;
    const top = line.y0 * scale;
    const width = (line.x1 - line.x0) * scale;
    const height = (line.y1 - line.y0) * scale;
    lineSpan.style.left = `${this._round2(left)}px`;
    lineSpan.style.top = `${this._round2(top)}px`;
    lineSpan.style.width = `${this._round2(width)}px`;
    lineSpan.style.height = `${this._round2(height)}px`;
    lineSpan.style.fontSize = `${this._round2(height * 0.88)}px`;
    lineSpan.style.lineHeight = `${this._round2(height)}px`;
    lineSpan.style.fontFamily = "sans-serif";
    lineSpan.style.display = "inline-block";
    lineSpan.style.position = "absolute";
    container.appendChild(lineSpan);

    const words = Array.isArray(line.words) && line.words.length > 0 ? line.words : null;
    if (!words) {
      lineSpan.textContent = line.text;
      this._fitTextToBox(lineSpan, line.text || "", width, height);
      return;
    }

    for (let index = 0; index < words.length; index++) {
      const word = words[index];
      const nextWord = words[index + 1];
      const includeTrailingSpace = Boolean(nextWord && !line.is_vertical);
      const wordText = word.text || "";
      const renderedText = `${wordText}${includeTrailingSpace ? " " : ""}`;
      const gapWidth = includeTrailingSpace ? Math.max(0, nextWord.x0 - word.x1) * scale : 0;
      const wordSpan = document.createElement("span");
      wordSpan.className = "precise-word";
      wordSpan.textContent = renderedText;
      wordSpan.dataset.x0 = word.x0;
      wordSpan.dataset.y0 = word.y0;
      wordSpan.dataset.x1 = word.x1;
      wordSpan.dataset.y1 = word.y1;
      wordSpan.dataset.isVertical = line.is_vertical ? "true" : "false";
      if (word.block !== undefined && word.block !== null) {
        wordSpan.dataset.block = String(word.block);
      }

      lineSpan.appendChild(wordSpan);
      this._positionPreciseWord(wordSpan, word, line, scale, renderedText, (word.x1 - word.x0) * scale + gapWidth);
    }

    const breakSpan = document.createElement("span");
    breakSpan.className = "precise-linebreak";
    breakSpan.style.position = "absolute";
    breakSpan.style.left = `${this._round2(width)}px`;
    breakSpan.style.top = "0px";
    breakSpan.style.width = "0px";
    breakSpan.style.height = `${this._round2(height)}px`;
    breakSpan.style.whiteSpace = "pre";
    breakSpan.textContent = "\n";
    lineSpan.appendChild(breakSpan);
  },

  renderPreciseLines(container, lines, scale) {
    container.innerHTML = "";
    if (!lines || !lines.length) return;
    for (const line of lines) this._renderPreciseLine(container, line, scale);
  },
};

window.TextLayerView = TextLayerView;
