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
    let liveScale = 1.0;
    let startFocal = null;
    let currentFocal = null;
    let pinchRaf = null;

    const getDistance = (touches) => {
      if (!touches || touches.length < 2) return 0;
      return Math.hypot(
        touches[0].clientX - touches[1].clientX,
        touches[0].clientY - touches[1].clientY
      );
    };

    const getFocalPoint = (touches) => {
      if (!touches || touches.length < 2) return null;
      return {
        clientX: (touches[0].clientX + touches[1].clientX) / 2,
        clientY: (touches[0].clientY + touches[1].clientY) / 2
      };
    };

    bodyEl.addEventListener('touchstart', (e) => {
      if (e.touches && e.touches.length === 2) {
        if (this.reader?.drawing && this.reader.drawing.isDrawing) {
          this.reader.drawing.isDrawing = false;
          this.reader.drawing.currentStroke = null;
          this.reader.drawing.strokePoints = [];
          const activePage = this.reader.drawing.activeDrawPage || this.model.currentPage;
          const canvas = document.querySelector(`.pdf-drawing-canvas[data-page="${activePage}"]`);
          if (canvas) this.reader.drawing.renderStrokes(canvas, activePage);
        }
        touchStartDist = getDistance(e.touches);
        baseScale = this.model.scale || 1.0;
        liveScale = baseScale;
        startFocal = getFocalPoint(e.touches);
        currentFocal = startFocal;
        this.isPinching = true;

        const viewportEl = this.reader.viewportEl || document.getElementById('pdf-viewport');
        if (viewportEl && startFocal && typeof viewportEl.getBoundingClientRect === 'function') {
          const vRect = viewportEl.getBoundingClientRect();
          const originX = startFocal.clientX - vRect.left;
          const originY = startFocal.clientY - vRect.top;
          if (viewportEl.style) {
            viewportEl.style.transformOrigin = `${originX}px ${originY}px`;
            viewportEl.style.willChange = 'transform';
            viewportEl.style.transition = 'none';
          }
        }
      }
    }, { passive: true });

    bodyEl.addEventListener('touchmove', (e) => {
      if (this.isPinching && e.touches && e.touches.length === 2) {
        if (e.cancelable) {
          e.preventDefault();
        }
        const currentDist = getDistance(e.touches);
        if (touchStartDist > 0 && currentDist > 0) {
          const ratio = currentDist / touchStartDist;
          liveScale = Math.max(0.25, Math.min(5.0, baseScale * ratio));
          currentFocal = getFocalPoint(e.touches);

          if (!pinchRaf) {
            pinchRaf = requestAnimationFrame(() => {
              pinchRaf = null;
              if (!this.isPinching) return;
              const viewportEl = this.reader.viewportEl || document.getElementById('pdf-viewport');
              if (viewportEl && viewportEl.style) {
                const liveRatio = liveScale / baseScale;
                const panX = currentFocal && startFocal ? currentFocal.clientX - startFocal.clientX : 0;
                const panY = currentFocal && startFocal ? currentFocal.clientY - startFocal.clientY : 0;
                viewportEl.style.transform = `translate3d(${panX}px, ${panY}px, 0) scale(${liveRatio})`;
              }
              const zoomLabel = document.getElementById('reader-zoom-reset-btn');
              if (zoomLabel) {
                zoomLabel.textContent = `${Math.round(liveScale * 100)}%`;
              }
            });
          }
        }
      }
    }, { passive: false });

    const endPinch = (e) => {
      if (this.isPinching && (!e.touches || e.touches.length < 2)) {
        this.isPinching = false;
        if (pinchRaf) {
          cancelAnimationFrame(pinchRaf);
          pinchRaf = null;
        }

        const finalScale = Math.max(0.25, Math.min(5.0, Math.round(liveScale * 100) / 100));
        const focal = currentFocal || startFocal;

        const viewportEl = this.reader.viewportEl || document.getElementById('pdf-viewport');
        if (viewportEl && viewportEl.style && finalScale === this.model.scale) {
          viewportEl.style.transform = '';
          viewportEl.style.transformOrigin = '';
          viewportEl.style.willChange = '';
          viewportEl.style.transition = '';
        }

        touchStartDist = 0;
        startFocal = null;
        currentFocal = null;

        if (finalScale !== this.model.scale) {
          this.reader.nav.setZoom(finalScale, true, focal);
        }
      }
    };

    bodyEl.addEventListener('touchend', endPinch, { passive: true });
    bodyEl.addEventListener('touchcancel', endPinch, { passive: true });
  }
}

window.MobileHUDView = MobileHUDView;
