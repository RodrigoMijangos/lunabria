// Frozen pre-extraction implementation: evaluated as a classic script in its
// own VM, not called as a host function. Keep this oracle unchanged.
function originalApiSnapshot() {
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
    const local = await localDB.getLocalProgress(bookId);
    try {
      const res = await fetch(`/api/books/${bookId}/progress`);
      if (res.ok) {
        const serverData = await res.json();
        if (serverData && serverData.current_page) {
          this._lastSyncTime = new Date();
          // If local progress is ahead of server (pending sync was not delivered), preserve local and sync forward
          if (local && local.current_page && local.current_page > serverData.current_page) {
            await this.saveProgress(bookId, local);
            await this.syncPendingProgress('reconcile ahead local');
            return local;
          }
          await localDB.saveLocalProgress(bookId, serverData);
          return serverData;
        }
      }
    } catch (e) {
      console.warn('Network offline or progress fetch failed, checking local storage:', e);
    }
    return local;
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

if (typeof window !== 'undefined') {
  const flushBeacon = () => {
    if (api && typeof api.flushPendingProgressBeacon === 'function') {
      api.flushPendingProgressBeacon();
    }
  };
  window.addEventListener('beforeunload', flushBeacon);
  window.addEventListener('pagehide', flushBeacon);
}

window.api = api;
}

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const servicePaths = [
  'books.js', 'virtual-libraries.js', 'metadata.js', 'progress.js',
  'layouts.js', 'annotations.js', 'colors.js', 'drawings.js'
];
const jsDirectory = path.join(__dirname, '../js');
const snapshotText = originalApiSnapshot.toString();
const originalSource = snapshotText.slice(snapshotText.indexOf('{') + 1, -1);
const normalize = value => JSON.parse(JSON.stringify(value, (_key, item) => {
  if (item instanceof Error || (item && /Error$/.test(item.name))) {
    return { name: item.name, message: item.message };
  }
  return item;
}));
const progress = { current_page: 7, total_pages: 20, percentage: 35 };
const pageOne = { page: 1, text: 'one' };
const pageTwo = { page: 2, text: 'two' };

