'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const frontend = path.resolve(__dirname, '..');
const origin = 'https://lunabria.test/';
const html = fs.readFileSync(path.join(frontend, 'index.html'), 'utf8')
  .replace(/<!--[\s\S]*?-->/g, '');

function attributes(tag) {
  return Object.fromEntries(Array.from(tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/gs),
    match => [match[1].toLowerCase(), match[3]]));
}

function localAsset(reference, base = origin) {
  if (!reference || reference.startsWith('#') || /^(?:data|blob|javascript|mailto):/i.test(reference)) return null;
  const url = new URL(reference, base);
  if (url.origin !== new URL(origin).origin) return null;
  url.hash = '';
  return `.${url.pathname}${url.search}`;
}

function assetPath(asset) {
  const url = new URL(asset, origin);
  const filename = path.resolve(frontend, `.${decodeURIComponent(url.pathname)}`);
  const relative = path.relative(frontend, filename);
  assert.ok(!relative.startsWith('..') && !path.isAbsolute(relative), `Asset escapes frontend: ${asset}`);
  return filename;
}

const scripts = Array.from(html.matchAll(/<script\b[^>]*>/gi), match => ({
  ...attributes(match[0]),
  async: /\sasync(?:\s|=|>)/i.test(match[0]),
  defer: /\sdefer(?:\s|=|>)/i.test(match[0])
})).filter(tag => tag.src && localAsset(tag.src));
const htmlAssets = new Set();
for (const match of html.matchAll(/<[a-z][\w:-]*\b[^>]*>/gi)) {
  const tag = attributes(match[0]);
  for (const name of ['src', 'href', 'xlink:href']) {
    const asset = localAsset(tag[name]);
    // /api/ references are generated backend responses, not frontend files;
    // the worker handles them separately rather than precaching them.
    if (asset && !new URL(asset, origin).pathname.startsWith('/api/')) htmlAssets.add(asset);
  }
}

function cssImports(asset, found = new Set()) {
  if (found.has(asset)) return found;
  found.add(asset);
  const css = fs.readFileSync(assetPath(asset), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const imports = /@import\s+(?:url\(\s*(?:["']([^"']+)["']|([^\s)]+))\s*\)|["']([^"']+)["'])/gi;
  for (const match of css.matchAll(imports)) {
    const imported = localAsset(match[1] || match[2] || match[3], new URL(asset, origin));
    if (imported) cssImports(imported, found);
  }
  return found;
}

class EventTargetStub {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }
  async emit(type, properties = {}) {
    const event = { type, target: this, preventDefault() {}, stopPropagation() {}, ...properties };
    for (const handler of this.listeners.get(type) || []) await handler(event);
  }
}

class ElementStub extends EventTargetStub {
  constructor(tag = 'div', attrs = {}) {
    super();
    this.tagName = tag.toUpperCase();
    this.attributes = { ...attrs };
    this.id = attrs.id || '';
    this.value = attrs.value || '';
    this.style = {};
    this.dataset = {};
    this.children = [];
    this.textContent = '';
    const classes = new Set((attrs.class || '').split(/\s+/).filter(Boolean));
    this.classList = {
      contains: name => classes.has(name),
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      toggle(name, force) {
        const enabled = force === undefined ? !classes.has(name) : Boolean(force);
        if (enabled) classes.add(name); else classes.delete(name);
        return enabled;
      }
    };
  }
  appendChild(child) { this.children.push(child); return child; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  closest() { return null; }
}

function browserWorld() {
  const elements = new Map();
  for (const match of html.matchAll(/<([a-z][\w:-]*)\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    if (attrs.id) elements.set(attrs.id, new ElementStub(match[1], attrs));
  }
  const document = new EventTargetStub();
  Object.assign(document, {
    body: new ElementStub('body'),
    documentElement: new ElementStub('html'),
    getElementById: id => elements.get(id) || null,
    createElement: tag => new ElementStub(tag),
    querySelector: () => null,
    querySelectorAll: () => []
  });
  const storage = new Map();
  const forbiddenCalls = [];
  const forbidden = name => (...args) => {
    forbiddenCalls.push([name, ...args]);
    throw new Error(`Unexpected browser side effect: ${name}`);
  };
  const timers = new Map();
  let timerId = 0;
  // window is the VM global, as with browser classic scripts. Each script keeps
  // its own source boundary but shares the same global lexical environment.
  const sandbox = new EventTargetStub();
  Object.assign(sandbox, {
    document, Element: ElementStub, Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    navigator: { onLine: false, sendBeacon: forbidden('sendBeacon') },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key)
    },
    fetch: forbidden('fetch'),
    indexedDB: { open: forbidden('indexedDB.open'), deleteDatabase: forbidden('indexedDB.deleteDatabase') },
    XMLHttpRequest: forbidden('XMLHttpRequest'), WebSocket: forbidden('WebSocket'),
    console,
    setTimeout: (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId; },
    clearTimeout: id => timers.delete(id),
    setInterval: (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId; },
    clearInterval: id => timers.delete(id),
    requestAnimationFrame: callback => { timers.set(++timerId, { callback }); return timerId; },
    cancelAnimationFrame: id => timers.delete(id),
    innerWidth: 1024, innerHeight: 768, devicePixelRatio: 1,
    getSelection: () => null
  });
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  const context = vm.createContext(sandbox);
  const loaded = [];
  for (const script of scripts) {
    assert.ok(!script.type || script.type === 'text/javascript', `Not a classic script: ${script.src}`);
    assert.ok(!script.async && !script.defer, `HTML order requires blocking classic scripts: ${script.src}`);
    const filename = assetPath(script.src);
    vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename, timeout: 2000 });
    loaded.push(script.src);
  }
  return { context, window: sandbox, document, elements, forbiddenCalls, timers, loaded };
}

