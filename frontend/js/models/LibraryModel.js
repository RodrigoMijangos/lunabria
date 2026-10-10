/**
 * LibraryModel.js
 * Model & State Management for Moon-Calibre Library, Collections & Uploads
 * Follows Single Responsibility Principle (SRP): Each function has exactly one responsibility.
 */

class LibraryModel {
  constructor() {
    this.theme = localStorage.getItem('moon_theme') || 'sepia';
    this.activeVirtualLibraryId = null;
    this.allBooks = [];
    this.virtualLibraries = [];
    this.recentBooks = [];
    this.searchQuery = '';
    const storedCatalogSort = localStorage.getItem('moon_catalog_sort');
    this.catalogSort = ['title', 'date_added', 'last_read_at'].includes(storedCatalogSort)
      ? storedCatalogSort
      : 'title';
    this.catalogCollapsed = localStorage.getItem('moon_catalog_collapsed') === 'true';
    const storedCatalogPageSize = Number(localStorage.getItem('moon_catalog_page_size'));
    this.catalogPageSizePreference = Number.isInteger(storedCatalogPageSize) && storedCatalogPageSize > 0
      ? storedCatalogPageSize
      : null;
    this.catalogPage = 1;
    this.uploadQueue = [];
  }

  // --- Theme State ---
  setTheme(newTheme) {
    this.theme = newTheme || 'sepia';
    localStorage.setItem('moon_theme', this.theme);
    return this.theme;
  }

  getTheme() {
    return this.theme;
  }

  // --- Virtual Library State ---
  setActiveVirtualLibrary(id) {
    this.activeVirtualLibraryId = id !== null && id !== undefined && id !== '' ? Number(id) : null;
    return this.activeVirtualLibraryId;
  }

  getActiveVirtualLibrary() {
    if (!this.activeVirtualLibraryId) return null;
    return this.virtualLibraries.find(vl => vl.id === this.activeVirtualLibraryId) || null;
  }

  setVirtualLibraries(libraries) {
    this.virtualLibraries = Array.isArray(libraries) ? libraries : [];
    return this.virtualLibraries;
  }

  // --- Books State ---
  setBooks(books) {
    this.allBooks = Array.isArray(books) ? books : [];
    return this.allBooks;
  }

  getBookById(bookId) {
    return this.allBooks.find(b => b.id === Number(bookId)) || null;
  }

  removeBook(bookId) {
    const id = Number(bookId);
    this.allBooks = this.allBooks.filter(b => Number(b.id) !== id);
    this.recentBooks = this.recentBooks.filter(b => Number(b.id) !== id);
    return this.allBooks;
  }

  setRecentBooks(recentList) {
    this.recentBooks = Array.isArray(recentList) ? recentList : [];
    return this.recentBooks;
  }

  // --- Search & Filtering ---
  setSearchQuery(query) {
    const nextQuery = (query || '').toLowerCase().trim();
    if (nextQuery !== this.searchQuery) this.catalogPage = 1;
    this.searchQuery = nextQuery;
    return this.searchQuery;
  }

  setCatalogSort(sortKey) {
    const supportedSorts = ['title', 'date_added', 'last_read_at'];
    this.catalogSort = supportedSorts.includes(sortKey) ? sortKey : 'title';
    localStorage.setItem('moon_catalog_sort', this.catalogSort);
    return this.catalogSort;
  }

  setCatalogCollapsed(collapsed) {
    this.catalogCollapsed = Boolean(collapsed);
    localStorage.setItem('moon_catalog_collapsed', String(this.catalogCollapsed));
    return this.catalogCollapsed;
  }

  getFilteredBooks() {
    const recentIds = new Set(this.recentBooks.map(book => String(book.id)));
    const query = this.searchQuery;
    const filtered = this.allBooks.filter(book => {
      if (!query && this.catalogSort !== 'last_read_at' && recentIds.has(String(book.id))) return false;
      if (!query) return true;

      const title = (book.title || '').toLowerCase();
      const authors = (book.authors || '').toLowerCase();
      const tags = Array.isArray(book.tags) ? book.tags.join(' ').toLowerCase() : '';
      return title.includes(query) || authors.includes(query) || tags.includes(query);
    });

    if (this.catalogSort === 'title') {
      return filtered.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'es', { sensitivity: 'base' }));
    }

    return filtered.sort((a, b) => {
      const parseTimestamp = value => {
        if (!value) return 0;
        const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
        const timestamp = Date.parse(normalized);
        return Number.isFinite(timestamp) ? timestamp : 0;
      };
      return parseTimestamp(b[this.catalogSort]) - parseTimestamp(a[this.catalogSort]);
    });
  }

  getCatalogPageSize(maxPageSize, minPageSize = 1) {
    const preferredSize = this.catalogPageSizePreference ?? maxPageSize;
    return Math.max(minPageSize, Math.min(preferredSize, maxPageSize));
  }

  setCatalogPageSize(pageSize) {
    const size = Math.trunc(Number(pageSize));
    if (!Number.isFinite(size) || size < 1) return this.catalogPageSizePreference;

    this.catalogPageSizePreference = size;
    localStorage.setItem('moon_catalog_page_size', String(size));
    this.catalogPage = 1;
    return size;
  }

  getCatalogPageCount(bookCount, pageSize) {
    return Math.max(1, Math.ceil(bookCount / pageSize));
  }

  setCatalogPage(page) {
    const pageNumber = Number(page);
    this.catalogPage = Number.isFinite(pageNumber) ? Math.max(1, Math.trunc(pageNumber)) : 1;
    return this.catalogPage;
  }

  getCatalogPage(books, pageSize) {
    const pageCount = this.getCatalogPageCount(books.length, pageSize);
    this.catalogPage = Math.min(this.catalogPage, pageCount);
    const start = (this.catalogPage - 1) * pageSize;
    return books.slice(start, start + pageSize);
  }

  // --- Upload Queue State ---
  addFilesToUploadQueue(files) {
    const fileArray = Array.from(files);
    fileArray.forEach(file => {
      this.uploadQueue.push({
        id: `${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        file: file,
        name: file.name,
        size: file.size,
        status: 'pending',
        progress: 0,
        jobId: null,
        error: null
      });
    });
    return this.uploadQueue;
  }

  removeUploadItem(itemId) {
    this.uploadQueue = this.uploadQueue.filter(item => item.id !== itemId);
    return this.uploadQueue;
  }

  clearUploadQueue() {
    this.uploadQueue = [];
  }

  // --- Formatting Pure Helpers ---
  static formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  static formatReadingProgress(currentPage, totalPages) {
    if (!totalPages || totalPages <= 0) return 0;
    return Math.min(100, Math.max(0, Math.round((currentPage / totalPages) * 100)));
  }
}

// Attach to window for standard script loading
window.LibraryModel = LibraryModel;