function harness(refactored = true, options = {}) {
  const calls = [];
  const responses = [...(options.responses || [])];
  const storage = new Map(Object.entries(options.storage || {}));
  const localProgress = new Map(Object.entries(options.progress || {}));
  const layouts = new Map(Object.entries(options.layouts || {}));
  const timers = new Map();
  const events = new Map();
  let timerId = 0;
  let fetchHandler;
  const fail = operation => {
    if ((options.failDB || []).includes(operation)) throw new Error(operation + ' failed');
  };
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [1700000000000])); }
    static now() { return 1700000000000; }
  }
  class FakeFormData {
    constructor() { this.entries = []; }
    append(...args) { this.entries.push(args); }
  }
  class FakeBlob {
    constructor(parts, settings) { this.parts = parts; this.type = settings.type; }
  }
  const context = vm.createContext({
    URLSearchParams, Date: FixedDate, FormData: FakeFormData, Blob: FakeBlob,
    console: Object.fromEntries(['log', 'warn'].map(level => [level, (...args) => {
      calls.push(['console.' + level, ...normalize(args)]);
    }])),
    localStorage: {
      getItem(key) { calls.push(['storage.get', key]); return storage.get(key) ?? null; },
      setItem(key, value) { calls.push(['storage.set', key, String(value)]); storage.set(key, String(value)); }
    },
    localDB: {
      async getLocalProgress(book) {
        calls.push(['db.getLocalProgress', book]); fail('getLocalProgress');
        return localProgress.get(String(book)) ?? null;
      },
      async saveLocalProgress(book, data) {
        calls.push(['db.saveLocalProgress', book, normalize(data)]); fail('saveLocalProgress');
        localProgress.set(String(book), data);
      },
      async getLayout(book, page) {
        calls.push(['db.getLayout', book, page]); fail('getLayout');
        return layouts.get(`${book}_${page}`) ?? null;
      },
      async saveLayout(book, page, data) {
        calls.push(['db.saveLayout', book, page, normalize(data)]); fail('saveLayout');
        layouts.set(`${book}_${page}`, data);
      },
      async saveLayoutsBatch(book, data) {
        calls.push(['db.saveLayoutsBatch', book, normalize(data)]); fail('saveLayoutsBatch');
        for (const [page, layout] of Object.entries(data)) layouts.set(`${book}_${page}`, layout);
      }
    },
    navigator: {},
    fetch(url, settings) {
      calls.push(['fetch', url, settings === undefined ? null : normalize(settings)]);
      if (fetchHandler) return fetchHandler(url, settings);
      const response = responses.shift() || {};
      if (response.syncError) throw new Error('sync network failure');
      if (response.networkError) return Promise.reject(new Error('network failure'));
      return Promise.resolve({
        ok: response.ok ?? true,
        json() {
          calls.push(['json', url]);
          return response.jsonError ? Promise.reject(new SyntaxError('bad json'))
            : Promise.resolve(Object.hasOwn(response, 'data') ? response.data : { result: 'ok' });
        }
      });
    },
    setInterval(callback, delay) {
      const id = ++timerId; timers.set(id, callback); calls.push(['timer.start', id, delay]); return id;
    },
    clearInterval(id) { calls.push(['timer.stop', id]); timers.delete(id); },
    addEventListener(name, callback) {
      calls.push(['event.listen', name]);
      if (!events.has(name)) events.set(name, []);
      events.get(name).push(callback);
    }
  });
  context.window = context;
  if (options.beacon !== 'absent') {
    context.navigator.sendBeacon = (url, blob) => {
      calls.push(['beacon', url, normalize(blob)]);
      if (options.beacon === 'throw') throw new Error('beacon failure');
      return options.beacon !== 'false';
    };
  }
  if (refactored) {
    for (const file of servicePaths) {
      vm.runInContext(readFileSync(path.join(jsDirectory, 'services', file), 'utf8'), context, { filename: file });
    }
    vm.runInContext(readFileSync(path.join(jsDirectory, 'api.js'), 'utf8'), context, { filename: 'api.js' });
  } else {
    vm.runInContext(originalSource, context, { filename: 'original-api.js' });
  }
  return {
    context, api: context.api, calls, storage, localProgress, layouts, timers, events,
    setFetchHandler(handler) { fetchHandler = handler; },
    snapshot() {
      return normalize({
        calls, storage: [...storage], progress: [...localProgress], layouts: [...layouts],
        timers: [...timers.keys()],
        state: {
          pending: context.api._pendingProgress, timer: context.api._autoSaveTimer,
          lastSync: context.api._lastSyncTime, batches: [...context.api._layoutBatches.keys()]
        }
      });
    }
  };
}

async function outcome(action, env) {
  try {
    const result = await action(env);
    return result === undefined ? { undefined: true } : { value: normalize(result) };
  } catch (error) {
    return { error: { name: error.name, message: error.message } };
  }
}

function parity(name, options, action, verify) {
  test(name, async () => {
    const original = harness(false, options);
    const extracted = harness(true, options);
    const before = await outcome(action, original);
    const after = await outcome(action, extracted);
    assert.deepEqual(after, before, 'result/error changed');
    assert.deepEqual(extracted.snapshot(), original.snapshot(), 'side effects/state changed');
    if (verify) await verify(extracted, after);
  });
}

const expectedKeys = [
  'getBooks', 'getBook', 'deleteBook', 'uploadBook', 'uploadBooks', 'getRecents',
  'getVirtualLibraries', 'createVirtualLibrary', 'addBooksToVirtualLibrary',
  'deleteVirtualLibrary', 'getVirtualLibraryBooks', 'getMetadataSources',
  'saveMetadataSources', 'fetchMetadataOnline', 'fetchMetadataByIsbn', 'updateMetadata',
  '_layoutBatches', 'syncConfig', '_pendingProgress', '_autoSaveTimer', '_lastSyncTime',
  'getProgress', 'markBookOpened', 'saveProgress', 'ensureAutoSaveTimer',
  'stopAutoSaveTimer', 'restartAutoSaveTimer', 'syncPendingProgress',
  'flushPendingProgressBeacon', 'getPageLayout', 'prefetchLayouts', 'getAnnotations',
  'createAnnotation', 'updateAnnotation', 'deleteAnnotation', 'getColors', 'saveColors',
  'getPageDrawings', 'savePageDrawings', 'clearPageDrawings'
];

