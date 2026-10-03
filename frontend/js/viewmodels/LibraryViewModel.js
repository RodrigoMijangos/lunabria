/**
 * Library coordinator: data loading, model commands and feature delegation.
 * Catalog views own DOM presentation; CatalogSelectionManager owns selection workflows.
 */
class LibraryViewModel {
  constructor() {
    this.model = new LibraryModel();

    // Preserve public element references and state for existing callers.
    Object.assign(this, CatalogView.captureElements());
    this.catalogPageCount = 1;
    this.catalogGridColumns = 0;
    this.catalogResizeTimeout = null;
    this.selectionMode = false;
    this.selectedBookIds = new Set();
    this.catalogSelectionBusy = false;

    this.uploadManager = new BookUploadManager(this.model, () => this.loadHome());
    this.metadataManager = new BookMetadataManager(() => this.loadHome());
    this.vlManager = new VirtualLibraryManager(createdLibrary => this.onVirtualLibrariesChanged(createdLibrary));
    this.colorSettings = new HighlightColorSettingsManager();
    this.syncSettings = new SyncSettingsManager();
    this.catalogSelectionManager = new CatalogSelectionManager(this);
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

  async loadHome() {
    try {
      const [books, recents] = await Promise.all([api.getBooks(), api.getRecents()]);
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
    return CatalogView.getGridColumnCount(this.bookGrid, this.catalogGridColumns);
  }

  syncCatalogPageSizeOptions(columns, maxPageSize, pageSize) {
    this.catalogGridColumns = CatalogView.syncPageSizeOptions(
      this, columns, maxPageSize, pageSize, this.catalogGridColumns
    );
  }

  syncCatalogSelectionLibraryOptions() { this.catalogSelectionManager.syncLibraryOptions(); }
  syncCatalogSelectionControls() { this.catalogSelectionManager.syncControls(); }
  setBookSelectionMode(enabled) { this.catalogSelectionManager.setMode(enabled); }
  setBookSelected(bookId, selected) { this.catalogSelectionManager.setBookSelected(bookId, selected); }
  async addSelectedBooksToLibrary() { await this.catalogSelectionManager.addToLibrary(); }
  createLibraryFromSelection() { this.catalogSelectionManager.createLibrary(); }
  async onVirtualLibrariesChanged(createdLibrary = null) {
    await this.catalogSelectionManager.onLibrariesChanged(createdLibrary);
  }

  syncCatalogControls() { CatalogView.syncControls(this, this.model); }

  getCatalogPageItems(currentPage, pageCount) {
    return CatalogPaginationView.getPageItems(currentPage, pageCount);
  }

  updateCatalogPagination(pageCount) {
    const currentPage = this.model.catalogPage;
    this.catalogPageCount = pageCount;
    CatalogPaginationView.render(
      this, currentPage, pageCount,
      () => this.getCatalogPageItems(currentPage, pageCount),
      item => {
        if (item === this.model.catalogPage) return;
        this.model.setCatalogPage(item);
        this.renderBooks();
      }
    );
  }

  submitCatalogPageInput() {
    const input = this.catalogPageInput;
    if (!input) return;
    const requestedPage = CatalogPaginationView.readRequestedPage(input);
    if (!Number.isSafeInteger(requestedPage) || requestedPage < 1) {
      CatalogPaginationView.setInputPage(input, this.model.catalogPage);
      return;
    }
    const page = Math.min(requestedPage, this.catalogPageCount);
    CatalogPaginationView.setInputPage(input, page);
    if (page === this.model.catalogPage) return;
    this.model.setCatalogPage(page);
    this.renderBooks();
  }

  syncSearchPresentation() {
    CatalogView.syncSearchPresentation(this, this.model, () => this.renderRecents());
    this.syncCatalogControls();
  }

  updateBooksCountBadge(count) { CatalogView.updateBooksCountBadge(count); }

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
    if (window.reader && typeof window.reader.open === 'function') window.reader.open(bookId, startPage);
  }

  openUploadModal() { this.uploadManager.openUploadModal(); }
  closeUploadModal() { this.uploadManager.closeUploadModal(); }
  openEditModal(book) { this.metadataManager.openEditModal(book); }
  openVirtualLibraryModal() { this.vlManager.openVirtualLibraryModal(); }

  bindEvents() {
    document.getElementById('theme-select')?.addEventListener('change', (e) => {
      this.applyTheme(e.target.value);
    });
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
        if (!this.model.searchQuery && this.recentsContainer?.clientWidth > 0) this.renderRecents();
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
    this.vlSelect?.addEventListener('change', (e) => {
      this.selectVirtualLibrary(e.target.value ? Number(e.target.value) : null);
    });
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
    document.getElementById('new-vl-btn')?.addEventListener('click', () => this.openVirtualLibraryModal());
    document.getElementById('upload-btn')?.addEventListener('click', () => this.openUploadModal());
  }
}

window.LibraryViewModel = LibraryViewModel;
