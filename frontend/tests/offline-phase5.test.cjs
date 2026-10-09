'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const frontend = path.resolve(__dirname, '..');
const swSource = fs.readFileSync(path.join(frontend, 'sw.js'), 'utf8');

function createWorkerWorld(options = {}) {
  const listeners = new Map();
  const cacheStorage = new Map();
  let skipped = 0;
  let claimed = 0;

  class FakeCache {
    constructor(name) {
      this.name = name;
      this.entries = new Map();
    }
    async addAll(assets) {
      if (options.failAddAll) {
        throw new Error('Failed to fetch asset during addAll');
      }
      for (const a of assets) {
        this.entries.set(a, { status: 200, url: a });
      }
    }
    async match(req) {
      const key = typeof req === 'string' ? req : req.url;
      return this.entries.get(key) || null;
    }
    async put(req, res) {
      const key = typeof req === 'string' ? req : req.url;
      this.entries.set(key, res);
    }
  }

  const self = {
    addEventListener: (type, fn) => listeners.set(type, fn),
    skipWaiting: () => { skipped++; },
    clients: {
      claim: () => { claimed++; }
    }
  };

  const caches = {
    open: async (name) => {
      if (!cacheStorage.has(name)) {
        cacheStorage.set(name, new FakeCache(name));
      }
      return cacheStorage.get(name);
    },
    keys: async () => Array.from(cacheStorage.keys()),
    delete: async (name) => cacheStorage.delete(name),
    match: async (req) => {
      const key = typeof req === 'string' ? req : req.url;
      for (const cache of cacheStorage.values()) {
        const found = await cache.match(key);
        if (found) return found;
      }
      return null;
    }
  };

  const context = vm.createContext({
    self,
    URL,
    caches,
    fetch: options.fetch || (async () => { throw new Error('Network offline'); }),
    Response: class {
      constructor(body, init = {}) {
        this.body = body;
        this.status = init.status || 200;
        this.headers = init.headers || {};
      }
    }
  });

  vm.runInContext(swSource, context, { filename: 'sw.js' });

  return { listeners, caches, cacheStorage, self, get skipped() { return skipped; }, get claimed() { return claimed; } };
}

test('SW activate deletes obsolete caches and preserves current CACHE_NAME', async () => {
  const worker = createWorkerWorld(); const { listeners, cacheStorage } = worker;
  // Pre-seed an obsolete cache from older version
  cacheStorage.set('lunabria-v1.3.0', { entries: new Map() });

  const activateListener = listeners.get('activate');
  assert.equal(typeof activateListener, 'function');

  let waitUntilPromise = null;
  activateListener({
    waitUntil: p => { waitUntilPromise = p; }
  });

  await waitUntilPromise;

  assert.equal(cacheStorage.has('lunabria-v1.3.0'), false, 'Older cache must be pruned');
  assert.equal(worker.claimed, 1, 'Clients must be claimed on activation');
});

test('SW message SKIP_WAITING calls self.skipWaiting', () => {
  const { listeners, self } = createWorkerWorld();
  const messageListener = listeners.get('message');
  assert.equal(typeof messageListener, 'function');

  let skippedCount = 0;
  self.skipWaiting = () => { skippedCount++; };

  messageListener({ data: { action: 'SKIP_WAITING' } });
  assert.equal(skippedCount, 1, 'SKIP_WAITING message must trigger skipWaiting');
});

test('SW fetch handles /api/ by returning 503 JSON response when offline', async () => {
  const { listeners } = createWorkerWorld();
  const fetchListener = listeners.get('fetch');
  assert.equal(typeof fetchListener, 'function');

  let responsePromise = null;
  fetchListener({
    request: { url: 'https://lunabria.local/api/books', method: 'GET' },
    respondWith: p => { responsePromise = p; }
  });

  const response = await responsePromise;
  assert.equal(response.status, 503);
  const data = JSON.parse(response.body);
  assert.equal(data.offline, true);
});

test('SW fetch falls back to cache on network failure for app assets', async () => {
  const { listeners, caches } = createWorkerWorld();
  const cache = await caches.open('lunabria-v1.4.1');
  await cache.put('https://lunabria.local/js/db.js?v=1.0.7', { status: 200, body: 'cached-content' });

  const fetchListener = listeners.get('fetch');
  let responsePromise = null;
  fetchListener({
    request: { url: 'https://lunabria.local/js/db.js?v=1.0.7', method: 'GET' },
    respondWith: p => { responsePromise = p; }
  });

  const response = await responsePromise;
  assert.equal(response.status, 200);
  assert.equal(response.body, 'cached-content');
});
