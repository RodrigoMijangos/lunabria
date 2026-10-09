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

  return { fakeIndexedDB, stores };
}

test('LocalDB outbox queues, idempotently deduplicates, and removes processed ops', async () => {
  const { fakeIndexedDB, stores } = createFakeIndexedDB();

  const context = vm.createContext({
    indexedDB: fakeIndexedDB,
    localStorage: { getItem: () => null, setItem: () => {} },
    window: { addEventListener: () => {} },
    document: { addEventListener: () => {} },
    console,
    setTimeout,
    clearTimeout
  });

  vm.runInContext(source('db.js'), context);
  const localDB = vm.runInContext('localDB', context);

  // 1. Enqueue operation
  await localDB.enqueueOutboxOp({
    id: 'op_create_annot123',
    type: 'annotation',
    action: 'create',
    bookId: 1,
    payload: { id: 'annot123', text: 'Hello offline' }
  });

  let count = await localDB.getOutboxCount();
  assert.equal(count, 1);

  // 2. Process queue successfully
  const calls = [];
  const fakeApi = {
    createAnnotation: async (bookId, payload) => {
      calls.push(['createAnnotation', bookId, payload]);
      return { success: true };
    }
  };

  const result = await localDB.processOutboxQueue(fakeApi);
  assert.equal(result.processed, 1);
  assert.equal(result.pending, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], 1);
  assert.equal(calls[0][2].text, 'Hello offline');

  // Verify DB store is empty after successful processing
  count = await localDB.getOutboxCount();
  assert.equal(count, 0);
});

test('concurrent outbox processing waits for the active run instead of returning early', async () => {
  const { fakeIndexedDB } = createFakeIndexedDB();
  const context = vm.createContext({
    indexedDB: fakeIndexedDB,
    localStorage: { getItem: () => null, setItem: () => {} },
    window: { addEventListener: () => {} },
    document: { addEventListener: () => {} },
    console,
    setTimeout,
    clearTimeout
  });
  vm.runInContext(source('db.js'), context);
  const localDB = vm.runInContext('localDB', context);
  await localDB.enqueueOutboxOp({
    id: 'op_create_concurrent',
    type: 'annotation',
    action: 'create',
    bookId: 1,
    payload: { id: 'concurrent', text: 'Queued' }
  });

  let releaseRequest;
  let markRequestStarted;
  let apiCalls = 0;
  const requestStarted = new Promise(resolve => { markRequestStarted = resolve; });
  const waitingRequest = new Promise(resolve => { releaseRequest = resolve; });
  const apiClient = {
    async createAnnotation() {
      apiCalls++;
      markRequestStarted();
      await waitingRequest;
    }
  };

  const firstRun = localDB.processOutboxQueue(apiClient);
  await requestStarted;
  const secondRun = localDB.processOutboxQueue(apiClient);
  let secondRunFinished = false;
  secondRun.then(() => { secondRunFinished = true; });
  await Promise.resolve();
  assert.equal(secondRunFinished, false);

  releaseRequest();
  const [firstResult, secondResult] = await Promise.all([firstRun, secondRun]);
  assert.equal(apiCalls, 1);
  assert.equal(firstResult.pending, 0);
  assert.equal(secondResult.pending, 0);
});

test('LocalDB outbox tolerates 404 on deletion as idempotent success', async () => {
  const { fakeIndexedDB } = createFakeIndexedDB();

  const context = vm.createContext({
    indexedDB: fakeIndexedDB,
    localStorage: { getItem: () => null, setItem: () => {} },
    window: { addEventListener: () => {} },
    document: { addEventListener: () => {} },
    console,
    setTimeout,
    clearTimeout
  });

  vm.runInContext(source('db.js'), context);
  const localDB = vm.runInContext('localDB', context);

  await localDB.enqueueOutboxOp({
    id: 'op_del_annot404',
    type: 'annotation',
    action: 'delete',
    bookId: 1,
    entityId: 'annot404'
  });

  const fakeApi = {
    deleteAnnotation: async id => {
      const err = new Error('HTTP 404: Not Found');
      err.status = 404;
      throw err;
    }
  };

  const result = await localDB.processOutboxQueue(fakeApi);
  assert.equal(result.processed, 1);
  assert.equal(result.pending, 0);

  const count = await localDB.getOutboxCount();
  assert.equal(count, 0, 'Op must be removed even when backend returns 404');
});

test('LocalDB outbox drawing clear replaces prior strokes op and syncs correctly', async () => {
  const { fakeIndexedDB } = createFakeIndexedDB();

  const context = vm.createContext({
    indexedDB: fakeIndexedDB,
    localStorage: { getItem: () => null, setItem: () => {} },
    window: { addEventListener: () => {} },
    document: { addEventListener: () => {} },
    console,
    setTimeout,
    clearTimeout
  });

  vm.runInContext(source('db.js'), context);
  const localDB = vm.runInContext('localDB', context);

  // 1. Enqueue save stroke op
  await localDB.enqueueOutboxOp({
    id: 'drawing_1_5',
    type: 'drawing',
    action: 'save',
    bookId: 1,
    page: 5,
    payload: { strokes: [{ color: '#ff0000' }] }
  });

  // 2. User clears page offline -> replaces 'drawing_1_5' key
  await localDB.enqueueOutboxOp({
    id: 'drawing_1_5',
    type: 'drawing',
    action: 'clear',
    bookId: 1,
    page: 5,
    payload: null
  });

  const count = await localDB.getOutboxCount();
  assert.equal(count, 1, 'Clear must collapse with prior save using same op id');

  const ops = await localDB.getPendingOutboxOps();
  assert.equal(ops[0].action, 'clear');

  const calls = [];
  const fakeApi = {
    clearPageDrawings: async (bookId, page) => {
      calls.push(['clearPageDrawings', bookId, page]);
      return true;
    }
  };

  const result = await localDB.processOutboxQueue(fakeApi);
  assert.equal(result.processed, 1);
  assert.equal(result.pending, 0);
  assert.equal(calls[0][0], 'clearPageDrawings');
  assert.equal(calls[0][1], 1);
  assert.equal(calls[0][2], 5);
});
