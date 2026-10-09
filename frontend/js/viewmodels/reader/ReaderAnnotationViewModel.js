/**
 * ReaderAnnotationViewModel.js
 * Manages text selections, precise word/line highlights, annotations sidebar, and highlight menus.
 */
class ReaderAnnotationViewModel {
  constructor(model, elements, callbacks) {
    this.model = model;
    this.viewportEl = elements.viewportEl;
    this.floatingToolbar = elements.floatingToolbar;
    this.highlightActionMenu = elements.highlightActionMenu;
    this.notesDrawer = elements.notesDrawer;
    this.getDrawingCoordinator = callbacks.getDrawingCoordinator;
    this.onPageNeedsRefresh = callbacks.onPageNeedsRefresh;
  }

  computeSelectionRects(range, pageWrapper, currentScale) {
    if (!range || !pageWrapper) return [];
    const pageRect = pageWrapper.getBoundingClientRect();
    const rawRects = Array.from(range.getClientRects()).filter(r => r.width > 1 && r.height > 1);
    const rectsToUse = rawRects.length > 0 ? rawRects : [range.getBoundingClientRect()].filter(r => r.width > 1 && r.height > 1);
    if (!rectsToUse.length) return [];

    const lineSpans = Array.from(pageWrapper.querySelectorAll('.precise-line'));

    const relativeRects = rectsToUse.map(cr => {
      const midY = cr.top + cr.height / 2;

      let lineSpan = null;
      let bestSpan = null;
      let bestScore = -Infinity;

      for (const s of lineSpans) {
        const sr = s.getBoundingClientRect();
        const score = ReaderSelectionGeometry.lineMatchScore(cr, sr, midY);
        if (score !== null) {
          if (score > bestScore) {
            bestScore = score;
            bestSpan = s;
          }
        }
      }

      lineSpan = bestSpan;

      return ReaderSelectionGeometry.relativeRect(
        cr, pageRect, currentScale,
        lineSpan && lineSpan.dataset.y0 ? lineSpan.dataset : null
      );
    });

    return ReaderModel.mergeLineRects(relativeRects);
  }

