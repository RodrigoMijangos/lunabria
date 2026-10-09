/**
 * HighlightOverlayView.js
 * Renders precise SVG/DIV highlight rectangles over PDF pages.
 */
const HighlightOverlayView = {
  createHighlightLayerContainer() {
    const layer = document.createElement('div');
    layer.className = 'pdf-highlight-layer';
    return layer;
  },

  renderPageHighlights(layer, annotations, effectiveScale, colors, onHighlightClick) {
    layer.innerHTML = '';
    if (!annotations || !annotations.length) return;

    annotations.forEach(annot => {
      if (annot.rects && annot.rects.length > 0) {
        annot.rects.forEach(r => {
          const div = document.createElement('div');
          div.className = 'pdf-highlight-rect';
          div.dataset.annotationId = String(annot.id);
          const colorMeta = colors.find(c => String(c.id).toLowerCase() === String(annot.color).toLowerCase());
          div.style.backgroundColor = colorMeta ? colorMeta.color : '#ffeb3b';

          let left, top, width, height;
          if (r.x0 !== undefined && r.x1 !== undefined) {
            left = r.x0 * effectiveScale;
            top = r.y0 * effectiveScale;
            width = Math.max(1, (r.x1 - r.x0) * effectiveScale);
            height = Math.max(1, (r.y1 - r.y0) * effectiveScale);
          } else {
            const baseS = r.scale || 1.3;
            const ratio = effectiveScale / baseS;
            left = r.left * ratio;
            top = r.top * ratio;
            width = Math.max(1, r.width * ratio);
            height = Math.max(1, r.height * ratio);
          }

          div.style.left = `${Math.round(left * 100) / 100}px`;
          div.style.top = `${Math.round(top * 100) / 100}px`;
          div.style.width = `${Math.round(width * 100) / 100}px`;
          div.style.height = `${Math.round(height * 100) / 100}px`;
          div.title = annot.comment ? `Note: ${annot.comment}` : annot.text;
          div.onclick = (e) => {
            e.stopPropagation();
            if (onHighlightClick) onHighlightClick(annot, div);
          };
          layer.appendChild(div);
        });
      }
    });
  }
};

window.HighlightOverlayView = HighlightOverlayView;
