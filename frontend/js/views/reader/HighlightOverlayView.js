/**
 * HighlightOverlayView.js
 * Renders precise SVG/DIV highlight rectangles over PDF pages.
 */
const HighlightOverlayView = {
  /**
   * Default vertical reduction in pixels applied to highlight boxes.
   * Modify this constant to increase or decrease the highlight thickness.
   */
  HIGHLIGHT_HEIGHT_DELTA_PX: 3,

  /**
   * Minimum rendered height in pixels to ensure highlights remain visible
   * and pass layout assertions even under small scales or thin line geometries.
   */
  MIN_RENDER_HEIGHT_PX: 1,

  /**
   * Calculates vertically centered highlight bounds without altering
   * underlying selection geometry or coordinates.
   *
   * @param {number} top - Original top coordinate in pixels.
   * @param {number} height - Original height in pixels.
   * @param {number} [deltaPx=3] - Total pixels to reduce from the height.
   * @returns {{ top: number, height: number }} Adjusted top and height.
   */
  calculateHighlightVerticalBounds(top, height, deltaPx = HighlightOverlayView.HIGHLIGHT_HEIGHT_DELTA_PX) {
    const minHeight = HighlightOverlayView.MIN_RENDER_HEIGHT_PX;
    // Allow at most reducing down to minHeight so thin lines do not collapse
    const effectiveDelta = Math.max(0, Math.min(deltaPx, height - minHeight));
    const renderHeight = Math.max(minHeight, height - effectiveDelta);
    // Center vertically by offsetting top by half of the effective height reduction
    const renderTop = top + (effectiveDelta / 2);

    return { top: renderTop, height: renderHeight };
  },

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
            width = Math.max(HighlightOverlayView.MIN_RENDER_HEIGHT_PX, (r.x1 - r.x0) * effectiveScale);
            height = Math.max(HighlightOverlayView.MIN_RENDER_HEIGHT_PX, (r.y1 - r.y0) * effectiveScale);
          } else {
            const baseS = r.scale || 1.3;
            const ratio = effectiveScale / baseS;
            left = r.left * ratio;
            top = r.top * ratio;
            width = Math.max(HighlightOverlayView.MIN_RENDER_HEIGHT_PX, r.width * ratio);
            height = Math.max(HighlightOverlayView.MIN_RENDER_HEIGHT_PX, r.height * ratio);
          }

          const bounds = this.calculateHighlightVerticalBounds(top, height);

          div.style.left = `${Math.round(left * 100) / 100}px`;
          div.style.top = `${Math.round(bounds.top * 100) / 100}px`;
          div.style.width = `${Math.round(width * 100) / 100}px`;
          div.style.height = `${Math.round(bounds.height * 100) / 100}px`;
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
