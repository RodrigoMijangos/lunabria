'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const frontend = path.resolve(__dirname, '..');
const source = file => fs.readFileSync(path.join(frontend, 'js', file), 'utf8');

function createDOM() {
  const elements = new Map();
  class Element {
    constructor(tag = 'div') {
      this.tagName = tag;
      this._id = '';
      this.children = [];
      this.attributes = {};
      this.style = {};
      this.listeners = {};
      this.dataset = {};
      this.value = '';
      this.textContent = '';
      this.innerHTML = '';
      this.hidden = false;
      this.disabled = false;
      this.classes = new Set();
      this.classList = {
        add: name => this.classes.add(name),
        remove: name => this.classes.delete(name),
        contains: name => this.classes.has(name),
        toggle: (name, force) => force ?? !this.classes.has(name) ? this.classes.add(name) : this.classes.delete(name)
      };
    }
    get id() { return this._id; }
    set id(val) {
      this._id = val;
      elements.set(val, this);
    }
    setAttribute(name, val) { this.attributes[name] = String(val); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    appendChild(child) { this.children.push(child); return child; }
    prepend(child) { this.children.unshift(child); return child; }
    replaceChildren(...children) { this.children = children; }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    fire(type, event = {}) {
      for (const h of this.listeners[type] || []) h({ target: this, ...event });
    }
  }

  const document = {
    getElementById: id => elements.get(id) || null,
    querySelector: sel => sel === 'main' ? elements.get('main') : null,
    querySelectorAll: () => [],
    createElement: tag => new Element(tag)
  };

  return { elements, Element, document };
}

test('BookCardView uses SVG fallback cover and resets onerror to prevent infinite loops', () => {
  const { Element, document } = createDOM();
  const window = {};
  const context = vm.createContext({
    document,
    window,
    LibraryModel: {
      formatReadingProgress: () => '10%'
    }
  });

  vm.runInContext(source('views/library/BookCardView.js'), context);
  const BookCardView = vm.runInContext('BookCardView', context);

  const container = new Element('div');
  const books = [{ id: 1, title: 'Test Book', has_cover: true, cover_url: '/api/broken-cover.jpg' }];

  BookCardView.renderBookGrid(container, books, () => {}, () => {});

  const card = container.children[0];
  assert.ok(card);
  const coverWrap = card.children[0];
  const img = coverWrap.children[0];
  assert.equal(img.src, '/api/broken-cover.jpg');
  assert.ok(typeof img.onerror === 'function');

  // Trigger error event
  img.onerror();
  assert.equal(img.onerror, null, 'img.onerror should be cleared to prevent loop');
  assert.ok(img.src.startsWith('data:image/svg+xml'), 'img.src must fall back to SVG data URI');
});

test('HighlightColorSettingsManager caches palette to localStorage and recovers offline', async () => {
  const { elements, document } = createDOM();
  const storage = new Map();
  const modal = document.createElement('div');
  modal.id = 'colors-modal';
  const status = document.createElement('span');
  status.id = 'colors-status';

  const localStorage = {
    getItem: k => storage.get(k) || null,
    setItem: (k, v) => storage.set(k, String(v))
  };

  let getColorsCalls = 0;
  const api = {
    getColors: async () => {
      getColorsCalls++;
      if (getColorsCalls === 1) {
        return [{ id: 'blue', name: 'Reference', color: '#bfdbfe' }];
      }
      throw new Error('network down');
    }
  };

  const window = {};
  const context = vm.createContext({
    document,
    localStorage,
    api,
    ModalView: { open: () => {}, close: () => {} },
    window
  });

  vm.runInContext(source('viewmodels/library/HighlightColorSettingsManager.js'), context);
  const manager = new window.HighlightColorSettingsManager();

  // 1. Online open caches to localStorage
  await manager.open();
  assert.equal(storage.has('moon_cached_colors'), true);
  const cachedRaw = JSON.parse(storage.get('moon_cached_colors'));
  assert.equal(cachedRaw[0].id, 'blue');

  // 2. Offline open (api fails) loads from localStorage
  const offlineManager = new window.HighlightColorSettingsManager();
  await offlineManager.open();
  assert.equal(offlineManager.colors[0].id, 'blue');
  assert.ok(status.textContent.includes('cached or default'));
});

test('LibraryViewModel shows offline banner with correct message and count', () => {
  const { elements, document } = createDOM();
  const main = document.createElement('main');
  main.id = 'main';

  const window = {};
  const context = vm.createContext({
    document,
    window,
    LibraryModel: class { constructor() { this.theme = 'light'; } },
    CatalogView: { captureElements: () => ({}) },
    BookUploadManager: class { constructor() {} },
    BookMetadataManager: class { constructor() {} },
    VirtualLibraryManager: class { constructor() {} },
    HighlightColorSettingsManager: class { constructor() {} },
    SyncSettingsManager: class { constructor() {} },
    CatalogSelectionManager: class { constructor() {} }
  });

  vm.runInContext(source('viewmodels/LibraryViewModel.js'), context);
  const l = new window.LibraryViewModel();

  l.showOfflineBanner(3);
  const banner = elements.get('offline-catalog-banner');
  assert.ok(banner);
  assert.equal(banner.style.display, 'flex');
  assert.ok(banner.innerHTML.includes('3 libro(s) disponible(s)'));

  l.showOfflineBanner(0);
  assert.ok(banner.innerHTML.includes('sin libros descargados'));

  l.hideOfflineBanner();
  assert.equal(banner.style.display, 'none');
});

test('LocalDB merges offline complete books non-destructively and handles cached annotations', async () => {
  const stores = new Map();
  const getStore = name => {
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name);
  };

  const fakeDb = {
    objectStoreNames: {
      contains: name => stores.has(name)
    },
    createObjectStore: name => {
      stores.set(name, new Map());
      return { createIndex: () => {} };
    },
    transaction: (storeNames, mode) => {
      const name = Array.isArray(storeNames) ? storeNames[0] : storeNames;
      const map = getStore(name);
      const tx = {
        oncomplete: null,
        onerror: null,
        objectStore: () => ({
          get: key => {
            const req = { result: map.get(key), onsuccess: null, onerror: null };
            setTimeout(() => req.onsuccess?.({ target: req }), 2);
            return req;
          },
          getAll: () => {
            const req = { result: Array.from(map.values()), onsuccess: null, onerror: null };
            setTimeout(() => req.onsuccess?.({ target: req }), 2);
            return req;
          },
          put: item => {
            const key = item.id ?? item.bookId ?? item.key;
            map.set(key, item);
            setTimeout(() => tx.oncomplete?.(), 2);
          }
        })
      };
      return tx;
    }
  };

  const fakeIndexedDB = {
    open: (name, version) => {
      const req = {
        result: fakeDb,
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null
      };
      setTimeout(() => {
        req.onupgradeneeded?.({ target: req });
        req.onsuccess?.({ target: req });
      }, 2);
      return req;
    }
  };

  // Pre-seed db with base stores
  for (const s of ['reading_progress', 'pdf_cache', 'pdf_layouts', 'page_drawings', 'pending_annotations', 'cached_books']) {
    stores.set(s, new Map());
  }

  const context = vm.createContext({
    indexedDB: fakeIndexedDB,
    localStorage: { getItem: () => null, setItem: () => {} },
    window: {},
    console,
    setTimeout,
    clearTimeout
  });

  vm.runInContext(source('db.js'), context);
  const localDB = vm.runInContext('localDB', context);

  assert.equal(localDB.version, 7, 'LocalDB version must be bumped to 7');

  // 1. Initial save of an offline complete book
  await localDB.saveCachedBook({ id: 42, title: 'Downloaded Offline', isOfflineComplete: true });

  // 2. Server re-sync with partial online metadata (isOfflineComplete undefined)
  await localDB.saveCachedBook({ id: 42, title: 'Downloaded Offline (Updated Title)' });

  // 3. Verify isOfflineComplete was NOT wiped
  const cachedBooksStore = stores.get('cached_books');
  const savedBook = cachedBooksStore.get(42);
  assert.equal(savedBook.title, 'Downloaded Offline (Updated Title)');
  assert.equal(savedBook.isOfflineComplete, true, 'isOfflineComplete must be preserved across server syncs');

  // 4. Test cached annotations save and retrieve
  const sampleAnnots = [{ id: 'a1', page: 2, color: 'yellow', text: 'Important' }];
  await localDB.saveCachedAnnotations(42, sampleAnnots);

  const retrieved = await localDB.getCachedAnnotations(42);
  assert.deepEqual(retrieved, sampleAnnots);

  // 5. Test isBookOfflineComplete helper
  stores.get('pdf_cache').set(42, { bookId: 42, blob: {} });
  assert.equal(await localDB.isBookOfflineComplete(42), true);
  assert.equal(await localDB.isBookOfflineComplete(999), false);
});
