/**
 * TextLayerView.js
 * Creates textLayer container and renders precise typographical lines for text selection.
 */
const TextLayerView = {
  _round2(value) { return Math.round(value * 100) / 100; },
  _round4(value) { return Math.round(value * 10000) / 10000; },

  // Lazily created 2D context used to measure text without touching layout.
  // `null` = not probed yet, `false` = unavailable (DOM measurement fallback).
  _measureCtx: null,
  // Browser minimum font size (user/accessibility setting). `null` = not probed yet.
  _minFontSize: null,

  _ensureSelectionStyles() {
    if (typeof document === 'undefined' || !document.head || typeof document.head.appendChild !== 'function') return;
    if (document.getElementById('lunabria-precise-selection-styles')) return;
    const style = document.createElement('style');
    style.id = 'lunabria-precise-selection-styles';
    // Inherited typography is neutralised so the DOM glyph run has exactly the
    // width measured on the canvas (same font, no extra spacing or transforms).
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
    const div = document.createElement('div');
    div.className = 'textLayer';
    div.style.width = `${width}px`;
    div.style.height = `${height}px`;
    div.style.setProperty('--scale-factor', scale);
    return div;
  },

  _measureContext() {
    if (this._measureCtx !== null) return this._measureCtx || null;
    let ctx = false;
    try {
      if (typeof OffscreenCanvas === 'function') {
        ctx = new OffscreenCanvas(1, 1).getContext('2d') || false;
      }
      if (!ctx && typeof document !== 'undefined' && typeof document.createElement === 'function') {
        const canvas = document.createElement('canvas');
        ctx = (canvas && typeof canvas.getContext === 'function' && canvas.getContext('2d')) || false;
      }
    } catch (error) {
      ctx = false;
    }
    this._measureCtx = ctx;
    return ctx || null;
  },

  /**
   * Browsers with a minimum font size setting silently enlarge tiny text (low zoom,
   * footnotes), which would invalidate any width measured for the requested size.
   * Same probe as PDF.js: a 1px "X" with line-height 1 reports the clamped size.
   */
  _browserMinFontSize() {
    if (this._minFontSize !== null) return this._minFontSize;
    let minFontSize = 1;
    try {
      const body = typeof document !== 'undefined' ? document.body : null;
      if (body && typeof body.appendChild === 'function') {
        const probe = document.createElement('div');
        probe.style.position = 'absolute';
        probe.style.visibility = 'hidden';
        probe.style.fontFamily = 'sans-serif';
        probe.style.fontSize = '1px';
        probe.style.lineHeight = '1';
        probe.style.whiteSpace = 'pre';
        probe.textContent = 'X';
        body.appendChild(probe);
        const height = probe.getBoundingClientRect().height;
        if (typeof probe.remove === 'function') probe.remove();
        else if (typeof body.removeChild === 'function') body.removeChild(probe);
        if (Number.isFinite(height) && height > 1 && height <= 72) minFontSize = height;
      }
    } catch (error) {
      minFontSize = 1;
    }
    this._minFontSize = minFontSize;
    return minFontSize;
  },

  /**
   * Natural (unscaled) width of `text` rendered at `fontSize` px sans-serif.
   * Canvas measurement works on detached nodes (single/dual page wrappers are built
   * off-DOM) and avoids one forced reflow per word. DOM measurement is only a fallback
   * and is skipped for detached nodes, where it would report 0.
   */
  _naturalTextWidth(span, text, fontSize) {
    const ctx = this._measureContext();
    if (ctx) {
      ctx.font = `normal normal ${fontSize}px sans-serif`;
      const width = ctx.measureText(text).width;
      if (Number.isFinite(width) && width > 0) return width;
    }
    if (span.isConnected === false || typeof span.getBoundingClientRect !== 'function') return 0;
    const width = span.getBoundingClientRect().width;
    return Number.isFinite(width) ? width : 0;
  },

  /**
   * Sizes `span` so its glyph run covers exactly `targetWidth` x `boxHeight` CSS px.
   * Selection rectangles, caret hit-testing and saved highlights all derive from the
   * glyph run, so it must match the PDF word box drawn on the canvas.
   */
  _fitTextToBox(span, text, targetWidth, boxHeight) {
    const requestedFont = this._round2(boxHeight * 0.88);
    const renderFont = Math.max(requestedFont, this._browserMinFontSize());
    const yScale = renderFont > 0 ? requestedFont / renderFont : 1;
    const layoutHeight = this._round2(yScale > 0 && yScale < 1 ? boxHeight / yScale : boxHeight);

    span.style.fontSize = `${renderFont}px`;
    span.style.height = `${layoutHeight}px`;
    span.style.lineHeight = `${layoutHeight}px`;
    span.style.transform = '';

    const naturalWidth = this._round2(this._naturalTextWidth(span, text, renderFont));
    if (naturalWidth > 0 && targetWidth > 0) {
      const scaleX = targetWidth / naturalWidth;
      if (scaleX > 0.05 && scaleX < 20) {
        span.style.width = `${naturalWidth}px`;
        span.style.transform = yScale < 1
          ? `scale(${this._round4(scaleX)}, ${this._round4(yScale)})`
          : `scaleX(${this._round4(scaleX)})`;
        span.style.transformOrigin = '0% 0%';
        return;
      }
    }
    span.style.width = `${this._round2(Math.max(0, targetWidth))}px`;
    if (yScale < 1) {
      span.style.transform = `scale(1, ${this._round4(yScale)})`;
      span.style.transformOrigin = '0% 0%';
    }
  },

  groupWordsIntoLines(words) {
    if (!words || !words.length) return [];

    // Sort words primarily by y0, secondarily by x0 to preserve true reading order
    const sortedWords = [...words].sort((a, b) => {
      const dy = a.y0 - b.y0;
      return Math.abs(dy) > 4 ? dy : a.x0 - b.x0;
    });

    const lineGroups = [];
    for (const w of sortedWords) {
      const wY0 = w.y0;
      const wY1 = w.y1;
      const wMidY = (wY0 + wY1) / 2;
      const wH = Math.max(1, wY1 - wY0);
      let matched = null;
      for (const group of lineGroups) {
        const gY0 = Math.min(...group.map(i => i.y0));
        const gY1 = Math.max(...group.map(i => i.y1));
        const gMidY = group.reduce((sum, item) => sum + (item.y0 + item.y1) / 2, 0) / group.length;
        const gH = Math.max(1, gY1 - gY0);

        const overlap = Math.min(wY1, gY1) - Math.max(wY0, gY0);
        const minH = Math.min(wH, gH);
        const overlapRatio = minH > 0 ? (overlap / minH) : 0;
        const midDist = Math.abs(wMidY - gMidY);

        if (overlapRatio >= 0.35 || midDist <= Math.max(wH, gH) * 0.45 || (overlap > 0 && midDist <= minH * 0.75)) {
          matched = group;
          break;
        }
      }
      if (matched) {
        matched.push(w);
      } else {
        lineGroups.push([w]);
      }
    }

    const lines = lineGroups.map(group => {
      group.sort((a, b) => a.x0 - b.x0);
      return {
        block: group[0].block,
        line: group[0].line,
        x0: Math.min(...group.map(x => x.x0)),
        y0: Math.min(...group.map(x => x.y0)),
        x1: Math.max(...group.map(x => x.x1)),
        y1: Math.max(...group.map(x => x.y1)),
        text: group.map(x => x.text).join(' '),
        words: group
      };
    });

    lines.sort((a, b) => {
      const dy = a.y0 - b.y0;
      return Math.abs(dy) > 4 ? dy : a.x0 - b.x0;
    });
    return lines;
  },

  renderPreciseLines(container, lines, scale) {
    container.innerHTML = '';
    if (!lines || !lines.length) return;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineSpan = document.createElement('span');
      lineSpan.className = 'precise-line';

      lineSpan.dataset.x0 = line.x0;
      lineSpan.dataset.y0 = line.y0;
      lineSpan.dataset.x1 = line.x1;
      lineSpan.dataset.y1 = line.y1;

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
      lineSpan.style.fontFamily = 'sans-serif';
      lineSpan.style.display = 'inline-block';
      lineSpan.style.position = 'absolute';

      // Attach before measuring so the DOM fallback measures a connected node.
      container.appendChild(lineSpan);

      const words = Array.isArray(line.words) && line.words.length > 0 ? line.words : null;

      if (!words) {
        // Fallback for legacy layout objects without words array
        lineSpan.textContent = line.text;
        this._fitTextToBox(lineSpan, line.text || '', width, height);
        continue;
      }

      // Phase 1: Render Word and Token layouts with exact subpixel scaling
      for (let j = 0; j < words.length; j++) {
        const w = words[j];
        const wordSpan = document.createElement('span');
        wordSpan.className = 'precise-word';
        wordSpan.textContent = w.text;

        wordSpan.dataset.x0 = w.x0;
        wordSpan.dataset.y0 = w.y0;
        wordSpan.dataset.x1 = w.x1;
        wordSpan.dataset.y1 = w.y1;

        const wRelLeft = (w.x0 - line.x0) * scale;
        const wRelTop = (w.y0 - line.y0) * scale;
        const wWidth = (w.x1 - w.x0) * scale;
        const wHeight = (w.y1 - w.y0) * scale;

        wordSpan.style.left = `${this._round2(wRelLeft)}px`;
        wordSpan.style.top = `${this._round2(wRelTop)}px`;
        wordSpan.style.fontFamily = 'sans-serif';
        wordSpan.style.display = 'inline-block';
        wordSpan.style.position = 'absolute';
        wordSpan.style.whiteSpace = 'pre';

        lineSpan.appendChild(wordSpan);

        // Subpixel scale calibration per-word
        this._fitTextToBox(wordSpan, w.text || '', wWidth, wHeight);

        // Phase 2: Render Inter-word Space layouts
        if (j < words.length - 1) {
          const nextW = words[j + 1];
          const gap = nextW.x0 - w.x1;
          const spaceSpan = document.createElement('span');
          spaceSpan.className = 'precise-space';
          spaceSpan.textContent = ' ';
          spaceSpan.setAttribute('role', 'presentation');

          const sRelLeft = (w.x1 - line.x0) * scale;
          const sWidth = Math.max(0, gap * scale);
          spaceSpan.style.left = `${this._round2(sRelLeft)}px`;
          spaceSpan.style.top = `${this._round2(wRelTop)}px`;
          spaceSpan.style.fontFamily = 'sans-serif';
          spaceSpan.style.display = 'inline-block';
          spaceSpan.style.position = 'absolute';
          spaceSpan.style.whiteSpace = 'pre';

          lineSpan.appendChild(spaceSpan);
          // The space glyph must fill the gap exactly: a natural-width space would
          // leave holes in the selection bar or overlap the next word.
          this._fitTextToBox(spaceSpan, ' ', sWidth, wHeight);
        }
      }

      // Phase 3: Line break delimiter for clean paragraph text copying
      const breakSpan = document.createElement('span');
      breakSpan.className = 'precise-linebreak';
      breakSpan.style.position = 'absolute';
      breakSpan.style.left = `${this._round2(width)}px`;
      breakSpan.style.top = '0px';
      breakSpan.style.width = '0px';
      breakSpan.style.height = `${this._round2(height)}px`;
      breakSpan.style.whiteSpace = 'pre';
      breakSpan.textContent = '\n';
      lineSpan.appendChild(breakSpan);
    }
  }
};

window.TextLayerView = TextLayerView;
