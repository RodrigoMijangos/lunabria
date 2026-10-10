'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const frontend = path.resolve(__dirname, '..');
const source = file => fs.readFileSync(path.join(frontend, 'js', file), 'utf8');

function createFakeIndexedDB() {
  const stores = new Map();
  const getStore = name => {
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name);
  };

  for (const s of ['local_progress', 'pdf_cache', 'page_layouts', 'page_drawings', 'cached_annotations', 'pending_annotations', 'cached_books']) {
    stores.set(s, new Map());
  }

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
      const createCursorReq = (filterBookId = null) => {
        const entries = Array.from(map.entries()).filter(([key, val]) => {
          if (filterBookId == null) return true;
          return Number(val.bookId) === Number(filterBookId);
        });
        let index = 0;
        const req = { result: null, onsuccess: null, onerror: null };
        const advance = () => {
          if (index < entries.length) {
            const [key, value] = entries[index];
            req.result = {
              key,
              value,
              delete: () => { map.delete(key); },
              continue: () => {
                index++;
                advance();
              }
            };
          } else {
            req.result = null;
          }
          req.onsuccess?.({ target: req });
        };
        setTimeout(advance, 2);
        return req;
      };

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
          count: () => {
            const req = { result: map.size, onsuccess: null, onerror: null };
            setTimeout(() => req.onsuccess?.({ target: req }), 2);
            return req;
          },
          put: item => {
            const key = item.id ?? item.bookId ?? item.key;
            map.set(key, item);
            setTimeout(() => tx.oncomplete?.(), 2);
          },
          delete: key => {
            map.delete(key);
            setTimeout(() => tx.oncomplete?.(), 2);
          },
          clear: () => {
            map.clear();
            setTimeout(() => tx.oncomplete?.(), 2);
          },
          index: (_idxName) => ({
            openCursor: (range) => createCursorReq(range)
          }),
          openCursor: () => createCursorReq(null)
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

  return { fakeIndexedDB, stores };
}

test('LocalDB.deleteBook thoroughly purges a book across IndexedDB stores, localStorage and CacheStorage', async () => {
  const { fakeIndexedDB, stores } = createFakeIndexedDB();
  const localStorageMap = new Map();
  const deletedCacheUrls = [];

  const fakeCaches = {
    open: async (cacheName) => ({
      delete: async (url) => {
        deletedCacheUrls.push({ cacheName, url });
        return true;
      }
    })
  };

  const context = vm.createContext({
    indexedDB: fakeIndexedDB,
    IDBKeyRange: { only: val => val },
    localStorage: {
      getItem: k => localStorageMap.get(k) || null,
      setItem: (k, v) => localStorageMap.set(k, String(v)),
      removeItem: k => localStorageMap.delete(k)
    },
    caches: fakeCaches,
    window: {},
    console,
    setTimeout,
    clearTimeout
  });

  vm.runInContext(source('db.js'), context);
  const localDB = vm.runInContext('localDB', context);

  // 1. Seed data for book 42 and untouched book 99
  const cachedBooks = stores.get('cached_books');
  cachedBooks.set(42, { id: 42, title: 'Book 42' });
  cachedBooks.set(99, { id: 99, title: 'Book 99' });

  localStorageMap.set('moon_offline_books', JSON.stringify([
    { id: 42, title: 'Book 42' },
    { id: 99, title: 'Book 99' }
  ]));

  const pdfCache = stores.get('pdf_cache');
  pdfCache.set(42, { bookId: 42, blob: 'pdf42' });
  pdfCache.set(99, { bookId: 99, blob: 'pdf99' });

  const progress = stores.get('local_progress');
  progress.set(42, { bookId: 42, page: 5 });
  progress.set(99, { bookId: 99, page: 10 });
  localStorageMap.set('moon_progress_42', JSON.stringify({ page: 5 }));
  localStorageMap.set('moon_progress_99', JSON.stringify({ page: 10 }));

  const layouts = stores.get('page_layouts');
  layouts.set('42_1', { key: '42_1', bookId: 42, page: 1 });
  layouts.set('42_2', { key: '42_2', bookId: 42, page: 2 });
  layouts.set('99_1', { key: '99_1', bookId: 99, page: 1 });

  const drawings = stores.get('page_drawings');
  drawings.set('42_1', { key: '42_1', bookId: 42, strokes: [] });
  drawings.set('42_2', { key: '42_2', bookId: 42, strokes: [] });
  drawings.set('99_1', { key: '99_1', bookId: 99, strokes: [] });

  const annotations = stores.get('cached_annotations');
  annotations.set(42, { bookId: 42, annotations: [{ id: 'a1' }] });
  annotations.set(99, { bookId: 99, annotations: [{ id: 'a2' }] });

  const outbox = stores.get('pending_annotations');
  outbox.set('op1', { id: 'op1', bookId: 42, action: 'create' });
  outbox.set('op2', { id: 'op2', bookId: 99, action: 'create' });

  // 2. Perform deleteBook(42)
  const result = await localDB.deleteBook(42);
  assert.equal(result, true);

  // 3. Verify book 42 was wiped from all locations
  assert.equal(cachedBooks.has(42), false, 'cached_books must not contain 42');
  assert.equal(pdfCache.has(42), false, 'pdf_cache must not contain 42');
  assert.equal(progress.has(42), false, 'local_progress must not contain 42');
  assert.equal(localStorageMap.has('moon_progress_42'), false, 'moon_progress_42 must be removed');
  assert.equal(layouts.has('42_1'), false, 'page_layouts 42_1 must be removed');
  assert.equal(layouts.has('42_2'), false, 'page_layouts 42_2 must be removed');
  assert.equal(drawings.has('42_1'), false, 'page_drawings 42_1 must be removed');
  assert.equal(drawings.has('42_2'), false, 'page_drawings 42_2 must be removed');
  assert.equal(annotations.has(42), false, 'cached_annotations 42 must be removed');
  assert.equal(outbox.has('op1'), false, 'pending outbox op for 42 must be removed');

  const parsedOffline = JSON.parse(localStorageMap.get('moon_offline_books'));
  assert.equal(parsedOffline.some(b => b.id === 42), false, 'moon_offline_books must not contain 42');

  // 4. Verify book 99 was NOT touched
  assert.equal(cachedBooks.has(99), true, 'cached_books must retain 99');
  assert.equal(pdfCache.has(99), true, 'pdf_cache must retain 99');
  assert.equal(progress.has(99), true, 'local_progress must retain 99');
  assert.equal(localStorageMap.has('moon_progress_99'), true, 'moon_progress_99 must be retained');
  assert.equal(layouts.has('99_1'), true, 'page_layouts 99_1 must be retained');
  assert.equal(drawings.has('99_1'), true, 'page_drawings 99_1 must be retained');
  assert.equal(annotations.has(99), true, 'cached_annotations 99 must be retained');
  assert.equal(outbox.has('op2'), true, 'pending outbox op for 99 must be retained');
  assert.equal(parsedOffline.some(b => b.id === 99), true, 'moon_offline_books must retain 99');

  // 5. Verify cover cache deletion was requested
  assert.deepEqual(deletedCacheUrls, [{ cacheName: 'lunabria-covers-v1', url: '/api/books/42/cover' }]);
});

