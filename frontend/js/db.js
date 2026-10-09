/**
 * IndexedDB helper for Offline Storage (PDF caching, offline layouts & progress sync)
 */
class LocalDB {
  constructor() {
    this.dbName = 'moon_calibre_local';
    this.version = 6;
    this.db = null;
  }

  async open() {
    if (this.db) return this.db;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        // 1. Store for cached PDF blobs: key is bookId
        if (!db.objectStoreNames.contains('pdf_cache')) {
          db.createObjectStore('pdf_cache', { keyPath: 'bookId' });
        }
        // 2. Store for offline pending annotations
        if (!db.objectStoreNames.contains('pending_annotations')) {
          db.createObjectStore('pending_annotations', { keyPath: 'id' });
        }
        // 3. Store for offline reading progress
        if (!db.objectStoreNames.contains('local_progress')) {
          db.createObjectStore('local_progress', { keyPath: 'bookId' });
        }
        // 4. Store for pre-buffered & offline page layouts (key: `${bookId}_${pageNumber}`)
        if (e.oldVersion < 5 && db.objectStoreNames.contains('page_layouts')) {
          db.deleteObjectStore('page_layouts');
        }
        if (!db.objectStoreNames.contains('page_layouts')) {
          const store = db.createObjectStore('page_layouts', { keyPath: 'key' });
          store.createIndex('by_book', 'bookId', { unique: false });
        }
        // 5. Store for freehand page drawings / smart pencil ink (key: `${bookId}_${pageNumber}`)
        if (!db.objectStoreNames.contains('page_drawings')) {
          const store = db.createObjectStore('page_drawings', { keyPath: 'key' });
          store.createIndex('by_book', 'bookId', { unique: false });
        }
        // 6. Store for cached book metadata for offline library catalog
        if (!db.objectStoreNames.contains('cached_books')) {
          db.createObjectStore('cached_books', { keyPath: 'id' });
        }
      };

      request.onsuccess = (e) => {
        this.db = e.target.result;
        resolve(this.db);
      };

