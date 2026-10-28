/**
 * ReaderKeyboardWheelController.js
 * Handles keyboard shortcuts, space-bar panning, and continuous wheel/trackpad pinch zoom
 * for ReaderToolbarManager.
 */
const DRAW_COLOR_PALETTE = {
  1: "#1e293b",
  2: "#2563eb",
  3: "#dc2626",
  4: "#eab308",
  5: "#16a34a",
  6: "#9333ea",
};

const DRAW_TOOL_KEYS = {
  p: "pen",
  b: "pen",
  h: "highlighter",
  s: "highlighter",
  v: "pan",
  m: "pan",
};

const DELTA_MODE_MULTIPLIER = { 1: 16, 2: 800 };
const TEXT_INPUT_SELECTOR =
  'textarea, input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]), [contenteditable]:not([contenteditable="false"])';

class ReaderKeyboardWheelController {
  static handleModifierShortcuts(toolbar, e) {
    if (e.key === "z" || e.key === "Z") {
      e.preventDefault();
      toolbar.drawing.undoLastStroke();
      return true;
    }
    const zoomActions = {
      "+": () => toolbar.nav.zoomIn(),
      "=": () => toolbar.nav.zoomIn(),
      NumpadAdd: () => toolbar.nav.zoomIn(),
      "-": () => toolbar.nav.zoomOut(),
      NumpadSubtract: () => toolbar.nav.zoomOut(),
      0: () => toolbar.nav.resetZoom(),
      Numpad0: () => toolbar.nav.resetZoom(),
    };
    const action = zoomActions[e.key] || zoomActions[e.code];
    if (!action) return false;
    e.preventDefault();
    action();
    return true;
  }

  static handleDrawModeShortcuts(toolbar, e) {
    const key = e.key;
    const lowerKey = typeof key === "string" ? key.toLowerCase() : "";
    const mappedTool = DRAW_TOOL_KEYS[lowerKey];
    if (mappedTool) {
      e.preventDefault();
      toolbar.drawing.setDrawTool(mappedTool);
      return true;
    }
    if (lowerKey === "e") {
      e.preventDefault();
      if (typeof toolbar.drawing?.toggleEraser === "function") toolbar.drawing.toggleEraser();
      else toolbar.drawing?.setDrawTool?.("eraser");
      return true;
    }
    if (DRAW_COLOR_PALETTE[key]) {
      e.preventDefault();
      toolbar.drawing.setDrawColor(DRAW_COLOR_PALETTE[key]);
      return true;
    }

    const drawKeyActions = {
      "[": () => toolbar.drawing.cycleDrawWidth(-1),
      "]": () => toolbar.drawing.cycleDrawWidth(1),
      Delete: () => toolbar.drawing.clearCurrentPageDrawings(),
      Backspace: () => toolbar.drawing.clearCurrentPageDrawings(),
      t: () => toolbar.drawing.toggleDrawingTool(),
      Escape: () => {
        const stylusModal = document.getElementById("stylus-accessibility-modal");
        if (stylusModal && stylusModal.style.display !== "none") {
          toolbar.closeStylusAccessibilityModal();
          return;
        }
        toolbar.drawing.toggleDrawMode(false);
      },
    };
    const action = drawKeyActions[key] || drawKeyActions[lowerKey];
    if (!action) return false;
    e.preventDefault();
    action();
    return true;
  }

  static handleReadingShortcuts(toolbar, e) {
    const key = e.key;
    const lowerKey = typeof key === "string" ? key.toLowerCase() : "";

    if ((lowerKey === "p" || lowerKey === "d") && toolbar.model.viewMode !== "notes" && !toolbar.model.isDrawMode) {
      e.preventDefault();
      toolbar.drawing.toggleDrawMode(true);
      return true;
    }
    if (!toolbar.model.isDrawMode && (lowerKey === "t" || lowerKey === "n")) {
      e.preventDefault();
      toolbar.toggleDrawerTab(lowerKey === "t" ? "chapters" : "notes");
      return true;
    }

    const viewActions = {
      Escape: () => toolbar.annotations.clearTextSelection(),
      w: () => toolbar.nav.fitWidth(),
      h: () => toolbar.nav.fitPage(),
    };
    const viewAction = viewActions[key] || viewActions[lowerKey];
    if (viewAction) {
      e.preventDefault();
      viewAction();
      return true;
    }

    if (toolbar.model.viewMode === "notes") return false;
    const navActions = {
      ArrowRight: () => toolbar.nav.nextPage(),
      PageDown: () => toolbar.nav.nextPage(),
      ArrowLeft: () => toolbar.nav.prevPage(),
      PageUp: () => toolbar.nav.prevPage(),
    };
    if (!navActions[key]) return false;
    navActions[key]();
    return true;
  }

  static isInteractiveTarget(target) {
    if (typeof target?.closest !== "function") return false;
    if (target.closest(TEXT_INPUT_SELECTOR)) return true;
    return Boolean(target.closest("select"));
  }

