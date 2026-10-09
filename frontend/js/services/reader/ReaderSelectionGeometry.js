/** Numeric selection geometry only: no DOM, reader state, persistence or scheduling. */
class ReaderSelectionGeometry {
  static lineMatchScore(cr, sr, midY) {
    const vOverlap = Math.min(cr.bottom, sr.bottom) - Math.max(cr.top, sr.top);
    const vMatch = vOverlap > 0 || (midY >= sr.top - 6 && midY <= sr.bottom + 6);
    if (!vMatch) return null;
    const hOverlap = Math.min(cr.right, sr.right) - Math.max(cr.left, sr.left);
    return (vOverlap * 10) + Math.max(0, hOverlap);
  }

  static relativeRect(cr, pageRect, currentScale, lineData) {
    if (lineData) {
      const lineX0 = parseFloat(lineData.x0);
      const lineY0 = parseFloat(lineData.y0);
      const lineX1 = parseFloat(lineData.x1);
      const lineY1 = parseFloat(lineData.y1);

      const selLeft = (cr.left - pageRect.left) / currentScale;
      const selRight = (cr.right - pageRect.left) / currentScale;

      const x0 = Math.max(lineX0, Math.min(lineX1, selLeft));
      const x1 = Math.min(lineX1, Math.max(lineX0, selRight));
      const y0 = Math.max(0, lineY0 - 1.2);
      const y1 = lineY1 + 1.2;

      return {
        x0: Math.round(x0 * 100) / 100,
        y0: Math.round(y0 * 100) / 100,
        x1: Math.round(x1 * 100) / 100,
        y1: Math.round(y1 * 100) / 100
      };
    } else {
      const x0 = (cr.left - pageRect.left) / currentScale;
      const y0 = (cr.top - pageRect.top) / currentScale;
      return {
        x0: Math.round(x0 * 100) / 100,
        y0: Math.round(y0 * 100) / 100,
        x1: Math.round((x0 + cr.width / currentScale) * 100) / 100,
        y1: Math.round((y0 + cr.height / currentScale) * 100) / 100
      };
    }
  }

  static floatingToolbarPosition(firstRect, lastRect, tbWidth, tbHeight, viewportWidth, safeTop, safeBottom) {
    const gap = 12;
    const candidateAbove = firstRect.top - tbHeight - gap;
    const candidateBelow = lastRect.bottom + gap;
    const fitsAbove = candidateAbove >= safeTop && candidateAbove + tbHeight <= safeBottom;
    const fitsBelow = candidateBelow >= safeTop && candidateBelow + tbHeight <= safeBottom;
    const anchor = fitsAbove ? firstRect : lastRect;
    const targetCenterX = (anchor.left + anchor.right) / 2;
    const left = tbWidth > viewportWidth - 24 ? viewportWidth / 2 :
      Math.max(tbWidth / 2 + 12, Math.min(viewportWidth - tbWidth / 2 - 12, targetCenterX));

    // Avoid an above-last fallback that would split a multiline selection.
    const candidate = fitsAbove ? candidateAbove : fitsBelow ? candidateBelow : safeBottom - tbHeight;
    const top = Math.max(safeTop, Math.min(safeBottom - tbHeight, candidate));
    return { left, top };
  }

  static quickPalettePosition(bounds, paletteBounds, viewportWidth) {
    const left = Math.max(paletteBounds.width / 2 + 8, Math.min(
      viewportWidth - paletteBounds.width / 2 - 8,
      bounds.left + bounds.width / 2
    ));
    const opensBelow = bounds.top < paletteBounds.height + 16;
    return { left, top: opensBelow ? bounds.bottom : bounds.top - 8, opensBelow };
  }
}