test('facade preserves global identity, own keys/order, descriptors and unchanged method bodies', () => {
  const original = harness(false);
  const extracted = harness();
  assert.deepEqual(Object.keys(extracted.api), expectedKeys);
  assert.deepEqual(Object.keys(extracted.context), Object.keys(original.context), 'no extra window globals');
  assert.equal(vm.runInContext('api === window.api', extracted.context), true);
  for (const key of expectedKeys) {
    const a = Object.getOwnPropertyDescriptor(original.api, key);
    const b = Object.getOwnPropertyDescriptor(extracted.api, key);
    for (const flag of ['writable', 'enumerable', 'configurable']) assert.equal(b[flag], a[flag], key);
    if (typeof a.value === 'function') {
      assert.equal(b.value.name, a.value.name, key);
      assert.equal(b.value.length, a.value.length, key);
      // HTTP errors must reject here so the reader can use its IndexedDB fallback.
      if (key !== 'getAnnotations') {
        assert.equal(b.value.toString(), a.value.toString(), key + ' must be a mechanical extraction');
      }
      assert.equal(Object.hasOwn(b.value, 'prototype'), Object.hasOwn(a.value, 'prototype'), key);
    }
  }
  for (const key of Object.keys(original.api.syncConfig)) {
    assert.equal(extracted.api.syncConfig[key].toString(), original.api.syncConfig[key].toString(), key);
  }
  assert.deepEqual(extracted.snapshot(), original.snapshot());
});

test('service factories allocate isolated state and remain usable on alternate receivers', () => {
  const env = harness();
  assert.equal(vm.runInContext('createLayoutsApiService()._layoutBatches !== createLayoutsApiService()._layoutBatches', env.context), true);
  assert.equal(vm.runInContext('createProgressApiService().syncConfig !== createProgressApiService().syncConfig', env.context), true);
  assert.equal(harness().api._pendingProgress, null);
});

const networkMethods = [
  ['getBooks', ['luna & sol', 4]], ['getBook', [4]], ['deleteBook', [4]],
  ['uploadBook', [{ name: 'moon.pdf' }]], ['uploadBooks', [{ submitted: true }]],
  ['getRecents', []], ['getVirtualLibraries', []], ['createVirtualLibrary', [{ name: 'Moon' }]],
  ['addBooksToVirtualLibrary', [4, [1, 2]]], ['deleteVirtualLibrary', [4]], ['getVirtualLibraryBooks', [4]],
  ['getMetadataSources', []], ['saveMetadataSources', [['google', 'amazon']]],
  ['fetchMetadataOnline', [{ title: 'Moon' }]], ['fetchMetadataByIsbn', ['123']], ['updateMetadata', [4, { title: 'Moon' }]],
  ['markBookOpened', [4, progress]],
  ['createAnnotation', [4, { page: 1, color: 'red', text: 'luna'.repeat(30) }]],
  ['updateAnnotation', [3, { comment: 'note' }]], ['deleteAnnotation', [3]],
  ['getColors', []], ['saveColors', [[{ color: 'red' }]]], ['getPageDrawings', [4, 2]],
  ['savePageDrawings', [4, 2, [{ x: 1 }]]], ['clearPageDrawings', [4, 2]]
];
for (const [method, args] of networkMethods) {
  for (const [kind, response] of Object.entries({
    success: { data: { exact: [1, null, 'x'] } },
    httpFailure: { ok: false, data: { detail: 'backend detail' } },
    fallbackMessage: { ok: false, data: {} },
    errorJsonFailure: { ok: false, jsonError: true },
    networkFailure: { networkError: true },
    successJsonFailure: { jsonError: true }
  })) {
    parity(`${method}: ${kind}`, { responses: [response] }, env => env.api[method](...args));
  }
}

