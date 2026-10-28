/**
 * ReaderExportSectionPicker.js
 * Manages chapter/section loading, custom dropdown menu rendering, and badge updates
 * for annotation export in the reader drawer.
 */
const SECTION_LEVEL_PREFIXES = ["", "    - ", "        • "];
const SECTION_LEVEL_CLASSES = ["is-chapter", "is-section", "is-subsection"];
const SECTION_LEVEL_ICONS = ["book-open", "toc", "page"];
const SECTION_LEVEL_LABELS = ["Chapter", "Section", "Subsection"];

class ReaderExportSectionPicker {
  static setProp(target, key, value) {
    if (target) target[key] = value;
  }

  static computeBaseLevel(sections) {
    const minLevel = sections.reduce((min, s) => {
      const lvl = Number.isInteger(s.level) ? s.level : 1;
      return lvl < min ? lvl : min;
    }, Infinity);
    return Number.isFinite(minLevel) ? minLevel : 1;
  }

  static getLevelMeta(rawLevel, baseLevel) {
    const level = Math.max(0, (Number.isInteger(rawLevel) ? rawLevel : baseLevel) - baseLevel);
    const tier = Math.min(level, 2);
    const prefix = SECTION_LEVEL_PREFIXES[level] ?? `${"  ".repeat(level + 1)}– `;
    return {
      level,
      clampedLevel: Math.min(level, 5),
      prefix,
      levelClass: SECTION_LEVEL_CLASSES[tier],
      iconSymbol: SECTION_LEVEL_ICONS[tier],
      typeLabel: SECTION_LEVEL_LABELS[tier],
    };
  }

