/**
 * ReaderToolbarManager.js
 * Manages event binding for reader controls, drawing toolbar, accessibility modal, and keyboard shortcuts.
 */
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
    this.drawerToggle = document.getElementById('reader-drawer-toggle-btn');
    this.notesToggle = document.getElementById('reader-notes-toggle-btn');
    this.activeDrawerTab = 'chapters';
    this.drawerReturnFocus = null;
    this.onClose = coordinators.onClose;
    this.onDownloadOffline = coordinators.onDownloadOffline;
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
    document.getElementById('reader-jump-return-btn')?.addEventListener('click', () => {
      this.onReturnToPreviousReadingPoint?.();
    });
    document.getElementById('reader-jump-dismiss-btn')?.addEventListener('click', () => {
      this.onDismissJumpBreadcrumb?.();
    });
  }

  bindReaderHeaderEvents() {
    // Back to library
    document.getElementById('reader-back-btn')?.addEventListener('click', () => {
      if (this.onClose) this.onClose();
    });

    document.getElementById('reader-top-bar')?.addEventListener('click', (e) => {
      const btn = e.target && typeof e.target.closest === 'function' ? e.target.closest('button') : null;
      if (btn && typeof btn.blur === 'function') btn.blur();
    });

    // View Mode Dropdown
    document.getElementById('view-mode-select')?.addEventListener('change', (e) => {
      this.nav.setViewMode(e.target.value);
    });

    // Navigation buttons
    document.getElementById('reader-prev-btn')?.addEventListener('click', () => this.nav.prevPage());
    document.getElementById('reader-next-btn')?.addEventListener('click', () => this.nav.nextPage());

    // Page input
    const pageInput = document.getElementById('reader-page-input');
    if (pageInput) {
      pageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.nav.handlePageInputSubmit();
        }
      });
      pageInput.addEventListener('blur', () => this.nav.handlePageInputSubmit());
    }

    // Scrubber
    const scrubber = document.getElementById('reader-scrubber');
    if (scrubber) {
      scrubber.addEventListener('input', (e) => {
        this.nav.goToPage(Number(e.target.value));
      });
    }

    // Zoom buttons
    document.getElementById('reader-zoom-in-btn')?.addEventListener('click', () => this.nav.zoomIn());
    document.getElementById('reader-zoom-out-btn')?.addEventListener('click', () => this.nav.zoomOut());
    document.getElementById('reader-zoom-reset-btn')?.addEventListener('click', () => this.nav.resetZoom());
    document.getElementById('reader-fit-width-btn')?.addEventListener('click', () => this.nav.fitWidth());
    document.getElementById('reader-fit-page-btn')?.addEventListener('click', () => this.nav.fitPage());

    // Fullscreen toggle
    document.getElementById('reader-fullscreen-btn')?.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    });

    // Drawer toggles (TOC & Notes)
    this.drawerToggle?.addEventListener('click', () => {
      this.toggleDrawerTab('chapters');
    });
    this.notesToggle?.addEventListener('click', () => {
      this.toggleDrawerTab('notes');
    });

    document.getElementById('reader-offline-btn')?.addEventListener('click', () => {
      this.downloadBookForOfflineUse();
    });
  }

  setOfflineStatus({ pdfCached = false, layoutsCached = false } = {}) {
    const button = document.getElementById('reader-offline-btn');
    if (!button) return;
    const isComplete = Boolean(pdfCached && layoutsCached);
    button.dataset.cached = String(isComplete);
    button.dataset.pdfCached = String(Boolean(pdfCached));
    button.disabled = false;

    if (isComplete) {
      button.innerHTML = '<svg class="ui-icon" aria-hidden="true" focusable="false"><use href="./icons.svg#circle-check"></use></svg><span class="hud-btn-label"> Offline</span>';
      button.title = 'The PDF and all layouts are saved for offline reading';
    } else if (pdfCached) {
      button.innerHTML = '<svg class="ui-icon" aria-hidden="true" focusable="false"><use href="./icons.svg#download"></use></svg><span class="hud-btn-label"> Layouts</span>';
      button.title = 'The PDF is saved. Download layouts to complete offline access';
    } else {
      button.innerHTML = '<svg class="ui-icon" aria-hidden="true" focusable="false"><use href="./icons.svg#download"></use></svg><span class="hud-btn-label"> Offline</span>';
      button.title = 'Save the PDF and layouts in browser for offline reading';
    }
  }

  async downloadBookForOfflineUse() {
    const button = document.getElementById('reader-offline-btn');
    if (!button || button.disabled || button.dataset.cached === 'true' || !this.onDownloadOffline) return;

    const requestedBookId = this.model.bookId;
    button.disabled = true;
    button.innerHTML = '<svg class="ui-icon ui-icon-spin" aria-hidden="true" focusable="false"><use href="./icons.svg#loader"></use></svg><span class="hud-btn-label"> Saving</span>';
    try {
      await this.onDownloadOffline((progress) => {
        if (this.model.bookId !== requestedBookId) return;
        if (progress.stage === 'pdf') {
          button.innerHTML = '<svg class="ui-icon ui-icon-spin" aria-hidden="true" focusable="false"><use href="./icons.svg#loader"></use></svg><span class="hud-btn-label"> Downloading PDF</span>';
        } else if (progress.stage === 'pdf-complete') {
          button.dataset.pdfCached = 'true';
          button.innerHTML = '<svg class="ui-icon ui-icon-spin" aria-hidden="true" focusable="false"><use href="./icons.svg#loader"></use></svg><span class="hud-btn-label"> Preparing layouts</span>';
        } else if (progress.stage === 'layouts') {
          button.innerHTML = `<svg class="ui-icon ui-icon-spin" aria-hidden="true" focusable="false"><use href="./icons.svg#loader"></use></svg><span class="hud-btn-label"> Layouts ${progress.completed}/${progress.total}</span>`;
        }
      });
      if (this.model.bookId === requestedBookId) {
        this.setOfflineStatus({ pdfCached: true, layoutsCached: true });
      }
    } catch (error) {
      console.error('[ReaderToolbarManager] Incomplete offline download:', error);
      if (this.model.bookId === requestedBookId) {
        button.innerHTML = button.dataset.pdfCached === 'true'
                  ? '<svg class="ui-icon" aria-hidden="true" focusable="false"><use href="./icons.svg#warning"></use></svg><span class="hud-btn-label"> Retry layouts</span>'
                  : '<svg class="ui-icon" aria-hidden="true" focusable="false"><use href="./icons.svg#warning"></use></svg><span class="hud-btn-label"> Retry</span>';
        button.title = error.message || 'Could not complete offline download';
      }
    } finally {
      button.disabled = false;
    }
  }

  bindDrawerEvents() {
    const tabs = [
      { name: 'chapters', button: document.getElementById('drawer-tab-chapters'), panel: document.getElementById('table-of-contents-panel') },
      { name: 'notes', button: document.getElementById('drawer-tab-notes'), panel: document.getElementById('drawer-notes-panel') }
    ];
    tabs.forEach((tab, index) => {
      tab.button?.addEventListener('click', () => this.activateDrawerTab(tab.name));
      tab.button?.addEventListener('keydown', event => {
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
    this.drawer?.addEventListener('keydown', event => this.handleDrawerKeydown(event));
    this.drawerBackdrop?.addEventListener('click', () => this.toggleDrawer(false));
    document.getElementById('drawer-close-btn')?.addEventListener('click', () => this.toggleDrawer(false));
    document.getElementById('drawer-view-mode-btn')?.addEventListener('click', () => {
      this.toggleDrawer(false);
      this.nav.setViewMode('notes');
    });
    this.bindExportControls();
  }

  bindExportControls() {
    const exportBtn = document.getElementById('export-notes-btn');
    this.exportFormatSelect = document.getElementById('export-format-select');
    this.exportScopeSelect = document.getElementById('export-scope-select');
    this.exportSectionSelect = document.getElementById('export-section-select');
    this.exportPageInput = document.getElementById('export-page-input');
    this.exportStartPageInput = document.getElementById('export-start-page-input');
    this.exportEndPageInput = document.getElementById('export-end-page-input');
    this.exportStatus = document.getElementById('export-status');
    this.exportSelectionCount = document.getElementById('export-selection-count');
    this.exportSectionTrigger = document.getElementById('export-section-trigger');
    this.exportSectionMenu = document.getElementById('export-section-menu');
    this.exportSectionPicker = document.getElementById('export-section-picker');
    this.exportBusy = false;
    this.exportSectionsBookId = null;

    this.exportSectionTrigger?.addEventListener('click', (e) => {
      e.stopPropagation();
      const isExpanded = this.exportSectionTrigger.getAttribute('aria-expanded') === 'true';
      this.toggleExportSectionMenu(!isExpanded);
    });

    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('click', (e) => {
        if (!this.exportSectionPicker?.contains(e.target)) {
          this.toggleExportSectionMenu(false);
        }
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.exportSectionPicker?.classList?.contains('is-open')) {
          this.toggleExportSectionMenu(false);
          this.exportSectionTrigger?.focus();
        }
      });
    }

    document.getElementById('export-clear-selection-btn')?.addEventListener('click', () => {
      this.model.clearAnnotationExportSelection?.();
      this.drawer?.querySelectorAll('.annotation-export-checkbox').forEach(checkbox => {
        checkbox.checked = false;
      });
      this.updateExportSelectionCount();
    });

    document.getElementById('annotations-list')?.addEventListener('change', event => {
      const checkbox = event.target;
      if (!checkbox?.classList?.contains('annotation-export-checkbox')) return;
      const annotationId = checkbox.dataset.annotationId;
      if (!annotationId || !this.model.setAnnotationExportSelected?.(annotationId, checkbox.checked)) return;
      this.updateExportSelectionCount();
    });

    this.exportScopeSelect?.addEventListener('change', () => {
      this.setExportStatus('');
      this.updateExportScopeFields();
      if (this.exportScopeSelect.value === 'section') this.loadExportSections();
    });
    for (const input of [this.exportSectionSelect, this.exportPageInput, this.exportStartPageInput, this.exportEndPageInput]) {
      input?.addEventListener('input', () => {
        this.updateExportButtonState();
        if (input === this.exportSectionSelect) this.updateExportSectionBadge();
      });
      input?.addEventListener('change', () => {
        this.updateExportButtonState();
        if (input === this.exportSectionSelect) this.updateExportSectionBadge();
      });
    }

    const updateExportServerState = () => {
      const isUnavailable = window.serverConnectivity?.state === 'unavailable';
      if (exportBtn) {
        exportBtn.title = isUnavailable
          ? 'Export is unavailable because the Lunabria server cannot be reached'
          : 'Export annotations';
      }
      if (this.exportFormatSelect) {
        this.exportFormatSelect.title = isUnavailable
          ? 'The Lunabria server cannot be reached'
          : 'Select export format';
      }
      if (isUnavailable && !this.exportBusy) {
        this.setExportStatus('Export requires a connection to the Lunabria server.');
      } else if (this.exportStatus?.textContent === 'Export requires a connection to the Lunabria server.') {
        this.setExportStatus('');
      }
      this.updateExportButtonState();
    };

    window.addEventListener('lunabria:server-connectivity-change', updateExportServerState);
    updateExportServerState();

    exportBtn?.addEventListener('click', () => this.exportAnnotations());
    this.updateExportScopeFields();
    this.updateExportSelectionCount();
  }

  updateExportScopeFields() {
    const scope = this.exportScopeSelect?.value || 'all';
    const fields = {
      section: document.getElementById('export-section-field'),
      page: document.getElementById('export-page-field'),
      range: document.getElementById('export-range-field'),
      selected: document.getElementById('export-selection-field')
    };
    for (const [name, element] of Object.entries(fields)) {
      if (element) element.hidden = scope !== name;
    }
    if (scope !== 'section') {
      const badge = document.getElementById('export-section-badge');
      if (badge) badge.hidden = true;
    } else {
      this.updateExportSectionBadge();
    }

    const currentPage = Number(this.model.currentPage) || 1;
    const totalPages = Number(this.model.totalPages);
    if (this.exportPageInput) {
      this.exportPageInput.max = totalPages > 0 ? String(totalPages) : '';
      if (!this.exportPageInput.value) this.exportPageInput.value = String(currentPage);
    }
    if (this.exportStartPageInput && !this.exportStartPageInput.value) {
      this.exportStartPageInput.value = String(currentPage);
    }
    if (this.exportEndPageInput && !this.exportEndPageInput.value) {
      this.exportEndPageInput.value = String(currentPage);
    }
    if (this.exportStartPageInput) this.exportStartPageInput.max = totalPages > 0 ? String(totalPages) : '';
    if (this.exportEndPageInput) this.exportEndPageInput.max = totalPages > 0 ? String(totalPages) : '';

    const exportLabel = document.getElementById('export-notes-label');
    if (exportLabel) exportLabel.textContent = scope === 'selected' ? 'Export selected' : 'Export';
    this.updateExportButtonState();
  }

  updateExportSelectionCount() {
    const count = this.model.selectedAnnotationIds?.size || 0;
    if (this.exportSelectionCount) {
      this.exportSelectionCount.textContent = `${count} annotation${count === 1 ? '' : 's'} selected`;
    }
    const clearButton = document.getElementById('export-clear-selection-btn');
    if (clearButton) clearButton.disabled = count === 0;
    this.updateExportButtonState();
  }

  updateExportButtonState() {
    const exportBtn = document.getElementById('export-notes-btn');
    if (!exportBtn) return;
    const unavailable = window.serverConnectivity?.state === 'unavailable';
    const requiresSelection = this.exportScopeSelect?.value === 'selected';
    const noSelection = (this.model.selectedAnnotationIds?.size || 0) === 0;
    const requiresSection = this.exportScopeSelect?.value === 'section';
    const noSection = !this.exportSectionSelect || this.exportSectionSelect.disabled || !this.exportSectionSelect.value;
    exportBtn.disabled = this.exportBusy || unavailable ||
      (requiresSelection && noSelection) || (requiresSection && noSection);
  }

  setExportStatus(message) {
    if (this.exportStatus) this.exportStatus.textContent = message;
  }

  toggleExportSectionMenu(open) {
    if (!this.exportSectionMenu || !this.exportSectionTrigger) return;
    this.exportSectionMenu.hidden = !open;
    this.exportSectionTrigger.setAttribute('aria-expanded', String(open));
    this.exportSectionPicker?.classList?.toggle?.('is-open', open);
  }

  async loadExportSections() {
    const bookId = Number(this.model.bookId);
    if (!bookId || !this.exportSectionSelect || this.exportSectionsBookId === bookId) return;
    this.exportSectionsBookId = bookId;
    this.exportSectionSelect.disabled = true;
    if (this.exportSectionTrigger) this.exportSectionTrigger.disabled = true;
    this.exportSectionSelect.replaceChildren();
    if (this.exportSectionMenu) this.exportSectionMenu.replaceChildren();
    const loadingOption = document.createElement('option');
    loadingOption.value = '';
    loadingOption.textContent = 'Loading chapters…';
    this.exportSectionSelect.appendChild(loadingOption);
    this.setExportStatus('');

    try {
      if (typeof api === 'undefined' || typeof api.getAnnotationExportSections !== 'function') {
        throw new Error('Chapter export is not available.');
      }
      const result = await api.getAnnotationExportSections(bookId);
      if (Number(this.model.bookId) !== bookId) return;

      this.exportSections = Array.isArray(result?.sections) ? result.sections : [];
      this.exportSectionSelect.replaceChildren();
      if (this.exportSectionMenu) this.exportSectionMenu.replaceChildren();

      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'Choose a chapter or section';
      this.exportSectionSelect.appendChild(placeholder);

      const minLevel = this.exportSections.reduce((min, s) => {
        const lvl = Number.isInteger(s.level) ? s.level : 1;
        return lvl < min ? lvl : min;
      }, Infinity);
      const baseLevel = Number.isFinite(minLevel) ? minLevel : 1;

      for (const section of this.exportSections) {
        const rawLevel = Number.isInteger(section.level) ? section.level : baseLevel;
        const level = Math.max(0, rawLevel - baseLevel);
        const option = document.createElement('option');
        option.value = String(section.index);
        option.setAttribute('data-level', String(level));

        const pageLabel = `(pages ${section.page_start}–${section.page_end})`;
        let indentPrefix = '';
        if (level === 0) {
          indentPrefix = '';
        } else if (level === 1) {
          indentPrefix = '    - ';
        } else if (level === 2) {
          indentPrefix = '        • ';
        } else {
          indentPrefix = '  '.repeat(level + 1) + '– ';
        }

        option.textContent = `${indentPrefix}${section.title} ${pageLabel}`;
        this.exportSectionSelect.appendChild(option);

        if (this.exportSectionMenu) {
          const itemBtn = document.createElement('button');
          itemBtn.type = 'button';
          const clampedLevel = Math.min(level, 5);
          itemBtn.className = `export-section-item export-section-level-${clampedLevel} ${level === 0 ? 'is-chapter' : (level === 1 ? 'is-section' : 'is-subsection')}`;
          itemBtn.setAttribute('data-index', String(section.index));
          itemBtn.style.paddingLeft = `${10 + clampedLevel * 14}px`;

          const iconSymbol = level === 0 ? 'book-open' : (level === 1 ? 'toc' : 'page');
          itemBtn.innerHTML = `
            <span class="export-section-item-content">
              <svg class="ui-icon export-section-item-icon" aria-hidden="true" focusable="false"><use href="./icons.svg#${iconSymbol}"></use></svg>
              <span class="export-section-item-title">${section.title}</span>
            </span>
            <span class="export-section-item-badge">pp. ${section.page_start}–${section.page_end}</span>
          `;

          itemBtn.addEventListener('click', () => {
            if (this.exportSectionSelect) {
              this.exportSectionSelect.value = String(section.index);
              this.exportSectionSelect.dispatchEvent(new Event('change', { bubbles: true }));
              this.exportSectionSelect.dispatchEvent(new Event('input', { bubbles: true }));
            }
            this.toggleExportSectionMenu(false);
            this.exportSectionTrigger?.focus();
          });

          this.exportSectionMenu.appendChild(itemBtn);
        }
      }

      const hasSections = this.exportSections.length > 0;
      this.exportSectionSelect.disabled = !hasSections;
      if (this.exportSectionTrigger) this.exportSectionTrigger.disabled = !hasSections;

      if (result.total_pages > 0) {
        for (const input of [this.exportPageInput, this.exportStartPageInput, this.exportEndPageInput]) {
          if (input) input.max = String(result.total_pages);
        }
      }
      if (!hasSections) {
        this.setExportStatus('No chapter list is available for this book. Choose a page or range instead.');
      }
      this.updateExportSectionBadge();
    } catch (error) {
      this.exportSections = [];
      this.exportSectionSelect.replaceChildren();
      if (this.exportSectionMenu) this.exportSectionMenu.replaceChildren();
      const unavailableOption = document.createElement('option');
      unavailableOption.value = '';
      unavailableOption.textContent = 'Chapters unavailable';
      this.exportSectionSelect.appendChild(unavailableOption);
      this.exportSectionSelect.disabled = true;
      if (this.exportSectionTrigger) this.exportSectionTrigger.disabled = true;
      this.setExportStatus(error.message || 'Could not load chapters. Choose a page or range instead.');
      this.updateExportSectionBadge();
    }
    this.updateExportButtonState();
  }

  updateExportSectionBadge() {
    const badge = document.getElementById('export-section-badge');
    const triggerText = document.getElementById('export-section-trigger-text');
    const triggerIcon = this.exportSectionTrigger?.querySelector('.export-section-trigger-icon');

    const selectedIndex = this.exportSectionSelect?.value;
    if (!selectedIndex || !Array.isArray(this.exportSections) || this.exportSections.length === 0) {
      if (badge) {
        badge.hidden = true;
        badge.textContent = '';
        badge.className = 'export-section-badge';
      }
      if (triggerText) triggerText.textContent = 'Choose a chapter or section';
      if (triggerIcon) triggerIcon.innerHTML = '<use href="./icons.svg#book-open"></use>';
      if (this.exportSectionMenu) {
        this.exportSectionMenu.querySelectorAll('.export-section-item').forEach(item => {
          item.classList.remove('is-selected');
        });
      }
      return;
    }

    const section = this.exportSections.find(s => String(s.index) === String(selectedIndex));
    if (!section) {
      if (badge) {
        badge.hidden = true;
        badge.textContent = '';
        badge.className = 'export-section-badge';
      }
      if (triggerText) triggerText.textContent = 'Choose a chapter or section';
      return;
    }

    const minLevel = this.exportSections.reduce((min, s) => {
      const lvl = Number.isInteger(s.level) ? s.level : 1;
      return lvl < min ? lvl : min;
    }, Infinity);
    const baseLevel = Number.isFinite(minLevel) ? minLevel : 1;
    const rawLevel = Number.isInteger(section.level) ? section.level : baseLevel;
    const level = Math.max(0, rawLevel - baseLevel);

    const iconSymbol = level === 0 ? 'book-open' : (level === 1 ? 'toc' : 'page');
    const typeLabel = level === 0 ? 'Chapter' : (level === 1 ? 'Section' : 'Subsection');

    if (triggerText) {
      triggerText.textContent = `${section.title} (pp. ${section.page_start}–${section.page_end})`;
    }
    if (triggerIcon) {
      triggerIcon.innerHTML = `<use href="./icons.svg#${iconSymbol}"></use>`;
    }

    if (this.exportSectionMenu) {
      this.exportSectionMenu.querySelectorAll('.export-section-item').forEach(item => {
        const isSelected = item.getAttribute('data-index') === String(section.index);
        item.classList.toggle('is-selected', isSelected);
      });
    }

    if (badge) {
      badge.hidden = false;
      badge.className = `export-section-badge ${level === 0 ? 'is-chapter' : (level === 1 ? 'is-section' : 'is-subsection')}`;
      badge.innerHTML = `
        <svg class="ui-icon" aria-hidden="true" focusable="false"><use href="./icons.svg#${iconSymbol}"></use></svg>
        <span class="export-badge-tag">${typeLabel}:</span>
        <span class="export-badge-title">${section.title}</span>
        <span class="export-badge-pages">Pages ${section.page_start}–${section.page_end}</span>
      `;
    }
  }

  _resolveExportFormatAndGrouping(formatValue) {
    const map = {
      md_hierarchy: { format: 'md', group_by: 'hierarchy' },
      md_color: { format: 'md', group_by: 'color' },
    };
    return map[formatValue] || { format: formatValue, group_by: 'color' };
  }

  _populateExportScopeOptions(options) {
    const parsePage = (input, label) => {
      const page = Number(input?.value);
      const totalPages = Number(this.model.totalPages);
      if (!Number.isInteger(page) || page < 1 || (totalPages > 0 && page > totalPages)) {
        throw new Error(`${label} must be between 1 and ${totalPages > 0 ? totalPages : 'the last page'}.`);
      }
      return page;
    };

    const scopePopulators = {
      page: () => {
        options.page = parsePage(this.exportPageInput, 'Page');
      },
      range: () => {
        options.start_page = parsePage(this.exportStartPageInput, 'Start page');
        options.end_page = parsePage(this.exportEndPageInput, 'End page');
        if (options.start_page > options.end_page) {
          throw new Error('The start page must not be after the end page.');
        }
      },
      section: () => {
        const sectionIndex = Number(this.exportSectionSelect?.value);
        if (!Number.isInteger(sectionIndex) || sectionIndex < 0) {
          throw new Error('Choose a chapter or section to export.');
        }
        options.section_index = sectionIndex;
      },
      selected: () => {
        options.annotation_ids = Array.from(this.model.selectedAnnotationIds || []);
        if (options.annotation_ids.length === 0) {
          throw new Error('Select at least one annotation to export.');
        }
      },
    };

    const populator = scopePopulators[options.scope];
    if (populator) populator();
  }

  buildExportOptions() {
    const formatValue = this.exportFormatSelect?.value || 'md_hierarchy';
    const { format, group_by } = this._resolveExportFormatAndGrouping(formatValue);
    const options = { format, group_by, scope: this.exportScopeSelect?.value || 'all' };
    this._populateExportScopeOptions(options);
    return options;
  }

  async ensureAnnotationsSynchronized() {
    if (typeof localDB === 'undefined' || typeof localDB.getPendingOutboxOps !== 'function') return;
    const bookId = Number(this.model.bookId);
    const pendingForBook = async () => {
      const ops = await localDB.getPendingOutboxOps();
      if (!Array.isArray(ops)) throw new Error('Could not verify pending annotation changes.');
      return ops.filter(op => Number(op.bookId) === bookId && op.type === 'annotation');
    };

    let pending = await pendingForBook();
    if (!pending.length) return;
    if (typeof localDB.processOutboxQueue !== 'function') {
      throw new Error('Sync pending annotations before exporting.');
    }
    this.setExportStatus('Syncing pending annotations…');
    await localDB.processOutboxQueue();
    pending = await pendingForBook();
    if (pending.length) {
      throw new Error('Some annotations are still waiting to sync. Try exporting again after synchronization completes.');
    }
    await this.annotations?.refreshAnnotations?.();
  }

  downloadExport(result) {
    if (!result?.blob || typeof URL.createObjectURL !== 'function') {
      throw new Error('The export file could not be downloaded in this browser.');
    }
    const objectUrl = URL.createObjectURL(result.blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = result.filename;
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }

  async exportAnnotations() {
    const monitor = window.serverConnectivity;
    const exportBtn = document.getElementById('export-notes-btn');
    this.exportBusy = true;
    this.updateExportButtonState();
    this.setExportStatus('Checking connection and pending changes…');
    try {
      if (monitor?.checkServer && !(await monitor.checkServer())) {
        throw new Error('Export requires a connection to the Lunabria server.');
      }
      await this.ensureAnnotationsSynchronized();
      const options = this.buildExportOptions();
      if (typeof api === 'undefined' || typeof api.exportAnnotations !== 'function') {
        throw new Error('Annotation export is not available.');
      }
      this.setExportStatus('Preparing export…');
      const result = await api.exportAnnotations(this.model.bookId, options);
      this.downloadExport(result);
      this.setExportStatus('Export downloaded.');
    } catch (error) {
      console.error('[ReaderToolbarManager] Annotation export failed:', error);
      this.setExportStatus(error.message || 'Annotation export failed.');
    } finally {
      this.exportBusy = false;
      this.updateExportButtonState();
      if (exportBtn && window.serverConnectivity?.state === 'unavailable') {
        exportBtn.title = 'Export is unavailable because the Lunabria server cannot be reached';
      }
    }
  }

  activateDrawerTab(name, focus = false) {
    const tabs = [
      { name: 'chapters', button: document.getElementById('drawer-tab-chapters'), panel: document.getElementById('table-of-contents-panel') },
      { name: 'notes', button: document.getElementById('drawer-tab-notes'), panel: document.getElementById('drawer-notes-panel') }
    ];
    const activeTab = tabs.find(tab => tab.name === name);
    if (!activeTab) return;

    this.activeDrawerTab = name;
    for (const tab of tabs) {
      const isActive = tab === activeTab;
      if (tab.button) {
        tab.button.classList.toggle('active', isActive);
        tab.button.setAttribute('aria-selected', String(isActive));
        tab.button.tabIndex = isActive ? 0 : -1;
      }
      if (tab.panel) tab.panel.hidden = !isActive;
    }

    if (name === 'chapters') this.tableOfContents?.render(this.model.currentPage);
    if (focus) activeTab.button?.focus?.();
  }

  handleDrawerKeydown(event) {
    if (!this.drawer?.classList.contains('open')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.toggleDrawer(false);
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = Array.from(this.drawer.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter(element => !element.closest?.('[hidden]') && !element.disabled);
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
    const isOpen = this.drawer.classList.contains('open');
    if (!isOpen) {
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
    const wasOpen = this.drawer.classList.contains('open');
    const isOpen = forceState !== null ? Boolean(forceState) : !wasOpen;
    if (wasOpen === isOpen) return;

    if (isOpen) this.drawerReturnFocus = document.activeElement || this.drawerToggle;
    this.drawer.classList.toggle('open', isOpen);
    this.drawer.inert = !isOpen;
    this.drawer.setAttribute('aria-hidden', String(!isOpen));
    this.drawerToggle?.setAttribute('aria-expanded', String(isOpen));
    this.notesToggle?.setAttribute('aria-expanded', String(isOpen));
    if (this.drawerBackdrop) this.drawerBackdrop.classList.toggle('open', isOpen);
    if (isOpen) {
      this.activateDrawerTab(this.activeDrawerTab);
      const initialFocus = document.getElementById('drawer-close-btn');
      initialFocus?.focus?.();
    } else {
      const returnFocus = this.drawerReturnFocus || this.drawerToggle;
      this.drawerReturnFocus = null;
      returnFocus?.focus?.();
    }
  }

  bindDrawingToolbarEvents() {
    document.getElementById('drawing-toolbar')?.addEventListener('click', (e) => {
      const btn = e.target && typeof e.target.closest === 'function' ? e.target.closest('button') : null;
      if (btn && typeof btn.blur === 'function') btn.blur();
    });
    document.getElementById('reader-draw-toggle-btn')?.addEventListener('click', () => this.drawing.toggleDrawMode());
    document.getElementById('floating-draw-btn')?.addEventListener('click', () => this.drawing.toggleDrawMode(true));

    document.getElementById('draw-tool-pen')?.addEventListener('click', () => this.drawing.setDrawTool('pen'));
    document.getElementById('draw-tool-highlighter')?.addEventListener('click', () => this.drawing.setDrawTool('highlighter'));
    document.getElementById('draw-tool-eraser')?.addEventListener('click', () => this.drawing.setDrawTool('eraser'));
    document.getElementById('draw-tool-pan')?.addEventListener('click', () => this.drawing.setDrawTool('pan'));

    document.querySelectorAll('.drawing-color-dot').forEach(dot => {
      dot.onclick = () => this.drawing.setDrawColor(dot.dataset.color);
    });

    document.querySelectorAll('.drawing-width-btn').forEach(btn => {
      btn.onclick = () => this.drawing.setDrawWidth(Number(btn.dataset.width));
    });

    document.getElementById('draw-action-toggle-tool')?.addEventListener('click', () => this.drawing.toggleDrawingTool());
    document.getElementById('draw-action-settings')?.addEventListener('click', () => this.openStylusAccessibilityModal());

    document.getElementById('stylus-modal-close-x')?.addEventListener('click', () => this.closeStylusAccessibilityModal());
    document.getElementById('stylus-modal-close-btn')?.addEventListener('click', () => this.closeStylusAccessibilityModal());

    const stylusModal = document.getElementById('stylus-accessibility-modal');
    stylusModal?.addEventListener('pointerdown', (e) => {
      if (e.target === stylusModal) this.closeStylusAccessibilityModal();
    });

    document.getElementById('setting-palm-rejection')?.addEventListener('change', (e) => {
      this.model.setAccessibilitySetting('palmRejection', e.target.value);
    });

    document.getElementById('setting-double-click-delay')?.addEventListener('change', (e) => {
      this.model.setAccessibilitySetting('doubleClickDelay', Number(e.target.value));
    });

    document.getElementById('setting-double-click-action')?.addEventListener('change', (e) => {
      this.model.setAccessibilitySetting('doubleClickAction', e.target.value);
    });

    document.getElementById('setting-pressure-curve')?.addEventListener('change', (e) => {
      this.model.setAccessibilitySetting('pressureSensitivity', e.target.value);
      this.drawing.reRenderAllCanvasStrokes();
    });

    document.getElementById('draw-action-undo')?.addEventListener('click', () => this.drawing.undoLastStroke());
    document.getElementById('draw-action-clear')?.addEventListener('click', () => this.drawing.clearCurrentPageDrawings());
    document.getElementById('draw-action-close')?.addEventListener('click', () => this.drawing.toggleDrawMode(false));

    // Draggable toolbar
    const toolbar = document.getElementById('drawing-toolbar');
    const handle = toolbar?.querySelector('.drawing-drag-handle');
    if (toolbar && handle) {
      let isDragging = false;
      let startX = 0, startY = 0, initialLeft = 0, initialTop = 0;

      handle.onpointerdown = (e) => {
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        const rect = toolbar.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;
        toolbar.style.left = `${initialLeft}px`;
        toolbar.style.top = `${initialTop}px`;
        toolbar.style.transform = 'none';
        handle.setPointerCapture(e.pointerId);
      };

      handle.onpointermove = (e) => {
        if (!isDragging) return;
        const maxLeft = Math.max(0, window.innerWidth - toolbar.offsetWidth);
        const maxTop = Math.max(0, window.innerHeight - toolbar.offsetHeight);
        const left = Math.max(0, Math.min(maxLeft, initialLeft + (e.clientX - startX)));
        const top = Math.max(0, Math.min(maxTop, initialTop + (e.clientY - startY)));
        toolbar.style.left = `${left}px`;
        toolbar.style.top = `${top}px`;
      };

      handle.onpointerup = (e) => {
        isDragging = false;
        try { handle.releasePointerCapture(e.pointerId); } catch(err) {}
      };
    }
  }

  openStylusAccessibilityModal() {
    const modal = document.getElementById('stylus-accessibility-modal');
    if (!modal) return;

    const palmSelect = document.getElementById('setting-palm-rejection');
    if (palmSelect) palmSelect.value = this.model.getAccessibilitySetting('palmRejection');

    const delaySelect = document.getElementById('setting-double-click-delay');
    if (delaySelect) delaySelect.value = String(this.model.getAccessibilitySetting('doubleClickDelay'));

    const actionSelect = document.getElementById('setting-double-click-action');
    if (actionSelect) actionSelect.value = this.model.getAccessibilitySetting('doubleClickAction');

    const pressureSelect = document.getElementById('setting-pressure-curve');
    if (pressureSelect) pressureSelect.value = this.model.getAccessibilitySetting('pressureSensitivity');

    modal.style.display = 'flex';
  }

  closeStylusAccessibilityModal() {
    const modal = document.getElementById('stylus-accessibility-modal');
    if (modal) modal.style.display = 'none';
  }

  _handleModifierShortcuts(e) {
    if (e.key === 'z' || e.key === 'Z') {
      e.preventDefault();
      this.drawing.undoLastStroke();
      return true;
    }
    const zoomActions = {
      '+': () => this.nav.zoomIn(),
      '=': () => this.nav.zoomIn(),
      NumpadAdd: () => this.nav.zoomIn(),
      '-': () => this.nav.zoomOut(),
      NumpadSubtract: () => this.nav.zoomOut(),
      '0': () => this.nav.resetZoom(),
      Numpad0: () => this.nav.resetZoom(),
    };
    const action = zoomActions[e.key] || zoomActions[e.code];
    if (action) {
      e.preventDefault();
      action();
      return true;
    }
    return false;
  }

  _handleDrawModeShortcuts(e) {
    const key = e.key;
    const lowerKey = typeof key === 'string' ? key.toLowerCase() : '';

    if (lowerKey === 'p' || lowerKey === 'b') {
      e.preventDefault();
      this.drawing.setDrawTool('pen');
      return true;
    }
    if (lowerKey === 'h' || lowerKey === 's') {
      e.preventDefault();
      this.drawing.setDrawTool('highlighter');
      return true;
    }
    if (lowerKey === 'e') {
      e.preventDefault();
      if (typeof this.drawing?.toggleEraser === 'function') {
        this.drawing.toggleEraser();
      } else if (typeof this.drawing?.setDrawTool === 'function') {
        this.drawing.setDrawTool('eraser');
      }
      return true;
    }
    if (lowerKey === 'v' || lowerKey === 'm') {
      e.preventDefault();
      this.drawing.setDrawTool('pan');
      return true;
    }

    const colorPalette = {
      '1': '#1e293b',
      '2': '#2563eb',
      '3': '#dc2626',
      '4': '#eab308',
      '5': '#16a34a',
      '6': '#9333ea',
    };
    if (colorPalette[key]) {
      e.preventDefault();
      this.drawing.setDrawColor(colorPalette[key]);
      return true;
    }

    if (key === '[') {
      e.preventDefault();
      this.drawing.cycleDrawWidth(-1);
      return true;
    }
    if (key === ']') {
      e.preventDefault();
      this.drawing.cycleDrawWidth(1);
      return true;
    }
    if (key === 'Delete' || key === 'Backspace') {
      e.preventDefault();
      this.drawing.clearCurrentPageDrawings();
      return true;
    }
    if (lowerKey === 't') {
      e.preventDefault();
      this.drawing.toggleDrawingTool();
      return true;
    }
    if (key === 'Escape') {
      e.preventDefault();
      const stylusModal = document.getElementById('stylus-accessibility-modal');
      if (stylusModal && stylusModal.style.display !== 'none') {
        this.closeStylusAccessibilityModal();
        return true;
      }
      this.drawing.toggleDrawMode(false);
      return true;
    }
    return false;
  }

  _handleReadingShortcuts(e) {
    const key = e.key;
    const lowerKey = typeof key === 'string' ? key.toLowerCase() : '';

    if ((lowerKey === 'p' || lowerKey === 'd') && this.model.viewMode !== 'notes' && !this.model.isDrawMode) {
      e.preventDefault();
      this.drawing.toggleDrawMode(true);
      return true;
    }

    if (!this.model.isDrawMode) {
      if (lowerKey === 't') {
        e.preventDefault();
        this.toggleDrawerTab('chapters');
        return true;
      }
      if (lowerKey === 'n') {
        e.preventDefault();
        this.toggleDrawerTab('notes');
        return true;
      }
    }

    if (key === 'Escape') {
      e.preventDefault();
      this.annotations.clearTextSelection();
      return true;
    }

    if (lowerKey === 'w') {
      e.preventDefault();
      this.nav.fitWidth();
      return true;
    }

    if (lowerKey === 'h') {
      e.preventDefault();
      this.nav.fitPage();
      return true;
    }

    if (this.model.viewMode === 'notes') return false;

    if (key === 'ArrowRight' || key === 'PageDown') {
      this.nav.nextPage();
      return true;
    }
    if (key === 'ArrowLeft' || key === 'PageUp') {
      this.nav.prevPage();
      return true;
    }

    return false;
  }

  bindKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      if (this.container.style.display !== 'flex') return;
      const isInteractiveTarget = this.isInteractiveTarget(e.target);

      if (e.altKey && !e.ctrlKey && !e.metaKey && e.key === 'ArrowLeft') {
        if (!isInteractiveTarget && this.onReturnToPreviousReadingPoint?.()) {
          e.preventDefault();
        }
        return;
      }

      if (e.code === 'Space' && !isInteractiveTarget) {
        if (this.model.isDrawMode || this.model.isSpacePanActive) {
          e.preventDefault();
          if (e.target && typeof e.target.blur === 'function') {
            e.target.blur();
          }
          if (!e.repeat) {
            this.model.setSpacePanActive(true);
            this.viewportEl.classList.add('pan-mode-active');
            this.bodyEl.classList.add('pan-mode-active');
          }
          return;
        }
      }

      if (isInteractiveTarget) return;

      if (!this.model.isDrawMode && !e.altKey && !e.ctrlKey && !e.metaKey &&
          e.key === 'Backspace' && this.onReturnToPreviousReadingPoint?.()) {
        e.preventDefault();
        return;
      }

      if (e.ctrlKey || e.metaKey) {
        this._handleModifierShortcuts(e);
        return;
      }

      if (this.model.isDrawMode && this._handleDrawModeShortcuts(e)) {
        return;
      }

      this._handleReadingShortcuts(e);
    });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') this.releaseSpacePan();
    });
    window.addEventListener('blur', () => this.releaseSpacePan());
  }

  isInteractiveTarget(target) {
    if (!target || typeof target.closest !== 'function') return false;
    const isTextInput = target.closest(
      'textarea, input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]), [contenteditable]:not([contenteditable="false"])'
    );
    if (isTextInput) return true;
    if (target.closest('select')) return true;
    return false;
  }

  releaseSpacePan() {
    if (!this.model.isSpacePanActive) return;
    this.model.setSpacePanActive(false);
    this.viewportEl.classList.remove('pan-mode-active');
    this.bodyEl.classList.remove('pan-mode-active');
  }

  bindWheelZoom() {
    let continuousScale = null;
    let gestureBaseScale = null;
    let pendingFocalPoint = null;
    let wheelRaf = null;
    let idleTimer = null;

    const handleWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      if (this.container && this.container.style.display !== 'flex') return;

      e.preventDefault();

      let delta = e.deltaY;
      if (e.deltaMode === 1) delta *= 16;
      else if (e.deltaMode === 2) delta *= 800;

      // Continuous exponential pinch-to-zoom formula:
      // Scales continuously according to the velocity and distance of the gesture.
      // Small trackpad movements adjust smoothly by tiny fractions, while rapid pinches scale fast.
      const SENSITIVITY = 0.0022314355;
      const zoomFactor = Math.exp(-delta * SENSITIVITY);

      if (continuousScale === null) {
        continuousScale = this.model.scale || 1.0;
        gestureBaseScale = this.model.scale || 1.0;
        if (this.viewportEl && this.viewportEl.style && typeof this.viewportEl.getBoundingClientRect === 'function') {
          const vRect = this.viewportEl.getBoundingClientRect();
          const ox = e.clientX - vRect.left;
          const oy = e.clientY - vRect.top;
          this.viewportEl.style.transformOrigin = `${ox}px ${oy}px`;
          this.viewportEl.style.willChange = 'transform';
        }
      }
      continuousScale = Math.max(0.25, Math.min(5.0, continuousScale * zoomFactor));

      pendingFocalPoint = { clientX: e.clientX, clientY: e.clientY };

      // Immediate hardware-accelerated visual scale preview
      if (this.viewportEl && this.viewportEl.style && gestureBaseScale > 0) {
        const liveRatio = continuousScale / gestureBaseScale;
        this.viewportEl.style.transform = `scale(${liveRatio})`;
      }

      const zoomLabel = document.getElementById('reader-zoom-reset-btn');
      if (zoomLabel) {
        zoomLabel.textContent = `${Math.round(continuousScale * 100)}%`;
      }

      if (typeof clearTimeout === 'function') clearTimeout(idleTimer);
      else if (typeof window !== 'undefined' && typeof window.clearTimeout === 'function') window.clearTimeout(idleTimer);

      const commitPinch = () => {
        continuousScale = null;
        gestureBaseScale = null;
        if (this.viewportEl && this.viewportEl.style) {
          this.viewportEl.style.transform = '';
          this.viewportEl.style.transformOrigin = '';
          this.viewportEl.style.willChange = '';
        }
      };

      if (typeof setTimeout === 'function') {
        idleTimer = setTimeout(commitPinch, 200);
      } else if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
        idleTimer = window.setTimeout(commitPinch, 200);
      }

      const targetScale = Math.max(0.25, Math.min(5.0, Math.round(continuousScale * 100) / 100));
      if (targetScale === this.model.scale && !wheelRaf) return;

      if (!wheelRaf) {
        wheelRaf = requestAnimationFrame(() => {
          wheelRaf = null;
          if (continuousScale !== null) {
            const scaleToApply = Math.max(0.25, Math.min(5.0, Math.round(continuousScale * 100) / 100));
            const focal = pendingFocalPoint;
            if (scaleToApply !== this.model.scale) {
              this.nav.setZoom(scaleToApply, true, focal);
            }
          }
        });
      }
    };

    window.addEventListener('wheel', handleWheel, { passive: false });
  }
}

window.ReaderToolbarManager = ReaderToolbarManager;