  async applyHighlight(colorId, comment = "", options = {}) {
    const text = this.model.selectedText;
    const pageNumber = Number(options.pageNumber || this.model.selectedPage || this.model.currentPage || 1);
    const pageWrapper = options.pageWrapper ||
      document.getElementById(`pdf-page-${pageNumber}`) ||
      this.viewportEl.querySelector(`.pdf-page-wrapper[data-page="${pageNumber}"]`) ||
      this.viewportEl.querySelector('.pdf-page-wrapper');
    let rects = (options.rects && options.rects.length) ? options.rects : this.model.selectedRects;

    if ((!rects || !rects.length) && this.model.selectedRange && pageWrapper) {
      rects = this.computeSelectionRects(this.model.selectedRange, pageWrapper, this.model.scale);
    }

    if (!text || !rects || !rects.length) {
      console.warn('[ReaderAnnotationViewModel] Cannot apply highlight: missing text or rects', { text, rects });
      return;
    }

    const colorMeta = this.model.getColorMetadata(colorId);
    const cleanText = ReaderModel.normalizeText(text);

    const annotData = {
      book_id: this.model.bookId,
      page: pageNumber,
      color: colorId,
      category: colorMeta?.name || '',
      text: cleanText,
      comment: comment,
      rects: rects
    };

    const annotId = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
      ? crypto.randomUUID()
      : ('annot_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9));
    const fullAnnot = { id: annotId, ...annotData };

    // 1. Optimistic update in model
    const existingAnnots = Array.isArray(this.model.annotations) ? [...this.model.annotations] : [];
    existingAnnots.push(fullAnnot);
    this.model.setAnnotations(existingAnnots);

    // 2. Persist to cached_annotations in localDB
    if (typeof localDB !== 'undefined' && typeof localDB.saveCachedAnnotations === 'function') {
      localDB.saveCachedAnnotations(this.model.bookId, existingAnnots).catch(() => {});
    }

    // 3. Enqueue to outbox
    if (typeof localDB !== 'undefined' && typeof localDB.enqueueOutboxOp === 'function') {
      await localDB.enqueueOutboxOp({
        id: `op_create_${annotId}`,
        type: 'annotation',
        action: 'create',
        bookId: this.model.bookId,
        entityId: annotId,
        payload: fullAnnot
      }).catch(() => {});
    }

    if (this.floatingToolbar) {
      this.floatingToolbar.style.opacity = '0';
      this.floatingToolbar.style.pointerEvents = 'none';
    }
    this.clearTextSelection();

    this.renderDrawerAnnotations();
    const refreshed = this.refreshPageHighlights(pageNumber);
    if (!refreshed && this.model.viewMode !== 'flow' && this.onPageNeedsRefresh) {
      this.onPageNeedsRefresh(pageNumber);
    }
    if (options.showQuickPalette) {
      this.openQuickHighlightPalette(fullAnnot, pageNumber);
    }

    // 4. Try network sync via outbox or direct api call
    try {
      const savedAnnotation = await api.createAnnotation(this.model.bookId, fullAnnot);
      if (typeof localDB !== 'undefined' && typeof localDB.removeOutboxOp === 'function') {
        await localDB.removeOutboxOp(`op_create_${annotId}`).catch(() => {});
      }
      await this.refreshAnnotations();
      this.refreshPageHighlights(pageNumber);
    } catch (err) {
      console.warn('[ReaderAnnotationViewModel] Network save failed, kept in outbox queue:', err);
    }
  }

  async refreshAnnotations() {
    try {
      const annots = await api.getAnnotations(this.model.bookId);
      if (!Array.isArray(annots)) throw new Error('Invalid annotations response');
      this.model.setAnnotations(annots);
      if (typeof localDB !== 'undefined' && localDB && typeof localDB.saveCachedAnnotations === 'function') {
        try {
          await localDB.saveCachedAnnotations(this.model.bookId, annots);
        } catch (error) {
          console.warn('[ReaderAnnotationViewModel] Could not cache annotations:', error);
        }
      }
      this.renderDrawerAnnotations();
      return annots;
    } catch (err) {
      if (typeof localDB !== 'undefined' && localDB && typeof localDB.getCachedAnnotations === 'function') {
        const cached = await localDB.getCachedAnnotations(this.model.bookId).catch(() => null);
        if (cached && Array.isArray(cached)) {
          this.model.setAnnotations(cached);
          this.renderDrawerAnnotations();
          return cached;
        }
      }
      throw err;
    }
  }

  renderPageHighlights(layer, pageNumber) {
    const targetPage = pageNumber || this.model.currentPage;
    const annots = this.model.getPageAnnotations(targetPage);
    const effScale = this.model.scale;

    HighlightOverlayView.renderPageHighlights(layer, annots, effScale, this.model.colors, (annot, el) => {
      this.openHighlightMenu(annot, el);
    });
  }

  refreshPageHighlights(pageNumber) {
    const targetPage = Number(pageNumber || this.model.currentPage);
    const wrapper = document.getElementById(`pdf-page-${targetPage}`) || this.viewportEl.querySelector(`.pdf-page-wrapper[data-page="${targetPage}"]`);
    if (wrapper) {
      let hlLayer = wrapper.querySelector('.pdf-highlight-layer');
      if (!hlLayer) {
        hlLayer = HighlightOverlayView.createHighlightLayerContainer();
        const drawCanvas = wrapper.querySelector('.pdf-drawing-canvas');
        if (drawCanvas) {
          wrapper.insertBefore(hlLayer, drawCanvas);
        } else {
          wrapper.appendChild(hlLayer);
        }
      }
      this.renderPageHighlights(hlLayer, targetPage);
      return true;
    }
    return false;
  }

  openHighlightMenu(annot, highlightEl) {
    this.hideQuickHighlightPalette();
    this.model.activeHighlight = annot;
    if (this.floatingToolbar) this.floatingToolbar.style.display = 'none';

    const rect = highlightEl.getBoundingClientRect();

    const colorsContainer = document.getElementById('highlight-action-colors');
    if (colorsContainer) {
      colorsContainer.innerHTML = '';
      this.model.colors.forEach(c => {
        const btn = document.createElement('button');
        btn.className = 'color-dot-btn';
        if (annot.color === c.id) btn.style.boxShadow = '0 0 0 2px var(--text-primary)';
        btn.style.backgroundColor = c.color;
        btn.title = `Cambiar a: ${c.name}`;
        btn.onclick = async (ev) => {
          ev.stopPropagation();
          await this.changeHighlightColor(annot.id, c.id, annot.page);
        };
        colorsContainer.appendChild(btn);
      });
    }
    const { safeTop, safeBottom } = this.toolbarSafeBounds();
    this.positionAnnotationToolbar(this.highlightActionMenu, rect, rect, safeTop, safeBottom);
  }

  openQuickHighlightPalette(annot, pageNumber, fallbackBounds = null) {
    const palette = document.getElementById('reader-quick-highlight-palette');
    if (!palette || !annot?.id) return;
    if (this.highlightActionMenu) this.highlightActionMenu.style.display = 'none';
    this.model.activeHighlight = null;

    const targetPage = Number(annot.page || pageNumber || this.model.currentPage);
    const pageWrapper = document.getElementById(`pdf-page-${targetPage}`) ||
      this.viewportEl.querySelector(`.pdf-page-wrapper[data-page="${targetPage}"]`);
    const highlight = Array.from(pageWrapper?.querySelectorAll('.pdf-highlight-rect') || [])
      .find(element => element.dataset.annotationId === String(annot.id));
    const bounds = highlight?.getBoundingClientRect() || fallbackBounds;
    if (!bounds) return;

    const colorContainer = document.createElement('div');
    colorContainer.className = 'quick-highlight-color-dots';
    this.model.colors.forEach(color => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'quick-highlight-color-btn';
      button.style.backgroundColor = color.color;
      button.title = `Change to: ${color.name}`;
      button.setAttribute('aria-label', `Change highlight to ${color.name}`);
      button.setAttribute('aria-pressed', String(annot.color === color.id));
      if (annot.color === color.id) button.classList.add('active');
      button.addEventListener('click', async event => {
        event.stopPropagation();
        if (annot.color === color.id) {
          this.hideQuickHighlightPalette();
          return;
        }
        await this.changeHighlightColor(annot.id, color.id, targetPage);
      });
      colorContainer.appendChild(button);
    });

    palette.replaceChildren(colorContainer);
    palette.style.display = 'flex';
    palette.style.opacity = '0';
    palette.style.pointerEvents = 'auto';
    palette.setAttribute('aria-hidden', 'false');

    const paletteBounds = palette.getBoundingClientRect();
    const { left, top, opensBelow } = ReaderSelectionGeometry.quickPalettePosition(bounds, paletteBounds, window.innerWidth);
    palette.style.left = `${left}px`;
    palette.style.top = `${top}px`;
    palette.classList.toggle('opens-below', opensBelow);
    requestAnimationFrame(() => {
      palette.style.opacity = '1';
    });
  }