function workerWorld() {
  const listeners = new Map();
  const entries = new Map();
  const opened = [], added = [], networkRequests = [], matched = [];
  let skipped = 0;
  const self = {
    addEventListener(type, handler) {
      assert.ok(!listeners.has(type), `Duplicate worker handler: ${type}`);
      listeners.set(type, handler);
    },
    skipWaiting() { skipped++; },
    clients: { claim() {} }
  };
  const cache = {
    async addAll(assets) {
      added.push(Array.from(assets));
      for (const asset of assets) {
        const filename = assetPath(asset);
        const body = fs.statSync(filename).isDirectory()
          ? fs.readFileSync(path.join(filename, 'index.html'), 'utf8')
          : fs.readFileSync(filename, 'utf8');
        entries.set(new URL(asset, origin).href, { status: 200, body, asset });
      }
    }
  };
  const context = vm.createContext({
    self, URL,
    caches: {
      async open(name) { opened.push(name); return cache; },
      async match(request) { matched.push(request); return entries.get(request.url); }
    },
    fetch: async request => { networkRequests.push(request); throw new Error('Simulated offline network'); }
  });
  vm.runInContext(fs.readFileSync(path.join(frontend, 'sw.js'), 'utf8'), context,
    { filename: 'sw.js', timeout: 2000 });
  // const declarations are lexical globals, not properties of self/context.
  const assets = Array.from(vm.runInContext('STATIC_ASSETS', context));
  const cacheName = vm.runInContext('CACHE_NAME', context);
  async function install() {
    const pending = [];
    assert.equal(typeof listeners.get('install'), 'function');
    listeners.get('install')({ waitUntil: promise => pending.push(promise) });
    assert.equal(pending.length, 1, 'install must keep cache population alive with waitUntil');
    await Promise.all(pending);
  }
  async function offlineFetch(request) {
    const responses = [];
    assert.equal(typeof listeners.get('fetch'), 'function');
    listeners.get('fetch')({ request, respondWith: promise => responses.push(promise) });
    assert.equal(responses.length, 1, 'fetch must supply one response');
    return responses[0];
  }
  return { assets, cacheName, install, offlineFetch, entries, opened, added, matched,
    networkRequests, get skipped() { return skipped; } };
}

test('all local HTML scripts exist and instantiate real singletons in HTML order', () => {
  assert.ok(scripts.length > 0, 'No local scripts discovered');
  assert.equal(new Set(scripts.map(script => script.src)).size, scripts.length, 'Duplicate HTML scripts');
  for (const script of scripts) assert.ok(fs.statSync(assetPath(script.src)).isFile(), script.src);
  const world = browserWorld();
  assert.deepEqual(world.loaded, scripts.map(script => script.src));
  for (const expression of [
    'window === globalThis', 'window.api === api', 'window.reader === reader', 'window.app === app',
    'reader instanceof MoonReader', 'reader instanceof ReaderViewModel',
    'reader.model instanceof ReaderModel', 'app instanceof LibraryViewModel',
    'app.model instanceof LibraryModel', 'localDB instanceof LocalDB',
    'reader.eventBindings instanceof ReaderEventBindings',
    'reader.documentLifecycle instanceof ReaderDocumentLifecycle',
    'reader.offlineService instanceof ReaderOfflineService',
    'app.catalogSelectionManager instanceof CatalogSelectionManager'
  ]) assert.equal(vm.runInContext(expression, world.context), true, expression);
  for (const method of ['getBooks', 'getVirtualLibraries', 'getBook', 'getProgress',
    'getPageLayout', 'getAnnotations', 'getColors', 'getPageDrawings']) {
    assert.equal(typeof world.window.api[method], 'function', `api.${method}`);
  }
  assert.deepEqual(world.forbiddenCalls, []);
});

test('reader and API events bind and run without network or IndexedDB', async () => {
  const world = browserWorld();
  for (const [target, events] of [
    [world.window, ['beforeunload', 'pagehide', 'pointerdown', 'pointerup', 'resize']],
    [world.document, ['DOMContentLoaded', 'selectionchange']],
    [world.elements.get('reader-body'), ['scroll', 'pointerdown', 'mousedown']]
  ]) {
    for (const event of events) assert.ok(target.listeners.get(event)?.length, `Missing event: ${event}`);
  }
  const drawer = world.elements.get('reader-drawer');
  await world.elements.get('reader-drawer-toggle-btn').emit('click');
  assert.equal(drawer.classList.contains('open'), true);
  await world.elements.get('drawer-close-btn').emit('click');
  assert.equal(drawer.classList.contains('open'), false);
  await world.window.emit('beforeunload');
  await world.window.emit('pagehide');
  assert.deepEqual(world.forbiddenCalls, []);
});

