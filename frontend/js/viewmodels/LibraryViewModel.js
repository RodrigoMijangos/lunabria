/**
 * Library coordinator: data loading, model commands and feature delegation.
 * Catalog views own DOM presentation; CatalogSelectionManager owns selection workflows.
 */
class LibraryViewModel {
  constructor() {
    this.model = new LibraryModel();
    Object.assign(this, CatalogView.captureElements());
    this.catalogPageCount = 1;
    this.catalogGridColumns = 0;
    this.catalogResizeTimeout = null;
    this.catalogSearchTimeout = null;
    this.catalogRequestSequence = 0;
    this.catalogServerPage = null;
    this.selectionMode = false;
    this.selectedBookIds = new Set();
    this.catalogSelectionBusy = false;
    this.pendingAppReload = false;

    this.uploadManager = new BookUploadManager(this.model, () => this.loadHome());
    this.metadataManager = new BookMetadataManager(async (deletedBookId) => {
      if (deletedBookId) {
        const id = Number(deletedBookId);
        this.model.removeBook(id);
        this.selectedBookIds.delete(id);
        this.renderBooks();
        this.renderRecents();
      }
      await this.loadHome();
    });
    this.vlManager = new VirtualLibraryManager((createdLibrary) => this.onVirtualLibrariesChanged(createdLibrary));
    this.colorSettings = new HighlightColorSettingsManager();
    this.syncSettings = new SyncSettingsManager();
    this.catalogSelectionManager = new CatalogSelectionManager(this);
    this.offlineController =
      typeof LibraryOfflineController !== "undefined" ? new LibraryOfflineController(this) : null;
  }

  get currentTheme() {
    return this.model.theme;
  }
  get activeVirtualLibraryId() {
    return this.model.activeVirtualLibraryId;
  }
  set activeVirtualLibraryId(val) {
    this.model.setActiveVirtualLibrary(val);
  }
  get allBooksCache() {
    return this.model.allBooks;
  }
  set allBooksCache(val) {
    this.model.setBooks(val);
  }

  async init() {
    this.applyTheme(this.model.theme);
    this.initServiceWorker();
    navigator.storage?.persist?.().catch(() => {});
    this.initPWAInstaller();
    this.uploadManager.init();
    this.colorSettings.init();
    this.syncSettings.init();
    this.bindEvents();
    this.syncCatalogControls();
    window.serverConnectivity?.start();
    await this.loadVirtualLibraries();
    await this.loadHome();
  }

  initPWAInstaller() {
    if (typeof MobilePWAInstaller !== "undefined") {
      this.pwaInstaller = new MobilePWAInstaller();
    }
  }

  canSafelyReloadForUpdate() {
    return this.offlineController ? this.offlineController.canSafelyReloadForUpdate() : true;
  }

  initServiceWorker() {
    this.offlineController?.initServiceWorker();
  }

  applyTheme(theme) {
    this.model.setTheme(theme);
    CatalogView.applyTheme?.(this.model.theme);
  }

  isStaleCatalogRequest(requestSequence) {
    return requestSequence !== this.catalogRequestSequence;
  }

  async loadHome() {
    if (this.offlineController?.flushPendingAppReload()) return;
    const requestSequence = ++this.catalogRequestSequence;
    if (this.catalogSearchTimeout !== null) {
      window.clearTimeout(this.catalogSearchTimeout);
      this.catalogSearchTimeout = null;
    }
    this.catalogServerPage = null;
    const cachedBooks = (await this.offlineController?.preloadCachedCatalog(requestSequence)) || [];
    if (this.isStaleCatalogRequest(requestSequence)) return;

    try {
      const recents = await this.fetchHomeRecents(requestSequence, cachedBooks);
      if (this.isStaleCatalogRequest(requestSequence)) return;
      this.model.setRecentBooks(recents);

      const options = this.getCatalogRequestOptions();
      const response = await api.getBooks(null, this.model.activeVirtualLibraryId, options);
      if (this.isStaleCatalogRequest(requestSequence)) return;
      const page = this.normalizeCatalogResponse(response, options);
      const books = await this.attachCachedCovers(page.books, cachedBooks);
      if (this.isStaleCatalogRequest(requestSequence)) return;
      this.model.setBooks(books);
      if (page.serverPaged) {
        this.model.setCatalogPage(page.page);
        this.catalogServerPage = { page: page.page, pageSize: page.pageSize, total: page.total };
      }

      this.offlineController?.syncLocalCatalogCache(page.total, books);
      this.hideOfflineBanner();
      this.renderHomeSections();
    } catch (err) {
      await this.offlineController?.handleCatalogLoadError(err, requestSequence, "Loading the catalogue");
    }
  }