test('LocalDB.clearCachedBooks clears cached catalog in IndexedDB and localStorage', async () => {
  const { fakeIndexedDB, stores } = createFakeIndexedDB();
  const localStorageMap = new Map();

  const context = vm.createContext({
    indexedDB: fakeIndexedDB,
    localStorage: {
      getItem: k => localStorageMap.get(k) || null,
      setItem: (k, v) => localStorageMap.set(k, String(v)),
      removeItem: k => localStorageMap.delete(k)
    },
    window: {},
    console,
    setTimeout,
    clearTimeout
  });

  vm.runInContext(source('db.js'), context);
  const localDB = vm.runInContext('localDB', context);

  const cachedBooks = stores.get('cached_books');
  cachedBooks.set(1, { id: 1, title: 'Server book 1' });
  cachedBooks.set(2, { id: 2, title: 'Server book 2' });

  localStorageMap.set('moon_offline_books', JSON.stringify([
    { id: 1, title: 'Server book 1' },
    { id: 2, title: 'Server book 2' }
  ]));

  await localDB.clearCachedBooks();

  assert.equal(cachedBooks.size, 0, 'cached_books should be cleared');
  assert.equal(localStorageMap.has('moon_offline_books'), false, 'moon_offline_books should be removed');
});

test('LibraryModel.removeBook purges deleted book from allBooks and recentBooks', () => {
  const context = vm.createContext({
    window: {},
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }
  });
  vm.runInContext(source('models/LibraryModel.js'), context);
  const LibraryModel = vm.runInContext('LibraryModel', context);

  const model = new LibraryModel();
  model.setBooks([{ id: 1, title: 'One' }, { id: 2, title: 'Two' }]);
  model.setRecentBooks([{ id: 1, title: 'One' }, { id: 3, title: 'Three' }]);

  const remaining = model.removeBook(1);
  assert.deepEqual(remaining.map(b => b.id), [2]);
  assert.deepEqual(model.allBooks.map(b => b.id), [2]);
  assert.deepEqual(model.recentBooks.map(b => b.id), [3]);

  // Removing non-existent does not affect remaining
  model.removeBook(999);
  assert.deepEqual(model.allBooks.map(b => b.id), [2]);
});

test('LibraryViewModel.deleteBook deletes via api and localDB, prunes model and selection, and rerenders', async () => {
  let localDbDeleted = null;
  let rerendered = false;

  const localDB = {
    async deleteBook(id) {
      localDbDeleted = id;
    }
  };

  const context = vm.createContext({
    window: {},
    document: {
      activeElement: null,
      getElementById: () => null,
      querySelector: () => null,
      documentElement: { classList: { toggle: () => {} } }
    },
    localStorage: { getItem: () => null, setItem: () => {} },
    localDB,
    console,
    BookUploadManager: class {},
    BookMetadataManager: class {},
    VirtualLibraryManager: class {},
    HighlightColorSettingsManager: class {},
    SyncSettingsManager: class {}
  });

  vm.runInContext(source('models/LibraryModel.js'), context);
  vm.runInContext(source('views/library/CatalogView.js'), context);
  vm.runInContext(source('views/library/CatalogPaginationView.js'), context);
  vm.runInContext(source('views/library/CatalogSelectionView.js'), context);
  vm.runInContext(source('viewmodels/library/CatalogSelectionManager.js'), context);
  vm.runInContext(source('viewmodels/LibraryViewModel.js'), context);

  const LibraryViewModel = vm.runInContext('LibraryViewModel', context);
  const l = new LibraryViewModel();
  l.model.setBooks([{ id: 42, title: 'Target Book' }, { id: 99, title: 'Other' }]);
  l.selectedBookIds.add(42);
  l.renderBooks = () => { rerendered = true; };
  l.renderRecents = () => {};
  l.loadHome = async () => {};

  await l.deleteBook(42);

  assert.equal(localDbDeleted, 42);
  assert.equal(l.model.allBooks.length, 1);
  assert.equal(l.model.allBooks[0].id, 99);
  assert.equal(l.selectedBookIds.has(42), false);
  assert.equal(rerendered, true);
});