parity('getBooks retains empty query and falsy filtering', {}, async ({ api }) => {
  return [await api.getBooks(), await api.getBooks('', 0), await api.getBooks('0', '0')];
}, env => {
  assert.deepEqual(env.calls.filter(call => call[0] === 'fetch').map(call => call[1]), [
    '/api/books?', '/api/books?', '/api/books?search=0&virtual_library_id=0'
  ]);
});
parity('getAnnotations retains optional color query', {}, async ({ api }) => [
  await api.getAnnotations(4), await api.getAnnotations(4, ''), await api.getAnnotations(4, 'blue & red')
]);
test('getAnnotations accepts an empty 200 response and rejects HTTP errors', async () => {
  const env = harness(true, { responses: [{ data: [] }, { ok: false }] });
  assert.equal((await env.api.getAnnotations(4)).length, 0);
  await assert.rejects(env.api.getAnnotations(4), /Error fetching annotations/);
});
parity('uploadBooks forwards the exact supplied body object', {}, async env => {
  const body = { original: true };
  env.setFetchHandler((_url, settings) => {
    assert.equal(settings.body, body);
    return Promise.resolve({ ok: true, json: async () => body });
  });
  assert.equal(await env.api.uploadBooks(body), body);
});
parity('metadata delegation honors facade overrides and call receiver', {}, async ({ api }) => {
  api.fetchMetadataOnline = function (data) { assert.equal(this, api); return { overridden: data }; };
  const custom = { fetchMetadataOnline(data) { assert.equal(this, custom); return { custom: data }; } };
  return [await api.fetchMetadataByIsbn('123'), await api.fetchMetadataByIsbn.call(custom, '456')];
});
parity('detached methods retain original receiver failures', {}, async ({ api }) => {
  const fn = api.fetchMetadataByIsbn;
  return fn('123');
});

parity('sync config retains defaults, arbitrary modes, parsing and clamp rules', {}, ({ api }) => {
  const values = [api.syncConfig.getMode(), api.syncConfig.getIntervalMinutes()];
  for (const mode of ['page', 'close', 'interval', 'unexpected', '']) {
    api.syncConfig.setMode(mode); values.push(api.syncConfig.getMode());
  }
  for (const minutes of ['bad', 0, -3, 1, '12.9', 121, 999]) {
    api.syncConfig.setIntervalMinutes(minutes); values.push(api.syncConfig.getIntervalMinutes());
  }
  return values;
});
for (const stored of ['bad', '0', '-2', '125', '3.9']) {
  parity(`sync config reads preexisting interval ${stored}`, { storage: { moon_sync_interval: stored } },
    ({ api }) => api.syncConfig.getIntervalMinutes());
}

for (const mode of ['interval', 'close', 'page', 'unknown']) {
  parity(`saveProgress: ${mode} mode`, { storage: { moon_sync_mode: mode } }, async ({ api }) => {
    const result = await api.saveProgress(4, progress);
    assert.equal(api._autoSaveTimer !== null, mode === 'interval');
    assert.equal(api._pendingProgress !== null, mode !== 'page');
    return result;
  });
}
parity('progress local write fails before queue/timer/network mutation', { failDB: ['saveLocalProgress'] },
  ({ api }) => api.saveProgress(4, progress));
parity('pending progress replacement preserves original data identity', { storage: { moon_sync_mode: 'close' } }, async ({ api }) => {
  await api.saveProgress(4, progress);
  const next = { current_page: 9 };
  await api.saveProgress(5, next);
  assert.equal(api._pendingProgress.data, next);
  return api._pendingProgress;
});
parity('sync with no pending progress retains exact response', {}, ({ api }) => api.syncPendingProgress(), (_env, result) => {
  assert.deepEqual(result.value, { success: true, alreadySynced: true });
});
for (const [name, response] of Object.entries({ success: {}, failure: { ok: false }, offline: { networkError: true } })) {
  parity(`sync pending: ${name}`, { responses: [response] }, async ({ api }) => {
    api._pendingProgress = { bookId: 4, data: progress, timestamp: 1 };
    const result = await api.syncPendingProgress();
    if (name === 'success') assert.equal(result.data, progress);
    return result;
  });
}
parity('successful sync does not parse response JSON', { responses: [{ jsonError: true }] }, async env => {
  env.api._pendingProgress = { bookId: 4, data: progress };
  const result = await env.api.syncPendingProgress('custom');
  assert.equal(env.calls.some(call => call[0] === 'json'), false);
  return result;
});
parity('in-flight sync keeps original clearing behavior for newly queued progress', { storage: { moon_sync_mode: 'close' } }, async env => {
  let release;
  env.setFetchHandler(() => new Promise(resolve => { release = resolve; }));
  await env.api.saveProgress(4, progress);
  const request = env.api.syncPendingProgress();
  await env.api.saveProgress(5, { current_page: 9 });
  release({ ok: true });
  const result = await request;
  assert.equal(env.api._pendingProgress, null);
  return result;
});

