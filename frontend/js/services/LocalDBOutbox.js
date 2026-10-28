/**
 * LocalDBOutbox.js
 * Handles offline catalog book metadata persistence and persistent outbox synchronization
 * for LocalDB.
 */
class LocalDBOutbox {
  static readStorageJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  static writeStorageJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }

  static removeStorageKey(key) {
    try {
      localStorage.removeItem(key);
    } catch {}
  }

  static async saveCachedBook(dbInstance, book) {
    if (!book?.id) return;
    const bId = Number(book.id);
    const existing = await dbInstance._get("cached_books", bId);
    const item = {
      id: bId,
      title: book.title || existing?.title || "Untitled",
      authors: book.authors || existing?.authors || "",
      cover_path: book.cover_path || existing?.cover_path || "",
      coverBlob: book.coverBlob || existing?.coverBlob || null,
      total_pages: Number(book.total_pages || book.totalPages || existing?.total_pages || 0),
      cachedAt: Date.now(),
      isOfflineComplete:
        book.isOfflineComplete !== undefined ? Boolean(book.isOfflineComplete) : Boolean(existing?.isOfflineComplete),
    };
    await dbInstance._put("cached_books", item).catch(() => {});

    const list = this.readStorageJson("moon_offline_books", []);
    const { coverBlob: _omitted, ...localStorageItem } = item;
    const idx = list.findIndex((b) => Number(b.id) === item.id);
    if (idx >= 0) list[idx] = { ...list[idx], ...localStorageItem };
    else list.push(localStorageItem);
    this.writeStorageJson("moon_offline_books", list);
  }

  static async deleteCachedBook(dbInstance, bookId) {
    if (!bookId) return false;
    const bId = Number(bookId);
    await dbInstance._delete("cached_books", bId).catch(() => {});
    const raw = localStorage.getItem("moon_offline_books");
    if (raw) {
      const filtered = this.readStorageJson("moon_offline_books", []).filter((b) => Number(b.id) !== bId);
      this.writeStorageJson("moon_offline_books", filtered);
    }
    return true;
  }

  static async clearCachedBooks(dbInstance) {
    try {
      const db = await dbInstance.open();
      await new Promise((resolve, reject) => {
        const tx = db.transaction("cached_books", "readwrite");
        tx.objectStore("cached_books").clear();
        tx.oncomplete = () => resolve(true);
        tx.onerror = (e) => reject(e);
      });
    } catch {}
    this.removeStorageKey("moon_offline_books");
    return true;
  }

  static async getAllCachedBooks(dbInstance) {
    const books = await dbInstance._getAll("cached_books");
    if (books.length > 0) return books;
    return this.readStorageJson("moon_offline_books", []);
  }

  static async getOfflineCompleteBooks(dbInstance) {
    const allCached = await dbInstance.getAllCachedBooks();
    const pdfBookIds = new Set(await dbInstance.getAllCachedPdfBookIds());
    const completeBooks = [];

    for (const book of allCached) {
      const bId = Number(book.id);
      const hasPdf = pdfBookIds.has(bId) || (await dbInstance.isPdfCached(bId));
      if (!hasPdf) continue;

      const totalPages = book.total_pages || book.totalPages;
      const isComplete =
        totalPages > 0
          ? (await dbInstance.hasAllLayoutsCached(bId, totalPages)) || Boolean(book.isOfflineComplete)
          : (await dbInstance.getCachedLayoutPages(bId)).size > 0 || Boolean(book.isOfflineComplete);
      if (isComplete) completeBooks.push(book);
    }
    return completeBooks;
  }

  static async isBookOfflineComplete(dbInstance, bookId) {
    if (!bookId) return false;
    try {
      const bId = Number(bookId);
      if (!(await dbInstance.isPdfCached(bId))) return false;
      const book = await dbInstance._get("cached_books", bId);
      if (book?.isOfflineComplete) return true;
      const totalPages = book?.total_pages || book?.totalPages;
      return totalPages > 0 ? await dbInstance.hasAllLayoutsCached(bId, totalPages) : false;
    } catch {
      return false;
    }
  }

  static isOutboxOpReady(op, now = Date.now()) {
    const backoffMs = op.attempts > 0 ? Math.min(60000, 1000 * 2 ** (op.attempts - 1)) : 0;
    return !op.lastAttempt || now - op.lastAttempt >= backoffMs;
  }

  static async executeAnnotationOutboxOp(client, op) {
    if (op.action === "create") {
      await client.createAnnotation(op.bookId, op.payload);
      return true;
    }
    if (op.action === "update") {
      await client.updateAnnotation(op.entityId, op.payload);
      return true;
    }
    if (op.action === "delete") {
      try {
        await client.deleteAnnotation(op.entityId);
        return true;
      } catch (delErr) {
        if (delErr?.message?.includes("404") || delErr?.status === 404) return true;
        throw delErr;
      }
    }
    return false;
  }

  static async executeProgressOutboxOp(op) {
    const res = await fetch(`/api/books/${op.bookId}/progress`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(op.payload),
    });
    return Boolean(res?.ok);
  }

  static async executeDrawingOutboxOp(client, op) {
    if (op.action === "save") {
      const res = await client.savePageDrawings(op.bookId, op.page, op.payload?.strokes);
      return res !== null;
    }
    if (op.action === "clear") {
      return Boolean(await client.clearPageDrawings(op.bookId, op.page));
    }
    return false;
  }

  static async executeOutboxOp(dbInstance, client, op) {
    const handlers = {
      annotation: () => dbInstance._executeAnnotationOutboxOp(client, op),
      progress: () => dbInstance._executeProgressOutboxOp(client, op),
      drawing: () => dbInstance._executeDrawingOutboxOp(client, op),
    };
    return handlers[op.type] ? await handlers[op.type]() : false;
  }

  static async processOutboxQueueInternal(dbInstance, client) {
    let processed = 0;
    const ops = await dbInstance.getPendingOutboxOps();
    const now = Date.now();

    for (const op of ops) {
      if (!dbInstance._isOutboxOpReady(op, now)) continue;
      let success = false;
      try {
        success = await dbInstance._executeOutboxOp(client, op);
      } catch (execErr) {
        console.warn(`[LocalDB] Outbox operation ${op.id} attempt failed:`, execErr);
      }

      if (success) {
        await dbInstance.removeOutboxOp(op.id);
        processed++;
      } else {
        Object.assign(op, {
          attempts: (op.attempts || 0) + 1,
          lastAttempt: Date.now(),
          status: "failed",
        });
        await dbInstance.updateOutboxOp(op);
      }
    }
    return { processed, pending: await dbInstance.getOutboxCount() };
  }
}

window.LocalDBOutbox = LocalDBOutbox;
