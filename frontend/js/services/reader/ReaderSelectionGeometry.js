/** Numeric selection geometry only: no DOM, reader state, persistence or scheduling. */
class ReaderSelectionGeometry {
  static VERTICAL_SELECTION_SLACK_PT = 1.2;

  static calculateLineVerticalBounds(top, bottom, slackPt = ReaderSelectionGeometry.VERTICAL_SELECTION_SLACK_PT) {
    const y0 = Math.max(0, top - slackPt);
    const y1 = bottom + slackPt;
    return {
      y0: Math.round(y0 * 100) / 100,
      y1: Math.round(y1 * 100) / 100,
    };
  }

  static lineMatchScore(cr, sr, midY) {
    const vOverlap = Math.min(cr.bottom, sr.bottom) - Math.max(cr.top, sr.top);
    const vMatch = vOverlap > 0 || (midY >= sr.top - 6 && midY <= sr.bottom + 6);
    if (!vMatch) return null;
    const hOverlap = Math.min(cr.right, sr.right) - Math.max(cr.left, sr.left);
    return vOverlap * 10 + Math.max(0, hOverlap);
  }

  static relativeRect(cr, pageRect, currentScale, lineData) {
    if (lineData) {
      const lineX0 = Number.parseFloat(lineData.x0);
      const lineY0 = Number.parseFloat(lineData.y0);
      const lineX1 = Number.parseFloat(lineData.x1);
      const lineY1 = Number.parseFloat(lineData.y1);

      const selLeft = (cr.left - pageRect.left) / currentScale;
      const selRight = (cr.right - pageRect.left) / currentScale;

      const x0 = Math.max(lineX0, Math.min(lineX1, selLeft));
      const x1 = Math.min(lineX1, Math.max(lineX0, selRight));

      const vBounds = ReaderSelectionGeometry.calculateLineVerticalBounds(lineY0, lineY1);

      return {
        x0: Math.round(x0 * 100) / 100,
        y0: vBounds.y0,
        x1: Math.round(x1 * 100) / 100,
        y1: vBounds.y1,
      };
    }
    const x0 = (cr.left - pageRect.left) / currentScale;
    const y0 = (cr.top - pageRect.top) / currentScale;
    return {
      x0: Math.round(x0 * 100) / 100,
      y0: Math.round(y0 * 100) / 100,
      x1: Math.round((x0 + cr.width / currentScale) * 100) / 100,
      y1: Math.round((y0 + cr.height / currentScale) * 100) / 100,
    };
  }

  static wordSegmentRect(wordData, lineData, from = 0, to = 1) {
    const num = (value) => Number.parseFloat(value);
    const wx0 = num(wordData?.x0);
    const wx1 = num(wordData?.x1);
    if (!Number.isFinite(wx0) || !Number.isFinite(wx1) || wx1 < wx0) return null;

    const lineY0 = num(lineData?.y0);
    const lineY1 = num(lineData?.y1);
    const hasLine = Number.isFinite(lineY0) && Number.isFinite(lineY1) && lineY1 >= lineY0;
    const top = hasLine ? lineY0 : num(wordData?.y0);
    const bottom = hasLine ? lineY1 : num(wordData?.y1);
    if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom < top) return null;

    const clamp = (value) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
    const f0 = clamp(Math.min(from, to));
    const f1 = clamp(Math.max(from, to));
    const width = wx1 - wx0;
    const x0 = wx0 + width * f0;
    const x1 = wx0 + width * f1;
    if (!(x1 > x0)) return null;

    const vBounds = ReaderSelectionGeometry.calculateLineVerticalBounds(top, bottom);

    return {
      x0: Math.round(x0 * 100) / 100,
      y0: vBounds.y0,
      x1: Math.round(x1 * 100) / 100,
      y1: vBounds.y1,
    };
  }

  static floatingToolbarPosition(firstRect, lastRect, tbWidth, tbHeight, viewportWidth, safeTop, safeBottom) {
    const gap = 12;
    const candidateAbove = firstRect.top - tbHeight - gap;
    const candidateBelow = lastRect.bottom + gap;
    const fitsAbove = candidateAbove >= safeTop && candidateAbove + tbHeight <= safeBottom;
    const fitsBelow = candidateBelow >= safeTop && candidateBelow + tbHeight <= safeBottom;
    const anchor = fitsAbove ? firstRect : lastRect;
    const targetCenterX = (anchor.left + anchor.right) / 2;
    const left =
      tbWidth > viewportWidth - 24
        ? viewportWidth / 2
        : Math.max(tbWidth / 2 + 12, Math.min(viewportWidth - tbWidth / 2 - 12, targetCenterX));

    const candidate = fitsAbove ? candidateAbove : fitsBelow ? candidateBelow : safeBottom - tbHeight;
    const top = Math.max(safeTop, Math.min(safeBottom - tbHeight, candidate));
    return { left, top };
  }

  static quickPalettePosition(bounds, paletteBounds, viewportWidth) {
    const left = Math.max(
      paletteBounds.width / 2 + 8,
      Math.min(viewportWidth - paletteBounds.width / 2 - 8, bounds.left + bounds.width / 2),
    );
    const opensBelow = bounds.top < paletteBounds.height + 16;
    return { left, top: opensBelow ? bounds.bottom : bounds.top - 8, opensBelow };
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { ReaderSelectionGeometry };
}
