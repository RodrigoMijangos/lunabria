/**
 * ReaderModel.js
 * Model & State Management for Lunabria PDF Reader
 * Follows Single Responsibility Principle (SRP): Each function has exactly one responsibility.
 */

class ReaderModel {
  constructor() {
    this.bookId = null;
    this.pdfDoc = null;
    this.totalPages = 0;
    this.currentPage = 1;
    this.scale = 1.3;
    this.viewMode = this.normalizeViewMode(localStorage.getItem('moon_reader_view_mode'));
    this.drawTool = 'pen'; // 'pen' | 'highlighter' | 'eraser' | 'pan'
    this.drawColor = '#1e293b';
    this.drawWidth = 4;
    this.isDrawMode = false;
    this.isSpacePanActive = false;
    this.detectedInputType = 'mouse';
    this.annotations = [];
    this.pageStrokes = new Map();
    this.activeHighlight = null;
    this.selectedRange = null;
    this.selectedText = '';
    this.colors = [
      { id: 'yellow', name: 'Key Idea', color: '#fef08a' },
      { id: 'green', name: 'Definition', color: '#bbf7d0' },
      { id: 'blue', name: 'Reference', color: '#bfdbfe' },
      { id: 'red', name: 'Question / Important', color: '#fecaca' },
      { id: 'purple', name: 'Quote', color: '#e9d5ff' },
    ];
    this.accessibility = {
      palmRejection: localStorage.getItem('moon_palm_rejection') || 'strict',
      doubleClickDelay: localStorage.getItem('moon_double_click_delay') !== null ? Number(localStorage.getItem('moon_double_click_delay')) : 500,
      doubleClickAction: localStorage.getItem('moon_double_click_action') || 'toggle',
      pressureSensitivity: localStorage.getItem('moon_pressure_sensitivity') || 'normal'
    };
  }

  // --- Accessibility Settings State ---
  setAccessibilitySetting(key, val) {
    if (this.accessibility[key] !== undefined) {
      this.accessibility[key] = val;
      const storageKey = `moon_${key.replace(/([A-Z])/g, '_$1').toLowerCase()}`;
      localStorage.setItem(storageKey, val);
    }
  }

  getAccessibilitySetting(key) {
    return this.accessibility[key];
  }

  // --- Book & Document State ---
  setBook(bookId, pdfDoc, totalPages) {
    this.bookId = bookId;
    this.pdfDoc = pdfDoc;
    this.totalPages = totalPages;
  }

  reset() {
    this.bookId = null;
    this.pdfDoc = null;
    this.totalPages = 0;
    this.currentPage = 1;
    this.scale = 1.3;
    this.annotations = [];
    this.pageStrokes.clear();
    this.activeHighlight = null;
    this.selectedRange = null;
    this.selectedText = '';
  }

  // --- Page Navigation State ---
  setCurrentPage(pageNumber) {
    this.currentPage = Math.min(Math.max(1, pageNumber), this.totalPages || 1);
    return this.currentPage;
  }

  getNextPageNumber() {
    return Math.min(this.totalPages || 1, this.currentPage + 1);
  }

  getPrevPageNumber() {
    return Math.max(1, this.currentPage - 1);
  }

  getNextDualPageNumber() {
    return (this.currentPage % 2 === 1) ? this.currentPage + 2 : this.currentPage + 1;
  }

  getPrevDualPageNumber() {
    return (this.currentPage % 2 === 1) ? this.currentPage - 2 : this.currentPage - 3;
  }

  // --- Zoom Scale State ---
  setScale(scale) {
    this.scale = Math.max(0.5, Math.min(3.0, Math.round(scale * 100) / 100));
    return this.scale;
  }

  calculateZoomInScale() {
    return Math.min(3.0, this.scale + 0.15);
  }

  calculateZoomOutScale() {
    return Math.max(0.5, this.scale - 0.15);
  }

  // --- View Mode State ---
  normalizeViewMode(mode) {
    const normalized = mode === 'single' ? 'paginated' : mode;
    const validModes = ['paginated', 'flow', 'dual', 'notes'];
    return validModes.includes(normalized) ? normalized : 'paginated';
  }

  setViewMode(mode) {
    this.viewMode = this.normalizeViewMode(mode);
    localStorage.setItem('moon_reader_view_mode', this.viewMode);
    return this.viewMode;
  }

  // --- Drawing Tool State ---
  setDrawTool(tool) {
    const validTools = ['pen', 'highlighter', 'eraser', 'pan'];
    this.drawTool = validTools.includes(tool) ? tool : 'pen';
    return this.drawTool;
  }

  setDrawColor(hexColor) {
    this.drawColor = hexColor || '#1e293b';
    return this.drawColor;
  }

  setDrawWidth(width) {
    this.drawWidth = Number(width) || 4;
    return this.drawWidth;
  }