  static releaseSpacePan(toolbar) {
    if (!toolbar.model.isSpacePanActive) return;
    toolbar.model.setSpacePanActive(false);
    toolbar.viewportEl.classList.remove("pan-mode-active");
    toolbar.bodyEl.classList.remove("pan-mode-active");
  }

  static bindKeyboardShortcuts(toolbar) {
    window.addEventListener("keydown", (e) => {
      if (toolbar.container.style.display !== "flex") return;
      const isInteractive = toolbar.isInteractiveTarget(e.target);

      if (e.altKey && !e.ctrlKey && !e.metaKey && e.key === "ArrowLeft") {
        if (!isInteractive && toolbar.onReturnToPreviousReadingPoint?.()) e.preventDefault();
        return;
      }

      if (e.code === "Space" && !isInteractive && (toolbar.model.isDrawMode || toolbar.model.isSpacePanActive)) {
        e.preventDefault();
        e.target?.blur?.();
        if (!e.repeat) {
          toolbar.model.setSpacePanActive(true);
          toolbar.viewportEl.classList.add("pan-mode-active");
          toolbar.bodyEl.classList.add("pan-mode-active");
        }
        return;
      }

      if (isInteractive) return;
      const isPlainBackspace =
        !toolbar.model.isDrawMode && !e.altKey && !e.ctrlKey && !e.metaKey && e.key === "Backspace";
      if (isPlainBackspace && toolbar.onReturnToPreviousReadingPoint?.()) {
        e.preventDefault();
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        toolbar._handleModifierShortcuts(e);
        return;
      }
      if (toolbar.model.isDrawMode && toolbar._handleDrawModeShortcuts(e)) return;
      toolbar._handleReadingShortcuts(e);
    });

    window.addEventListener("keyup", (e) => {
      if (e.code === "Space") toolbar.releaseSpacePan();
    });
    window.addEventListener("blur", () => toolbar.releaseSpacePan());
  }

  static bindWheelZoom(toolbar) {
    let continuousScale = null;
    let gestureBaseScale = null;
    let pendingFocalPoint = null;
    let wheelRaf = null;
    let idleTimer = null;

    const clearIdle = typeof clearTimeout === "function" ? clearTimeout : window?.clearTimeout?.bind(window);
    const setIdle = typeof setTimeout === "function" ? setTimeout : window?.setTimeout?.bind(window);

    const commitPinch = () => {
      continuousScale = null;
      gestureBaseScale = null;
      if (toolbar.viewportEl?.style) {
        Object.assign(toolbar.viewportEl.style, { transform: "", transformOrigin: "", willChange: "" });
      }
    };

    const clampScale = (s) => Math.max(0.25, Math.min(5.0, Math.round(s * 100) / 100));

    const handleWheel = (e) => {
      if ((!e.ctrlKey && !e.metaKey) || (toolbar.container && toolbar.container.style.display !== "flex")) return;
      e.preventDefault();

      const delta = e.deltaY * (DELTA_MODE_MULTIPLIER[e.deltaMode] || 1);
      const zoomFactor = Math.exp(-delta * 0.0022314355);

      if (continuousScale === null) {
        continuousScale = toolbar.model.scale || 1.0;
        gestureBaseScale = continuousScale;
        if (toolbar.viewportEl?.style && typeof toolbar.viewportEl.getBoundingClientRect === "function") {
          const vRect = toolbar.viewportEl.getBoundingClientRect();
          toolbar.viewportEl.style.transformOrigin = `${e.clientX - vRect.left}px ${e.clientY - vRect.top}px`;
          toolbar.viewportEl.style.willChange = "transform";
        }
      }
      continuousScale = Math.max(0.25, Math.min(5.0, continuousScale * zoomFactor));
      pendingFocalPoint = { clientX: e.clientX, clientY: e.clientY };

      if (toolbar.viewportEl?.style && gestureBaseScale > 0) {
        toolbar.viewportEl.style.transform = `scale(${continuousScale / gestureBaseScale})`;
      }
      const zoomLabel = document.getElementById("reader-zoom-reset-btn");
      if (zoomLabel) zoomLabel.textContent = `${Math.round(continuousScale * 100)}%`;

      clearIdle?.(idleTimer);
      idleTimer = setIdle?.(commitPinch, 200);

      if (clampScale(continuousScale) === toolbar.model.scale && !wheelRaf) return;
      if (!wheelRaf) {
        wheelRaf = requestAnimationFrame(() => {
          wheelRaf = null;
          if (continuousScale === null) return;
          const scaleToApply = clampScale(continuousScale);
          if (scaleToApply !== toolbar.model.scale) {
            toolbar.nav.setZoom(scaleToApply, true, pendingFocalPoint);
          }
        });
      }
    };

    window.addEventListener("wheel", handleWheel, { passive: false });
  }
}

window.ReaderKeyboardWheelController = ReaderKeyboardWheelController;
