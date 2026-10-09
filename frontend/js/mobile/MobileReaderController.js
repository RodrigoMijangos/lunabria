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

  syncMobileState() {
    const isMobile = this.device.isMobileReaderActive();
    const isReaderOpen = !this.reader?.container || this.reader.container.style.display !== 'none';
    const shouldBeActive = isMobile && isReaderOpen;

    document.body.classList.toggle('mobile-reader-active', shouldBeActive);

    if (shouldBeActive) {
      this.drawingFAB?.render();
      this.mobileHUD?.render();
    } else {
      this.drawingFAB?.closeColorMenu();
      this.drawingFAB?.setExpanded(false);
      document.body.classList.remove('mobile-drawing-active', 'mobile-text-selecting');
    }
  }

  onBookOpened() {
    if (!this.device.isMobileReaderActive()) return;

    // Document requirement: Drawing mode activated by default, and always in move/pan mode by default
    if (!this.model.isDrawMode) {
      this.reader.drawing.toggleDrawMode(true);
    }
    this.reader.drawing.setDrawTool('pan');

    this.syncMobileState();
  }

  onBookClosed() {
    this.syncMobileState();
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