parity('autosave lifecycle retains idempotence, interval, pending guard and restart', {
  storage: { moon_sync_mode: 'interval', moon_sync_interval: '2' }
}, async env => {
  env.api.ensureAutoSaveTimer(); env.api.ensureAutoSaveTimer();
  const first = env.timers.get(env.api._autoSaveTimer);
  await first();
  await env.api.saveProgress(4, progress);
  env.api.syncPendingProgress = async function (reason) {
    assert.equal(this, env.api); env.calls.push(['override.sync', reason]);
  };
  await first();
  env.api.restartAutoSaveTimer();
  env.api.syncConfig.setMode('close'); env.api.restartAutoSaveTimer();
  env.api.stopAutoSaveTimer();
});
parity('progress methods keep alternate receiver state and delegated this', {}, async env => {
  const receiver = {
    _pendingProgress: null, _autoSaveTimer: null, _lastSyncTime: null,
    syncConfig: { getMode: () => 'page', getIntervalMinutes: () => 3 },
    syncPendingProgress(reason) { assert.equal(this, receiver); env.calls.push(['custom.sync', reason]); }
  };
  await env.api.saveProgress.call(receiver, 4, progress);
  assert.equal(env.api._pendingProgress, null);
  return receiver._pendingProgress;
});
parity('timer closure retains alternate receiver', {}, async env => {
  const receiver = {
    _autoSaveTimer: null, _pendingProgress: { data: progress },
    syncConfig: { getIntervalMinutes: () => 2 },
    syncPendingProgress(reason) { assert.equal(this, receiver); env.calls.push(['custom.timer', reason]); }
  };
  env.api.ensureAutoSaveTimer.call(receiver);
  await env.timers.get(receiver._autoSaveTimer)();
  env.api.stopAutoSaveTimer.call(receiver);
  assert.equal(env.api._autoSaveTimer, null);
});

for (const [name, response, local] of [
  ['server ahead', { data: progress }, { current_page: 2 }],
  ['local ahead', { data: { current_page: 2 } }, progress],
  ['equal', { data: progress }, progress],
  ['zero server page', { data: { current_page: 0 } }, progress],
  ['null server', { data: null }, progress],
  ['http failure', { ok: false }, progress],
  ['offline', { networkError: true }, progress],
  ['invalid json', { jsonError: true }, progress],
  ['no local', { ok: false }, null]
]) {
  parity(`getProgress: ${name}`, { progress: { 4: local }, responses: [response] }, ({ api }) => api.getProgress(4));
}
parity('getProgress local lookup errors remain outside network catch', { failDB: ['getLocalProgress'] },
  ({ api }) => api.getProgress(4));
parity('getProgress local save error returns prior local progress', {
  progress: { 4: { current_page: 2 } }, failDB: ['saveLocalProgress'], responses: [{ data: progress }]
}, ({ api }) => api.getProgress(4));
parity('getProgress reconciliation uses overridden facade methods', {
  progress: { 4: progress }, responses: [{ data: { current_page: 2 } }]
}, async env => {
  env.api.saveProgress = async function (...args) { assert.equal(this, env.api); env.calls.push(['override.save', ...args]); };
  env.api.syncPendingProgress = async function (reason) { assert.equal(this, env.api); env.calls.push(['override.sync', reason]); };
  return env.api.getProgress(4);
});

for (const beacon of ['true', 'false', 'absent', 'throw']) {
  parity(`flush beacon: ${beacon}`, { beacon }, ({ api }) => {
    api._pendingProgress = { bookId: 4, data: progress };
    return api.flushPendingProgressBeacon();
  }, (env, result) => {
    assert.deepEqual(result, { undefined: true });
    assert.equal(env.api._pendingProgress === null, beacon !== 'throw');
  });
}
parity('beacon fallback synchronous fetch throw retains pending state', {
  beacon: 'absent', responses: [{ syncError: true }]
}, ({ api }) => {
  api._pendingProgress = { bookId: 4, data: progress };
  api.flushPendingProgressBeacon();
});
parity('no pending beacon emits no request', {}, ({ api }) => api.flushPendingProgressBeacon());
parity('close events share one callback and dynamically use facade override', {}, env => {
  assert.equal(env.events.get('beforeunload').length, 1);
  assert.equal(env.events.get('pagehide').length, 1);
  assert.equal(env.events.get('beforeunload')[0], env.events.get('pagehide')[0]);
  env.api.flushPendingProgressBeacon = function () {
    assert.equal(this, env.api); env.calls.push(['override.flush']);
  };
  env.events.get('beforeunload')[0](); env.events.get('pagehide')[0]();
  env.api.flushPendingProgressBeacon = null;
  env.events.get('pagehide')[0]();
});
parity('close events flush pending progress only once across both events', {}, env => {
  env.api._pendingProgress = { bookId: 4, data: progress };
  env.events.get('beforeunload')[0](); env.events.get('pagehide')[0]();
});