  hideQuickHighlightPalette() {
    const palette = document.getElementById('reader-quick-highlight-palette');
    if (!palette) return;
    palette.style.display = 'none';
    palette.style.opacity = '0';
    palette.style.pointerEvents = 'none';
    palette.classList.remove('opens-below');
    palette.setAttribute('aria-hidden', 'true');
  }

  async changeHighlightColor(annotId, newColorId, pageNumber = null) {
    const annot = this.model.annotations.find(a => String(a.id) === String(annotId)) || this.model.activeHighlight;
    const targetPage = Number(annot?.page || pageNumber || this.model.currentPage);
    const colorMeta = this.model.getColorMetadata(newColorId);

    // 1. Optimistic update in model
    if (annot) {
      annot.color = newColorId;
      annot.category = colorMeta?.name || '';
    }
    if (this.model.activeHighlight && String(this.model.activeHighlight.id) === String(annotId)) {
      this.model.activeHighlight.color = newColorId;
      this.model.activeHighlight.category = colorMeta?.name || '';
    }

    // 2. Direct DOM update for all matching highlight rects on screen
    const highlightRects = document.querySelectorAll(`.pdf-highlight-rect[data-annotation-id="${annotId}"]`);
    highlightRects.forEach(el => {
      el.style.backgroundColor = colorMeta ? colorMeta.color : '#ffeb3b';
    });

    if (this.highlightActionMenu) this.highlightActionMenu.style.display = 'none';
    this.hideQuickHighlightPalette();
    this.model.activeHighlight = null;

    // Update cached_annotations in localDB
    if (typeof localDB !== 'undefined' && typeof localDB.saveCachedAnnotations === 'function') {
      localDB.saveCachedAnnotations(this.model.bookId, this.model.annotations).catch(() => {});
    }

    // Enqueue update to outbox
    if (typeof localDB !== 'undefined' && typeof localDB.enqueueOutboxOp === 'function') {
      await localDB.enqueueOutboxOp({
        id: `op_update_${annotId}`,
        type: 'annotation',
        action: 'update',
        bookId: this.model.bookId,
        entityId: annotId,
        payload: {
          color: newColorId,
          category: colorMeta?.name || ''
        }
      }).catch(() => {});
    }

    // 3. Persist change to backend
    try {
      await api.updateAnnotation(annotId, {
        color: newColorId,
        category: colorMeta?.name || ''
      });
      if (typeof localDB !== 'undefined' && typeof localDB.removeOutboxOp === 'function') {
        await localDB.removeOutboxOp(`op_update_${annotId}`).catch(() => {});
      }
      await this.refreshAnnotations();
    } catch (err) {
      console.warn('[ReaderAnnotationViewModel] Error updating annotation color, queued in outbox:', err);
    }

    // 4. Refresh target page highlights
    this.refreshPageHighlights(targetPage);
  }