test('DOMContentLoaded delegates to the existing app singleton', async () => {
  const world = browserWorld();
  let initialized = 0;
  // Test event wiring only; full init intentionally requires API/DOM mocks.
  world.window.app.init = function () {
    assert.equal(this, world.window.app);
    initialized++;
  };
  assert.equal(initialized, 0);
  await world.document.emit('DOMContentLoaded');
  assert.equal(initialized, 1);
  assert.deepEqual(world.forbiddenCalls, []);
});

test('STATIC_ASSETS covers exact HTML URLs, transitive CSS imports and icons', () => {
  const { assets } = workerWorld();
  const cached = new Set(assets);
  assert.ok(htmlAssets.has('./icons.svg'), 'HTML must reference the icon sprite');
  for (const asset of htmlAssets) assert.ok(cached.has(asset), `Uncached HTML resource: ${asset}`);
  const styles = Array.from(htmlAssets).filter(asset => new URL(asset, origin).pathname.endsWith('.css'));
  assert.ok(styles.length > 0, 'No local stylesheet discovered');
  const requiredCss = new Set();
  for (const style of styles) cssImports(style, requiredCss);
  assert.ok(requiredCss.size > styles.length, 'No CSS imports discovered');
  for (const asset of requiredCss) assert.ok(cached.has(asset), `Uncached CSS import: ${asset}`);
  for (const asset of ['./', './index.html', './manifest.json', './icons.svg']) {
    assert.ok(cached.has(asset), `Missing app-shell asset: ${asset}`);
  }
});

test('STATIC_ASSETS are unique local existing resources and cache release matches backend 1.0.10', () => {
  const { assets, cacheName } = workerWorld();
  assert.equal(new Set(assets).size, assets.length, 'Duplicate STATIC_ASSETS');
  assert.equal(new Set(assets.map(asset => new URL(asset, origin).href)).size, assets.length,
    'Different asset spellings resolve to the same cache key');
  for (const asset of assets) {
    assert.equal(typeof asset, 'string');
    assert.equal(new URL(asset, origin).origin, new URL(origin).origin, `Nonlocal cache asset: ${asset}`);
    assert.equal(new URL(asset, origin).hash, '', `Fragment in cache key: ${asset}`);
    const stat = fs.statSync(assetPath(asset));
    assert.ok(stat.isFile() || (asset === './' && stat.isDirectory()), `Not a static resource: ${asset}`);
  }
  const backend = fs.readFileSync(path.join(frontend, '..', 'backend', 'app', 'main.py'), 'utf8');
  const version = backend.match(/\bversion\s*=\s*['"]([^'"]+)['"]/);
  assert.ok(version, 'Backend FastAPI version not found');
  assert.equal(version[1], '1.2.0');
  // Frontend-only revisions refresh the shell without publishing a new API release.
  const cacheVersion = cacheName.match(/^lunabria-v(\d+\.\d+\.\d+)(?:-[a-z0-9-]+)?$/);
  assert.ok(cacheVersion, 'Invalid shell cache name');
  assert.equal(cacheVersion[1], version[1]);
});

test('service worker install passes the complete STATIC_ASSETS list to cache.addAll', async () => {
  const worker = workerWorld();
  await worker.install();
  assert.equal(worker.skipped, 1);
  assert.deepEqual(worker.opened, [worker.cacheName]);
  assert.deepEqual(worker.added, [worker.assets]);
  assert.equal(worker.entries.size, worker.assets.length);
  assert.deepEqual(worker.networkRequests, []);
});

test('offline fetch returns installed versioned HTML assets using exact request query strings', async () => {
  const worker = workerWorld();
  await worker.install();
  const versioned = Array.from(htmlAssets).filter(asset => new URL(asset, origin).search);
  assert.ok(versioned.length > 0, 'No versioned HTML assets discovered');
  for (const asset of versioned) {
    const request = { url: new URL(asset, origin).href, method: 'GET' };
    const response = await worker.offlineFetch(request);
    assert.equal(response, worker.entries.get(request.url), `Offline cache miss: ${asset}`);
    assert.ok(response, `Missing cached response: ${asset}`);
    assert.equal(response.body, fs.readFileSync(assetPath(asset), 'utf8'));
    assert.equal(worker.networkRequests.at(-1), request, 'Must try network before cache');
    assert.equal(worker.matched.at(-1), request, 'Must preserve request identity and query');
  }
  const differentVersion = new URL(versioned[0], origin);
  differentVersion.searchParams.set('v', 'not-installed');
  assert.equal(await worker.offlineFetch({ url: differentVersion.href, method: 'GET' }), undefined,
    'An uninstalled version must not hit a different query-string cache key');
});