      request.onerror = (e) => reject(e);
    });
  }

  async savePdfBlob(bookId, blob) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('pdf_cache', 'readwrite');
      const store = tx.objectStore('pdf_cache');
      store.put({ bookId: Number(bookId), blob: blob, cachedAt: Date.now() });
      tx.oncomplete = () => resolve(true);
      tx.onerror = (e) => reject(e);
    });
  }

  async getPdfBlob(bookId) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('pdf_cache', 'readonly');
      const store = tx.objectStore('pdf_cache');
      const req = store.get(Number(bookId));
      req.onsuccess = () => resolve(req.result ? req.result.blob : null);
      req.onerror = (e) => reject(e);
    });
  }

  async isPdfCached(bookId) {
    const blob = await this.getPdfBlob(bookId);
    return blob !== null;
  }

  async saveLocalProgress(bookId, progress) {
    const bId = Number(bookId);
    // Instant fallback sync to localStorage
    try {
      localStorage.setItem(`moon_progress_${bId}`, JSON.stringify(progress));
    } catch (e) {}

    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('local_progress', 'readwrite');
      const store = tx.objectStore('local_progress');
      store.put({ bookId: bId, ...progress, updatedAt: Date.now() });
      tx.oncomplete = () => resolve(true);
      tx.onerror = (e) => reject(e);
    });
  }

  async getLocalProgress(bookId) {
    const bId = Number(bookId);
    try {
      const db = await this.open();
      const local = await new Promise((resolve, reject) => {
        const tx = db.transaction('local_progress', 'readonly');
        const store = tx.objectStore('local_progress');
        const req = store.get(bId);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = (e) => reject(e);
      });
      if (local && local.current_page) return local;
    } catch (e) {}

    try {
      const raw = localStorage.getItem(`moon_progress_${bId}`);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return null;
  }

  // --- Offline Page Layouts (10-Page Buffering) ---
  async saveLayout(bookId, pageNumber, layoutData) {
    if (!layoutData) return;
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('page_layouts', 'readwrite');
      const store = tx.objectStore('page_layouts');
      store.put({
        key: `${Number(bookId)}_${Number(pageNumber)}`,
        bookId: Number(bookId),
        page: Number(pageNumber),
        layout: layoutData,
        cachedAt: Date.now()
      });
      tx.oncomplete = () => resolve(true);
      tx.onerror = (e) => reject(e);
    });
  }

  async saveLayoutsBatch(bookId, layoutsObj) {
    if (!layoutsObj || typeof layoutsObj !== 'object') return;
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('page_layouts', 'readwrite');
      const store = tx.objectStore('page_layouts');
      const bId = Number(bookId);
      const now = Date.now();
      for (const [pageNumStr, layout] of Object.entries(layoutsObj)) {
        if (!layout) continue;
        const pNum = Number(pageNumStr);
        store.put({
          key: `${bId}_${pNum}`,
          bookId: bId,
          page: pNum,
          layout: layout,
          cachedAt: now
        });
      }
      tx.oncomplete = () => resolve(true);
      tx.onerror = (e) => reject(e);
    });
  }

  async getLayout(bookId, pageNumber) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('page_layouts', 'readonly');
      const store = tx.objectStore('page_layouts');
      const req = store.get(`${Number(bookId)}_${Number(pageNumber)}`);
      req.onsuccess = () => resolve(req.result ? req.result.layout : null);
      req.onerror = (e) => reject(e);
    });
  }

  async hasLayout(bookId, pageNumber) {
    const layout = await this.getLayout(bookId, pageNumber);
    return layout !== null;
  }

  async getCachedLayoutPages(bookId) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('page_layouts', 'readonly');
      const index = tx.objectStore('page_layouts').index('by_book');
      const request = index.openKeyCursor(IDBKeyRange.only(Number(bookId)));
      const pages = new Set();

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor) {
          resolve(pages);
          return;
        }
        const pageNumber = Number(String(cursor.primaryKey).split('_').pop());
        if (Number.isInteger(pageNumber)) pages.add(pageNumber);
        cursor.continue();
      };
      request.onerror = (event) => reject(event.target.error);
    });
  }

  async hasAllLayoutsCached(bookId, totalPages) {
    if (!Number.isInteger(totalPages) || totalPages < 1) return false;
    const cachedPages = await this.getCachedLayoutPages(bookId);
    for (let page = 1; page <= totalPages; page += 1) {
      if (!cachedPages.has(page)) return false;
    }
    return true;
  }

  async clearBookLayouts(bookId) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('page_layouts', 'readwrite');
      const store = tx.objectStore('page_layouts');
      const index = store.index('by_book');
      const req = index.openCursor(IDBKeyRange.only(Number(bookId)));
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          resolve(true);
        }
      };
      req.onerror = (e) => reject(e);
    });
  }

  // --- Freehand Page Drawings (Smart pencil, stylus, and canvas drawings) ---
  async savePageDrawings(bookId, pageNumber, strokes) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('page_drawings', 'readwrite');
      const store = tx.objectStore('page_drawings');
      const key = `${bookId}_${pageNumber}`;
      store.put({ key, bookId: Number(bookId), page: Number(pageNumber), strokes, updatedAt: Date.now() });
      tx.oncomplete = () => resolve(true);
      tx.onerror = (e) => reject(e);
    });
  }

  async getPageDrawings(bookId, pageNumber) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('page_drawings', 'readonly');
      const store = tx.objectStore('page_drawings');
      const key = `${bookId}_${pageNumber}`;
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result ? req.result.strokes : null);
      req.onerror = () => resolve(null);
    });
  }

  async clearPageDrawings(bookId, pageNumber) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('page_drawings', 'readwrite');
      const store = tx.objectStore('page_drawings');
      const key = `${bookId}_${pageNumber}`;
      store.delete(key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = (e) => reject(e);
    });
  }

  // --- Cached Books Metadata (for Offline Catalog) ---
  async saveCachedBook(book) {
    if (!book || !book.id) return;
    const item = {
      id: Number(book.id),
      title: book.title || 'Untitled',
      authors: book.authors || '',
      cover_path: book.cover_path || '',
      total_pages: Number(book.total_pages || book.totalPages || 0),
      cachedAt: Date.now(),
      isOfflineComplete: Boolean(book.isOfflineComplete)
    };
    try {
      const db = await this.open();
      await new Promise((resolve, reject) => {
        const tx = db.transaction('cached_books', 'readwrite');
        const store = tx.objectStore('cached_books');
        store.put(item);
        tx.oncomplete = () => resolve(true);
        tx.onerror = (e) => reject(e);
      });
    } catch (e) {}

    // Fallback sync to localStorage
    try {
      const raw = localStorage.getItem('moon_offline_books');
      const list = raw ? JSON.parse(raw) : [];
      const idx = list.findIndex(b => Number(b.id) === item.id);
      if (idx >= 0) list[idx] = { ...list[idx], ...item };
      else list.push(item);
      localStorage.setItem('moon_offline_books', JSON.stringify(list));
    } catch (e) {}
  }

  async saveCachedBooks(books) {
    if (!Array.isArray(books)) return;
    for (const b of books) {
      await this.saveCachedBook(b);
    }
  }

  async getAllCachedBooks() {
    try {
      const db = await this.open();
      const books = await new Promise((resolve) => {
        const tx = db.transaction('cached_books', 'readonly');
        const store = tx.objectStore('cached_books');
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });
      if (books && books.length > 0) return books;
    } catch (e) {}

    // Fallback from localStorage
    try {
      const raw = localStorage.getItem('moon_offline_books');
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  async getAllCachedPdfBookIds() {
    try {
      const db = await this.open();
      return new Promise((resolve) => {
        const tx = db.transaction('pdf_cache', 'readonly');
        const store = tx.objectStore('pdf_cache');
        const req = store.getAllKeys();
        req.onsuccess = () => resolve((req.result || []).map(Number));
        req.onerror = () => resolve([]);
      });
    } catch (e) {
      return [];
    }
  }

  async getOfflineCompleteBooks() {
    const allCached = await this.getAllCachedBooks();
    const pdfBookIds = new Set(await this.getAllCachedPdfBookIds());
    const completeBooks = [];

    for (const book of allCached) {
      const bId = Number(book.id);
      let hasPdf = pdfBookIds.has(bId);
      if (!hasPdf) {
        hasPdf = await this.isPdfCached(bId);
      }
      if (!hasPdf) continue;

      const totalPages = book.total_pages || book.totalPages;
      if (totalPages && totalPages > 0) {
        const hasAllLayouts = await this.hasAllLayoutsCached(bId, totalPages);
        if (hasAllLayouts || book.isOfflineComplete) {
          completeBooks.push(book);
        }
      } else {
        const cachedPages = await this.getCachedLayoutPages(bId);
        if (cachedPages.size > 0 || book.isOfflineComplete) {
          completeBooks.push(book);
        }
      }
    }

    return completeBooks;
  }
}

const localDB = new LocalDB();