  static createOption(value, textContent, level = null) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = textContent;
    if (level !== null) option.setAttribute("data-level", String(level));
    return option;
  }

  static appendMenuButton(toolbar, section, meta) {
    if (!toolbar.exportSectionMenu) return;
    const itemBtn = document.createElement("button");
    itemBtn.type = "button";
    itemBtn.className = `export-section-item export-section-level-${meta.clampedLevel} ${meta.levelClass}`;
    itemBtn.setAttribute("data-index", String(section.index));
    itemBtn.style.paddingLeft = `${10 + meta.clampedLevel * 14}px`;
    itemBtn.innerHTML = `
      <span class="export-section-item-content">
        <svg class="ui-icon export-section-item-icon" aria-hidden="true" focusable="false"><use href="./icons.svg#${meta.iconSymbol}"></use></svg>
        <span class="export-section-item-title">${section.title}</span>
      </span>
      <span class="export-section-item-badge">pp. ${section.page_start}–${section.page_end}</span>
    `;
    itemBtn.addEventListener("click", () => {
      if (toolbar.exportSectionSelect) {
        toolbar.exportSectionSelect.value = String(section.index);
        toolbar.exportSectionSelect.dispatchEvent(new Event("change", { bubbles: true }));
        toolbar.exportSectionSelect.dispatchEvent(new Event("input", { bubbles: true }));
      }
      toolbar.toggleExportSectionMenu(false);
      toolbar.exportSectionTrigger?.focus();
    });
    toolbar.exportSectionMenu.appendChild(itemBtn);
  }

  static toggleExportSectionMenu(toolbar, open) {
    if (!toolbar.exportSectionMenu || !toolbar.exportSectionTrigger) return;
    toolbar.exportSectionMenu.hidden = !open;
    toolbar.exportSectionTrigger.setAttribute("aria-expanded", String(open));
    toolbar.exportSectionPicker?.classList?.toggle?.("is-open", open);
  }

  static resetSectionControls(toolbar, optionText, isDisabled) {
    toolbar.exportSectionSelect.replaceChildren(this.createOption("", optionText));
    toolbar.exportSectionMenu?.replaceChildren();
    toolbar.exportSectionSelect.disabled = isDisabled;
    this.setProp(toolbar.exportSectionTrigger, "disabled", isDisabled);
  }

  static async loadExportSections(toolbar) {
    const bookId = Number(toolbar.model.bookId);
    if (!bookId || !toolbar.exportSectionSelect || toolbar.exportSectionsBookId === bookId) return;
    toolbar.exportSectionsBookId = bookId;
    this.resetSectionControls(toolbar, "Loading chapters…", true);
    toolbar.setExportStatus("");

    try {
      if (typeof api?.getAnnotationExportSections !== "function") {
        throw new Error("Chapter export is not available.");
      }
      const result = await api.getAnnotationExportSections(bookId);
      if (Number(toolbar.model.bookId) !== bookId) return;

      toolbar.exportSections = Array.isArray(result?.sections) ? result.sections : [];
      const hasSections = toolbar.exportSections.length > 0;
      this.resetSectionControls(toolbar, "Choose a chapter or section", !hasSections);

      const baseLevel = this.computeBaseLevel(toolbar.exportSections);
      for (const section of toolbar.exportSections) {
        const meta = this.getLevelMeta(section.level, baseLevel);
        const pageLabel = `(pages ${section.page_start}–${section.page_end})`;
        toolbar.exportSectionSelect.appendChild(
          this.createOption(String(section.index), `${meta.prefix}${section.title} ${pageLabel}`, meta.level),
        );
        this.appendMenuButton(toolbar, section, meta);
      }

      if (result.total_pages > 0) {
        for (const input of [toolbar.exportPageInput, toolbar.exportStartPageInput, toolbar.exportEndPageInput]) {
          this.setProp(input, "max", String(result.total_pages));
        }
      }
      if (!hasSections) {
        toolbar.setExportStatus("No chapter list is available for this book. Choose a page or range instead.");
      }
      this.updateExportSectionBadge(toolbar);
    } catch (error) {
      toolbar.exportSections = [];
      this.resetSectionControls(toolbar, "Chapters unavailable", true);
      toolbar.setExportStatus(error.message || "Could not load chapters. Choose a page or range instead.");
      this.updateExportSectionBadge(toolbar);
    }
    toolbar.updateExportButtonState();
  }

  static resetBadgeUI(badge, triggerText, triggerIcon, menu) {
    if (badge) {
      badge.hidden = true;
      badge.textContent = "";
      badge.className = "export-section-badge";
    }
    this.setProp(triggerText, "textContent", "Choose a chapter or section");
    this.setProp(triggerIcon, "innerHTML", '<use href="./icons.svg#book-open"></use>');
    menu?.querySelectorAll(".export-section-item").forEach((item) => item.classList.remove("is-selected"));
  }

  static updateExportSectionBadge(toolbar) {
    const badge = document.getElementById("export-section-badge");
    const triggerText = document.getElementById("export-section-trigger-text");
    const triggerIcon = toolbar.exportSectionTrigger?.querySelector(".export-section-trigger-icon");
    const sections = Array.isArray(toolbar.exportSections) ? toolbar.exportSections : [];
    const selectedIndex = toolbar.exportSectionSelect?.value;
    const section = selectedIndex ? sections.find((s) => String(s.index) === String(selectedIndex)) : null;

    if (!section) {
      this.resetBadgeUI(badge, triggerText, triggerIcon, toolbar.exportSectionMenu);
      return;
    }

    const baseLevel = this.computeBaseLevel(sections);
    const meta = this.getLevelMeta(section.level, baseLevel);
    this.setProp(triggerText, "textContent", `${section.title} (pp. ${section.page_start}–${section.page_end})`);
    this.setProp(triggerIcon, "innerHTML", `<use href="./icons.svg#${meta.iconSymbol}"></use>`);

    toolbar.exportSectionMenu?.querySelectorAll(".export-section-item").forEach((item) => {
      item.classList.toggle("is-selected", item.getAttribute("data-index") === String(section.index));
    });

    if (badge) {
      badge.hidden = false;
      badge.className = `export-section-badge ${meta.levelClass}`;
      badge.innerHTML = `
        <svg class="ui-icon" aria-hidden="true" focusable="false"><use href="./icons.svg#${meta.iconSymbol}"></use></svg>
        <span class="export-badge-tag">${meta.typeLabel}:</span>
        <span class="export-badge-title">${section.title}</span>
        <span class="export-badge-pages">Pages ${section.page_start}–${section.page_end}</span>
      `;
    }
  }
}

window.ReaderExportSectionPicker = ReaderExportSectionPicker;