  detectAndHighlightWordAtPoint(clientX, clientY, drawCanvas) {
    try {
      drawCanvas.style.pointerEvents = 'none';
      let range = null;
      if (document.caretRangeFromPoint) {
        range = document.caretRangeFromPoint(clientX, clientY);
      } else if (document.caretPositionFromPoint) {
        const pos = document.caretPositionFromPoint(clientX, clientY);
        if (pos && pos.offsetNode) {
          range = document.createRange();
          range.setStart(pos.offsetNode, pos.offset);
          range.collapse(true);
        }
      }

      if ((!range || range.startContainer?.nodeType !== Node.TEXT_NODE) && drawCanvas.parentElement) {
        const textLayer = drawCanvas.parentElement.querySelector('.textLayer');
        const fallbackProbe = window.ReaderNativeSelectionLoupeController?.prototype?.findTextTargetWithinGap?.call(null, clientX, clientY, textLayer);
        if (fallbackProbe?.node) {
          range = document.createRange();
          range.setStart(fallbackProbe.node, fallbackProbe.offset);
          range.collapse(true);
        }
      }

      if (range && range.startContainer && range.startContainer.nodeType === Node.TEXT_NODE) {
        const textContent = range.startContainer.textContent || '';
        const offset = range.startOffset;
        let start = offset;
        let end = offset;
        while (start > 0 && /\S/.test(textContent[start - 1])) start--;
        while (end < textContent.length && /\S/.test(textContent[end])) end++;

        if (end > start && textContent.slice(start, end).trim().length > 0) {
          const wordRange = document.createRange();
          wordRange.setStart(range.startContainer, start);
          wordRange.setEnd(range.startContainer, end);
          const sel = window.getSelection();
          if (sel) {
            sel.removeAllRanges();
            sel.addRange(wordRange);
            this.model.selectedRange = wordRange;
            this.model.selectedText = wordRange.toString().trim();
            const pageWrapper = drawCanvas.parentElement?.closest?.('.pdf-page-wrapper') || drawCanvas.parentElement;
            const pageNumber = pageWrapper?.dataset?.page ? Number(pageWrapper.dataset.page) : this.model.currentPage;
            this.model.selectedPage = pageNumber;
            const rects = pageWrapper ? this.computeSelectionRects(wordRange, pageWrapper, this.model.scale) : [];
            this.model.selectedRects = rects;
            const colorId = this.model.getHighlightColorIdFromHex(this.model.drawColor);
            this.applyHighlight(colorId, '', { showQuickPalette: true, pageNumber, pageWrapper, rects });
          }
        }
      }
    } catch(err) {
      console.warn('[ReaderAnnotationViewModel] Caret detection:', err);
    }
  }

