/**
 * ReaderAnnotationToolbarView.js
 * Manages floating highlight toolbars, quick highlight color palettes, and the annotations sidebar drawer.
 */
class ReaderAnnotationToolbarView {
  constructor(annotationsVm) {
    this.vm = annotationsVm;
  }

  computeSelectionRects(range, pageWrapper, currentScale) {
    if (!range || !pageWrapper) return [];
    const pageRect = pageWrapper.getBoundingClientRect();
    const rawRects = Array.from(range.getClientRects()).filter((r) => r.width > 1 && r.height > 1);
    const rectsToUse =
      rawRects.length > 0 ? rawRects : [range.getBoundingClientRect()].filter((r) => r.width > 1 && r.height > 1);
    if (!rectsToUse.length) return [];

    const lineSpans = Array.from(pageWrapper.querySelectorAll(".precise-line"));

    const relativeRects = rectsToUse.map((cr) => {
      const midY = cr.top + cr.height / 2;
      let bestSpan = null;
      let bestScore = Number.NEGATIVE_INFINITY;

      for (const s of lineSpans) {
        const sr = s.getBoundingClientRect();
        const score = ReaderSelectionGeometry.lineMatchScore(cr, sr, midY);
        if (score !== null && score > bestScore) {
          bestScore = score;
          bestSpan = s;
        }
      }

      return ReaderSelectionGeometry.relativeRect(
        cr,
        pageRect,
        currentScale,
        bestSpan?.dataset.y0 ? bestSpan.dataset : null,
      );
    });

    return ReaderModel.mergeLineRects(relativeRects);
  }

  resolveWordRangeAtPoint(clientX, clientY, drawCanvas) {
    let range = null;
    if (document.caretRangeFromPoint) {
      range = document.caretRangeFromPoint(clientX, clientY);
    } else if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(clientX, clientY);
      if (pos?.offsetNode) {
        range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
        range.collapse(true);
      }
    }

    if (range?.startContainer?.nodeType !== Node.TEXT_NODE && drawCanvas.parentElement) {
      const textLayer = drawCanvas.parentElement.querySelector(".textLayer");
      const fallbackProbe = window.ReaderNativeSelectionLoupeController?.prototype?.findTextTargetWithinGap?.call(
        null,
        clientX,
        clientY,
        textLayer,
      );
      if (fallbackProbe?.node) {
        range = document.createRange();
        range.setStart(fallbackProbe.node, fallbackProbe.offset);
        range.collapse(true);
      }
    }

    if (range?.startContainer?.nodeType !== Node.TEXT_NODE) return null;
    const textContent = range.startContainer.textContent || "";
    let start = range.startOffset;
    let end = start;
    while (start > 0 && /\S/.test(textContent[start - 1])) start--;
    while (end < textContent.length && /\S/.test(textContent[end])) end++;
    if (end <= start || textContent.slice(start, end).trim().length === 0) return null;