  async fetchHomeRecents(requestSequence, cachedBooks) {
    if (this.model.catalogSort === "last_read_at") return [];
    const serverRecents = await api.getRecents();
    if (this.isStaleCatalogRequest(requestSequence)) return [];
    return this.attachCachedCovers(serverRecents, cachedBooks);
  }

  renderHomeSections() {
    if (this.model.catalogSort === "last_read_at") {
      if (this.recentsSection) this.recentsSection.style.display = "none";
    } else {
      this.renderRecents();
    }
    this.renderBooks();
    this.updateActiveCollectionChip();
  }

  getCatalogRequestOptions() {
    const columns = this.getCatalogGridColumnCount();
    const maxPageSize = columns * 3;
    const pageSize = this.model.getCatalogPageSize(maxPageSize, columns);
    const excludeIds =
      !this.model.searchQuery && this.model.catalogSort !== "last_read_at"
        ? this.model.recentBooks.map((book) => Number(book.id)).filter(Number.isSafeInteger)
        : [];
    return {
      query: this.model.searchQuery,
      page: this.model.catalogPage,
      pageSize,
      sort: this.model.catalogSort,
      excludeIds,
    };
  }

  normalizeCatalogResponse(response, options) {
    if (Array.isArray(response)) {
      return {
        books: response,
        total: response.length,
        page: options.page,
        pageSize: options.pageSize,
        serverPaged: false,
      };
    }
    const books = Array.isArray(response?.books) ? response.books : [];
    return {
      books,
      total: Number.isFinite(Number(response?.total)) ? Number(response.total) : books.length,
      page: Number(response?.page) || options.page,
      pageSize: Number(response?.page_size) || options.pageSize,
      serverPaged: Array.isArray(response?.books),
    };
  }

  async showOfflineBooks() {
    return this.offlineController?.showOfflineBooks();
  }

  showOfflineBanner(count = 0) {
    this.offlineController?.showOfflineBanner(count);
  }

  hideOfflineBanner() {
    this.offlineController?.hideOfflineBanner();
  }

  showUpdateBanner(worker) {
    this.offlineController?.showUpdateBanner(worker);
  }

  hideUpdateBanner() {
    this.offlineController?.hideUpdateBanner();
  }

  async loadVirtualLibraries() {
    try {
      const vls = await api.getVirtualLibraries();
      this.model.setVirtualLibraries(vls);
      VirtualLibraryView.populateDropdown(this.vlSelect, vls, this.model.activeVirtualLibraryId);
    } catch (err) {
      console.warn("[LibraryViewModel] Could not load virtual libraries:", err);
      this.model.setVirtualLibraries([]);
    }
    this.updateActiveCollectionChip();
    this.syncCatalogSelectionLibraryOptions();
  }

  async attachCachedCovers(books, cachedBooks = null) {
    return this.offlineController ? this.offlineController.attachCachedCovers(books, cachedBooks) : books;
  }

  async loadBookGrid() {
    const requestSequence = ++this.catalogRequestSequence;
    const options = this.getCatalogRequestOptions();
    try {
      const response = await api.getBooks(null, this.model.activeVirtualLibraryId, options);
      if (this.isStaleCatalogRequest(requestSequence)) return;
      const page = this.normalizeCatalogResponse(response, options);
      const books = await this.attachCachedCovers(page.books);
      if (this.isStaleCatalogRequest(requestSequence)) return;
      this.model.setBooks(books);
      if (page.serverPaged) {
        this.model.setCatalogPage(page.page);
        this.catalogServerPage = { page: page.page, pageSize: page.pageSize, total: page.total };
      } else {
        this.catalogServerPage = null;
      }
      this.renderBooks();
    } catch (err) {
      await this.offlineController?.handleCatalogLoadError(err, requestSequence, "Loading a catalogue page");
    }
  }

