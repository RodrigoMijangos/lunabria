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
    this.catalogSearchTimeout = null;
    this.catalogRequestSequence = 0;
    this.catalogServerPage = null;
    this.selectionMode = false;
    this.selectedBookIds = new Set();
    this.catalogSelectionBusy = false;

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
    if (typeof MobilePWAInstaller !== 'undefined') {
      this.pwaInstaller = new MobilePWAInstaller();
    }
  }

  initServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').then((reg) => {
        if (reg.waiting) {
          this.showUpdateBanner(reg.waiting);
        }
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              this.showUpdateBanner(newWorker);
            }
          });
        });
        reg.update().catch(() => {});
      }).catch(err => {
        console.warn('[LibraryViewModel] Service worker registration failed:', err);
      });

      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!refreshing) {
          refreshing = true;
          window.location.reload();
        }
      });
    }
  }

  applyTheme(theme) {
    this.model.setTheme(theme);
    if (typeof document !== 'undefined') {
      if (document.documentElement && typeof document.documentElement.setAttribute === 'function') {
        document.documentElement.setAttribute('data-theme', this.model.theme);
      }
      const select = typeof document.getElementById === 'function' ? document.getElementById('theme-select') : null;
      if (select) select.value = this.model.theme;
      const themeColorMeta = typeof document.querySelector === 'function' ? document.querySelector('meta[name=\"theme-color\"]') : null;
      if (themeColorMeta && typeof themeColorMeta.setAttribute === 'function') {
        const themeColors = {
          sepia: '#f4ecd8',
          dark: '#151a24',
          amoled: '#000000',
        };
        themeColorMeta.setAttribute('content', themeColors[this.model.theme] || '#f4ecd8');
      }
    }
  }

  async loadHome() {
    const requestSequence = ++this.catalogRequestSequence;
    if (this.catalogSearchTimeout !== null) {
      window.clearTimeout(this.catalogSearchTimeout);
      this.catalogSearchTimeout = null;
    }
    this.catalogServerPage = null;
    let cachedBooks = [];
    if (typeof localDB !== 'undefined' && localDB && typeof localDB.getAllCachedBooks === 'function') {
      try {
        const cached = await localDB.getAllCachedBooks();
        if (requestSequence !== this.catalogRequestSequence) return;
        cachedBooks = Array.isArray(cached) ? cached : [];
        if (
          cachedBooks.length > 0 &&
          (!this.model.allBooks || this.model.allBooks.length === 0)
        ) {
          this.model.setBooks(cachedBooks);
          this.renderBooks();
        }
      } catch (_) {}
    }
    try {
      let recents = [];
      if (this.model.catalogSort !== 'last_read_at') {
        const serverRecents = await api.getRecents();
        if (requestSequence !== this.catalogRequestSequence) return;
        recents = await this.attachCachedCovers(serverRecents, cachedBooks);
        if (requestSequence !== this.catalogRequestSequence) return;
      }
      this.model.setRecentBooks(recents);

      const options = this.getCatalogRequestOptions();
      const response = await api.getBooks(null, this.model.activeVirtualLibraryId, options);
      if (requestSequence !== this.catalogRequestSequence) return;
      const page = this.normalizeCatalogResponse(response, options);
      const books = await this.attachCachedCovers(page.books, cachedBooks);
      if (requestSequence !== this.catalogRequestSequence) return;
      this.model.setBooks(books);
      if (page.serverPaged) {
        this.model.setCatalogPage(page.page);
        this.catalogServerPage = { page: page.page, pageSize: page.pageSize, total: page.total };
      }

      if (
        typeof localDB !== 'undefined' &&
        localDB &&
        page.total === 0 &&
        !this.model.searchQuery &&
        !this.model.activeVirtualLibraryId &&
        typeof localDB.clearCachedBooks === 'function'
      ) {
        localDB.clearCachedBooks().catch(() => {});
      } else if (
        typeof localDB !== 'undefined' &&
        localDB &&
        typeof localDB.saveCachedBooks === 'function' &&
        Array.isArray(books) &&
        books.length > 0
      ) {
        localDB.saveCachedBooks(books)
          .then(() => this.cacheMissingOfflineCovers(books))
          .catch(err => {
            console.warn('[LibraryViewModel] Could not refresh the local book cache:', err);
          });
      }
      this.hideOfflineBanner();
      if (this.model.catalogSort === 'last_read_at') {
        if (this.recentsSection) this.recentsSection.style.display = 'none';
      } else {
        this.renderRecents();
      }
      this.renderBooks();
      this.updateActiveCollectionChip();
    } catch (err) {
      await this.handleCatalogLoadError(err, requestSequence, 'Loading the catalogue');
    }
  }

  async handleCatalogLoadError(error, requestSequence, operation) {
    const monitor = window.serverConnectivity;
    let serverAvailable = false;
    if (typeof monitor?.checkServer === 'function') {
      try {
        serverAvailable = await monitor.checkServer();
      } catch (_) {}
    }
    if (requestSequence !== this.catalogRequestSequence) return;

    if (serverAvailable) {
      this.hideOfflineBanner();
      console.error(`[LibraryViewModel] ${operation} failed while the server is reachable:`, error);
      return;
    }

    console.warn(`[LibraryViewModel] ${operation} failed; checking offline books:`, error);
    await this.showOfflineBooks();
  }


  getCatalogRequestOptions() {
    const columns = this.getCatalogGridColumnCount();
    const maxPageSize = columns * 3;
    const pageSize = this.model.getCatalogPageSize(maxPageSize, columns);
    const excludeIds = !this.model.searchQuery && this.model.catalogSort !== 'last_read_at'
      ? this.model.recentBooks.map(book => Number(book.id)).filter(Number.isSafeInteger)
      : [];
    return {
      query: this.model.searchQuery,
      page: this.model.catalogPage,
      pageSize,
      sort: this.model.catalogSort,
      excludeIds
    };
  }

  normalizeCatalogResponse(response, options) {
    if (Array.isArray(response)) {
      return {
        books: response,
        total: response.length,
        page: options.page,
        pageSize: options.pageSize,
        serverPaged: false
      };
    }
    const books = Array.isArray(response?.books) ? response.books : [];
    return {
      books,
      total: Number.isFinite(Number(response?.total)) ? Number(response.total) : books.length,
      page: Number(response?.page) || options.page,
      pageSize: Number(response?.page_size) || options.pageSize,
      serverPaged: Array.isArray(response?.books)
    };
  }

  async showOfflineBooks() {
    const requestSequence = ++this.catalogRequestSequence;
    if (this.catalogSearchTimeout !== null) {
      window.clearTimeout(this.catalogSearchTimeout);
      this.catalogSearchTimeout = null;
    }
    this.catalogServerPage = null;
    if (typeof localDB !== 'undefined' && localDB && typeof localDB.getOfflineCompleteBooks === 'function') {
      let offlineBooks = [];
      try {
        offlineBooks = await localDB.getOfflineCompleteBooks();
      } catch (dbErr) {
        console.error('[LibraryViewModel] Error retrieving offline complete books:', dbErr);
      }
      if (requestSequence !== this.catalogRequestSequence) return;
      offlineBooks = Array.isArray(offlineBooks) ? offlineBooks : [];
      this.model.setBooks(offlineBooks);
      this.model.setRecentBooks([]);
      this.showOfflineBanner(offlineBooks.length);
    } else {
      this.showOfflineBanner(0);
    }
    this.renderRecents();
    this.renderBooks();
    this.updateActiveCollectionChip();
  }

  async cacheMissingOfflineCovers(books) {
    if (
      !Array.isArray(books) ||
      books.length === 0 ||
      typeof localDB === 'undefined' ||
      !localDB ||
      typeof localDB.getOfflineCompleteBooks !== 'function' ||
      typeof localDB.saveCachedBook !== 'function' ||
      typeof fetch !== 'function'
    ) {
      return;
    }

    const offlineBooks = await localDB.getOfflineCompleteBooks();
    if (!Array.isArray(offlineBooks)) return;
    const offlineById = new Map(offlineBooks.map(book => [Number(book.id), book]));

    for (const book of books) {
      const id = Number(book.id);
      const cachedBook = offlineById.get(id);
      if (
        !Number.isSafeInteger(id) ||
        !cachedBook ||
        cachedBook.coverBlob ||
        (!book.cover_url && !book.has_cover)
      ) {
        continue;
      }

      try {
        const coverUrl = book.cover_url || `/api/books/${id}/cover`;
        const response = await fetch(coverUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const coverBlob = await response.blob();
        if (!coverBlob.size || (coverBlob.type && !coverBlob.type.startsWith('image/'))) {
          throw new Error('The cover response is not a valid image');
        }
        await localDB.saveCachedBook({ ...book, coverBlob });
        cachedBook.coverBlob = coverBlob;
      } catch (err) {
        console.warn(`[LibraryViewModel] Could not cache the offline cover for book ${id}:`, err);
      }
    }
  }

  showOfflineBanner(count = 0) {
    let banner = document.getElementById('offline-catalog-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'offline-catalog-banner';
      banner.className = 'offline-catalog-banner';
      const container = document.querySelector('.container') || document.querySelector('main');
      if (container) container.prepend(banner);
    }
    const message = count > 0
      ? 'Modo sin conexión: mostrando ' + count + ' libro(s) disponible(s) con PDF y lectura completa'
      : 'Modo sin conexión: sin libros descargados para lectura completa';
    banner.innerHTML = '<svg class="ui-icon" aria-hidden="true" focusable="false"><use href="./icons.svg#circle-check"></use></svg> <span>' + message + '</span>';
    banner.style.display = 'flex';
  }

  hideOfflineBanner() {
    const banner = document.getElementById('offline-catalog-banner');
    if (banner) banner.style.display = 'none';
  }

  showUpdateBanner(worker) {
    let banner = document.getElementById('app-update-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'app-update-banner';
      banner.className = 'app-update-banner';
      const container = document.querySelector('.container') || document.querySelector('main');
      if (container) container.prepend(banner);
    }
    banner.innerHTML = `
      <div class="app-update-banner-content">
        <svg class="ui-icon" aria-hidden="true" focusable="false"><use href="./icons.svg#circle-check"></use></svg>
        <span>Nueva versión de Lunabria disponible.</span>
      </div>
      <button type="button" class="btn btn-sm btn-primary" id="app-update-reload-btn">Actualizar</button>
    `;
    const btn = banner.querySelector('#app-update-reload-btn');
    if (btn) {
      btn.onclick = () => {
        btn.disabled = true;
        btn.textContent = 'Actualizando...';
        if (worker && typeof worker.postMessage === 'function') {
          worker.postMessage({ action: 'SKIP_WAITING' });
        } else if (navigator.serviceWorker && navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage({ action: 'SKIP_WAITING' });
        } else {
          window.location.reload();
        }
      };
    }
    banner.style.display = 'flex';
  }

  hideUpdateBanner() {
    const banner = document.getElementById('app-update-banner');
    if (banner) banner.style.display = 'none';
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

  async attachCachedCovers(books, cachedBooks = null) {
    if (!Array.isArray(books) || !books.length || typeof localDB === 'undefined' ||
        !localDB || typeof localDB.getAllCachedBooks !== 'function') {
      return books;
    }

    let storedBooks = cachedBooks;
    if (!Array.isArray(storedBooks)) {
      try {
        storedBooks = await localDB.getAllCachedBooks();
      } catch (_) {
        return books;
      }
    }
    const coverBlobs = new Map((storedBooks || [])
      .filter(book => book?.coverBlob)
      .map(book => [Number(book.id), book.coverBlob]));
    return books.map(book => {
      const coverBlob = coverBlobs.get(Number(book.id));
      return !book.coverBlob && coverBlob ? { ...book, coverBlob } : book;
    });
  }

  async loadBookGrid() {
    const requestSequence = ++this.catalogRequestSequence;
    const options = this.getCatalogRequestOptions();
    try {
      const response = await api.getBooks(null, this.model.activeVirtualLibraryId, options);
      if (requestSequence !== this.catalogRequestSequence) return;
      const page = this.normalizeCatalogResponse(response, options);
      const books = await this.attachCachedCovers(page.books);
      if (requestSequence !== this.catalogRequestSequence) return;
      this.model.setBooks(books);
      if (page.serverPaged) {
        this.model.setCatalogPage(page.page);
        this.catalogServerPage = { page: page.page, pageSize: page.pageSize, total: page.total };
      } else {
        this.catalogServerPage = null;
      }
      this.renderBooks();
    } catch (err) {
      await this.handleCatalogLoadError(err, requestSequence, 'Loading a catalogue page');
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
    let pageCount;
    if (this.catalogServerPage) {
      pageBooks = this.model.allBooks.slice(0, pageSize);
      totalBooks = this.catalogServerPage.total;
      pageCount = this.model.getCatalogPageCount(totalBooks, pageSize);
    } else {
      const filtered = this.model.getFilteredBooks();
      pageBooks = this.model.getCatalogPage(filtered, pageSize);
      totalBooks = filtered.length;
      pageCount = this.model.getCatalogPageCount(totalBooks, pageSize);
    }

    this.updateBooksCountBadge(totalBooks);
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

  navigateCatalogPage(requestedPage) {
    const pageNumber = Number(requestedPage);
    if (!Number.isSafeInteger(pageNumber)) return;
    const pageCount = Math.max(1, this.catalogPageCount);
    const page = Math.min(Math.max(1, pageNumber), pageCount);
    if (page === this.model.catalogPage) return;

    this.model.setCatalogPage(page);
    if (this.catalogServerPage) return this.loadBookGrid();
    return this.renderBooks();
  }

  updateCatalogPagination(pageCount) {
    const currentPage = this.model.catalogPage;
    this.catalogPageCount = pageCount;
    CatalogPaginationView.render(
      this, currentPage, pageCount,
      () => this.getCatalogPageItems(currentPage, pageCount),
      item => this.navigateCatalogPage(item)
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

  async deleteBook(bookId) {
    const id = Number(bookId);
    if (!Number.isSafeInteger(id)) return;
    this.model.removeBook(id);
    this.selectedBookIds.delete(id);
    if (typeof localDB !== 'undefined' && localDB && typeof localDB.deleteBook === 'function') {
      try {
        await localDB.deleteBook(id);
      } catch (err) {
        console.warn('[LibraryViewModel] Error cleaning up local cache for deleted book:', err);
      }
    }
    this.renderBooks();
    this.renderRecents();
    await this.loadHome();
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
      this.model.setCatalogPage(1);
      this.catalogServerPage = null;
      this.loadHome();
    });
    this.catalogToggleButton?.addEventListener('click', () => {
      this.model.setCatalogCollapsed(!this.model.catalogCollapsed);
      this.syncCatalogControls();
      if (!this.catalogContent?.hidden) this.renderBooks();
    });
    this.catalogPageSizeSelect?.addEventListener('change', (event) => {
      this.model.setCatalogPageSize(event.target.value);
      if (this.catalogServerPage) this.loadBookGrid();
      else this.renderBooks();
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
          this.loadBookGrid();
        }
        if (!this.model.searchQuery && this.recentsContainer?.clientWidth > 0) this.renderRecents();
      }, 120);
    });
    window.addEventListener('lunabria:server-connectivity-change', (event) => {
      if (event.detail?.available) {
        if (event.detail.previousState === 'unknown') return;
        const reader = window.reader;
        if (reader?.model?.bookId && reader.container?.style.display === 'flex') {
          reader.reconcileServerConnection?.();
        }
        this.loadHome();
      } else {
        this.showOfflineBooks();
      }
    });
    this.catalogPageInput?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      this.submitCatalogPageInput();
      this.catalogPageInput.blur();
    });
    this.catalogPageInput?.addEventListener('blur', () => this.submitCatalogPageInput());
    this.catalogPreviousButton?.addEventListener('click', () => {
      this.navigateCatalogPage(this.model.catalogPage - 1);
    });
    this.catalogNextButton?.addEventListener('click', () => {
      this.navigateCatalogPage(this.model.catalogPage + 1);
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
