/**
 * ReaderExportController.js
 * Manages annotation export scope options, synchronization checks, and file downloads.
 */
const EXPORT_FORMAT_MAP = {
  md_hierarchy: { format: "md", group_by: "hierarchy" },
  md_color: { format: "md", group_by: "color" },
};

const EXPORT_SCOPE_FIELD_IDS = {
  section: "export-section-field",
  page: "export-page-field",
  range: "export-range-field",
  selected: "export-selection-field",
};

class ReaderExportController {
  static setProp(target, key, value) {
    if (target) target[key] = value;
  }

  static initPageBoundInput(inputEl, currentPage, maxAttr) {
    if (!inputEl) return;
    inputEl.max = maxAttr;
    if (!inputEl.value) inputEl.value = String(currentPage);
  }

  static bindExportControls(toolbar) {
    const byId = (id) => document.getElementById(id);
    const exportBtn = byId("export-notes-btn");
    toolbar.exportFormatSelect = byId("export-format-select");
    toolbar.exportScopeSelect = byId("export-scope-select");
    toolbar.exportSectionSelect = byId("export-section-select");
    toolbar.exportPageInput = byId("export-page-input");
    toolbar.exportStartPageInput = byId("export-start-page-input");
    toolbar.exportEndPageInput = byId("export-end-page-input");
    toolbar.exportStatus = byId("export-status");
    toolbar.exportSelectionCount = byId("export-selection-count");
    toolbar.exportSectionTrigger = byId("export-section-trigger");
    toolbar.exportSectionMenu = byId("export-section-menu");
    toolbar.exportSectionPicker = byId("export-section-picker");
    toolbar.exportBusy = false;
    toolbar.exportSectionsBookId = null;

    toolbar.exportSectionTrigger?.addEventListener("click", (e) => {
      e.stopPropagation();
      const isExpanded = toolbar.exportSectionTrigger.getAttribute("aria-expanded") === "true";
      toolbar.toggleExportSectionMenu(!isExpanded);
    });

    if (typeof document?.addEventListener === "function") {
      document.addEventListener("click", (e) => {
        if (!toolbar.exportSectionPicker?.contains(e.target)) toolbar.toggleExportSectionMenu(false);
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && toolbar.exportSectionPicker?.classList?.contains("is-open")) {
          toolbar.toggleExportSectionMenu(false);
          toolbar.exportSectionTrigger?.focus();
        }
      });
    }

    byId("export-clear-selection-btn")?.addEventListener("click", () => {
      toolbar.model.clearAnnotationExportSelection?.();
      toolbar.drawer?.querySelectorAll(".annotation-export-checkbox").forEach((checkbox) => {
        checkbox.checked = false;
      });
      toolbar.updateExportSelectionCount();
    });

    byId("annotations-list")?.addEventListener("change", (event) => {
      const checkbox = event.target;
      if (!checkbox?.classList?.contains("annotation-export-checkbox")) return;
      const annotationId = checkbox.dataset.annotationId;
      if (!annotationId || !toolbar.model.setAnnotationExportSelected?.(annotationId, checkbox.checked)) return;
      toolbar.updateExportSelectionCount();
    });

    toolbar.exportScopeSelect?.addEventListener("change", () => {
      toolbar.setExportStatus("");
      toolbar.updateExportScopeFields();
      if (toolbar.exportScopeSelect.value === "section") toolbar.loadExportSections();
    });

    const onFieldChange = (input) => () => {
      toolbar.updateExportButtonState();
      if (input === toolbar.exportSectionSelect) toolbar.updateExportSectionBadge();
    };
    for (const input of [
      toolbar.exportSectionSelect,
      toolbar.exportPageInput,
      toolbar.exportStartPageInput,
      toolbar.exportEndPageInput,
    ]) {
      input?.addEventListener("input", onFieldChange(input));
      input?.addEventListener("change", onFieldChange(input));
    }