  toggleDrawMode(forceState = null) {
    this.isDrawMode = forceState !== null ? Boolean(forceState) : !this.isDrawMode;
    return this.isDrawMode;
  }

  setSpacePanActive(active) {
    this.isSpacePanActive = Boolean(active);
    return this.isSpacePanActive;
  }

  setInputDevice(deviceType) {
    this.detectedInputType = deviceType === 'pen' ? 'pen' : 'mouse';
    return this.detectedInputType;
  }

  // --- Stroke Data Operations ---
  getPageStrokes(pageNumber) {
    return this.pageStrokes.get(pageNumber) || [];
  }

  setPageStrokes(pageNumber, strokes) {
    this.pageStrokes.set(pageNumber, Array.isArray(strokes) ? strokes : []);
  }

  addStrokeToPage(pageNumber, stroke) {
    const list = this.getPageStrokes(pageNumber);
    list.push(stroke);
    this.pageStrokes.set(pageNumber, list);
    return list;
  }

  removeLastStrokeFromPage(pageNumber) {
    const list = this.getPageStrokes(pageNumber);
    if (list.length > 0) {
      list.pop();
      this.pageStrokes.set(pageNumber, list);
      return true;
    }
    return false;
  }

  clearPageStrokes(pageNumber) {
    this.pageStrokes.set(pageNumber, []);
  }

  filterStrokesNearPoint(pageNumber, normX, normY, radius = 0.035) {
    const strokes = this.getPageStrokes(pageNumber);
    if (!strokes.length) return false;

    const radiusSq = radius * radius;
    const remaining = strokes.filter(stroke => {
      return !stroke.points.some(pt => {
        const dx = pt.x - normX;
        const dy = pt.y - normY;
        return (dx * dx + dy * dy) < radiusSq;
      });
    });

    const changed = remaining.length !== strokes.length;
    if (changed) {
      this.pageStrokes.set(pageNumber, remaining);
    }
    return changed;
  }

  // --- Color Palette State ---
  setColors(colors) {
    if (Array.isArray(colors) && colors.length > 0) {
      const legacyMap = {
        'Idea Clave': 'Key Idea',
        'Definición': 'Definition',
        'Definicion': 'Definition',
        'Referencia': 'Reference',
        'Duda / Importante': 'Question / Important',
        'Cita': 'Quote'
      };
      this.colors = colors.map(c => ({
        ...c,
        name: legacyMap[c.name] || c.name
      }));
    }
    // If empty/null, keep the default palette already set in constructor
  }

  // --- Annotation Data Operations ---
  setAnnotations(annotations) {
    this.annotations = Array.isArray(annotations) ? annotations : [];
  }

  getPageAnnotations(pageNumber) {
    return this.annotations.filter(a => a.page === pageNumber);
  }

  getColorMetadata(colorId) {
    return this.colors.find(c => c.id === colorId) || this.colors[0];
  }

  getHighlightColorIdFromHex(hex) {
    if (!hex) return 'yellow';
    const h = hex.toLowerCase();
    if (h === '#eab308' || h.includes('yellow') || h === '#fef08a') return 'yellow';
    if (h === '#16a34a' || h.includes('green') || h === '#bbf7d0') return 'green';
    if (h === '#2563eb' || h.includes('blue') || h === '#bfdbfe') return 'blue';
    if (h === '#dc2626' || h.includes('red') || h === '#fecaca') return 'red';
    if (h === '#9333ea' || h.includes('purple') || h === '#e9d5ff') return 'purple';
    return 'yellow';
  }

  // --- Pure Geometric & Text Calculation Helpers ---
  static normalizeText(str) {
    if (!str) return '';
    return str
      .replace(/(\b\w+)[-‐\xad]\s+([a-zA-ZáéíóúÁÉÍÓÚñÑ]\w*\b)/g, '$1$2')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  static mergeLineRects(rects) {
    if (!rects || !rects.length) return [];
    const sorted = [...rects].sort((a, b) => {
      const yDiff = a.y0 - b.y0;
      return Math.abs(yDiff) > 3 ? yDiff : a.x0 - b.x0;
    });

    const merged = [];
    let cur = { ...sorted[0] };

    for (let i = 1; i < sorted.length; i++) {
      const r = sorted[i];
      const sameLine = Math.abs(r.y0 - cur.y0) <= 3;
      const contiguous = r.x0 <= cur.x1 + 18;

      if (sameLine && contiguous) {
        cur.x1 = Math.max(cur.x1, r.x1);
        cur.y0 = Math.min(cur.y0, r.y0);
        cur.y1 = Math.max(cur.y1, r.y1);
      } else {
        merged.push(cur);
        cur = { ...r };
      }
    }
    merged.push(cur);
    return merged;
  }
}

// Attach to window for standard script loading
window.ReaderModel = ReaderModel;