parity('layout cache hit performs zero network calls and preserves object identity', { layouts: { '4_1': pageOne } }, async env => {
  const result = await env.api.getPageLayout(4, 1);
  assert.equal(result, pageOne);
  assert.equal(env.calls.some(call => call[0] === 'fetch'), false);
  return result;
});
for (const [page, total] of [[1, null], [10, null], [11, 13], [21, 21], [0, 0]]) {
  parity(`layout batch boundaries: page ${page}, total ${total}`, {
    responses: [{ data: { layouts: { [page]: { exact: page } } } }]
  }, ({ api }) => api.getPageLayout(4, page, total));
}
for (const [name, response, failures] of [
  ['HTTP failure', { ok: false }, []],
  ['network failure', { networkError: true }, []],
  ['invalid JSON', { jsonError: true }, []],
  ['missing layouts', { data: {} }, []],
  ['null batch', { data: null }, []],
  ['cache write failure', { data: { layouts: { 1: pageOne } } }, ['saveLayoutsBatch']],
  ['cache read failure', { data: { layouts: { 1: pageOne } } }, ['getLayout']]
]) {
  parity(`layout: ${name}`, { failDB: failures, responses: [response, { data: pageOne }] },
    ({ api }) => api.getPageLayout(4, 1));
}
parity('successful empty batch skips single fallback and rechecks cache', {
  responses: [{ data: { layouts: {} } }]
}, ({ api }) => api.getPageLayout(4, 1), env => {
  assert.equal(env.calls.filter(call => call[0] === 'fetch').length, 1);
});
for (const response of [{ ok: false }, { networkError: true }, { jsonError: true }]) {
  parity(`layout fallback failure: ${JSON.stringify(response)}`, { responses: [{ ok: false }, response] },
    ({ api }) => api.getPageLayout(4, 1));
}
parity('single layout cache write failure retains null fallback', {
  failDB: ['saveLayout'], responses: [{ ok: false }, { data: pageOne }]
}, ({ api }) => api.getPageLayout(4, 1));
parity('layout method honors supplied batch map receiver', { responses: [{ data: { layouts: { 1: pageOne } } }] }, async env => {
  const receiver = { _layoutBatches: new Map() };
  const result = await env.api.getPageLayout.call(receiver, 4, 1);
  assert.equal(receiver._layoutBatches.size, 0);
  assert.equal(env.api._layoutBatches.size, 0);
  return result;
});

parity('concurrent pages deduplicate batch and retain first-page result quirk', {}, async env => {
  let release;
  env.setFetchHandler(() => new Promise(resolve => { release = resolve; }));
  const first = env.api.getPageLayout(4, 1);
  const second = env.api.getPageLayout(4, 2);
  await Promise.resolve();
  assert.equal(env.api._layoutBatches.size, 1);
  release({ ok: true, json: async () => ({ layouts: { 1: pageOne, 2: pageTwo } }) });
  const results = await Promise.all([first, second]);
  assert.equal(results[0], pageOne);
  assert.equal(results[1], pageOne, 'preserve existing shared-promise result');
  assert.equal(await env.api.getPageLayout(4, 2), pageTwo);
  assert.equal(env.calls.filter(call => call[0] === 'fetch').length, 1);
  assert.equal(env.api._layoutBatches.size, 0);
  return results;
});
parity('batch entry is removed before single-page fallback completes', {}, async env => {
  let release;
  env.setFetchHandler(url => url.includes('/layouts?')
    ? Promise.resolve({ ok: false })
    : new Promise(resolve => { release = resolve; }));
  const request = env.api.getPageLayout(4, 1);
  for (let tick = 0; !release && tick < 10; tick++) await Promise.resolve();
  assert.equal(typeof release, 'function');
  assert.equal(env.api._layoutBatches.size, 0);
  release({ ok: true, json: async () => pageOne });
  return request;
});
parity('failed layout batch is retried on subsequent request', {
  responses: [{ ok: false }, { ok: false }, { data: { layouts: { 1: pageOne } } }]
}, async ({ api }) => [await api.getPageLayout(4, 1), await api.getPageLayout(4, 1)]);

