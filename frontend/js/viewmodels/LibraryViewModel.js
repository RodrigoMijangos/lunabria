/**
 * LibraryViewModel.js
 * Master ViewModel / Coordinator for Moon-Calibre Library & Collections
 * Coordinates:
 * - BookUploadManager (frontend/js/viewmodels/library/BookUploadManager.js)
 * - BookMetadataManager (frontend/js/viewmodels/library/BookMetadataManager.js)
 * - VirtualLibraryManager (frontend/js/viewmodels/library/VirtualLibraryManager.js)
 */
class LibraryViewModel {
  constructor() {
    this.model = new LibraryModel();

    // DOM Elements
    this.bookGrid = document.getElementById('book-grid');
    this.mainContainer = document.querySelector('main.container');
    this.recentsContainer = document.getElementById('recents-list');
    this.recentsSection = document.getElementById('recents-section');
    this.vlSelect = document.getElementById('vl-select');
    this.activeCollectionChip = document.getElementById('collections-chips');

    this.catalogContent = document.getElementById('catalog-content');
    this.catalogSortSelect = document.getElementById('catalog-sort-select');
    this.catalogToggleButton = document.getElementById('catalog-toggle-btn');
    this.catalogPagination = document.getElementById('catalog-pagination');
    this.catalogPageStatus = document.getElementById('catalog-page-status');
    this.catalogPageNumbers = document.getElementById('catalog-page-numbers');
    this.catalogPageInput = document.getElementById('catalog-page-input');
    this.catalogPageTotal = document.getElementById('catalog-page-total');
    this.catalogPageCount = 1;
    this.catalogPreviousButton = document.getElementById('catalog-page-previous');
    this.catalogNextButton = document.getElementById('catalog-page-next');
    this.catalogPageSizeSelect = document.getElementById('catalog-page-size-select');
    this.catalogPageSizeInfo = document.getElementById('catalog-page-size-info');
    this.catalogSelectionToggle = document.getElementById('catalog-selection-toggle');
    this.catalogSelectionActions = document.getElementById('catalog-selection-actions');
    this.catalogSelectionCount = document.getElementById('catalog-selection-count');
    this.catalogSelectionLibrary = document.getElementById('catalog-selection-library');
    this.catalogSelectionAddButton = document.getElementById('catalog-selection-add-btn');
    this.catalogSelectionCreateButton = document.getElementById('catalog-selection-create-btn');
    this.catalogSelectionStatus = document.getElementById('catalog-selection-status');
    this.catalogGridColumns = 0;
    this.catalogResizeTimeout = null;
    this.selectionMode = false;
    this.selectedBookIds = new Set();
    this.catalogSelectionBusy = false;

    // Granular Feature Managers
    this.uploadManager = new BookUploadManager(this.model, () => this.loadHome());
    this.metadataManager = new BookMetadataManager(() => this.loadHome());
    this.vlManager = new VirtualLibraryManager(createdLibrary => this.onVirtualLibrariesChanged(createdLibrary));
    this.colorSettings = new HighlightColorSettingsManager();
    this.syncSettings = new SyncSettingsManager();
  }

  // Getters for template & backward compatibility
  get currentTheme() { return this.model.theme; }
  get activeVirtualLibraryId() { return this.model.activeVirtualLibraryId; }
  set activeVirtualLibraryId(val) { this.model.setActiveVirtualLibrary(val); }
  get allBooksCache() { return this.model.allBooks; }
  set allBooksCache(val) { this.model.setBooks(val); }

  async init() {
    this.applyTheme(this.model.theme);
    this.initServiceWorker();
    this.uploadManager.init();
    this.colorSettings.init();
    this.syncSettings.init();
    this.bindEvents();
    this.syncCatalogControls();
    await this.loadVirtualLibraries();
    await this.loadHome();
  }

  initServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').then((reg) => {
        reg.update();
      }).catch(err => {
        console.warn('[LibraryViewModel] Service worker registration failed:', err);
      });
    }
  }

  applyTheme(theme) {
    this.model.setTheme(theme);
    document.documentElement.setAttribute('data-theme', this.model.theme);
    const select = document.getElementById('theme-select');
    if (select) select.value = this.model.theme;
  }

  // ============================================================
  // Data Loading & Presentation
  // ============================================================
  async loadHome() {
    try {
      const [books, recents] = await Promise.all([
        api.getBooks(),
        api.getRecents()
      ]);

      this.model.setBooks(books);
      this.model.setRecentBooks(recents);

      this.renderRecents();
      this.renderBooks();
      this.updateActiveCollectionChip();
    } catch (err) {
      console.error('[LibraryViewModel] Error loading home:', err);
    }
  }

  async loadVirtualLibraries() {
    try {
      const vls = await api.getVirtualLibraries();
      this.model.setVirtualLibraries(vls);
      VirtualLibraryView.populateDropdown(this.vlSelect, vls, this.model.activeVirtualLibraryId);
      this.updateActiveCollectionChip();
      this.syncCatalogSelectionLibraryOptions();
    } catch (err) {
      console.warn('[LibraryViewModel] Could not load virtual libraries:', err);
      this.model.setVirtualLibraries([]);
      this.updateActiveCollectionChip();
      this.syncCatalogSelectionLibraryOptions();
    }
  }

  async loadBookGrid() {
    try {
      const books = await api.getBooks(null, this.model.activeVirtualLibraryId);
      this.model.setBooks(books);
      this.renderBooks();
    } catch (err) {
      console.error('[LibraryViewModel] Error loading book grid:', err);
    }
  }

  renderBooks() {
    this.syncSearchPresentation();
    const columns = this.getCatalogGridColumnCount();
    const maxPageSize = columns * 3;
    const pageSize = this.model.getCatalogPageSize(maxPageSize, columns);
    this.syncCatalogPageSizeOptions(columns, maxPageSize, pageSize);

    const filtered = this.model.getFilteredBooks();
    const pageBooks = this.model.getCatalogPage(filtered, pageSize);
    const pageCount = this.model.getCatalogPageCount(filtered.length, pageSize);
    this.updateBooksCountBadge(filtered.length);
    BookCardView.renderBookGrid(
      this.bookGrid,
      pageBooks,
      (bookId) => this.openBook(bookId),
      (book) => this.metadataManager.openEditModal(book),
      {
        selectionMode: this.selectionMode,
        selectedBookIds: this.selectedBookIds,
        onToggleSelection: (bookId, selected) => this.setBookSelected(bookId, selected)
      }
    );
    this.updateCatalogPagination(pageCount);
  }

  getCatalogGridColumnCount() {
    if (!this.bookGrid || typeof window.getComputedStyle !== 'function') {
      return this.catalogGridColumns || 4;
    }

    const gridWidth = this.bookGrid.getBoundingClientRect().width;
    if (gridWidth <= 0) return this.catalogGridColumns || 4;

    const templateColumns = window.getComputedStyle(this.bookGrid).gridTemplateColumns.trim();
    if (!templateColumns || templateColumns === 'none') return this.catalogGridColumns || 4;

    const columnCount = templateColumns.split(/\s+/).filter(Boolean).length;
    return columnCount || this.catalogGridColumns || 4;
  }

  syncCatalogPageSizeOptions(columns, maxPageSize, pageSize) {
    if (this.catalogPageSizeSelect && this.catalogGridColumns !== columns) {
      this.catalogPageSizeSelect.replaceChildren();
      for (let count = columns; count <= maxPageSize; count += 1) {
        const option = document.createElement('option');
        option.value = String(count);
        option.textContent = `${count} books`;
        this.catalogPageSizeSelect.appendChild(option);
      }
      this.catalogGridColumns = columns;
    }

    if (this.catalogPageSizeSelect) {
      this.catalogPageSizeSelect.value = String(pageSize);
      this.catalogPageSizeSelect.disabled = maxPageSize < 1;
    }
    if (this.catalogPageSizeInfo) {
      this.catalogPageSizeInfo.textContent = `${columns} columns · maximum ${maxPageSize} books (3 rows)`;
    }
  }

  syncCatalogSelectionLibraryOptions() {
    if (!this.catalogSelectionLibrary) return;
    const selectedValue = this.catalogSelectionLibrary.value;
    const manualLibraries = this.model.virtualLibraries.filter(library => library.type === 'manual');
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = manualLibraries.length
      ? 'Select a manual library'
      : 'No manual libraries';
    placeholder.disabled = manualLibraries.length === 0;
    this.catalogSelectionLibrary.replaceChildren(placeholder);

    manualLibraries.forEach(library => {
      const option = document.createElement('option');
      option.value = String(library.id);
      const count = Array.isArray(library.book_ids) ? library.book_ids.length : 0;
      option.textContent = `${library.name} (${count})`;
      this.catalogSelectionLibrary.appendChild(option);
    });

    this.catalogSelectionLibrary.disabled = manualLibraries.length === 0 || this.catalogSelectionBusy;
    if (manualLibraries.some(library => String(library.id) === selectedValue)) {
      this.catalogSelectionLibrary.value = selectedValue;
    }
    this.syncCatalogSelectionControls();
  }

  syncCatalogSelectionControls() {
    const selectedCount = this.selectedBookIds.size;
    const hasManualLibraries = this.model.virtualLibraries.some(library => library.type === 'manual');
    const selectedLibraryId = Number(this.catalogSelectionLibrary?.value);
    const targetLibrary = this.model.virtualLibraries.find(
      library => library.type === 'manual' && library.id === selectedLibraryId
    );

    if (this.catalogSelectionToggle) {
      this.catalogSelectionToggle.textContent = this.selectionMode ? 'Cancel selection' : 'Select books';
      this.catalogSelectionToggle.setAttribute('aria-pressed', String(this.selectionMode));
      this.catalogSelectionToggle.disabled = this.catalogSelectionBusy;
    }
    if (this.catalogSelectionActions) this.catalogSelectionActions.hidden = !this.selectionMode;
    if (this.catalogSelectionCount) {
      this.catalogSelectionCount.textContent = `${selectedCount} ${selectedCount === 1 ? 'book selected' : 'books selected'}`;
    }
    if (this.catalogSelectionLibrary) {
      this.catalogSelectionLibrary.disabled = !hasManualLibraries || this.catalogSelectionBusy;
    }
    if (this.catalogSelectionAddButton) {
      this.catalogSelectionAddButton.disabled = !this.selectionMode || !selectedCount || !targetLibrary || this.catalogSelectionBusy;
    }
    if (this.catalogSelectionCreateButton) {
      this.catalogSelectionCreateButton.disabled = !this.selectionMode || !selectedCount || this.catalogSelectionBusy;
    }
  }

  setBookSelectionMode(enabled) {
    this.selectionMode = Boolean(enabled);
    if (!this.selectionMode) this.selectedBookIds.clear();
    else if (this.catalogSelectionStatus) this.catalogSelectionStatus.textContent = '';
    this.syncCatalogSelectionControls();
    this.renderBooks();
  }

  setBookSelected(bookId, selected) {
    const id = Number(bookId);
    if (!Number.isFinite(id)) return;
    if (selected) this.selectedBookIds.add(id);
    else this.selectedBookIds.delete(id);

    const card = this.bookGrid?.querySelector(`.book-card[data-id="${id}"]`);
    card?.classList.toggle('book-card-selected', Boolean(selected));
    const checkbox = card?.querySelector('.book-selection-toggle input');
    if (checkbox) checkbox.checked = Boolean(selected);
    this.syncCatalogSelectionControls();
  }

  async addSelectedBooksToLibrary() {
    const libraryId = Number(this.catalogSelectionLibrary?.value);
    const library = this.model.virtualLibraries.find(
      item => item.type === 'manual' && item.id === libraryId
    );
    const selectedIds = [...this.selectedBookIds];
    if (!library || !selectedIds.length) return;

    this.catalogSelectionBusy = true;
    this.syncCatalogSelectionControls();
    if (this.catalogSelectionStatus) this.catalogSelectionStatus.textContent = 'Adding books…';
    try {
      await api.addBooksToVirtualLibrary(library.id, selectedIds);
      this.selectionMode = false;
      this.selectedBookIds.clear();
      await this.loadVirtualLibraries();
      if (Number(this.model.activeVirtualLibraryId) === library.id) await this.loadBookGrid();
      else this.renderBooks();
      if (this.catalogSelectionStatus) {
        this.catalogSelectionStatus.textContent = `Selection added to «${library.name}». Duplicates were skipped.`;
      }
    } catch (error) {
      if (this.catalogSelectionStatus) this.catalogSelectionStatus.textContent = `Could not add books: ${error.message}`;
    } finally {
      this.catalogSelectionBusy = false;
      this.syncCatalogSelectionControls();
    }
  }

  createLibraryFromSelection() {
    const selectedIds = [...this.selectedBookIds];
    if (!selectedIds.length) return;
    this.vlManager.openVirtualLibraryModal({ selectedBookIds: selectedIds });
  }

  async onVirtualLibrariesChanged(createdLibrary = null) {
    await this.loadVirtualLibraries();
    if (!this.selectionMode) return;
    const selectedCount = this.selectedBookIds.size;
    this.selectionMode = false;
    this.selectedBookIds.clear();
    this.syncCatalogSelectionControls();
    this.renderBooks();
    if (createdLibrary?.type === 'manual' && this.catalogSelectionStatus) {
      const createdCount = Array.isArray(createdLibrary.book_ids) ? createdLibrary.book_ids.length : selectedCount;
      this.catalogSelectionStatus.textContent = `Created «${createdLibrary.name}» with ${createdCount} ${createdCount === 1 ? 'book' : 'books'}.`;
    }
  }

  syncCatalogControls() {
    const isSearching = Boolean(this.model.searchQuery);
    const isExpanded = isSearching || !this.model.catalogCollapsed;
    if (this.catalogSortSelect) this.catalogSortSelect.value = this.model.catalogSort;
    if (this.catalogContent) this.catalogContent.hidden = !isExpanded;

    if (this.catalogToggleButton) {
      const action = isExpanded ? 'Collapse' : 'Expand';
      this.catalogToggleButton.textContent = isExpanded ? '−' : '+';
      this.catalogToggleButton.title = `${action} catalog`;
      this.catalogToggleButton.setAttribute('aria-label', `${action} catalog`);
      this.catalogToggleButton.setAttribute('aria-expanded', String(isExpanded));
      this.catalogToggleButton.disabled = isSearching;
    }
  }

  getCatalogPageItems(currentPage, pageCount) {
    if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => index + 1);

    if (currentPage <= 4) return [1, 2, 3, 4, 5, 'ellipsis', pageCount];
    if (currentPage >= pageCount - 3) {
      return [1, 'ellipsis', ...Array.from({ length: 5 }, (_, index) => pageCount - 4 + index)];
    }
    return [1, 'ellipsis', currentPage - 1, currentPage, currentPage + 1, 'ellipsis', pageCount];
  }

  updateCatalogPagination(pageCount) {
    const currentPage = this.model.catalogPage;
    this.catalogPageCount = pageCount;
    if (this.catalogPagination) this.catalogPagination.hidden = pageCount <= 1;
    if (this.catalogPageStatus) {
      this.catalogPageStatus.textContent = `Page ${currentPage} of ${pageCount}`;
    }
    if (this.catalogPageTotal) this.catalogPageTotal.textContent = String(pageCount);
    if (this.catalogPageInput && document.activeElement !== this.catalogPageInput) {
      this.catalogPageInput.value = String(currentPage);
    }
    if (this.catalogPreviousButton) this.catalogPreviousButton.disabled = currentPage <= 1;
    if (this.catalogNextButton) this.catalogNextButton.disabled = currentPage >= pageCount;

    if (!this.catalogPageNumbers) return;
    this.catalogPageNumbers.replaceChildren();
    this.getCatalogPageItems(currentPage, pageCount).forEach(item => {
      if (item === 'ellipsis') {
        const ellipsis = document.createElement('span');
        ellipsis.className = 'catalog-page-ellipsis';
        ellipsis.textContent = '…';
        ellipsis.setAttribute('aria-hidden', 'true');
        this.catalogPageNumbers.appendChild(ellipsis);
        return;
      }

      const pageButton = document.createElement('button');
      pageButton.type = 'button';
      pageButton.className = 'catalog-page-number';
      pageButton.textContent = String(item);
      pageButton.setAttribute('aria-label', `Go to page ${item}`);
      pageButton.setAttribute('aria-current', String(item === currentPage ? 'page' : 'false'));
      pageButton.title = `Go to page ${item}`;
      pageButton.onclick = () => {
        if (item === this.model.catalogPage) return;
        this.model.setCatalogPage(item);
        this.renderBooks();
      };
      this.catalogPageNumbers.appendChild(pageButton);
    });
  }

  submitCatalogPageInput() {
    const input = this.catalogPageInput;
    if (!input) return;

    const value = input.value.trim();
    const requestedPage = /^\d+$/.test(value) ? Number(value) : NaN;
    if (!Number.isSafeInteger(requestedPage) || requestedPage < 1) {
      input.value = String(this.model.catalogPage);
      return;
    }

    const page = Math.min(requestedPage, this.catalogPageCount);
    input.value = String(page);
    if (page === this.model.catalogPage) return;

    this.model.setCatalogPage(page);
    this.renderBooks();
  }

  syncSearchPresentation() {
    const isSearching = Boolean(this.model.searchQuery);
    if (this.mainContainer) this.mainContainer.classList.toggle('search-active', isSearching);
    if (this.recentsSection) {
      const wasHidden = this.recentsSection.style.display === 'none';
      const shouldShow = !isSearching
        && this.model.catalogSort !== 'last_read_at'
        && this.model.recentBooks.length > 0;
      this.recentsSection.style.display = shouldShow ? 'block' : 'none';
      if (shouldShow && wasHidden) this.renderRecents();
    }
    this.syncCatalogControls();
  }

  updateBooksCountBadge(count) {
    const badge = document.getElementById('books-count-badge');
    if (badge) badge.textContent = `${count} ${count === 1 ? 'book' : 'books'}`;
  }

  renderRecents() {
    RecentReadsView.renderRecentReads(
      this.recentsContainer,
      this.recentsSection,
      this.model.recentBooks,
      (bookId, page) => this.openBook(bookId, page),
      (book) => this.metadataManager.openEditModal(book)
    );
  }

  filterBooks(query) {
    this.model.setSearchQuery(query);
    this.renderBooks();
  }

  updateActiveCollectionChip() {
    VirtualLibraryView.renderCollectionChips(
      this.activeCollectionChip,
      this.model.virtualLibraries,
      this.model.activeVirtualLibraryId,
      libraryId => this.selectVirtualLibrary(libraryId),
      library => this.deleteVirtualLibrary(library)
    );
  }

  async deleteVirtualLibrary(library) {
    const confirmed = confirm(
      `Delete virtual library «${library.name}»? Its books will not be deleted from Calibre.`
    );
    if (!confirmed) return;

    try {
      await api.deleteVirtualLibrary(library.id);
      const wasActive = Number(this.model.activeVirtualLibraryId) === Number(library.id);
      if (wasActive) {
        this.model.setActiveVirtualLibrary(null);
        this.model.setCatalogPage(1);
        if (this.vlSelect) this.vlSelect.value = '';
      }

      await this.loadVirtualLibraries();
      if (wasActive) await this.loadHome();
    } catch (error) {
      alert(`Could not delete virtual library: ${error.message}`);
    }
  }

  selectVirtualLibrary(libraryId) {
    this.model.setActiveVirtualLibrary(libraryId);
    this.model.setCatalogPage(1);
    if (this.vlSelect) this.vlSelect.value = libraryId == null ? '' : String(libraryId);
    this.updateActiveCollectionChip();
    return this.loadBookGrid();
  }

  clearCollectionFilter() {
    this.model.setActiveVirtualLibrary(null);
    this.model.setCatalogPage(1);
    if (this.vlSelect) this.vlSelect.value = '';
    this.updateActiveCollectionChip();
    this.loadHome();
  }

  openBook(bookId, startPage = null) {
    if (window.reader && typeof window.reader.open === 'function') {
      window.reader.open(bookId, startPage);
    }
  }

  // Delegated Modal Triggers
  openUploadModal() { this.uploadManager.openUploadModal(); }
  closeUploadModal() { this.uploadManager.closeUploadModal(); }
  openEditModal(book) { this.metadataManager.openEditModal(book); }
  openVirtualLibraryModal() { this.vlManager.openVirtualLibraryModal(); }

  // ============================================================
  // Event Binding
  // ============================================================
  bindEvents() {
    // Theme Switcher
    document.getElementById('theme-select')?.addEventListener('change', (e) => {
      this.applyTheme(e.target.value);
    });

    // Brand Link
    document.getElementById('brand-link')?.addEventListener('click', () => {
      this.clearCollectionFilter();
    });

    this.catalogSortSelect?.addEventListener('change', (event) => {
      this.model.setCatalogSort(event.target.value);
      this.renderBooks();
    });

    this.catalogToggleButton?.addEventListener('click', () => {
      this.model.setCatalogCollapsed(!this.model.catalogCollapsed);
      this.syncCatalogControls();
      if (!this.catalogContent?.hidden) this.renderBooks();
    });

    this.catalogPageSizeSelect?.addEventListener('change', (event) => {
      this.model.setCatalogPageSize(event.target.value);
      this.renderBooks();
    });

    this.catalogSelectionToggle?.addEventListener('click', () => {
      this.setBookSelectionMode(!this.selectionMode);
    });
    this.catalogSelectionLibrary?.addEventListener('change', () => this.syncCatalogSelectionControls());
    this.catalogSelectionAddButton?.addEventListener('click', () => this.addSelectedBooksToLibrary());
    this.catalogSelectionCreateButton?.addEventListener('click', () => this.createLibraryFromSelection());

    window.addEventListener('resize', () => {
      window.clearTimeout(this.catalogResizeTimeout);
      this.catalogResizeTimeout = window.setTimeout(() => {
        if (!this.catalogContent?.hidden && this.getCatalogGridColumnCount() !== this.catalogGridColumns) {
          this.renderBooks();
        }
        if (!this.model.searchQuery && this.recentsContainer?.clientWidth > 0) {
          this.renderRecents();
        }
      }, 120);
    });

    this.catalogPageInput?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      this.submitCatalogPageInput();
      this.catalogPageInput.blur();
    });
    this.catalogPageInput?.addEventListener('blur', () => this.submitCatalogPageInput());

    this.catalogPreviousButton?.addEventListener('click', () => {
      this.model.setCatalogPage(this.model.catalogPage - 1);
      this.renderBooks();
    });

    this.catalogNextButton?.addEventListener('click', () => {
      this.model.setCatalogPage(this.model.catalogPage + 1);
      this.renderBooks();
    });

    // Virtual Library Dropdown Change
    this.vlSelect?.addEventListener('change', (e) => {
      this.selectVirtualLibrary(e.target.value ? Number(e.target.value) : null);
    });

    // Search Bar Input & Clear
    const searchInput = document.getElementById('search-input');
    const searchClear = document.getElementById('search-clear-btn');
    if (searchInput) {
      searchInput.oninput = (e) => {
        const val = e.target.value;
        if (searchClear) searchClear.style.display = val ? 'inline-flex' : 'none';
        this.filterBooks(val);
      };
    }
    if (searchClear) {
      searchClear.onclick = () => {
        if (searchInput) {
          searchInput.value = '';
          searchClear.style.display = 'none';
          this.filterBooks('');
          searchInput.focus();
        }
      };
    }

    // Modal Trigger Buttons
    document.getElementById('new-vl-btn')?.addEventListener('click', () => this.openVirtualLibraryModal());
    document.getElementById('upload-btn')?.addEventListener('click', () => this.openUploadModal());
  }
}

window.LibraryViewModel = LibraryViewModel;
