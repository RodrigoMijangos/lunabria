'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SERVER_CONNECTIVITY_EVENT, ServerConnectivityMonitor } = require('../js/services/connectivity.js');

function createMonitor(fetchImpl, options = {}) {
  const events = [];
  class TestCustomEvent {
    constructor(type, init) {
      this.type = type;
      this.detail = init.detail;
    }
  }
  const listeners = new Map();
  const documentListeners = new Map();
  const documentRef = options.documentRef || {
    visibilityState: 'visible',
    listeners: documentListeners,
    addEventListener: (type, handler) => documentListeners.set(type, handler),
    removeEventListener: type => documentListeners.delete(type)
  };
  const windowRef = {
    CustomEvent: TestCustomEvent,
    listeners,
    dispatchEvent: event => events.push(event),
    addEventListener: (type, handler) => listeners.set(type, handler),
    removeEventListener: type => listeners.delete(type)
  };
  windowRef.setInterval = function(callback, delay) {
    assert.equal(this, windowRef);
    this.intervalArgs = { callback, delay };
    return 42;
  };
  windowRef.clearInterval = function(id) {
    assert.equal(this, windowRef);
    this.clearedIntervalId = id;
  };
  const monitor = new ServerConnectivityMonitor({
    fetchImpl,
    windowRef,
    documentRef,
    timeoutMs: 0,
    ...options
  });
  return { monitor, events, windowRef, documentRef };
}

test('default timer APIs are invoked with the Window receiver', async () => {
  const { monitor, windowRef } = createMonitor(async () => ({
    ok: true,
    status: 204,
    json: async () => { throw new Error('204 responses have no JSON body'); }
  }));

  await monitor.start();
  assert.equal(windowRef.intervalArgs.delay, 10000);
  monitor.stop();
  assert.equal(windowRef.clearedIntervalId, 42);
});

test('server connectivity requires a successful health response', async () => {
  let request;
  const { monitor, events } = createMonitor(async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ status: 'ok' }) };
  });

  assert.equal(await monitor.checkServer(), true);
  assert.equal(monitor.isServerAvailable, true);
  assert.equal(request.url, '/api/health');
  assert.equal(request.options.cache, 'no-store');
  assert.equal(request.options.method, 'GET');
  assert.equal(events.length, 1);
  assert.equal(events[0].type, SERVER_CONNECTIVITY_EVENT);
  assert.equal(events[0].detail.available, true);
});

test('an empty 204 health response means the server is available', async () => {
  const { monitor, events } = createMonitor(async () => ({
    ok: true,
    status: 204,
    json: async () => { throw new Error('204 responses have no JSON body'); }
  }));

  assert.equal(await monitor.checkServer(), true);
  assert.equal(monitor.isServerAvailable, true);
  assert.equal(events[0].detail.available, true);
});

test('non-success and invalid health responses mean the server is unavailable', async () => {
  for (const response of [
    { ok: false, json: async () => ({ status: 'ok' }) },
    { ok: true, json: async () => ({ status: 'starting' }) }
  ]) {
    const { monitor } = createMonitor(async () => response);
    assert.equal(await monitor.checkServer(), false);
    assert.equal(monitor.state, 'unavailable');
  }
});

test('network failures mean the server is unavailable even if the device may be online', async () => {
  const { monitor, events } = createMonitor(async () => {
    throw new TypeError('Failed to fetch');
  });

  assert.equal(await monitor.checkServer(), false);
  assert.equal(monitor.isServerAvailable, false);
  assert.equal(events[0].detail.state, 'unavailable');
});

test('online events trigger a server probe instead of asserting connectivity', async () => {
  let reachable = true;
  let requests = 0;
  let interval;
  const { monitor, windowRef, documentRef } = createMonitor(async () => {
    requests += 1;
    return { ok: true, json: async () => ({ status: reachable ? 'ok' : 'down' }) };
  }, {
    setIntervalImpl: (callback, delay) => { interval = { callback, delay }; return 1; },
    clearIntervalImpl: () => {}
  });

  await monitor.start();
  assert.equal(interval.delay, 10000);
  assert.equal(windowRef.listeners.has('focus'), true);
  assert.equal(windowRef.listeners.has('pageshow'), true);
  assert.equal(documentRef.listeners.has('resume'), true);
  assert.equal(monitor.state, 'available');
  reachable = false;
  const requestCountBeforePolling = requests;
  await interval.callback();
  assert.equal(requests, requestCountBeforePolling + 1);
  assert.equal(monitor.state, 'unavailable');
  reachable = true;
  const requestCountBeforeOnlineEvent = requests;
  windowRef.listeners.get('online')();
  assert.equal(monitor.state, 'unavailable');
  await monitor.checkServer();
  assert.equal(requests, requestCountBeforeOnlineEvent + 1);
  assert.equal(monitor.state, 'available');
  monitor.stop();
  assert.equal(windowRef.listeners.has('focus'), false);
  assert.equal(windowRef.listeners.has('pageshow'), false);
  assert.equal(documentRef.listeners.has('resume'), false);
});

test('PWA resume events trigger a fresh server health check', async () => {
  let reachable = true;
  let requests = 0;
  const { monitor, windowRef, documentRef } = createMonitor(async () => {
    requests += 1;
    return { ok: true, json: async () => ({ status: reachable ? 'ok' : 'down' }) };
  }, {
    setIntervalImpl: () => 1,
    clearIntervalImpl: () => {}
  });

  await monitor.start();
  reachable = false;
  await windowRef.listeners.get('pageshow')();
  assert.equal(monitor.state, 'unavailable');
  reachable = true;
  await documentRef.listeners.get('resume')();
  assert.equal(monitor.state, 'available');
  assert.equal(requests, 3);
  monitor.stop();
});

test('concurrent health checks share one server request', async () => {
  let finishRequest;
  let requests = 0;
  const { monitor } = createMonitor(() => {
    requests += 1;
    return new Promise(resolve => {
      finishRequest = () => resolve({ ok: true, json: async () => ({ status: 'ok' }) });
    });
  });

  const first = monitor.checkServer();
  const second = monitor.checkServer();
  assert.equal(requests, 1);
  finishRequest();
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
});
