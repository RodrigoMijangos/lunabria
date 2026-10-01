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

  async applyHighlight(colorId, comment = "", options = {}) {
    const range = this.model.selectedRange;
    const text = this.model.selectedText;
    if (!range || !text) return;
    const selection = window.getSelection();
    const activeRange = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
    const shouldClearSelection = () => {
      if (!selection || !activeRange || selection.rangeCount !== 1) return false;
      const current = selection.getRangeAt(0);
      return current.startContainer === activeRange.startContainer &&
        current.startOffset === activeRange.startOffset &&
        current.endContainer === activeRange.endContainer &&
        current.endOffset === activeRange.endOffset;
    };

    let pageWrapper = null;
    const startNode = range.startContainer;
    const element = startNode.nodeType === Node.ELEMENT_NODE ? startNode : startNode.parentElement;
    if (element) pageWrapper = element.closest('.pdf-page-wrapper');
    if (!pageWrapper) pageWrapper = this.viewportEl.querySelector('.pdf-page-wrapper');

    const pageNumber = pageWrapper?.dataset?.page ? Number(pageWrapper.dataset.page) : this.model.currentPage;
    const pageRect = (pageWrapper || this.viewportEl).getBoundingClientRect();
    const currentScale = this.model.scale;
    const selectionBounds = range.getBoundingClientRect();

    const clientRects = Array.from(range.getClientRects()).filter(r => r.width > 2 && r.height > 2);
    const lineSpans = Array.from(pageWrapper.querySelectorAll('.precise-line'));

    const relativeRects = clientRects.map(cr => {
      const midY = cr.top + cr.height / 2;
      const lineSpan = lineSpans.find(s => {
        const sr = s.getBoundingClientRect();
        return midY >= sr.top - 6 && midY <= sr.bottom + 6;
      });

      if (lineSpan && lineSpan.dataset.y0) {
        const lineX0 = parseFloat(lineSpan.dataset.x0);
        const lineY0 = parseFloat(lineSpan.dataset.y0);
        const lineX1 = parseFloat(lineSpan.dataset.x1);
        const lineY1 = parseFloat(lineSpan.dataset.y1);

        const selLeft = (cr.left - pageRect.left) / currentScale;
        const selRight = (cr.right - pageRect.left) / currentScale;

        const x0 = Math.max(lineX0, Math.min(lineX1, selLeft));
        const x1 = Math.min(lineX1, Math.max(lineX0, selRight));
        const y0 = Math.max(0, lineY0 - 1.2);
        const y1 = lineY1 + 1.2;

        return {
          x0: Math.round(x0 * 100) / 100,
          y0: Math.round(y0 * 100) / 100,
          x1: Math.round(x1 * 100) / 100,
          y1: Math.round(y1 * 100) / 100
        };
      } else {
        const x0 = (cr.left - pageRect.left) / currentScale;
        const y0 = (cr.top - pageRect.top) / currentScale;
        return {
          x0: Math.round(x0 * 100) / 100,
          y0: Math.round(y0 * 100) / 100,
          x1: Math.round((x0 + cr.width / currentScale) * 100) / 100,
          y1: Math.round((y0 + cr.height / currentScale) * 100) / 100
        };
      }
    });

    const mergedRects = ReaderModel.mergeLineRects(relativeRects);
    const colorMeta = this.model.getColorMetadata(colorId);
    const cleanText = ReaderModel.normalizeText(text);

    const annotData = {
      book_id: this.model.bookId,
      page: pageNumber,
      color: colorId,
      category: colorMeta?.name || '',
      text: cleanText,
      comment: comment,
      rects: mergedRects
    };

    const savedAnnotation = await api.createAnnotation(this.model.bookId, annotData);
    if (this.floatingToolbar) {
      this.floatingToolbar.style.opacity = '0';
      this.floatingToolbar.style.pointerEvents = 'none';
    }
    if (shouldClearSelection()) selection.removeAllRanges();

    await this.refreshAnnotations();
    const refreshed = this.refreshPageHighlights(pageNumber);
    if (!refreshed && this.model.viewMode !== 'flow' && this.onPageNeedsRefresh) {
      this.onPageNeedsRefresh(this.model.currentPage);
    }
    if (options.showQuickPalette) {
      this.openQuickHighlightPalette(savedAnnotation, pageNumber, selectionBounds);
    }
  }

  async refreshAnnotations() {
    const annots = await api.getAnnotations(this.model.bookId);
    this.model.setAnnotations(annots);
    this.renderDrawerAnnotations();
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
    const targetPage = pageNumber || this.model.currentPage;
    const wrapper = document.getElementById(`pdf-page-${targetPage}`) || this.viewportEl.querySelector(`.pdf-page-wrapper[data-page="${targetPage}"]`);
    if (wrapper) {
      const hlLayer = wrapper.querySelector('.pdf-highlight-layer');
      if (hlLayer) {
        this.renderPageHighlights(hlLayer, targetPage);
        return true;
      }
    }
    return false;
  }

  openHighlightMenu(annot, highlightEl) {
    this.hideQuickHighlightPalette();
    this.model.activeHighlight = annot;
    if (this.floatingToolbar) this.floatingToolbar.style.display = 'none';

    const rect = highlightEl.getBoundingClientRect();
    this.highlightActionMenu.style.left = `${rect.left + rect.width / 2}px`;
    this.highlightActionMenu.style.top = `${rect.top - 8}px`;
    this.highlightActionMenu.style.display = 'flex';

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
          await this.changeHighlightColor(annot.id, c.id);
        };
        colorsContainer.appendChild(btn);
      });
    }
  }

  openQuickHighlightPalette(annot, pageNumber, fallbackBounds = null) {
    const palette = document.getElementById('reader-quick-highlight-palette');
    if (!palette || !annot?.id) return;

    if (this.highlightActionMenu) this.highlightActionMenu.style.display = 'none';
    this.model.activeHighlight = null;

    const pageWrapper = document.getElementById(`pdf-page-${pageNumber}`) ||
      this.viewportEl.querySelector(`.pdf-page-wrapper[data-page="${pageNumber}"]`);
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
        await this.changeHighlightColor(annot.id, color.id, pageNumber);
      });
      colorContainer.appendChild(button);
    });

    palette.replaceChildren(colorContainer);
    palette.style.display = 'flex';
    palette.style.opacity = '0';
    palette.style.pointerEvents = 'auto';
    palette.setAttribute('aria-hidden', 'false');

    const paletteBounds = palette.getBoundingClientRect();
    const left = Math.max(paletteBounds.width / 2 + 8, Math.min(
      window.innerWidth - paletteBounds.width / 2 - 8,
      bounds.left + bounds.width / 2
    ));
    const opensBelow = bounds.top < paletteBounds.height + 16;
    palette.style.left = `${left}px`;
    palette.style.top = `${opensBelow ? bounds.bottom : bounds.top - 8}px`;
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

  async changeHighlightColor(annotId, newColorId, pageNumber = this.model.currentPage) {
    const colorMeta = this.model.getColorMetadata(newColorId);
    await api.updateAnnotation(annotId, {
      color: newColorId,
      category: colorMeta?.name || ''
    });
    if (this.highlightActionMenu) this.highlightActionMenu.style.display = 'none';
    this.hideQuickHighlightPalette();
    this.model.activeHighlight = null;
    await this.refreshAnnotations();
    this.refreshPageHighlights(pageNumber);
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
      if (range && range.startContainer && range.startContainer.nodeType === Node.TEXT_NODE) {
        const textContent = range.startContainer.textContent;
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
            const colorId = this.model.getHighlightColorIdFromHex(this.model.drawColor);
            this.applyHighlight(colorId, '', { showQuickPalette: true });
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
      btn.className = 'color-dot-btn';
      btn.style.backgroundColor = c.color;
      btn.title = c.name;
      btn.onclick = () => this.applyHighlight(c.id);
      colorContainer.appendChild(btn);
    });
  }

  clearTextSelection() {
    window.getSelection()?.removeAllRanges();
    this.model.selectedRange = null;
    this.model.selectedText = '';
    if (this.floatingToolbar) {
      this.floatingToolbar.style.opacity = '0';
      this.floatingToolbar.style.pointerEvents = 'none';
    }
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
      this.model.selectedRange = range;
      this.model.selectedText = text;

      if (this.highlightActionMenu) this.highlightActionMenu.style.display = 'none';

      if (this.model.isDrawMode && this.model.drawTool === 'highlighter') {
        if (this.floatingToolbar) {
          this.floatingToolbar.style.opacity = '0';
          this.floatingToolbar.style.pointerEvents = 'none';
        }
        return;
      }

      const tbWidth = 240;
      const left = Math.max(tbWidth / 2 + 10, Math.min(window.innerWidth - tbWidth / 2 - 10, rect.left + rect.width / 2));
      const top = Math.max(64, rect.top - 14);

      this.floatingToolbar.style.left = `${left}px`;
      this.floatingToolbar.style.top = `${top}px`;
      this.floatingToolbar.style.display = 'flex';
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
          <p style="font-size: 1.8rem; margin-bottom: 8px;">🖍️</p>
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
            <button type="button" class="btn btn-icon delete-annot-btn" title="Delete" style="padding:2px 6px; font-size:0.8rem;">🗑️</button>
          </div>
        </div>
        <div class="annotation-text">"${annot.text}"</div>
        ${annot.comment ? `<div class="annotation-comment" style="margin-top:6px; font-size:0.82rem; color:var(--text-secondary); font-style:italic;">💬 ${annot.comment}</div>` : ''}
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
          await api.deleteAnnotation(annot.id);
          await this.refreshAnnotations();
          this.refreshPageHighlights(annot.page);
        };
      }

      container.appendChild(item);
    });
  }
}

window.ReaderAnnotationViewModel = ReaderAnnotationViewModel;
