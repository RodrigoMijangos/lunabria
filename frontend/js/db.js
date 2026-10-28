/**
 * IndexedDB helper for Offline Storage (PDF caching, offline layouts & progress sync)
 */
const SIMPLE_STORES = [
  ["pdf_cache", "bookId"],
  ["pending_annotations", "id"],
  ["local_progress", "bookId"],
  ["cached_books", "id"],
  ["cached_annotations", "bookId"],
];

const INDEXED_STORES = ["page_layouts", "page_drawings"];

class LocalDB {
  constructor() {
    this.dbName = "moon_calibre_local";
    this.version = 7;
    this.db = null;
    this._outboxProcessing = false;
    this._outboxPromise = null;
  }

  async open() {
    if (this.db) return this.db;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        for (const [name, keyPath] of SIMPLE_STORES) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath });
        }
        if (e.oldVersion < 5 && db.objectStoreNames.contains("page_layouts")) {
          db.deleteObjectStore("page_layouts");
        }
        for (const name of INDEXED_STORES) {
          if (!db.objectStoreNames.contains(name)) {
            const store = db.createObjectStore(name, { keyPath: "key" });
            store.createIndex("by_book", "bookId", { unique: false });
          }
        }
      };

      request.onsuccess = (e) => {
        this.db = e.target.result;
        resolve(this.db);
      };
      request.onerror = (e) => reject(e);
    });
  }

  async _put(storeName, record) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).put(record);
      tx.oncomplete = () => resolve(true);
      tx.onerror = (e) => reject(e);
    });
  }

  async _get(storeName, key) {
    try {
      const db = await this.open();
      return await new Promise((resolve) => {
        const tx = db.transaction(storeName, "readonly");
        const req = tx.objectStore(storeName).get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  }

  async _delete(storeName, key) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).delete(key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = (e) => reject(e);
    });
  }

  async _getAll(storeName) {
    try {
      const db = await this.open();
      return await new Promise((resolve) => {
        const tx = db.transaction(storeName, "readonly");
        const req = tx.objectStore(storeName).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });
    } catch {
      return [];
    }
  }

  async _deleteByBookIndex(storeName, bookId) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      const index = tx.objectStore(storeName).index("by_book");
      const req = index.openCursor(IDBKeyRange.only(Number(bookId)));
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (!cursor) return resolve(true);
        cursor.delete();
        cursor.continue();
      };
      req.onerror = (e) => reject(e);
    });
  }

  async savePdfBlob(bookId, blob) {
    return this._put("pdf_cache", { bookId: Number(bookId), blob, cachedAt: Date.now() });
  }

  async getPdfBlob(bookId) {
    const record = await this._get("pdf_cache", Number(bookId));
    return record ? record.blob : null;
  }

  async deletePdfBlob(bookId) {
    if (!bookId) return false;
    return this._delete("pdf_cache", Number(bookId)).catch(() => false);
  }

  async isPdfCached(bookId) {
    return (await this.getPdfBlob(bookId)) !== null;
  }

  async saveLocalProgress(bookId, progress) {
    const bId = Number(bookId);
    LocalDBOutbox.writeStorageJson(`moon_progress_${bId}`, progress);
    return this._put("local_progress", { bookId: bId, ...progress, updatedAt: Date.now() });
  }

  async getLocalProgress(bookId) {
    const bId = Number(bookId);
    const local = await this._get("local_progress", bId);
    if (local?.current_page) return local;
    return LocalDBOutbox.readStorageJson(`moon_progress_${bId}`, null);
  }

  async deleteLocalProgress(bookId) {
    if (!bookId) return false;
    const bId = Number(bookId);
    LocalDBOutbox.removeStorageKey(`moon_progress_${bId}`);
    return this._delete("local_progress", bId).catch(() => false);
  }

  // --- Offline Page Layouts ---
  async saveLayout(bookId, pageNumber, layoutData) {
    if (!layoutData) return;
    const bId = Number(bookId);
    const pNum = Number(pageNumber);
    return this._put("page_layouts", {
      key: `${bId}_${pNum}`,
      bookId: bId,
      page: pNum,
      layout: layoutData,
      cachedAt: Date.now(),
    });
  }

  async saveLayoutsBatch(bookId, layoutsObj) {
    if (!layoutsObj) return;
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("page_layouts", "readwrite");
      const store = tx.objectStore("page_layouts");
      const bId = Number(bookId);
      const now = Date.now();
      for (const [pageNumStr, layout] of Object.entries(layoutsObj)) {
        if (!layout) continue;
        const pNum = Number(pageNumStr);
        store.put({ key: `${bId}_${pNum}`, bookId: bId, page: pNum, layout, cachedAt: now });
      }
      tx.oncomplete = () => resolve(true);
      tx.onerror = (e) => reject(e);
    });
  }

  async getLayout(bookId, pageNumber) {
    const record = await this._get("page_layouts", `${Number(bookId)}_${Number(pageNumber)}`);
    return record ? record.layout : null;
  }

  async hasLayout(bookId, pageNumber) {
    return (await this.getLayout(bookId, pageNumber)) !== null;
  }

  async getCachedLayoutPages(bookId) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("page_layouts", "readonly");
      const index = tx.objectStore("page_layouts").index("by_book");
      const request = index.openKeyCursor(IDBKeyRange.only(Number(bookId)));
      const pages = new Set();

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor) return resolve(pages);
        const pageNumber = Number(String(cursor.primaryKey).split("_").pop());
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
    return this._deleteByBookIndex("page_layouts", bookId);
  }

  // --- Freehand Page Drawings ---
  async savePageDrawings(bookId, pageNumber, strokes) {
    return this._put("page_drawings", {
      key: `${bookId}_${pageNumber}`,
      bookId: Number(bookId),
      page: Number(pageNumber),
      strokes,
      updatedAt: Date.now(),
    });
  }

  async getPageDrawings(bookId, pageNumber) {
    const record = await this._get("page_drawings", `${bookId}_${pageNumber}`);
    return record ? record.strokes : null;
  }

  async clearPageDrawings(bookId, pageNumber) {
    return this._delete("page_drawings", `${bookId}_${pageNumber}`);
  }

  async clearBookDrawings(bookId) {
    if (!bookId) return false;
    return this._deleteByBookIndex("page_drawings", bookId).catch(() => false);
  }

  // --- Cached Books Metadata (Offline Catalog) ---
  async saveCachedBook(book) {
    return LocalDBOutbox.saveCachedBook(this, book);
  }

  async saveCachedBooks(books) {
    if (!Array.isArray(books)) return;
    for (const b of books) await this.saveCachedBook(b);
  }

  async deleteCachedBook(bookId) {
    return LocalDBOutbox.deleteCachedBook(this, bookId);
  }

  async clearCachedBooks() {
    return LocalDBOutbox.clearCachedBooks(this);
  }

  async getAllCachedBooks() {
    return LocalDBOutbox.getAllCachedBooks(this);
  }

  async getAllCachedPdfBookIds() {
    try {
      const db = await this.open();
      return await new Promise((resolve) => {
        const tx = db.transaction("pdf_cache", "readonly");
        const req = tx.objectStore("pdf_cache").getAllKeys();
        req.onsuccess = () => resolve((req.result || []).map(Number));
        req.onerror = () => resolve([]);
      });
    } catch {
      return [];
    }
  }

  async getOfflineCompleteBooks() {
    return LocalDBOutbox.getOfflineCompleteBooks(this);
  }

  async isBookOfflineComplete(bookId) {
    return LocalDBOutbox.isBookOfflineComplete(this, bookId);
  }

  // --- Cached Annotations ---
  async saveCachedAnnotations(bookId, annotations) {
    if (!bookId || !Array.isArray(annotations)) return false;
    return this._put("cached_annotations", { bookId: Number(bookId), annotations, updatedAt: Date.now() });
  }

  async getCachedAnnotations(bookId) {
    if (!bookId) return null;
    const record = await this._get("cached_annotations", Number(bookId));
    return record ? record.annotations : null;
  }

  async deleteCachedAnnotations(bookId) {
    if (!bookId) return false;
    return this._delete("cached_annotations", Number(bookId)).catch(() => false);
  }

  // --- Persistent Outbox Queue (pending_annotations) ---
  async enqueueOutboxOp(op) {
    if (!op?.id) return false;
    const entry = { attempts: 0, createdAt: Date.now(), lastAttempt: 0, status: "pending", ...op };
    return this._put("pending_annotations", entry).catch((e) => {
      console.warn("[LocalDB] Failed to enqueue outbox op:", e);
      return false;
    });
  }

  async getPendingOutboxOps() {
    return this._getAll("pending_annotations");
  }

  async removeOutboxOp(opId) {
    if (!opId) return false;
    return this._delete("pending_annotations", opId).catch(() => false);
  }

  async clearBookOutboxOps(bookId) {
    if (!bookId) return false;
    const bId = Number(bookId);
    try {
      const ops = await this.getPendingOutboxOps();
      for (const op of ops) {
        if (Number(op.bookId) === bId) await this.removeOutboxOp(op.id);
      }
      return true;
    } catch {
      return false;
    }
  }

  async deleteCoverCache(bookId) {
    if (!bookId || typeof caches?.open !== "function") return false;
    try {
      const cache = await caches.open("lunabria-covers-v1");
      return await cache.delete(`/api/books/${Number(bookId)}/cover`);
    } catch {
      return false;
    }
  }

  async deleteBook(bookId) {
    if (!bookId) return false;
    const bId = Number(bookId);
    await Promise.allSettled([
      this.deleteCachedBook(bId),
      this.deletePdfBlob(bId),
      this.deleteLocalProgress(bId),
      this.clearBookLayouts(bId),
      this.clearBookDrawings(bId),
      this.deleteCachedAnnotations(bId),
      this.clearBookOutboxOps(bId),
      this.deleteCoverCache(bId),
    ]);
    return true;
  }

  async updateOutboxOp(op) {
    if (!op?.id) return false;
    return this._put("pending_annotations", op).catch(() => false);
  }

  async getOutboxCount() {
    try {
      const db = await this.open();
      return await new Promise((resolve) => {
        const tx = db.transaction("pending_annotations", "readonly");
        const req = tx.objectStore("pending_annotations").count();
        req.onsuccess = () => resolve(req.result || 0);
        req.onerror = () => resolve(0);
      });
    } catch {
      return 0;
    }
  }

  async processOutboxQueue(apiClient) {
    if (this._outboxPromise) return this._outboxPromise;
    const client = apiClient || (typeof api !== "undefined" ? api : null);
    if (!client) return { processed: 0, pending: await this.getOutboxCount() };

    this._outboxProcessing = true;
    this._outboxPromise = this.processOutboxQueueInternal(client).finally(() => {
      this._outboxProcessing = false;
      this._outboxPromise = null;
    });
    return this._outboxPromise;
  }

  _isOutboxOpReady(op, now = Date.now()) {
    return LocalDBOutbox.isOutboxOpReady(op, now);
  }

  async _executeAnnotationOutboxOp(client, op) {
    return LocalDBOutbox.executeAnnotationOutboxOp(client, op);
  }

  async _executeProgressOutboxOp(_client, op) {
    return LocalDBOutbox.executeProgressOutboxOp(op);
  }

  async _executeDrawingOutboxOp(client, op) {
    return LocalDBOutbox.executeDrawingOutboxOp(client, op);
  }

  async _executeOutboxOp(client, op) {
    return LocalDBOutbox.executeOutboxOp(this, client, op);
  }

  async processOutboxQueueInternal(client) {
    return LocalDBOutbox.processOutboxQueueInternal(this, client);
  }
}

const localDB = new LocalDB();
