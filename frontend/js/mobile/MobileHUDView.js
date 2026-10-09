/**
 * MobileHUDView.js
 * Manages compact mobile topbar (HUD), presentation mode toggler, and pinch-to-zoom gestures.
 */
class MobileHUDView {
  constructor(readerViewModel, model) {
    this.reader = readerViewModel;
    this.model = model;

    this.viewModeBtn = null;
    this.viewModeLabel = null;
    this.scenarioIndicator = null;

    // Pinch zoom tracking
    this.pinchStartDistance = 0;
    this.pinchStartScale = 1.0;
    this.isPinching = false;
  }

  init() {
    this.viewModeBtn = document.getElementById('mobile-view-mode-btn');
    this.viewModeLabel = document.getElementById('mobile-view-mode-label');
    this.scenarioIndicator = document.getElementById('mobile-scenario-indicator');

    this.bindEvents();
    this.setupPinchToZoom();
    this.render();
  }

  bindEvents() {
    this.viewModeBtn?.addEventListener('click', () => {
      this.cycleReadingMode();
    });

    const wipeBtn = document.getElementById('mobile-wipe-strokes-btn');
    wipeBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.reader.drawing.clearCurrentPageDrawings();
    });
  }

  cycleReadingMode() {
    const current = this.model.viewMode;
    // Mobile cycle: single <-> flow (the two primary mobile reading modes)
    const next = (current === 'flow') ? 'single' : 'flow';
    this.reader.nav.setViewMode(next);
    this.render();
  }

  render() {
    if (!this.viewModeBtn) {
      this.viewModeBtn = document.getElementById('mobile-view-mode-btn');
      this.viewModeLabel = document.getElementById('mobile-view-mode-label');
    }

    if (this.viewModeBtn) {
      const isFlow = this.model.viewMode === 'flow';
      const iconUse = this.viewModeBtn.querySelector('use');
      if (iconUse) {
        iconUse.setAttribute('href', isFlow ? './icons.svg#scroll' : './icons.svg#book-open');
      }
      if (this.viewModeLabel) {
        this.viewModeLabel.textContent = isFlow ? 'Continuo' : 'Página';
      }
      this.viewModeBtn.title = isFlow
        ? 'Modo continuo activo (Tocar para ver página única)'
        : 'Modo página única activo (Tocar para ver flujo continuo)';
    }
  }

  setupPinchToZoom() {
    const bodyEl = this.reader.bodyEl || document.getElementById('reader-body');
    if (!bodyEl) return;

    let touchStartDist = 0;
    let baseScale = 1.0;

    const getDistance = (touches) => {
      if (touches.length < 2) return 0;
      return Math.hypot(
        touches[0].clientX - touches[1].clientX,
        touches[0].clientY - touches[1].clientY
      );
    };

    bodyEl.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        touchStartDist = getDistance(e.touches);
        baseScale = this.model.scale || 1.0;
        this.isPinching = true;
      }
    }, { passive: true });

    bodyEl.addEventListener('touchmove', (e) => {
      if (this.isPinching && e.touches.length === 2) {
        const currentDist = getDistance(e.touches);
        if (touchStartDist > 0 && currentDist > 0) {
          const ratio = currentDist / touchStartDist;
          // Clamp target scale between 0.6 and 3.5
          const newScale = Math.max(0.6, Math.min(3.5, baseScale * ratio));
          // Apply pinch zoom update when noticeable
          if (Math.abs(newScale - this.model.scale) > 0.08) {
            this.reader.nav.setZoom(Math.round(newScale * 100) / 100, true);
          }
        }
      }
    }, { passive: true });

    const endPinch = (e) => {
      if (this.isPinching && e.touches.length < 2) {
        this.isPinching = false;
        touchStartDist = 0;
      }
    };

    bodyEl.addEventListener('touchend', endPinch, { passive: true });
    bodyEl.addEventListener('touchcancel', endPinch, { passive: true });
  }
}

window.MobileHUDView = MobileHUDView;