  renderBooks() {
    this.syncSearchPresentation();
    const columns = this.getCatalogGridColumnCount();
    const maxPageSize = columns * 3;
    const requestedPageSize = this.model.getCatalogPageSize(maxPageSize, columns);
    const pageSize = this.catalogServerPage?.pageSize || requestedPageSize;
    this.syncCatalogPageSizeOptions(columns, maxPageSize, pageSize);

    let pageBooks;
    let totalBooks;
    if (this.catalogServerPage) {
      pageBooks = this.model.allBooks.slice(0, pageSize);
      totalBooks = this.catalogServerPage.total;
    } else {
      const filtered = this.model.getFilteredBooks();
      pageBooks = this.model.getCatalogPage(filtered, pageSize);
      totalBooks = filtered.length;
    }
    const pageCount = this.model.getCatalogPageCount(totalBooks, pageSize);

    this.updateBooksCountBadge(totalBooks);
    BookCardView.renderBookGrid(
      this.bookGrid,
      pageBooks,
      (bookId) => this.openBook(bookId),
      (book) => this.metadataManager.openEditModal(book),
      {
        selectionMode: this.selectionMode,
        selectedBookIds: this.selectedBookIds,
        onToggleSelection: (bookId, selected) => this.setBookSelected(bookId, selected),
      },
    );
    this.updateCatalogPagination(pageCount);
  }

  getCatalogGridColumnCount() {
    return CatalogView.getGridColumnCount(this.bookGrid, this.catalogGridColumns);
  }

  syncCatalogPageSizeOptions(columns, maxPageSize, pageSize) {
    this.catalogGridColumns = CatalogView.syncPageSizeOptions(
      this,
      columns,
      maxPageSize,
      pageSize,
      this.catalogGridColumns,
    );
  }

  syncCatalogSelectionLibraryOptions() {
    this.catalogSelectionManager.syncLibraryOptions();
  }
  syncCatalogSelectionControls() {
    this.catalogSelectionManager.syncControls();
  }
  setBookSelectionMode(enabled) {
    this.catalogSelectionManager.setMode(enabled);
  }
  setBookSelected(bookId, selected) {
    this.catalogSelectionManager.setBookSelected(bookId, selected);
  }
  async addSelectedBooksToLibrary() {
    await this.catalogSelectionManager.addToLibrary();
  }
  async removeSelectedBooksFromLibrary() {
    await this.catalogSelectionManager.removeFromLibrary();
  }
  createLibraryFromSelection() {
    this.catalogSelectionManager.createLibrary();
  }
  async onVirtualLibrariesChanged(createdLibrary = null) {
    await this.catalogSelectionManager.onLibrariesChanged(createdLibrary);
  }

  syncCatalogControls() {
    CatalogView.syncControls(this, this.model);
  }

  getCatalogPageItems(currentPage, pageCount) {
    return CatalogPaginationView.getPageItems(currentPage, pageCount);
  }

  navigateCatalogPage(requestedPage) {
    const pageNumber = Number(requestedPage);
    if (!Number.isSafeInteger(pageNumber)) return;
    const page = Math.min(Math.max(1, pageNumber), Math.max(1, this.catalogPageCount));
    if (page === this.model.catalogPage) return;

    this.model.setCatalogPage(page);
    return this.catalogServerPage ? this.loadBookGrid() : this.renderBooks();
  }

