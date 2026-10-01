/**
 * API Client for Lunabria Backend
 */
const api = {
  // Books
  async getBooks(search = null, virtualLibraryId = null) {
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    if (virtualLibraryId) params.append('virtual_library_id', virtualLibraryId);
    const res = await fetch(`/api/books?${params.toString()}`);
    if (!res.ok) throw new Error('Error fetching books');
    return res.json();
  },

  async getBook(bookId) {
    const res = await fetch(`/api/books/${bookId}`);
    if (!res.ok) throw new Error('Book not found');
    return res.json();
  },

  async deleteBook(bookId) {
    console.log('[Lunabria] ❌ Deleting book:', bookId);
    const res = await fetch(`/api/books/${bookId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Error deleting book');
    const result = await res.json();
    console.log('[Lunabria] ✔️ Book successfully deleted');
    return result;
  },

  async uploadBook(file) {
    const formData = new FormData();
    formData.append('files', file, file.name);
    const res = await fetch('/api/books/upload', {
      method: 'POST',
      body: formData
    });
    if (!res.ok) {
      let detail = 'Error uploading book';
      try {
        const error = await res.json();
        detail = error.detail || detail;
      } catch (e) {}
      throw new Error(detail);
    }
    return res.json();
  },

  async uploadBooks(formData) {
    console.log('[Lunabria] 📤 Uploading book files...');
    const res = await fetch('/api/books/upload', {
      method: 'POST',
      body: formData
    });
    if (!res.ok) throw new Error('Error uploading books');
    const result = await res.json();
    console.log('[Lunabria] ✔️ Books processed and imported:', result);
    return result;
  },

  // Recents (Top 10)
  async getRecents() {
    const res = await fetch('/api/recents');
    if (!res.ok) return [];
    return res.json();
  },

  // Virtual Libraries
  async getVirtualLibraries() {
    const res = await fetch('/api/virtual-libraries');
    if (!res.ok) return [];
    return res.json();
  },

  async createVirtualLibrary(data) {
    console.log('[Lunabria] 📚 Creating virtual library:', data.name);
    const res = await fetch('/api/virtual-libraries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Error creating virtual library');
    }
    const result = await res.json();
    console.log('[Lunabria] ✔️ Virtual library created:', result);
    return result;
  },

  async addBooksToVirtualLibrary(id, bookIds) {
    const res = await fetch(`/api/virtual-libraries/${id}/books`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ book_ids: bookIds })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Error adding books to virtual library');
    }
    return res.json();
  },

  async deleteVirtualLibrary(id) {
    console.log('[Lunabria] 🗑️ Deleting virtual library:', id);
    const res = await fetch(`/api/virtual-libraries/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Error deleting virtual library');
    return res.json();
  },

  async getVirtualLibraryBooks(id) {
    const res = await fetch(`/api/virtual-libraries/${id}/books`);
    if (!res.ok) throw new Error('Error fetching books from virtual library');
    return res.json();
  },

  // Metadata
  async getMetadataSources() {
    const res = await fetch('/api/metadata/sources');
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Error fetching metadata sources');
    }
    return res.json();
  },

  async saveMetadataSources(selectedSources) {
    const res = await fetch('/api/metadata/sources', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selected_sources: selectedSources })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Error saving metadata sources');
    }
    return res.json();
  },

  async fetchMetadataOnline(data) {
    console.log('[Lunabria] 🔍 Fetching online metadata with Calibre:', data);
    const res = await fetch('/api/metadata/fetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Error fetching metadata with Calibre');
    }
    return res.json();
  },

  async fetchMetadataByIsbn(isbn) {
    return this.fetchMetadataOnline({ isbn });
  },

  async updateMetadata(bookId, data) {
    console.log('[Lunabria] 🏷️ Updating book metadata:', bookId, data);
    const res = await fetch(`/api/metadata/${bookId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Error updating metadata');
    }
    const result = await res.json();
    console.log('[Lunabria] ✔️ Metadata saved successfully');
    return result;
  },

  // Pending layout batch fetches to avoid duplicate concurrent network calls
  _layoutBatches: new Map(),

  // Reader Progress & Sync Configuration
  syncConfig: {
    getMode() {
      // 'interval' (periodic autosave) | 'close' (on book close only) | 'page' (after each page)
      return localStorage.getItem('moon_sync_mode') || 'interval';
    },
    setMode(mode) {
      localStorage.setItem('moon_sync_mode', mode);
    },
    getIntervalMinutes() {
      const val = parseInt(localStorage.getItem('moon_sync_interval') || '5', 10);
      return (isNaN(val) || val < 1) ? 5 : val;
    },
    setIntervalMinutes(min) {
      const safe = Math.max(1, Math.min(120, parseInt(min, 10) || 5));
      localStorage.setItem('moon_sync_interval', safe.toString());
    }
  },

  _pendingProgress: null,
  _autoSaveTimer: null,
  _lastSyncTime: null,

  async getProgress(bookId) {
    try {
      const res = await fetch(`/api/books/${bookId}/progress`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.current_page) {
          this._lastSyncTime = new Date();
          await localDB.saveLocalProgress(bookId, data);
          return data;
        }
      }
    } catch (e) {
      console.warn('Network offline or progress fetch failed, checking local storage:', e);
    }
    return await localDB.getLocalProgress(bookId);
  },

  async markBookOpened(bookId, progressData) {
    const res = await fetch(`/api/books/${bookId}/opened`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(progressData)
    });
    if (!res.ok) throw new Error('Could not record book opening');
    return res.json();
  },

  async saveProgress(bookId, progressData) {
    // 1. Instantly save in local storage (IndexedDB + localStorage)
    // Zero latency and full offline protection against network failures.
    await localDB.saveLocalProgress(bookId, progressData);

    this._pendingProgress = {
      bookId,
      data: progressData,
      timestamp: Date.now()
    };

    const mode = this.syncConfig.getMode();

    if (mode === 'page') {
      // Option to send data after each page
      await this.syncPendingProgress('after each page');
    } else {
      console.log(`[Lunabria] 📖 Progress saved locally: Page ${progressData.current_page}/${progressData.total_pages} (${progressData.percentage}%) [Pending sync to server per mode '${mode}']`);
      if (mode === 'interval') {
        this.ensureAutoSaveTimer();
      }
    }
  },

  ensureAutoSaveTimer() {
    if (this._autoSaveTimer) return;
    const minutes = this.syncConfig.getIntervalMinutes();
    const ms = minutes * 60 * 1000;
    this._autoSaveTimer = setInterval(async () => {
      if (this._pendingProgress) {
        console.log(`[Lunabria] ⏱️ Running periodic autosave (${minutes} min)...`);
        await this.syncPendingProgress(`autosave every ${minutes} min`);
      }
    }, ms);
  },

  stopAutoSaveTimer() {
    if (this._autoSaveTimer) {
      clearInterval(this._autoSaveTimer);
      this._autoSaveTimer = null;
    }
  },

  restartAutoSaveTimer() {
    this.stopAutoSaveTimer();
    if (this.syncConfig.getMode() === 'interval') {
      this.ensureAutoSaveTimer();
    }
  },

  async syncPendingProgress(reason = 'manual') {
    if (!this._pendingProgress) {
      return { success: true, alreadySynced: true };
    }
    const { bookId, data } = this._pendingProgress;
    try {
      const res = await fetch(`/api/books/${bookId}/progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (res.ok) {
        this._lastSyncTime = new Date();
        this._pendingProgress = null;
        console.log(`[Lunabria] ☁️ Synced with server (${reason}): Book ${bookId}, Page ${data.current_page}/${data.total_pages} (${data.percentage}%)`);
        return { success: true, data };
      }
    } catch (e) {
      console.warn(`[Lunabria] ⚠️ Error syncing with server (${reason}):`, e);
    }
    return { success: false };
  },

  flushPendingProgressBeacon() {
    if (!this._pendingProgress) return;
    const { bookId, data } = this._pendingProgress;
    const url = `/api/books/${bookId}/progress`;
    const payload = JSON.stringify(data);
    try {
      if (navigator.sendBeacon) {
        const blob = new Blob([payload], { type: 'application/json' });
        navigator.sendBeacon(url, blob);
      } else {
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: true
        });
      }
      console.log(`[Lunabria] 📕 Progress synced on window/tab close: Page ${data.current_page}`);
      this._pendingProgress = null;
    } catch (e) {
      console.warn('Beacon sync failed:', e);
    }
  },

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

  async getAnnotations(bookId, color = null) {
    const url = color ? `/api/books/${bookId}/annotations?color=${encodeURIComponent(color)}` : `/api/books/${bookId}/annotations`;
    const res = await fetch(url);
    if (!res.ok) return [];
    return res.json();
  },

  async createAnnotation(bookId, data) {
    console.log('[Lunabria] ✏️ Saving new highlight:', {
      book: bookId,
      page: data.page,
      color: data.color,
      text: (data.text || '').substring(0, 60) + '...'
    });
    const res = await fetch(`/api/books/${bookId}/annotations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error('Error saving annotation');
    const result = await res.json();
    console.log('[Lunabria] ✔️ Highlight saved successfully');
    return result;
  },

  async updateAnnotation(annotId, data) {
    console.log('[Lunabria] 🔄 Updating highlight:', annotId, data);
    const res = await fetch(`/api/annotations/${annotId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error('Error updating annotation');
    const result = await res.json();
    console.log('[Lunabria] ✔️ Highlight updated');
    return result;
  },

  async deleteAnnotation(annotId) {
    console.log('[Lunabria] 🗑️ Deleting highlight:', annotId);
    const res = await fetch(`/api/annotations/${annotId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Error deleting annotation');
    const result = await res.json();
    console.log('[Lunabria] ✔️ Highlight deleted');
    return result;
  },

  // Highlight Colors Settings
  async getColors() {
    const res = await fetch('/api/settings/colors');
    if (!res.ok) return [];
    return res.json();
  },

  async saveColors(colors) {
    console.log('[Lunabria] 🎨 Saving color configuration:', colors);
    const res = await fetch('/api/settings/colors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(colors)
    });
    if (!res.ok) throw new Error('Error saving colors');
    const result = await res.json();
    console.log('[Lunabria] ✔️ Color palette saved');
    return result;
  },

  // Freehand Page Drawings (Smart pencil, stylus, and canvas drawings)
  async getPageDrawings(bookId, page) {
    try {
      const res = await fetch(`/api/books/${bookId}/pages/${page}/drawings`);
      if (!res.ok) return [];
      return res.json();
    } catch (e) {
      return [];
    }
  },

  async savePageDrawings(bookId, page, strokes) {
    try {
      const res = await fetch(`/api/books/${bookId}/pages/${page}/drawings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strokes })
      });
      if (!res.ok) return null;
      return res.json();
    } catch (e) {
      return null;
    }
  },

  async clearPageDrawings(bookId, page) {
    try {
      const res = await fetch(`/api/books/${bookId}/pages/${page}/drawings`, {
        method: 'DELETE'
      });
      return res.ok;
    } catch (e) {
      return false;
    }
  }
};
