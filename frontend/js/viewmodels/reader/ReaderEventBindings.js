/** Binds reader UI events; timers and selection state remain owned by ReaderViewModel. */
class ReaderEventBindings {
  constructor(reader) {
    this.reader = reader;
  }

  bind() {
    const reader = this.reader;
    reader.toolbar.bindAllEvents();
    reader.selectionLoupe.bindEvents();
    reader.annotations.renderFloatingColors();

    let isPointerDown = false;

    window.addEventListener('pointerdown', (e) => {
      if (e.button === 0) isPointerDown = true;
    }, true);

    window.addEventListener('pointerup', () => {
      if (isPointerDown) {
        isPointerDown = false;
        setTimeout(() => reader.annotations.updateFloatingToolbar(), 40);
      }
    }, true);

    document.addEventListener('selectionchange', () => {
      if (reader.drawing.textHighlight.isSelecting) return;
      if (isPointerDown) {
        if (reader.floatingToolbar) {
          reader.floatingToolbar.style.opacity = '0';
          reader.floatingToolbar.style.pointerEvents = 'none';
        }
        return;
      }
      clearTimeout(reader.selectionTimeout);
      reader.selectionTimeout = setTimeout(() => reader.annotations.updateFloatingToolbar(), 80);
    });

    document.addEventListener('pointerdown', (e) => {
      const target = e.target instanceof Element ? e.target : null;
      if (!target) return;

      if (!target.closest('#reader-quick-highlight-palette')) {
        reader.annotations.hideQuickHighlightPalette();
      }

      if (!target.closest('#highlight-action-menu') && !target.closest('.pdf-highlight-rect')) {
        if (reader.highlightActionMenu) {
          reader.highlightActionMenu.style.display = 'none';
          reader.model.activeHighlight = null;
        }
      }

      const clickedSelectionToolbar = target.closest('#floating-toolbar');
      const clickedControls = target.closest('#reader-header, #reader-footer, #highlight-action-menu, .drawing-toolbar, .drawer, button, select, input');
      const isInsideReaderBody = Boolean(target.closest('#reader-body'));
      if (!clickedSelectionToolbar && !clickedControls && !isInsideReaderBody) {
        reader.annotations.clearTextSelection();
      }
    });

    reader.bodyEl.addEventListener('scroll', () => {
      reader.annotations.hideQuickHighlightPalette();
      if (reader.model.selectedRange) {
        reader.annotations.updateFloatingToolbar();
      }
    }, { passive: true });
    window.addEventListener('resize', () => {
      reader.annotations.hideQuickHighlightPalette();
      if (reader.container.style.display === 'flex' && reader.model.fitMode) {
        clearTimeout(reader.resizeFitTimeout);
        reader.resizeFitTimeout = setTimeout(async () => {
          if (reader.model.fitMode === 'width') {
            const scale = await reader.nav.calculateFitWidthScale();
            if (Math.abs(scale - reader.model.scale) > 0.02) {
              reader.nav.setZoom(scale, false);
            }
          } else if (reader.model.fitMode === 'page') {
            const scale = await reader.nav.calculateFitPageScale();
            if (Math.abs(scale - reader.model.scale) > 0.02) {
              reader.nav.setZoom(scale, false);
            }
          }
        }, 150);
      }
    });

    // Dismiss floating toolbar copy/note buttons
    document.getElementById('floating-copy-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (reader.model.selectedText) {
        navigator.clipboard.writeText(ReaderModel.normalizeText(reader.model.selectedText));
        if (reader.floatingToolbar) {
          reader.floatingToolbar.style.opacity = '0';
          reader.floatingToolbar.style.pointerEvents = 'none';
        }
      }
    });

    document.getElementById('floating-note-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const note = prompt('Add note to this quote:');
      if (note !== null) {
        reader.annotations.applyHighlight(reader.model.colors[0]?.id || 'yellow', note);
      }
    });

    // Highlight action menu: delete & edit
    document.getElementById('highlight-action-delete-btn')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (reader.model.activeHighlight) {
        const id = reader.model.activeHighlight.id;
        const page = reader.model.activeHighlight.page;
        await api.deleteAnnotation(id);
        reader.highlightActionMenu.style.display = 'none';
        reader.model.activeHighlight = null;
        await reader.annotations.refreshAnnotations();
        reader.annotations.refreshPageHighlights(page);
      }
    });

    document.getElementById('highlight-action-note-btn')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (reader.model.activeHighlight) {
        const annot = reader.model.activeHighlight;
        const currentNote = annot.comment || '';
        const newNote = prompt('Edit / Add note to this highlight:', currentNote);
        if (newNote !== null) {
          await api.updateAnnotation(annot.id, { comment: newNote });
          reader.highlightActionMenu.style.display = 'none';
          reader.model.activeHighlight = null;
          await reader.annotations.refreshAnnotations();
          reader.annotations.refreshPageHighlights(annot.page);
        }
      }
    });
  }

}