  renderFloatingColors() {
    const colorContainer = document.getElementById('floating-color-dots');
    if (!colorContainer) return;
    colorContainer.innerHTML = '';
    this.model.colors.forEach(c => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'color-dot-btn';
      btn.style.backgroundColor = c.color;
      btn.title = c.name;
      btn.addEventListener('pointerdown', (e) => e.stopPropagation());
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.applyHighlight(c.id);
      });
      colorContainer.appendChild(btn);
    });
  }

  clearTextSelection() {
    window.getSelection()?.removeAllRanges();
    this.model.selectedRange = null;
    this.model.selectedText = '';
    this.model.selectedRects = [];
    this.model.selectedPage = null;
    if (this.floatingToolbar) {
      this.floatingToolbar.style.opacity = '0';
      this.floatingToolbar.style.pointerEvents = 'none';
    }
  }

  toolbarSafeBounds() {
    const header = document.getElementById('reader-header') || document.querySelector('.reader-hud-header');
    const footer = document.getElementById('reader-footer') || document.querySelector('.reader-footer');
    return {
      safeTop: (header && !header.classList.contains('hidden') ? header.getBoundingClientRect().bottom : 0) + 10,
      safeBottom: (footer && !footer.classList.contains('hidden') ? footer.getBoundingClientRect().top : window.innerHeight) - 10
    };
  }

  positionAnnotationToolbar(toolbar, firstRect, lastRect, safeTop, safeBottom) {
    // Hidden controls have zero dimensions; measure the populated, visible layout.
    toolbar.style.display = 'flex';
    const width = toolbar.offsetWidth || 240;
    const height = toolbar.offsetHeight || 44;
    const { left, top } = ReaderSelectionGeometry.floatingToolbarPosition(
      firstRect, lastRect, width, height, window.innerWidth, safeTop, safeBottom
    );
    toolbar.style.left = `${Math.round(left)}px`;
    toolbar.style.top = `${Math.round(top)}px`;
  }

  async updateFloatingToolbar() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      if (this.floatingToolbar) {
        this.floatingToolbar.style.opacity = '0';
        this.floatingToolbar.style.pointerEvents = 'none';
      }
      return;
    }

    const text = sel.toString().trim();
    if (!text || text.length < 1) {
      if (this.floatingToolbar) {
        this.floatingToolbar.style.opacity = '0';
        this.floatingToolbar.style.pointerEvents = 'none';
      }
      return;
    }

    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    if (rect.width > 0 && rect.height > 0) {
      const { safeTop, safeBottom } = this.toolbarSafeBounds();

      // If selection is scrolled completely off-screen, hide toolbar
      if (rect.bottom < safeTop || rect.top > safeBottom) {
        if (this.floatingToolbar) {
          this.floatingToolbar.style.opacity = '0';
          this.floatingToolbar.style.pointerEvents = 'none';
        }
        return;
      }

      this.model.selectedRange = range.cloneRange();
      this.model.selectedText = text;

      let pageWrapper = null;
      const startNode = range.startContainer;
      const element = startNode.nodeType === Node.ELEMENT_NODE ? startNode : startNode.parentElement;
      if (element) pageWrapper = element.closest('.pdf-page-wrapper');
      if (!pageWrapper) pageWrapper = this.viewportEl.querySelector('.pdf-page-wrapper');

      const pageNumber = pageWrapper?.dataset?.page ? Number(pageWrapper.dataset.page) : this.model.currentPage;
      this.model.selectedPage = pageNumber;
      this.model.selectedRects = this.computeSelectionRects(range, pageWrapper, this.model.scale);

      if (this.highlightActionMenu) this.highlightActionMenu.style.display = 'none';

      if (this.model.isDrawMode && this.model.drawTool === 'highlighter') {
        if (this.floatingToolbar) {
          this.floatingToolbar.style.opacity = '0';
          this.floatingToolbar.style.pointerEvents = 'none';
        }
        return;
      }

      const rects = Array.from(range.getClientRects()).filter(r => r.width > 0 && r.height > 0);
      const firstRect = rects.length > 0 ? rects[0] : rect;
      const lastRect = rects.length > 0 ? rects[rects.length - 1] : rect;

      this.positionAnnotationToolbar(this.floatingToolbar, firstRect, lastRect, safeTop, safeBottom);
      requestAnimationFrame(() => {
        this.floatingToolbar.style.opacity = '1';
        this.floatingToolbar.style.pointerEvents = 'auto';
      });
    }
  }

  renderDrawerAnnotations() {
    const container = document.getElementById('annotations-list');
    if (!container) return;
    container.innerHTML = '';

    const annots = this.model.annotations;
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

    annots.forEach(annot => {
      const item = document.createElement('div');
      item.className = 'annotation-item';
      const colorMeta = this.model.getColorMetadata(annot.color);
      item.style.borderLeftColor = colorMeta ? colorMeta.color : '#ffeb3b';

      item.innerHTML = `
        <div class="annotation-item-header">
          <span class="annotation-page">Page ${annot.page}</span>
          <div style="display:flex; gap:6px;">
            <button type="button" class="btn btn-icon delete-annot-btn" title="Delete" aria-label="Delete annotation on page ${annot.page}" style="padding:2px 6px; font-size:0.8rem;"><svg class="ui-icon" aria-hidden="true" focusable="false"><use href="./icons.svg#trash"></use></svg></button>
          </div>
        </div>
        <div class="annotation-text">"${annot.text}"</div>
        ${annot.comment ? `<div class="annotation-comment" style="margin-top:6px; font-size:0.82rem; color:var(--text-secondary); font-style:italic;"><svg class="ui-icon" aria-hidden="true" focusable="false"><use href="./icons.svg#comment"></use></svg> ${annot.comment}</div>` : ''}
      `;

      item.onclick = (e) => {
        if (!e.target.closest('button') && this.onPageNeedsRefresh) {
          this.onPageNeedsRefresh(annot.page);
        }
      };

      const delBtn = item.querySelector('.delete-annot-btn');
      if (delBtn) {
        delBtn.onclick = async (e) => {
          e.stopPropagation();
          // Optimistic remove from model
          this.model.setAnnotations((this.model.annotations || []).filter(a => String(a.id) !== String(annot.id)));
          if (typeof localDB !== 'undefined' && typeof localDB.saveCachedAnnotations === 'function') {
            localDB.saveCachedAnnotations(this.model.bookId, this.model.annotations).catch(() => {});
          }
          if (typeof localDB !== 'undefined' && typeof localDB.enqueueOutboxOp === 'function') {
            await localDB.enqueueOutboxOp({
              id: `op_del_${annot.id}`,
              type: 'annotation',
              action: 'delete',
              bookId: this.model.bookId,
              entityId: annot.id
            }).catch(() => {});
          }
          this.renderDrawerAnnotations();
          this.refreshPageHighlights(annot.page);
          try {
            await api.deleteAnnotation(annot.id);
            if (typeof localDB !== 'undefined' && typeof localDB.removeOutboxOp === 'function') {
              await localDB.removeOutboxOp(`op_del_${annot.id}`).catch(() => {});
            }
            await this.refreshAnnotations();
          } catch (delErr) {
            console.warn('[ReaderAnnotationViewModel] Delete failed, queued in outbox:', delErr);
          }
          this.refreshPageHighlights(annot.page);
        };
      }

      container.appendChild(item);
    });
  }
}

window.ReaderAnnotationViewModel = ReaderAnnotationViewModel;