for (const [name, response] of Object.entries({
  complete: { data: { layouts: { 1: pageOne, 2: pageTwo } } },
  partial: { data: { layouts: { 1: pageOne } } },
  nullPage: { data: { layouts: { 1: pageOne, 2: null } } },
  absent: { data: {} }, nullData: { data: null },
  httpFailure: { ok: false }, offline: { networkError: true }, invalidJson: { jsonError: true }
})) {
  parity(`prefetchLayouts: ${name}`, { responses: [response] }, ({ api }) => api.prefetchLayouts(4, 1, 2));
}
parity('prefetch rejects inherited page entries', {}, env => {
  env.setFetchHandler(() => Promise.resolve({ ok: true, json: async () => ({ layouts: Object.create({ 1: pageOne }) }) }));
  return env.api.prefetchLayouts(4, 1, 1);
});
parity('prefetch cache failure returns false', {
  failDB: ['saveLayoutsBatch'], responses: [{ data: { layouts: { 1: pageOne } } }]
}, ({ api }) => api.prefetchLayouts(4, 1, 1));
parity('prefetch empty reversed range retains original success', {
  responses: [{ data: { layouts: {} } }]
}, ({ api }) => api.prefetchLayouts(4, 2, 1));

parity('sync and beacon mutate only the supplied receiver', {}, async env => {
  const receiver = { _pendingProgress: { bookId: 4, data: progress }, _lastSyncTime: null };
  const result = await env.api.syncPendingProgress.call(receiver, 'borrowed');
  assert.equal(receiver._pendingProgress, null);
  assert.equal(receiver._lastSyncTime.toISOString(), '2023-11-14T22:13:20.000Z');
  assert.equal(env.api._lastSyncTime, null);
  receiver._pendingProgress = { bookId: 5, data: progress };
  env.api.flushPendingProgressBeacon.call(receiver);
  assert.equal(receiver._pendingProgress, null);
  assert.equal(env.api._pendingProgress, null);
  return result;
});
parity('getProgress reconciliation uses the supplied receiver', {
  progress: { 4: progress }, responses: [{ data: { current_page: 2 } }]
}, async env => {
  const receiver = {
    _lastSyncTime: null,
    async saveProgress(...args) { assert.equal(this, receiver); env.calls.push(['borrowed.save', ...args]); },
    async syncPendingProgress(reason) { assert.equal(this, receiver); env.calls.push(['borrowed.sync', reason]); }
  };
  const result = await env.api.getProgress.call(receiver, 4);
  assert.equal(receiver._lastSyncTime.toISOString(), '2023-11-14T22:13:20.000Z');
  assert.equal(env.api._lastSyncTime, null);
  return result;
});
parity('restart timer resolves overrides on the supplied receiver in original order', {}, env => {
  const receiver = {
    stopAutoSaveTimer() { assert.equal(this, receiver); env.calls.push(['borrowed.stop']); },
    syncConfig: { getMode() { env.calls.push(['borrowed.mode']); return 'interval'; } },
    ensureAutoSaveTimer() { assert.equal(this, receiver); env.calls.push(['borrowed.ensure']); }
  };
  env.api.restartAutoSaveTimer.call(receiver);
});
parity('close event retains lexical api even when window.api is replaced', {}, env => {
  const api = env.api;
  api.flushPendingProgressBeacon = function () { assert.equal(this, api); env.calls.push(['lexical.flush']); };
  env.context.api = { flushPendingProgressBeacon() { throw new Error('wrong facade'); } };
  assert.equal(vm.runInContext('api === window.api', env.context), false);
  env.events.get('pagehide')[0]();
  env.context.api = api;
});

test('domain scripts have no eager storage/network/events or mutable global state', () => {
  const calls = [];
  const context = vm.createContext({
    fetch() { calls.push('fetch'); },
    localStorage: { getItem() { calls.push('storage'); } },
    localDB: {},
    window: { addEventListener() { calls.push('event'); } }
  });
  const initialGlobals = Object.keys(context);
  for (const file of [...servicePaths].reverse()) {
    vm.runInContext(readFileSync(path.join(jsDirectory, 'services', file), 'utf8'), context, { filename: file });
  }
  assert.deepEqual(calls, []);
  assert.deepEqual(Object.keys(context), initialGlobals);
});