    const wordRange = document.createRange();
    wordRange.setStart(range.startContainer, start);
    wordRange.setEnd(range.startContainer, end);
    return wordRange;
  }

  openHighlightMenu(annot, highlightEl) {
    const vm = this.vm;
    vm.hideQuickHighlightPalette();
    vm.model.activeHighlight = annot;
    if (vm.floatingToolbar) vm.floatingToolbar.style.display = "none";

    const rect = highlightEl.getBoundingClientRect();
    const colorsContainer = document.getElementById("highlight-action-colors");
    if (colorsContainer) {
      colorsContainer.innerHTML = "";
      for (const c of vm.model.colors) {
        const btn = document.createElement("button");
        btn.className = "color-dot-btn";
        if (annot.color === c.id) btn.style.boxShadow = "0 0 0 2px var(--text-primary)";
        btn.style.backgroundColor = c.color;
        btn.title = `Cambiar a: ${c.name}`;
        btn.onclick = async (ev) => {
          ev.stopPropagation();
          await vm.changeHighlightColor(annot.id, c.id, annot.page);
        };
        colorsContainer.appendChild(btn);
      }
    }
    const { safeTop, safeBottom } = vm.toolbarSafeBounds();
    vm.positionAnnotationToolbar(vm.highlightActionMenu, rect, rect, safeTop, safeBottom);
  }

  openQuickHighlightPalette(annot, pageNumber, fallbackBounds = null) {
    const vm = this.vm;
    const palette = document.getElementById("reader-quick-highlight-palette");
    if (!palette || !annot?.id) return;
    if (vm.highlightActionMenu) vm.highlightActionMenu.style.display = "none";
    vm.model.activeHighlight = null;

    const targetPage = Number(annot.page || pageNumber || vm.model.currentPage);
    const pageWrapper =
      document.getElementById(`pdf-page-${targetPage}`) ||
      vm.viewportEl.querySelector(`.pdf-page-wrapper[data-page="${targetPage}"]`);
    const highlight = Array.from(pageWrapper?.querySelectorAll(".pdf-highlight-rect") || []).find(
      (element) => element.dataset.annotationId === String(annot.id),
    );
    const bounds = highlight?.getBoundingClientRect() || fallbackBounds;
    if (!bounds) return;

    const colorContainer = document.createElement("div");
    colorContainer.className = "quick-highlight-color-dots";
    for (const color of vm.model.colors) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "quick-highlight-color-btn";
      button.style.backgroundColor = color.color;
      button.title = `Change to: ${color.name}`;
      button.setAttribute("aria-label", `Change highlight to ${color.name}`);
      button.setAttribute("aria-pressed", String(annot.color === color.id));
      if (annot.color === color.id) button.classList.add("active");
      button.addEventListener("click", async (event) => {
        event.stopPropagation();
        if (annot.color === color.id) {
          vm.hideQuickHighlightPalette();
          return;
        }
        await vm.changeHighlightColor(annot.id, color.id, targetPage);
      });
      colorContainer.appendChild(button);
    }

    palette.replaceChildren(colorContainer);
    palette.style.display = "flex";
    palette.style.opacity = "0";
    palette.style.pointerEvents = "auto";
    palette.setAttribute("aria-hidden", "false");

    const paletteBounds = palette.getBoundingClientRect();
    const { left, top, opensBelow } = ReaderSelectionGeometry.quickPalettePosition(
      bounds,
      paletteBounds,
      window.innerWidth,
    );
    palette.style.left = `${left}px`;
    palette.style.top = `${top}px`;
    palette.classList.toggle("opens-below", opensBelow);
    requestAnimationFrame(() => {
      palette.style.opacity = "1";
    });
  }

  hideQuickHighlightPalette() {
    const palette = document.getElementById("reader-quick-highlight-palette");
    if (!palette) return;
    palette.style.display = "none";
    palette.style.opacity = "0";
    palette.style.pointerEvents = "none";
    palette.classList.remove("opens-below");
    palette.setAttribute("aria-hidden", "true");
  }

  renderFloatingColors() {
    const vm = this.vm;
    const colorContainer = document.getElementById("floating-color-dots");
    if (!colorContainer) return;
    colorContainer.innerHTML = "";
    for (const c of vm.model.colors) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "color-dot-btn";
      btn.style.backgroundColor = c.color;
      btn.title = c.name;
      btn.addEventListener("pointerdown", (e) => e.stopPropagation());
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        vm.applyHighlight(c.id);
      });
      colorContainer.appendChild(btn);
    }
  }

  toolbarSafeBounds() {
    const header = document.getElementById("reader-header") || document.querySelector(".reader-hud-header");
    const footer = document.getElementById("reader-footer") || document.querySelector(".reader-footer");
    return {
      safeTop: (header && !header.classList.contains("hidden") ? header.getBoundingClientRect().bottom : 0) + 10,
      safeBottom:
        (footer && !footer.classList.contains("hidden") ? footer.getBoundingClientRect().top : window.innerHeight) - 10,
    };
  }

  positionAnnotationToolbar(toolbar, firstRect, lastRect, safeTop, safeBottom) {
    toolbar.style.display = "flex";
    const width = toolbar.offsetWidth || 240;
    const height = toolbar.offsetHeight || 44;
    const { left, top } = ReaderSelectionGeometry.floatingToolbarPosition(
      firstRect,
      lastRect,
      width,
      height,
      window.innerWidth,
      safeTop,
      safeBottom,
    );
    toolbar.style.left = `${Math.round(left)}px`;
    toolbar.style.top = `${Math.round(top)}px`;
  }

  hideFloatingToolbar() {
    const toolbar = this.vm.floatingToolbar;
    if (toolbar) {
      toolbar.style.opacity = "0";
      toolbar.style.pointerEvents = "none";
    }
  }

  async updateFloatingToolbar() {
    const vm = this.vm;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      this.hideFloatingToolbar();
      return;
    }

    const text = sel.toString().trim();
    if (!text) {
      this.hideFloatingToolbar();
      return;
    }

    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const { safeTop, safeBottom } = vm.toolbarSafeBounds();
    if (rect.bottom < safeTop || rect.top > safeBottom) {
      this.hideFloatingToolbar();
      return;
    }

    vm.model.selectedRange = range.cloneRange();
    vm.model.selectedText = text;

    const startNode = range.startContainer;
    const element = startNode.nodeType === Node.ELEMENT_NODE ? startNode : startNode.parentElement;
    const pageWrapper = element?.closest(".pdf-page-wrapper") || vm.viewportEl.querySelector(".pdf-page-wrapper");

    const pageNumber = pageWrapper?.dataset?.page ? Number(pageWrapper.dataset.page) : vm.model.currentPage;
    vm.model.selectedPage = pageNumber;
    vm.model.selectedRects = vm.computeSelectionRects(range, pageWrapper, vm.model.scale);

    if (vm.highlightActionMenu) vm.highlightActionMenu.style.display = "none";

    if (vm.model.isDrawMode && vm.model.drawTool === "highlighter") {
      this.hideFloatingToolbar();
      return;
    }

    const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
    const firstRect = rects.length > 0 ? rects[0] : rect;
    const lastRect = rects.length > 0 ? rects[rects.length - 1] : rect;

    vm.positionAnnotationToolbar(vm.floatingToolbar, firstRect, lastRect, safeTop, safeBottom);
    requestAnimationFrame(() => {
      vm.floatingToolbar.style.opacity = "1";
      vm.floatingToolbar.style.pointerEvents = "auto";
    });
  }

  renderDrawerAnnotations() {
    const vm = this.vm;
    const container = document.getElementById("annotations-list");
    if (!container) return;
    container.innerHTML = "";

    const annots = vm.model.annotations;
    const selectionCount = document.getElementById("export-selection-count");
    if (selectionCount) {
      const count = vm.model.selectedAnnotationIds?.size || 0;
      selectionCount.textContent = `${count} annotation${count === 1 ? "" : "s"} selected`;
    }

    if (!annots.length) {
      container.innerHTML = `
        <div style="text-align: center; color: var(--text-secondary); padding: 32px 16px;">
          <p class="annotations-empty-icon"><svg class="ui-icon" aria-hidden="true" focusable="false"><use href="./icons.svg#highlighter"></use></svg></p>
          <p style="font-weight: 600; margin-bottom: 4px;">No annotations yet</p>
          <p style="font-size: 0.8rem;">Select text in the reader to highlight.</p>
        </div>
      `;
      return;
    }

    annots.forEach((annot, annotationIndex) => {
      const item = document.createElement("div");
      item.className = "annotation-item";
      const colorMeta = vm.model.getColorMetadata(annot.color);
      item.style.borderLeftColor = colorMeta ? colorMeta.color : "#ffeb3b";

      item.innerHTML = `
        <div class="annotation-item-header">
          <span class="annotation-page">Page ${annot.page}</span>
          <div style="display:flex; gap:6px;">
            <label class="annotation-export-select">
              <input type="checkbox" class="annotation-export-checkbox">
              <span>Include</span>
            </label>
            <button type="button" class="btn btn-icon delete-annot-btn" title="Delete" aria-label="Delete annotation on page ${annot.page}" style="padding:2px 6px; font-size:0.8rem;"><svg class="ui-icon" aria-hidden="true" focusable="false"><use href="./icons.svg#trash"></use></svg></button>
          </div>
        </div>
        <div class="annotation-text">"${annot.text}"</div>
        ${annot.comment ? `<div class="annotation-comment" style="margin-top:6px; font-size:0.82rem; color:var(--text-secondary); font-style:italic;"><svg class="ui-icon" aria-hidden="true" focusable="false"><use href="./icons.svg#comment"></use></svg> ${annot.comment}</div>` : ""}
      `;

      const exportCheckbox = item.querySelector(".annotation-export-checkbox");
      if (exportCheckbox) {
        exportCheckbox.checked = vm.model.selectedAnnotationIds?.has(String(annot.id)) || false;
        exportCheckbox.dataset.annotationId = String(annot.id);
        exportCheckbox.setAttribute(
          "aria-label",
          `Include annotation ${annotationIndex + 1} on page ${annot.page} in export: ${String(annot.text || "").slice(0, 80)}`,
        );
      }

      item.onclick = (e) => {
        if (!e.target.closest("button, label") && vm.onPageNeedsRefresh) {
          vm.onPageNeedsRefresh(annot.page);
        }
      };

      const delBtn = item.querySelector(".delete-annot-btn");
      if (delBtn) {
        delBtn.onclick = async (e) => {
          e.stopPropagation();
          await vm.deleteAnnotationItem(annot);
        };
      }

      container.appendChild(item);
    });
  }
}

window.ReaderAnnotationToolbarView = ReaderAnnotationToolbarView;
