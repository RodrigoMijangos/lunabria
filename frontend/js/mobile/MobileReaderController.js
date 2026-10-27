/**
 * MobileReaderController.js
 * Master coordinator for the mobile PDF reading experience in Lunabria.
 * Adheres to MVVM: Plugs into ReaderViewModel without modifying core desktop classes.
 */
class MobileReaderController {
  constructor(readerViewModel, model) {
    this.reader = readerViewModel;
    this.model = model;
    this.device = new DeviceEnvironment();

    this.drawingFAB = null;
    this.mobileHUD = null;
    this.selectionController = null;
    this.isInitialized = false;
    this.pendingViewModeBeforeOpen = null;

    this.bindEnvironment();
  }

  bindEnvironment() {
    this.device.onChange(() => {
      this.syncMobileState();
    });
  }

  init() {
    if (this.isInitialized) return;
    this.isInitialized = true;

    if (typeof MobileDrawingToolbarView !== 'undefined') {
      this.drawingFAB = new MobileDrawingToolbarView(this.reader, this.model);
      this.drawingFAB.init();
    }

    if (typeof MobileHUDView !== 'undefined') {
      this.mobileHUD = new MobileHUDView(this.reader, this.model);
      this.mobileHUD.init();
    }

    if (typeof MobileSelectionController !== 'undefined') {
      this.selectionController = new MobileSelectionController(this.reader, this.model);
      this.selectionController.init();
    }

    this.syncMobileState();
  }

  prepareForBookOpen() {
    this.restorePendingViewMode();

    const isMobile = this.device.isMobileReaderActive();
    document.body.classList.toggle('mobile-reader-active', isMobile);
    if (!isMobile || this.model.viewMode !== 'dual-flow') return;

    this.pendingViewModeBeforeOpen = this.model.viewMode;
    this.model.setViewMode('flow', { persist: false });
    this.reader.nav.syncViewModeUI();
  }

  syncMobileState() {
    const isMobile = this.device.isMobileReaderActive();
    const isReaderOpen = !this.reader?.container || this.reader.container.style.display !== 'none';
    const shouldBeActive = isMobile && isReaderOpen;

    document.body.classList.toggle('mobile-reader-active', shouldBeActive);

    if (shouldBeActive) {
      if (this.model.viewMode === 'dual-flow') {
        this.reader.nav.setViewMode('flow');
      }
      this.drawingFAB?.render();
      this.mobileHUD?.render();
    } else {
      this.drawingFAB?.closeColorMenu();
      this.drawingFAB?.setExpanded(false);
      document.body.classList.remove('mobile-drawing-active', 'mobile-text-selecting');
    }
  }

  onBookOpened() {
    const isMobile = this.device.isMobileReaderActive();
    if (this.pendingViewModeBeforeOpen !== null) {
      if (isMobile) {
        this.model.setViewMode(this.model.viewMode);
      } else {
        this.model.setViewMode(this.pendingViewModeBeforeOpen, { persist: false });
        this.reader.nav.setViewMode(this.pendingViewModeBeforeOpen);
      }
      this.pendingViewModeBeforeOpen = null;
    }

    if (!isMobile) return;

    if (this.model.viewMode === 'dual-flow') {
      this.reader.nav.setViewMode('flow');
    }

    // Document requirement: Drawing mode activated by default, and always in move/pan mode by default
    if (!this.model.isDrawMode) {
      this.reader.drawing.toggleDrawMode(true);
    }
    this.reader.drawing.setDrawTool('pan');

    this.syncMobileState();
  }

  onBookClosed() {
    this.restorePendingViewMode();
    this.syncMobileState();
  }

  restorePendingViewMode() {
    if (this.pendingViewModeBeforeOpen === null) return;
    this.model.setViewMode(this.pendingViewModeBeforeOpen, { persist: false });
    this.reader.nav.syncViewModeUI();
    this.pendingViewModeBeforeOpen = null;
  }

  requestFullscreenIfMobile() {
    // Intentionally no-op: automatic fullscreen on mobile book selection was removed per UX requirement.
  }

  exitFullscreen() {
    if (document.fullscreenElement) {
      try {
        if (document.exitFullscreen) {
          document.exitFullscreen().catch(() => {});
        } else if (document.webkitExitFullscreen) {
          document.webkitExitFullscreen();
        }
      } catch (err) {}
    }
  }
}

window.MobileReaderController = MobileReaderController;
