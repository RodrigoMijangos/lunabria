/**
 * ReaderToolbarManager.js
 * Manages event binding for reader controls, drawing toolbar, accessibility modal,
 * and delegates export/keyboard/wheel interactions to cohesive sub-controllers.
 */
const OFFLINE_BTN_STATES = {
  complete: {
    icon: "circle-check",
    label: "Offline",
    title: "The PDF and all layouts are saved for offline reading",
  },
  layoutsOnly: {
    icon: "download",
    label: "Layouts",
    title: "The PDF is saved. Download layouts to complete offline access",
  },
  none: {
    icon: "download",
    label: "Offline",
    title: "Save the PDF and layouts in browser for offline reading",
  },
};

const DRAW_TOOL_BUTTON_IDS = [
  ["draw-tool-pen", "pen"],
  ["draw-tool-highlighter", "highlighter"],
  ["draw-tool-eraser", "eraser"],
  ["draw-tool-pan", "pan"],
];

const STYLUS_SETTING_FIELDS = [
  ["setting-palm-rejection", "palmRejection", (v) => v],
  ["setting-double-click-delay", "doubleClickDelay", (v) => Number(v)],
  ["setting-double-click-action", "doubleClickAction", (v) => v],
];

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
    this.tableOfContents = coordinators.tableOfContents;
    this.onReturnToPreviousReadingPoint = coordinators.onReturnToPreviousReadingPoint;
    this.onDismissJumpBreadcrumb = coordinators.onDismissJumpBreadcrumb;
    this.drawerToggle = document.getElementById("reader-drawer-toggle-btn");
    this.notesToggle = document.getElementById("reader-notes-toggle-btn");
    this.activeDrawerTab = "chapters";
    this.drawerReturnFocus = null;
    this.onClose = coordinators.onClose;
    this.onDownloadOffline = coordinators.onDownloadOffline;
  }

  static renderHudIconLabel(iconId, label, spin = false) {
    const spinCls = spin ? " ui-icon-spin" : "";
    return `<svg class="ui-icon${spinCls}" aria-hidden="true" focusable="false"><use href="./icons.svg#${iconId}"></use></svg><span class="hud-btn-label"> ${label}</span>`;
  }

  bindAllEvents() {
    this.bindReaderHeaderEvents();
    this.bindDrawingToolbarEvents();
    this.bindKeyboardShortcuts();
    this.bindJumpBreadcrumbEvents();
    this.bindDrawerEvents();
    this.bindWheelZoom();
  }

  bindJumpBreadcrumbEvents() {
    document.getElementById("reader-jump-return-btn")?.addEventListener("click", () => {
      this.onReturnToPreviousReadingPoint?.();
    });
    document.getElementById("reader-jump-dismiss-btn")?.addEventListener("click", () => {
      this.onDismissJumpBreadcrumb?.();
    });
  }

  bindReaderHeaderEvents() {
    const byId = (id) => document.getElementById(id);
    byId("reader-back-btn")?.addEventListener("click", () => this.onClose?.());
    byId("reader-top-bar")?.addEventListener("click", (e) => {
      e.target?.closest?.("button")?.blur?.();
    });
    byId("view-mode-select")?.addEventListener("change", (e) => this.nav.setViewMode(e.target.value));

    const clickBindings = [
      ["reader-prev-btn", () => this.nav.prevPage()],
      ["reader-next-btn", () => this.nav.nextPage()],
      ["reader-zoom-in-btn", () => this.nav.zoomIn()],
      ["reader-zoom-out-btn", () => this.nav.zoomOut()],
      ["reader-zoom-reset-btn", () => this.nav.resetZoom()],
      ["reader-fit-width-btn", () => this.nav.fitWidth()],
      ["reader-fit-page-btn", () => this.nav.fitPage()],
      ["reader-offline-btn", () => this.downloadBookForOfflineUse()],
    ];
    for (const [id, handler] of clickBindings) {
      byId(id)?.addEventListener("click", handler);
    }

    const pageInput = byId("reader-page-input");
    pageInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.nav.handlePageInputSubmit();
      }
    });
    pageInput?.addEventListener("blur", () => this.nav.handlePageInputSubmit());
    byId("reader-scrubber")?.addEventListener("input", (e) => this.nav.goToPage(Number(e.target.value)));

    byId("reader-fullscreen-btn")?.addEventListener("click", () => {
      const action = document.fullscreenElement
        ? document.exitFullscreen()
        : document.documentElement.requestFullscreen();
      action.catch(() => {});
    });

    this.drawerToggle?.addEventListener("click", () => this.toggleDrawerTab("chapters"));
    this.notesToggle?.addEventListener("click", () => this.toggleDrawerTab("notes"));
  }

  setOfflineStatus({ pdfCached = false, layoutsCached = false } = {}) {
    const button = document.getElementById("reader-offline-btn");
    if (!button) return;
    const isComplete = Boolean(pdfCached && layoutsCached);
    button.dataset.cached = String(isComplete);
    button.dataset.pdfCached = String(Boolean(pdfCached));
    button.disabled = false;

    const stateKey = isComplete ? "complete" : pdfCached ? "layoutsOnly" : "none";
    const meta = OFFLINE_BTN_STATES[stateKey];
    button.innerHTML = ReaderToolbarManager.renderHudIconLabel(meta.icon, meta.label);
    button.title = meta.title;
  }

  async downloadBookForOfflineUse() {
    const button = document.getElementById("reader-offline-btn");
    if (!button || button.disabled || button.dataset.cached === "true" || !this.onDownloadOffline) return;

    const requestedBookId = this.model.bookId;
    button.disabled = true;
    button.innerHTML = ReaderToolbarManager.renderHudIconLabel("loader", "Saving", true);
    try {
      await this.onDownloadOffline((progress) => {
        if (this.model.bookId !== requestedBookId) return;
        const stageLabels = {
          pdf: "Downloading PDF",
          "pdf-complete": "Preparing layouts",
          layouts: `Layouts ${progress.completed}/${progress.total}`,
        };
        if (progress.stage === "pdf-complete") button.dataset.pdfCached = "true";
        const label = stageLabels[progress.stage];
        if (label) button.innerHTML = ReaderToolbarManager.renderHudIconLabel("loader", label, true);
      });
      if (this.model.bookId === requestedBookId) {
        this.setOfflineStatus({ pdfCached: true, layoutsCached: true });
      }
    } catch (error) {
      console.error("[ReaderToolbarManager] Incomplete offline download:", error);
      if (this.model.bookId === requestedBookId) {
        const retryLabel = button.dataset.pdfCached === "true" ? "Retry layouts" : "Retry";
        button.innerHTML = ReaderToolbarManager.renderHudIconLabel("warning", retryLabel);
        button.title = error.message || "Could not complete offline download";
      }
    } finally {
      button.disabled = false;
    }
  }

  getDrawerTabs() {
    return [
      {
        name: "chapters",
        button: document.getElementById("drawer-tab-chapters"),
        panel: document.getElementById("table-of-contents-panel"),
      },
      {
        name: "notes",
        button: document.getElementById("drawer-tab-notes"),
        panel: document.getElementById("drawer-notes-panel"),
      },
    ];
  }

  bindDrawerEvents() {
    const tabs = this.getDrawerTabs();
    tabs.forEach((tab, index) => {
      tab.button?.addEventListener("click", () => this.activateDrawerTab(tab.name));
      tab.button?.addEventListener("keydown", (event) => {
        const nextIndexMap = {
          ArrowRight: (index + 1) % tabs.length,
          ArrowLeft: (index - 1 + tabs.length) % tabs.length,
          Home: 0,
          End: tabs.length - 1,
        };
        const nextIndex = nextIndexMap[event.key];
        if (nextIndex === undefined) return;
        event.preventDefault();
        this.activateDrawerTab(tabs[nextIndex].name, true);
      });
    });
    this.activateDrawerTab(this.activeDrawerTab);
    this.drawer?.addEventListener("keydown", (event) => this.handleDrawerKeydown(event));
    this.drawerBackdrop?.addEventListener("click", () => this.toggleDrawer(false));
    document.getElementById("drawer-close-btn")?.addEventListener("click", () => this.toggleDrawer(false));
    document.getElementById("drawer-view-mode-btn")?.addEventListener("click", () => {
      this.toggleDrawer(false);
      this.nav.setViewMode("notes");
    });
    this.bindExportControls();
  }

  activateDrawerTab(name, focus = false) {
    const tabs = this.getDrawerTabs();
    const activeTab = tabs.find((tab) => tab.name === name);
    if (!activeTab) return;

    this.activeDrawerTab = name;
    for (const tab of tabs) {
      const isActive = tab === activeTab;
      if (tab.button) {
        tab.button.classList.toggle("active", isActive);
        tab.button.setAttribute("aria-selected", String(isActive));
        tab.button.tabIndex = isActive ? 0 : -1;
      }
      if (tab.panel) tab.panel.hidden = !isActive;
    }
    if (name === "chapters") this.tableOfContents?.render(this.model.currentPage);
    if (focus) activeTab.button?.focus?.();
  }

  handleDrawerKeydown(event) {
    if (!this.drawer?.classList.contains("open")) return;
    if (event.key === "Escape") {
      event.preventDefault();
      this.toggleDrawer(false);
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = Array.from(
      this.drawer.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => !element.closest?.("[hidden]") && !element.disabled);
    if (!focusable.length) {
      event.preventDefault();
      this.drawer.focus?.();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    const isInside = this.drawer.contains?.(active);
    if (event.shiftKey && (active === first || !isInside)) {
      event.preventDefault();
      last.focus?.();
    } else if (!event.shiftKey && (active === last || !isInside)) {
      event.preventDefault();
      first.focus?.();
    }
  }

  toggleDrawerTab(tabName) {
    if (!this.drawer) return;
    if (!this.drawer.classList.contains("open")) {
      this.activeDrawerTab = tabName;
      this.toggleDrawer(true);
    } else if (this.activeDrawerTab === tabName) {
      this.toggleDrawer(false);
    } else {
      this.activateDrawerTab(tabName, true);
    }
  }

  toggleDrawer(forceState = null) {
    if (!this.drawer) return;
    const wasOpen = this.drawer.classList.contains("open");
    const isOpen = forceState !== null ? Boolean(forceState) : !wasOpen;
    if (wasOpen === isOpen) return;

    if (isOpen) this.drawerReturnFocus = document.activeElement || this.drawerToggle;
    this.drawer.classList.toggle("open", isOpen);
    this.drawer.inert = !isOpen;
    this.drawer.setAttribute("aria-hidden", String(!isOpen));
    this.drawerToggle?.setAttribute("aria-expanded", String(isOpen));
    this.notesToggle?.setAttribute("aria-expanded", String(isOpen));
    this.drawerBackdrop?.classList.toggle("open", isOpen);
    if (isOpen) {
      this.activateDrawerTab(this.activeDrawerTab);
      document.getElementById("drawer-close-btn")?.focus?.();
    } else {
      const returnFocus = this.drawerReturnFocus || this.drawerToggle;
      this.drawerReturnFocus = null;
      returnFocus?.focus?.();
    }
  }

  bindDrawingToolbarEvents() {
    const byId = (id) => document.getElementById(id);
    byId("drawing-toolbar")?.addEventListener("click", (e) => e.target?.closest?.("button")?.blur?.());
    byId("reader-draw-toggle-btn")?.addEventListener("click", () => this.drawing.toggleDrawMode());
    byId("floating-draw-btn")?.addEventListener("click", () => this.drawing.toggleDrawMode(true));

    for (const [id, tool] of DRAW_TOOL_BUTTON_IDS) {
      byId(id)?.addEventListener("click", () => this.drawing.setDrawTool(tool));
    }
    document.querySelectorAll(".drawing-color-dot").forEach((dot) => {
      dot.onclick = () => this.drawing.setDrawColor(dot.dataset.color);
    });
    document.querySelectorAll(".drawing-width-btn").forEach((btn) => {
      btn.onclick = () => this.drawing.setDrawWidth(Number(btn.dataset.width));
    });

    const actionBindings = [
      ["draw-action-toggle-tool", () => this.drawing.toggleDrawingTool()],
      ["draw-action-settings", () => this.openStylusAccessibilityModal()],
      ["stylus-modal-close-x", () => this.closeStylusAccessibilityModal()],
      ["stylus-modal-close-btn", () => this.closeStylusAccessibilityModal()],
      ["draw-action-undo", () => this.drawing.undoLastStroke()],
      ["draw-action-clear", () => this.drawing.clearCurrentPageDrawings()],
      ["draw-action-close", () => this.drawing.toggleDrawMode(false)],
    ];
    for (const [id, fn] of actionBindings) {
      byId(id)?.addEventListener("click", fn);
    }

    const stylusModal = byId("stylus-accessibility-modal");
    stylusModal?.addEventListener("pointerdown", (e) => {
      if (e.target === stylusModal) this.closeStylusAccessibilityModal();
    });

    for (const [id, settingKey, coerce] of STYLUS_SETTING_FIELDS) {
      byId(id)?.addEventListener("change", (e) => {
        this.model.setAccessibilitySetting(settingKey, coerce(e.target.value));
      });
    }
    byId("setting-pressure-curve")?.addEventListener("change", (e) => {
      this.model.setAccessibilitySetting("pressureSensitivity", e.target.value);
      this.drawing.reRenderAllCanvasStrokes();
    });

    this.bindDraggableToolbar(byId("drawing-toolbar"));
  }

  bindDraggableToolbar(toolbar) {
    const handle = toolbar?.querySelector(".drawing-drag-handle");
    if (!toolbar || !handle) return;
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let initialLeft = 0;
    let initialTop = 0;

    handle.onpointerdown = (e) => {
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = toolbar.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;
      Object.assign(toolbar.style, {
        left: `${initialLeft}px`,
        top: `${initialTop}px`,
        transform: "none",
      });
      handle.setPointerCapture(e.pointerId);
    };

    handle.onpointermove = (e) => {
      if (!isDragging) return;
      const maxLeft = Math.max(0, window.innerWidth - toolbar.offsetWidth);
      const maxTop = Math.max(0, window.innerHeight - toolbar.offsetHeight);
      toolbar.style.left = `${Math.max(0, Math.min(maxLeft, initialLeft + (e.clientX - startX)))}px`;
      toolbar.style.top = `${Math.max(0, Math.min(maxTop, initialTop + (e.clientY - startY)))}px`;
    };

    handle.onpointerup = (e) => {
      isDragging = false;
      try {
        handle.releasePointerCapture(e.pointerId);
      } catch {}
    };
  }

  openStylusAccessibilityModal() {
    const modal = document.getElementById("stylus-accessibility-modal");
    if (!modal) return;
    const fields = [
      ["setting-palm-rejection", "palmRejection"],
      ["setting-double-click-delay", "doubleClickDelay"],
      ["setting-double-click-action", "doubleClickAction"],
      ["setting-pressure-curve", "pressureSensitivity"],
    ];
    for (const [id, key] of fields) {
      const el = document.getElementById(id);
      if (el) el.value = String(this.model.getAccessibilitySetting(key));
    }
    modal.style.display = "flex";
  }

  closeStylusAccessibilityModal() {
    const modal = document.getElementById("stylus-accessibility-modal");
    if (modal) modal.style.display = "none";
  }

  // Export & Keyboard/Wheel delegations
  bindExportControls() {
    return ReaderExportController.bindExportControls(this);
  }
  updateExportScopeFields() {
    return ReaderExportController.updateExportScopeFields(this);
  }
  updateExportSelectionCount() {
    return ReaderExportController.updateExportSelectionCount(this);
  }
  updateExportButtonState() {
    return ReaderExportController.updateExportButtonState(this);
  }
  setExportStatus(message) {
    if (this.exportStatus) this.exportStatus.textContent = message;
  }
  toggleExportSectionMenu(open) {
    return ReaderExportSectionPicker.toggleExportSectionMenu(this, open);
  }
  loadExportSections() {
    return ReaderExportSectionPicker.loadExportSections(this);
  }
  updateExportSectionBadge() {
    return ReaderExportSectionPicker.updateExportSectionBadge(this);
  }
  _resolveExportFormatAndGrouping(fmt) {
    return ReaderExportController.resolveExportFormatAndGrouping(fmt);
  }
  _populateExportScopeOptions(opts) {
    return ReaderExportController.populateExportScopeOptions(this, opts);
  }
  buildExportOptions() {
    return ReaderExportController.buildExportOptions(this);
  }
  ensureAnnotationsSynchronized() {
    return ReaderExportController.ensureAnnotationsSynchronized(this);
  }
  downloadExport(result) {
    return ReaderExportController.downloadExport(result);
  }
  exportAnnotations() {
    return ReaderExportController.exportAnnotations(this);
  }
  _handleModifierShortcuts(e) {
    return ReaderKeyboardWheelController.handleModifierShortcuts(this, e);
  }
  _handleDrawModeShortcuts(e) {
    return ReaderKeyboardWheelController.handleDrawModeShortcuts(this, e);
  }
  _handleReadingShortcuts(e) {
    return ReaderKeyboardWheelController.handleReadingShortcuts(this, e);
  }
  bindKeyboardShortcuts() {
    return ReaderKeyboardWheelController.bindKeyboardShortcuts(this);
  }
  isInteractiveTarget(target) {
    return ReaderKeyboardWheelController.isInteractiveTarget(target);
  }
  releaseSpacePan() {
    return ReaderKeyboardWheelController.releaseSpacePan(this);
  }
  bindWheelZoom() {
    return ReaderKeyboardWheelController.bindWheelZoom(this);
  }
}

window.ReaderToolbarManager = ReaderToolbarManager;
