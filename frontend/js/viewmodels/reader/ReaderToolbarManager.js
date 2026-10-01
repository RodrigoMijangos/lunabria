/**
 * ReaderToolbarManager.js
 * Manages event binding for reader controls, drawing toolbar, accessibility modal, and keyboard shortcuts.
 */
class ReaderToolbarManager {
  constructor(model, elements, coordinators) {
    this.model = model;
    this.container = elements.container;
    this.viewportEl = elements.viewportEl;
    this.bodyEl = elements.bodyEl;
    this.drawer = elements.drawer;
    this.drawerBackdrop = elements.drawerBackdrop;

    this.nav = coordinators.nav;
    this.drawing = coordinators.drawing;
    this.annotations = coordinators.annotations;
    this.notes = coordinators.notes;
    this.onClose = coordinators.onClose;
    this.onDownloadOffline = coordinators.onDownloadOffline;
  }

  bindAllEvents() {
    this.bindReaderHeaderEvents();
    this.bindDrawingToolbarEvents();
    this.bindKeyboardShortcuts();
    this.bindDrawerEvents();
  }

  bindReaderHeaderEvents() {
    // Back to library
    document.getElementById('reader-back-btn')?.addEventListener('click', () => {
      if (this.onClose) this.onClose();
    });

    // View Mode Dropdown
    document.getElementById('view-mode-select')?.addEventListener('change', (e) => {
      this.nav.setViewMode(e.target.value);
    });

    // Navigation buttons
    document.getElementById('reader-prev-btn')?.addEventListener('click', () => this.nav.prevPage());
    document.getElementById('reader-next-btn')?.addEventListener('click', () => this.nav.nextPage());

    // Page input
    const pageInput = document.getElementById('reader-page-input');
    if (pageInput) {
      pageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.nav.handlePageInputSubmit();
        }
      });
      pageInput.addEventListener('blur', () => this.nav.handlePageInputSubmit());
    }

    // Scrubber
    const scrubber = document.getElementById('reader-scrubber');
    if (scrubber) {
      scrubber.addEventListener('input', (e) => {
        this.nav.goToPage(Number(e.target.value));
      });
    }

    // Zoom buttons
    document.getElementById('reader-zoom-in-btn')?.addEventListener('click', () => this.nav.zoomIn());
    document.getElementById('reader-zoom-out-btn')?.addEventListener('click', () => this.nav.zoomOut());
    document.getElementById('reader-zoom-reset-btn')?.addEventListener('click', () => this.nav.resetZoom());

    // Fullscreen toggle
    document.getElementById('reader-fullscreen-btn')?.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    });

    // Drawer toggle
    document.getElementById('reader-drawer-toggle-btn')?.addEventListener('click', () => {
      this.toggleDrawer();
    });

    document.getElementById('reader-offline-btn')?.addEventListener('click', () => {
      this.downloadBookForOfflineUse();
    });
  }

  setOfflineStatus({ pdfCached = false, layoutsCached = false } = {}) {
    const button = document.getElementById('reader-offline-btn');
    if (!button) return;
    const isComplete = Boolean(pdfCached && layoutsCached);
    button.dataset.cached = String(isComplete);
    button.dataset.pdfCached = String(Boolean(pdfCached));
    button.disabled = false;

    if (isComplete) {
      button.textContent = '✓ Offline';
      button.title = 'The PDF and all layouts are saved for offline reading';
    } else if (pdfCached) {
      button.textContent = '📥 Layouts';
      button.title = 'The PDF is saved. Download layouts to complete offline access';
    } else {
      button.textContent = '📥 Offline';
      button.title = 'Save the PDF and layouts in browser for offline reading';
    }
  }

  async downloadBookForOfflineUse() {
    const button = document.getElementById('reader-offline-btn');
    if (!button || button.disabled || button.dataset.cached === 'true' || !this.onDownloadOffline) return;

    const requestedBookId = this.model.bookId;
    button.disabled = true;
    button.textContent = '⏳ Saving';
    try {
      await this.onDownloadOffline((progress) => {
        if (this.model.bookId !== requestedBookId) return;
        if (progress.stage === 'pdf') {
          button.textContent = '⏳ Downloading PDF';
        } else if (progress.stage === 'pdf-complete') {
          button.dataset.pdfCached = 'true';
          button.textContent = '⏳ Preparing layouts';
        } else if (progress.stage === 'layouts') {
          button.textContent = `⏳ Layouts ${progress.completed}/${progress.total}`;
        }
      });
      if (this.model.bookId === requestedBookId) {
        this.setOfflineStatus({ pdfCached: true, layoutsCached: true });
      }
    } catch (error) {
      console.error('[ReaderToolbarManager] Incomplete offline download:', error);
      if (this.model.bookId === requestedBookId) {
        button.textContent = button.dataset.pdfCached === 'true' ? '⚠️ Retry layouts' : '⚠️ Retry';
        button.title = error.message || 'Could not complete offline download';
      }
    } finally {
      button.disabled = false;
    }
  }

  bindDrawerEvents() {
    this.drawerBackdrop?.addEventListener('click', () => this.toggleDrawer(false));
    document.getElementById('drawer-close-btn')?.addEventListener('click', () => this.toggleDrawer(false));
    document.getElementById('drawer-view-mode-btn')?.addEventListener('click', () => {
      this.toggleDrawer(false);
      this.nav.setViewMode('notes');
    });
    document.getElementById('export-notes-btn')?.addEventListener('click', () => {
      window.location.href = `/api/books/${this.model.bookId}/export`;
    });
  }

  toggleDrawer(forceState = null) {
    if (!this.drawer) return;
    const isOpen = forceState !== null ? Boolean(forceState) : !this.drawer.classList.contains('open');
    this.drawer.classList.toggle('open', isOpen);
    if (this.drawerBackdrop) this.drawerBackdrop.classList.toggle('open', isOpen);
  }

  bindDrawingToolbarEvents() {
    document.getElementById('reader-draw-toggle-btn')?.addEventListener('click', () => this.drawing.toggleDrawMode());
    document.getElementById('floating-draw-btn')?.addEventListener('click', () => this.drawing.toggleDrawMode(true));

    document.getElementById('draw-tool-pen')?.addEventListener('click', () => this.drawing.setDrawTool('pen'));
    document.getElementById('draw-tool-highlighter')?.addEventListener('click', () => this.drawing.setDrawTool('highlighter'));
    document.getElementById('draw-tool-eraser')?.addEventListener('click', () => this.drawing.setDrawTool('eraser'));
    document.getElementById('draw-tool-pan')?.addEventListener('click', () => this.drawing.setDrawTool('pan'));

    document.querySelectorAll('.drawing-color-dot').forEach(dot => {
      dot.onclick = () => this.drawing.setDrawColor(dot.dataset.color);
    });

    document.querySelectorAll('.drawing-width-btn').forEach(btn => {
      btn.onclick = () => this.drawing.setDrawWidth(Number(btn.dataset.width));
    });

    document.getElementById('draw-action-toggle-tool')?.addEventListener('click', () => this.drawing.toggleDrawingTool());
    document.getElementById('draw-action-settings')?.addEventListener('click', () => this.openStylusAccessibilityModal());

    document.getElementById('stylus-modal-close-x')?.addEventListener('click', () => this.closeStylusAccessibilityModal());
    document.getElementById('stylus-modal-close-btn')?.addEventListener('click', () => this.closeStylusAccessibilityModal());

    const stylusModal = document.getElementById('stylus-accessibility-modal');
    stylusModal?.addEventListener('pointerdown', (e) => {
      if (e.target === stylusModal) this.closeStylusAccessibilityModal();
    });

    document.getElementById('setting-palm-rejection')?.addEventListener('change', (e) => {
      this.model.setAccessibilitySetting('palmRejection', e.target.value);
    });

    document.getElementById('setting-double-click-delay')?.addEventListener('change', (e) => {
      this.model.setAccessibilitySetting('doubleClickDelay', Number(e.target.value));
    });

    document.getElementById('setting-double-click-action')?.addEventListener('change', (e) => {
      this.model.setAccessibilitySetting('doubleClickAction', e.target.value);
    });

    document.getElementById('setting-pressure-curve')?.addEventListener('change', (e) => {
      this.model.setAccessibilitySetting('pressureSensitivity', e.target.value);
      this.drawing.reRenderAllCanvasStrokes();
    });

    document.getElementById('draw-action-undo')?.addEventListener('click', () => this.drawing.undoLastStroke());
    document.getElementById('draw-action-clear')?.addEventListener('click', () => this.drawing.clearCurrentPageDrawings());
    document.getElementById('draw-action-close')?.addEventListener('click', () => this.drawing.toggleDrawMode(false));

    // Draggable toolbar
    const toolbar = document.getElementById('drawing-toolbar');
    const handle = toolbar?.querySelector('.drawing-drag-handle');
    if (toolbar && handle) {
      let isDragging = false;
      let startX = 0, startY = 0, initialLeft = 0, initialTop = 0;

      handle.onpointerdown = (e) => {
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        const rect = toolbar.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;
        toolbar.style.left = `${initialLeft}px`;
        toolbar.style.top = `${initialTop}px`;
        toolbar.style.transform = 'none';
        handle.setPointerCapture(e.pointerId);
      };

      handle.onpointermove = (e) => {
        if (!isDragging) return;
        const maxLeft = Math.max(0, window.innerWidth - toolbar.offsetWidth);
        const maxTop = Math.max(0, window.innerHeight - toolbar.offsetHeight);
        const left = Math.max(0, Math.min(maxLeft, initialLeft + (e.clientX - startX)));
        const top = Math.max(0, Math.min(maxTop, initialTop + (e.clientY - startY)));
        toolbar.style.left = `${left}px`;
        toolbar.style.top = `${top}px`;
      };

      handle.onpointerup = (e) => {
        isDragging = false;
        try { handle.releasePointerCapture(e.pointerId); } catch(err) {}
      };
    }
  }

  openStylusAccessibilityModal() {
    const modal = document.getElementById('stylus-accessibility-modal');
    if (!modal) return;

    const palmSelect = document.getElementById('setting-palm-rejection');
    if (palmSelect) palmSelect.value = this.model.getAccessibilitySetting('palmRejection');

    const delaySelect = document.getElementById('setting-double-click-delay');
    if (delaySelect) delaySelect.value = String(this.model.getAccessibilitySetting('doubleClickDelay'));

    const actionSelect = document.getElementById('setting-double-click-action');
    if (actionSelect) actionSelect.value = this.model.getAccessibilitySetting('doubleClickAction');

    const pressureSelect = document.getElementById('setting-pressure-curve');
    if (pressureSelect) pressureSelect.value = this.model.getAccessibilitySetting('pressureSensitivity');

    modal.style.display = 'flex';
  }

  closeStylusAccessibilityModal() {
    const modal = document.getElementById('stylus-accessibility-modal');
    if (modal) modal.style.display = 'none';
  }

  bindKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      if (this.container.style.display !== 'flex') return;
      const isInteractiveTarget = this.isInteractiveTarget(e.target);
      const isDrawingToolbarTarget = e.target instanceof Element && Boolean(e.target.closest('#drawing-toolbar'));

      if (e.code === 'Space' && !e.repeat && this.model.isDrawMode &&
          (!isInteractiveTarget || isDrawingToolbarTarget)) {
        e.preventDefault();
        this.model.setSpacePanActive(true);
        this.viewportEl.classList.add('pan-mode-active');
        return;
      }

      if (isInteractiveTarget) return;

      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z' || e.key === 'Z') {
          e.preventDefault();
          this.drawing.undoLastStroke();
          return;
        }
        if (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd') {
          e.preventDefault();
          this.nav.zoomIn();
        } else if (e.key === '-' || e.code === 'NumpadSubtract') {
          e.preventDefault();
          this.nav.zoomOut();
        } else if (e.key === '0' || e.code === 'Numpad0') {
          e.preventDefault();
          this.nav.resetZoom();
        }
      } else {
        if (e.key === 'p' || e.key === 'P' || e.key === 'd' || e.key === 'D') {
          if (this.model.viewMode !== 'notes' && !this.model.isDrawMode) {
            e.preventDefault();
            this.drawing.toggleDrawMode(true);
            return;
          }
        }

        if (this.model.isDrawMode) {
          if (e.key === 'p' || e.key === 'P' || e.key === 'b' || e.key === 'B') {
            e.preventDefault();
            this.drawing.setDrawTool('pen');
            return;
          } else if (e.key === 'h' || e.key === 'H' || e.key === 's' || e.key === 'S') {
            e.preventDefault();
            this.drawing.setDrawTool('highlighter');
            return;
          } else if (e.key === 'e' || e.key === 'E') {
            e.preventDefault();
            this.drawing.setDrawTool('eraser');
            return;
          } else if (e.key === 'v' || e.key === 'V' || e.key === 'm' || e.key === 'M') {
            e.preventDefault();
            this.drawing.setDrawTool('pan');
            return;
          } else if (e.key === '1') {
            e.preventDefault();
            this.drawing.setDrawColor('#1e293b');
            return;
          } else if (e.key === '2') {
            e.preventDefault();
            this.drawing.setDrawColor('#2563eb');
            return;
          } else if (e.key === '3') {
            e.preventDefault();
            this.drawing.setDrawColor('#dc2626');
            return;
          } else if (e.key === '4') {
            e.preventDefault();
            this.drawing.setDrawColor('#eab308');
            return;
          } else if (e.key === '5') {
            e.preventDefault();
            this.drawing.setDrawColor('#16a34a');
            return;
          } else if (e.key === '6') {
            e.preventDefault();
            this.drawing.setDrawColor('#9333ea');
            return;
          } else if (e.key === '[') {
            e.preventDefault();
            this.drawing.cycleDrawWidth(-1);
            return;
          } else if (e.key === ']') {
            e.preventDefault();
            this.drawing.cycleDrawWidth(1);
            return;
          } else if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            this.drawing.clearCurrentPageDrawings();
            return;
          } else if (e.key === 't' || e.key === 'T') {
            e.preventDefault();
            this.drawing.toggleDrawingTool();
            return;
          } else if (e.key === 'Escape') {
            e.preventDefault();
            const stylusModal = document.getElementById('stylus-accessibility-modal');
            if (stylusModal && stylusModal.style.display !== 'none') {
              this.closeStylusAccessibilityModal();
              return;
            }
            this.drawing.toggleDrawMode(false);
            return;
          }
        }

        if (e.key === 'Escape') {
          e.preventDefault();
          this.annotations.clearTextSelection();
          return;
        }

        if (this.model.viewMode === 'notes') return;
        if (e.key === 'ArrowRight' || e.key === 'PageDown') {
          this.nav.nextPage();
        } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
          this.nav.prevPage();
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') this.releaseSpacePan();
    });
    window.addEventListener('blur', () => this.releaseSpacePan());
  }

  isInteractiveTarget(target) {
    return target instanceof Element && Boolean(target.closest(
      'input, textarea, select, button, a, [contenteditable]:not([contenteditable="false"]), [role="button"]'
    ));
  }

  releaseSpacePan() {
    if (!this.model.isSpacePanActive) return;
    this.model.setSpacePanActive(false);
    this.viewportEl.classList.remove('pan-mode-active');
  }
}

window.ReaderToolbarManager = ReaderToolbarManager;
