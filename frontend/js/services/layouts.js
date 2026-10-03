/** Layouts API domain. Compose on the facade to preserve dynamic this. */
const createLayoutsApiService = () => ({
  // Pending layout batch fetches to avoid duplicate concurrent network calls
  _layoutBatches: new Map(),
  // Page Layouts: Offline-First with 10-Page Batch Buffering
  async getPageLayout(bookId, pageNumber, totalPages = null) {
    // Step 1: Check offline IndexedDB cache (0 network requests if already cached)
    try {
      const cached = await localDB.getLayout(bookId, pageNumber);
      if (cached) {
        console.log(`[Lunabria] ⚡ Page ${pageNumber}: Layout loaded from IndexedDB (0 network requests)`);
        return cached;
      }
    } catch (e) {
      console.warn('IndexedDB layout lookup failed:', e);
    }

    // Step 2: Buffer a 10-page batch containing this page to minimize requests and enable offline reading
    const batchSize = 10;
    const startPage = Math.max(1, Math.floor((pageNumber - 1) / batchSize) * batchSize + 1);
    const endPage = totalPages ? Math.min(totalPages, startPage + batchSize - 1) : startPage + batchSize - 1;
    const batchKey = `${bookId}_${startPage}_${endPage}`;

    if (!this._layoutBatches.has(batchKey)) {
      const fetchPromise = (async () => {
        try {
          console.log(`[Lunabria] 🌐 Downloading batch of 10 layouts (${startPage}-${endPage}) via HTTP/2...`);
          const res = await fetch(`/api/books/${bookId}/layouts?start_page=${startPage}&end_page=${endPage}`);
          if (res.ok) {
            const data = await res.json();
            if (data && data.layouts) {
              await localDB.saveLayoutsBatch(bookId, data.layouts);
              console.log(`[Lunabria] 💾 Layout batch for pages ${startPage}-${endPage} stored in IndexedDB`);
              return data.layouts[String(pageNumber)] || null;
            }
          }
        } catch (e) {
          console.warn(`Batch layout fetch failed for pages ${startPage}-${endPage}:`, e);
        } finally {
          this._layoutBatches.delete(batchKey);
        }

        // Fallback: single page fetch if batch endpoint fails
        try {
          const res = await fetch(`/api/books/${bookId}/pages/${pageNumber}/layout`);
          if (res.ok) {
            const layout = await res.json();
            await localDB.saveLayout(bookId, pageNumber, layout);
            return layout;
          }
        } catch (e) {}

        return null;
      })();

      this._layoutBatches.set(batchKey, fetchPromise);
    }

    // Await batch and return this page
    try {
      const batchResult = await this._layoutBatches.get(batchKey);
      if (batchResult) return batchResult;
      const recheck = await localDB.getLayout(bookId, pageNumber);
      if (recheck) return recheck;
    } catch (e) {}

    return null;
  },

  // Download and cache a complete page-layout range for offline reading.
  async prefetchLayouts(bookId, startPage, endPage) {
    try {
      const res = await fetch(`/api/books/${bookId}/layouts?start_page=${startPage}&end_page=${endPage}`);
      if (!res.ok) return false;

      const data = await res.json();
      if (!data || !data.layouts) return false;
      for (let page = startPage; page <= endPage; page += 1) {
        if (!Object.prototype.hasOwnProperty.call(data.layouts, String(page)) || !data.layouts[String(page)]) {
          return false;
        }
      }

      await localDB.saveLayoutsBatch(bookId, data.layouts);
      return true;
    } catch (e) {
      console.warn(`Layout download failed for book ${bookId} pages ${startPage}-${endPage}:`, e);
      return false;
    }
  },
});
