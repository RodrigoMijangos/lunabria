/**
 * TextLayerView.js
 * Creates textLayer container and renders precise typographical lines for text selection.
 */
const TextLayerView = {
  _ensureSelectionStyles() {
    if (typeof document === 'undefined' || !document.head || typeof document.head.appendChild !== 'function') return;
    if (document.getElementById('lunabria-precise-selection-styles')) return;
    const style = document.createElement('style');
    style.id = 'lunabria-precise-selection-styles';
    style.textContent = `
      .textLayer {
        opacity: 0.42 !important;
        mix-blend-mode: multiply !important;
        user-select: text !important;
        -webkit-user-select: text !important;
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

      lineSpan.style.left = `${Math.round(left * 100) / 100}px`;
      lineSpan.style.top = `${Math.round(top * 100) / 100}px`;
      lineSpan.style.width = `${Math.round(width * 100) / 100}px`;
      lineSpan.style.height = `${Math.round(height * 100) / 100}px`;
      lineSpan.style.fontSize = `${Math.round(height * 0.88 * 100) / 100}px`;
      lineSpan.style.lineHeight = `${Math.round(height * 100) / 100}px`;
      lineSpan.style.fontFamily = 'sans-serif';
      lineSpan.style.display = 'inline-block';
      lineSpan.style.position = 'absolute';

      const words = Array.isArray(line.words) && line.words.length > 0 ? line.words : null;

      if (!words) {
        // Fallback for legacy layout objects without words array
        lineSpan.textContent = line.text;
        container.appendChild(lineSpan);
        const naturalWidth = lineSpan.getBoundingClientRect().width;
        if (naturalWidth > 0 && width > 0) {
          const scaleX = width / naturalWidth;
          if (scaleX > 0.1 && scaleX < 10.0) {
            lineSpan.style.transform = `scaleX(${Math.round(scaleX * 10000) / 10000})`;
            lineSpan.style.transformOrigin = '0% 0%';
            lineSpan.style.width = `${Math.round(naturalWidth * 100) / 100}px`;
          } else {
            lineSpan.style.width = `${Math.round(width * 100) / 100}px`;
          }
        }
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

        wordSpan.style.left = `${Math.round(wRelLeft * 100) / 100}px`;
        wordSpan.style.top = `${Math.round(wRelTop * 100) / 100}px`;
        wordSpan.style.height = `${Math.round(wHeight * 100) / 100}px`;
        wordSpan.style.fontSize = `${Math.round(wHeight * 0.88 * 100) / 100}px`;
        wordSpan.style.lineHeight = `${Math.round(wHeight * 100) / 100}px`;
        wordSpan.style.fontFamily = 'sans-serif';
        wordSpan.style.display = 'inline-block';
        wordSpan.style.position = 'absolute';
        wordSpan.style.whiteSpace = 'pre';
        wordSpan.style.width = 'auto';

        lineSpan.appendChild(wordSpan);

        // Subpixel scale calibration per-word
        const naturalWordWidth = wordSpan.getBoundingClientRect().width;
        if (naturalWordWidth > 0 && wWidth > 0) {
          const wordScaleX = wWidth / naturalWordWidth;
          if (wordScaleX > 0.1 && wordScaleX < 10.0) {
            wordSpan.style.transform = `scaleX(${Math.round(wordScaleX * 10000) / 10000})`;
            wordSpan.style.transformOrigin = '0% 0%';
            wordSpan.style.width = `${Math.round(naturalWordWidth * 100) / 100}px`;
          } else {
            wordSpan.style.width = `${Math.round(wWidth * 100) / 100}px`;
          }
        } else {
          wordSpan.style.width = `${Math.round(wWidth * 100) / 100}px`;
        }

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
          spaceSpan.style.left = `${Math.round(sRelLeft * 100) / 100}px`;
          spaceSpan.style.top = `${Math.round(wRelTop * 100) / 100}px`;
          spaceSpan.style.width = `${Math.round(sWidth * 100) / 100}px`;
          spaceSpan.style.height = `${Math.round(wHeight * 100) / 100}px`;
          spaceSpan.style.fontSize = `${Math.round(wHeight * 0.88 * 100) / 100}px`;
          spaceSpan.style.lineHeight = `${Math.round(wHeight * 100) / 100}px`;
          spaceSpan.style.fontFamily = 'sans-serif';
          spaceSpan.style.display = 'inline-block';
          spaceSpan.style.position = 'absolute';
          spaceSpan.style.whiteSpace = 'pre';

          lineSpan.appendChild(spaceSpan);
        }
      }

      // Phase 3: Line break delimiter for clean paragraph text copying
      const breakSpan = document.createElement('span');
      breakSpan.className = 'precise-linebreak';
      breakSpan.style.position = 'absolute';
      breakSpan.style.left = `${Math.round(width * 100) / 100}px`;
      breakSpan.style.top = '0px';
      breakSpan.style.width = '0px';
      breakSpan.style.height = `${Math.round(height * 100) / 100}px`;
      breakSpan.style.whiteSpace = 'pre';
      breakSpan.textContent = '\n';
      lineSpan.appendChild(breakSpan);

      container.appendChild(lineSpan);
    }
  }
};

window.TextLayerView = TextLayerView;