  updateCatalogPagination(pageCount) {
    const currentPage = this.model.catalogPage;
    this.catalogPageCount = pageCount;
    CatalogPaginationView.render(
      this,
      currentPage,
      pageCount,
      () => this.getCatalogPageItems(currentPage, pageCount),
      (item) => this.navigateCatalogPage(item),
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
    return this.navigateCatalogPage(page);
  }

  syncSearchPresentation() {
    CatalogView.syncSearchPresentation(this, this.model, () => this.renderRecents());
    this.syncCatalogControls();
  }

  updateBooksCountBadge(count) {
    CatalogView.updateBooksCountBadge(count);
  }

  renderRecents() {
    RecentReadsView.renderRecentReads(
      this.recentsContainer,
      this.recentsSection,
      this.model.recentBooks,
      (bookId, page) => this.openBook(bookId, page),
      (book) => this.metadataManager.openEditModal(book),
    );
  }

  filterBooks(query) {
    this.model.setSearchQuery(query);
    this.model.setCatalogPage(1);
    this.catalogServerPage = null;
    this.catalogRequestSequence++;
    this.syncSearchPresentation();
    this.renderBooks();
    if (this.catalogSearchTimeout !== null) window.clearTimeout(this.catalogSearchTimeout);
    this.catalogSearchTimeout = window.setTimeout(() => {
      this.catalogSearchTimeout = null;
      return this.loadBookGrid();
    }, 250);
  }

  updateActiveCollectionChip() {
    VirtualLibraryView.renderCollectionChips(
      this.activeCollectionChip,
      this.model.virtualLibraries,
      this.model.activeVirtualLibraryId,
      (libraryId) => this.selectVirtualLibrary(libraryId),
      (library) => this.deleteVirtualLibrary(library),
      (library) => this.vlManager?.openManageModal(library),
    );
  }

  async deleteVirtualLibrary(library) {
    if (!confirm(`Delete virtual library «${library.name}»? Its books will not be deleted from Calibre.`)) {
      return;
    }
    try {
      await api.deleteVirtualLibrary(library.id);
      const wasActive = Number(this.model.activeVirtualLibraryId) === Number(library.id);
      if (wasActive) {
        this.model.setActiveVirtualLibrary(null);
        this.model.setCatalogPage(1);
        if (this.vlSelect) this.vlSelect.value = "";
      }
      await this.loadVirtualLibraries();
      if (wasActive) await this.loadHome();
    } catch (error) {
      alert(`Could not delete virtual library: ${error.message}`);
    }
  }

  async deleteBook(bookId) {
    const id = Number(bookId);
    if (!Number.isSafeInteger(id)) return;
    this.model.removeBook(id);
    this.selectedBookIds.delete(id);
    if (typeof localDB !== "undefined" && localDB && typeof localDB.deleteBook === "function") {
      try {
        await localDB.deleteBook(id);
      } catch (err) {
        console.warn("[LibraryViewModel] Error cleaning up local cache for deleted book:", err);
      }
    }
    this.renderBooks();
    this.renderRecents();
    await this.loadHome();
  }

  selectVirtualLibrary(libraryId) {
    this.model.setActiveVirtualLibrary(libraryId);
    this.model.setCatalogPage(1);
    if (this.vlSelect) this.vlSelect.value = libraryId == null ? "" : String(libraryId);
    this.updateActiveCollectionChip();
    return this.loadBookGrid();
  }

  clearCollectionFilter() {
    this.model.setActiveVirtualLibrary(null);
    this.model.setCatalogPage(1);
    if (this.vlSelect) this.vlSelect.value = "";
    this.updateActiveCollectionChip();
    this.loadHome();
  }

  openBook(bookId, startPage = null) {
    if (window.reader && typeof window.reader.open === "function") {
      window.reader.open(bookId, startPage);
    }
  }

  openUploadModal() {
    this.uploadManager.openUploadModal();
  }
  closeUploadModal() {
    this.uploadManager.closeUploadModal();
  }
  openEditModal(book) {
    this.metadataManager.openEditModal(book);
  }
  openVirtualLibraryModal() {
    const activeCollection = this.model.getActiveVirtualLibrary();
    this.vlManager.openVirtualLibraryModal({
      searchQuery: this.model.searchQuery || "",
      activeVirtualLibraryId: this.model.activeVirtualLibraryId || null,
      activeCollectionName: activeCollection?.name || "",
      activeCollectionType: activeCollection?.type || "",
      activeCollectionQuery: activeCollection?.query || "",
    });
  }

  bindEvents() {
    CatalogView.bindEvents?.(this);
  }
}

window.LibraryViewModel = LibraryViewModel;
