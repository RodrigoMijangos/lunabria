/**
 * TextLayerView.js
 * Creates textLayer container and renders precise typographical lines for text selection.
 */
const TextLayerView = {
  createTextLayerContainer(width, height, scale) {
    const div = document.createElement('div');
    div.className = 'textLayer';
    div.style.width = `${width}px`;
    div.style.height = `${height}px`;
    div.style.setProperty('--scale-factor', scale);
    return div;
  },

  groupWordsIntoLines(words) {
    if (!words || !words.length) return [];
    const lines = [];
    let cur = [];
    for (const w of words) {
      if (cur.length && (cur[0].block !== w.block || cur[0].line !== w.line)) {
        lines.push({
          block: cur[0].block,
          line: cur[0].line,
          x0: Math.min(...cur.map(x => x.x0)),
          y0: Math.min(...cur.map(x => x.y0)),
          x1: Math.max(...cur.map(x => x.x1)),
          y1: Math.max(...cur.map(x => x.y1)),
          text: cur.map(x => x.text).join(' ')
        });
        cur = [];
      }
      cur.push(w);
    }
    if (cur.length) {
      lines.push({
        block: cur[0].block,
        line: cur[0].line,
        x0: Math.min(...cur.map(x => x.x0)),
        y0: Math.min(...cur.map(x => x.y0)),
        x1: Math.max(...cur.map(x => x.x1)),
        y1: Math.max(...cur.map(x => x.y1)),
        text: cur.map(x => x.text).join(' ')
      });
    }
    return lines;
  },

  renderPreciseLines(container, lines, scale) {
    container.innerHTML = '';
    if (!lines || !lines.length) return;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const span = document.createElement('span');
      span.className = 'precise-line';
      span.textContent = line.text;

      span.dataset.x0 = line.x0;
      span.dataset.y0 = line.y0;
      span.dataset.x1 = line.x1;
      span.dataset.y1 = line.y1;

      const left = line.x0 * scale;
      const top = line.y0 * scale;
      const width = (line.x1 - line.x0) * scale;
      const height = (line.y1 - line.y0) * scale;

      span.style.left = `${Math.round(left * 100) / 100}px`;
      span.style.top = `${Math.round(top * 100) / 100}px`;
      span.style.height = `${Math.round(height * 100) / 100}px`;
      span.style.fontSize = `${Math.round(height * 0.88 * 100) / 100}px`;
      span.style.lineHeight = `${Math.round(height * 100) / 100}px`;
      span.style.width = 'auto';

      container.appendChild(span);

      // Measure unscaled natural text width to prevent font drift
      const naturalWidth = span.getBoundingClientRect().width;
      if (naturalWidth > 0 && width > 0) {
        const scaleX = width / naturalWidth;
        if (scaleX > 0.3 && scaleX < 3.0) {
          span.style.transform = `scaleX(${Math.round(scaleX * 10000) / 10000})`;
          span.style.transformOrigin = '0% 0%';
        }
      }
      span.style.width = `${Math.round(width * 100) / 100}px`;
    }
  }
};

window.TextLayerView = TextLayerView;