    const offlineStatusMsg = "Export requires a connection to the Lunabria server.";
    const updateExportServerState = () => {
      const isUnavailable = window.serverConnectivity?.state === "unavailable";
      this.setProp(
        exportBtn,
        "title",
        isUnavailable ? "Export is unavailable because the Lunabria server cannot be reached" : "Export annotations",
      );
      this.setProp(
        toolbar.exportFormatSelect,
        "title",
        isUnavailable ? "The Lunabria server cannot be reached" : "Select export format",
      );
      if (isUnavailable && !toolbar.exportBusy) {
        toolbar.setExportStatus(offlineStatusMsg);
      } else if (toolbar.exportStatus?.textContent === offlineStatusMsg) {
        toolbar.setExportStatus("");
      }
      toolbar.updateExportButtonState();
    };

    window.addEventListener("lunabria:server-connectivity-change", updateExportServerState);
    updateExportServerState();

    exportBtn?.addEventListener("click", () => toolbar.exportAnnotations());
    toolbar.updateExportScopeFields();
    toolbar.updateExportSelectionCount();
  }

  static updateExportScopeFields(toolbar) {
    const scope = toolbar.exportScopeSelect?.value || "all";
    for (const [name, id] of Object.entries(EXPORT_SCOPE_FIELD_IDS)) {
      this.setProp(document.getElementById(id), "hidden", scope !== name);
    }
    if (scope !== "section") {
      this.setProp(document.getElementById("export-section-badge"), "hidden", true);
    } else {
      toolbar.updateExportSectionBadge();
    }

    const currentPage = Number(toolbar.model.currentPage) || 1;
    const totalPages = Number(toolbar.model.totalPages);
    const maxAttr = totalPages > 0 ? String(totalPages) : "";
    this.initPageBoundInput(toolbar.exportPageInput, currentPage, maxAttr);
    this.initPageBoundInput(toolbar.exportStartPageInput, currentPage, maxAttr);
    this.initPageBoundInput(toolbar.exportEndPageInput, currentPage, maxAttr);

    const exportLabel = document.getElementById("export-notes-label");
    this.setProp(exportLabel, "textContent", scope === "selected" ? "Export selected" : "Export");
    toolbar.updateExportButtonState();
  }

  static updateExportSelectionCount(toolbar) {
    const count = toolbar.model.selectedAnnotationIds?.size || 0;
    const suffix = count === 1 ? "" : "s";
    this.setProp(toolbar.exportSelectionCount, "textContent", `${count} annotation${suffix} selected`);
    this.setProp(document.getElementById("export-clear-selection-btn"), "disabled", count === 0);
    toolbar.updateExportButtonState();
  }

  static updateExportButtonState(toolbar) {
    const exportBtn = document.getElementById("export-notes-btn");
    if (!exportBtn) return;
    const unavailable = window.serverConnectivity?.state === "unavailable";
    const scope = toolbar.exportScopeSelect?.value;
    const missingSelection = scope === "selected" && (toolbar.model.selectedAnnotationIds?.size || 0) === 0;
    const missingSection =
      scope === "section" &&
      (!toolbar.exportSectionSelect || toolbar.exportSectionSelect.disabled || !toolbar.exportSectionSelect.value);
    exportBtn.disabled = Boolean(toolbar.exportBusy || unavailable || missingSelection || missingSection);
  }

  static resolveExportFormatAndGrouping(formatValue) {
    return EXPORT_FORMAT_MAP[formatValue] || { format: formatValue, group_by: "color" };
  }

  static populateExportScopeOptions(toolbar, options) {
    const parsePage = (input, label) => {
      const page = Number(input?.value);
      const totalPages = Number(toolbar.model.totalPages);
      const outOfBounds = totalPages > 0 && page > totalPages;
      if (!Number.isInteger(page) || page < 1 || outOfBounds) {
        const limitLabel = totalPages > 0 ? totalPages : "the last page";
        throw new Error(`${label} must be between 1 and ${limitLabel}.`);
      }
      return page;
    };

    const scopePopulators = {
      page: () => {
        options.page = parsePage(toolbar.exportPageInput, "Page");
      },
      range: () => {
        options.start_page = parsePage(toolbar.exportStartPageInput, "Start page");
        options.end_page = parsePage(toolbar.exportEndPageInput, "End page");
        if (options.start_page > options.end_page) {
          throw new Error("The start page must not be after the end page.");
        }
      },
      section: () => {
        const sectionIndex = Number(toolbar.exportSectionSelect?.value);
        if (!Number.isInteger(sectionIndex) || sectionIndex < 0) {
          throw new Error("Choose a chapter or section to export.");
        }
        options.section_index = sectionIndex;
      },
      selected: () => {
        options.annotation_ids = Array.from(toolbar.model.selectedAnnotationIds || []);
        if (!options.annotation_ids.length) {
          throw new Error("Select at least one annotation to export.");
        }
      },
    };
    scopePopulators[options.scope]?.();
  }

  static buildExportOptions(toolbar) {
    const formatValue = toolbar.exportFormatSelect?.value || "md_hierarchy";
    const { format, group_by } = this.resolveExportFormatAndGrouping(formatValue);
    const options = { format, group_by, scope: toolbar.exportScopeSelect?.value || "all" };
    this.populateExportScopeOptions(toolbar, options);
    return options;
  }

  static async ensureAnnotationsSynchronized(toolbar) {
    if (typeof localDB?.getPendingOutboxOps !== "function") return;
    const bookId = Number(toolbar.model.bookId);
    const pendingForBook = async () => {
      const ops = await localDB.getPendingOutboxOps();
      if (!Array.isArray(ops)) throw new Error("Could not verify pending annotation changes.");
      return ops.filter((op) => Number(op.bookId) === bookId && op.type === "annotation");
    };

    let pending = await pendingForBook();
    if (!pending.length) return;
    if (typeof localDB.processOutboxQueue !== "function") {
      throw new Error("Sync pending annotations before exporting.");
    }
    toolbar.setExportStatus("Syncing pending annotations…");
    await localDB.processOutboxQueue();
    pending = await pendingForBook();
    if (pending.length) {
      throw new Error(
        "Some annotations are still waiting to sync. Try exporting again after synchronization completes.",
      );
    }
    await toolbar.annotations?.refreshAnnotations?.();
  }

  static downloadExport(result) {
    if (!result?.blob || typeof URL.createObjectURL !== "function") {
      throw new Error("The export file could not be downloaded in this browser.");
    }
    const objectUrl = URL.createObjectURL(result.blob);
    const link = document.createElement("a");
    Object.assign(link, { href: objectUrl, download: result.filename, hidden: true });
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }

  static async exportAnnotations(toolbar) {
    const monitor = window.serverConnectivity;
    const exportBtn = document.getElementById("export-notes-btn");
    toolbar.exportBusy = true;
    toolbar.updateExportButtonState();
    toolbar.setExportStatus("Checking connection and pending changes…");
    try {
      if (monitor?.checkServer && !(await monitor.checkServer())) {
        throw new Error("Export requires a connection to the Lunabria server.");
      }
      await toolbar.ensureAnnotationsSynchronized();
      const options = toolbar.buildExportOptions();
      if (typeof api?.exportAnnotations !== "function") {
        throw new Error("Annotation export is not available.");
      }
      toolbar.setExportStatus("Preparing export…");
      const result = await api.exportAnnotations(toolbar.model.bookId, options);
      toolbar.downloadExport(result);
      toolbar.setExportStatus("Export downloaded.");
    } catch (error) {
      console.error("[ReaderToolbarManager] Annotation export failed:", error);
      toolbar.setExportStatus(error.message || "Annotation export failed.");
    } finally {
      toolbar.exportBusy = false;
      toolbar.updateExportButtonState();
      if (exportBtn && window.serverConnectivity?.state === "unavailable") {
        exportBtn.title = "Export is unavailable because the Lunabria server cannot be reached";
      }
    }
  }
}

window.ReaderExportController = ReaderExportController;
