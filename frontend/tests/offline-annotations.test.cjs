'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const frontend = path.resolve(__dirname, '..');
const source = file => fs.readFileSync(path.join(frontend, 'js', file), 'utf8');

test('annotation API distinguishes HTTP failure from a valid empty list', async () => {
  const context = vm.createContext({
    fetch: async () => ({ ok: false, status: 503 }),
    window: {}
  });
  vm.runInContext(source('services/annotations.js'), context);
  const service = vm.runInContext('createAnnotationsApiService()', context);

  await assert.rejects(service.getAnnotations(42), /Error fetching annotations/);
});

test('successful annotation refresh is persisted in the local database', async () => {
  const annotations = [{ id: 'a1', page: 3, comment: 'Saved note' }];
  const writes = [];
  const context = vm.createContext({
    api: { getAnnotations: async () => annotations },
    localDB: {
      async saveCachedAnnotations(bookId, list) {
        writes.push({ bookId, annotations: list });
      }
    },
    document: { getElementById: () => null },
    window: {},
    console
  });
  vm.runInContext(source('viewmodels/reader/ReaderAnnotationViewModel.js'), context);

  const model = {
    bookId: 42,
    annotations: [],
    setAnnotations(list) { this.annotations = list; }
  };
  const viewModel = new context.window.ReaderAnnotationViewModel(model, {}, {});

  await viewModel.refreshAnnotations();

  assert.equal(model.annotations, annotations);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].bookId, 42);
  assert.equal(writes[0].annotations, annotations);
});

function createLifecycleHarness({
  getAnnotations,
  cachedAnnotations,
  saveCachedAnnotations = async () => {},
  getProgress = async () => null,
  processOutboxQueue = async () => ({ processed: 0, pending: 0 }),
  pendingOutboxOps = []
}) {
  const model = {
    annotations: [],
    fitMode: 'page',
    reset() {
      this.annotations = [];
      this.bookId = null;
      this.currentPage = 0;
      this.totalPages = 0;
    },
    setColors(colors) { this.colors = colors; },
    setBook(bookId, pdfDoc, totalPages) {
      this.bookId = bookId;
      this.pdfDoc = pdfDoc;
      this.totalPages = totalPages;
    },
    setCurrentPage(page) { this.currentPage = page; },
    setAnnotations(annotations) { this.annotations = annotations; },
    setScale(scale) { this.scale = scale; }
  };
  const reader = {
    openSequence: 0,
    loadingTask: null,
    model,
    renderer: { resetViewportDOM() {} },
    toolbar: { setOfflineStatus() {} },
    container: { style: { display: 'none' } },
    drawing: { toggleDrawMode() {}, setDrawTool() {} },
    annotations: {
      renderFloatingColors() {},
      renderDrawerAnnotations() {},
      refreshPageHighlights() {}
    },
    nav: {
      async calculateFitPageScale() { return 1; },
      syncViewModeUI() {},
      updateHUD() {},
      goToPage(page) { model.setCurrentPage(page); }
    },
    async updateBookInfo() {},
    destroyPdfResource() {},
    async loadPdfDocument() { return { numPages: 4 }; },
    async renderCurrentViewMode() {}
  };
  const localDB = {
    async isPdfCached() { return false; },
    async hasAllLayoutsCached() { return false; },
    async getCachedAnnotations() { return cachedAnnotations; },
    async processOutboxQueue() { return processOutboxQueue(); },
    async getPendingOutboxOps() { return pendingOutboxOps; },
    saveCachedAnnotations
  };
  const context = vm.createContext({
    api: {
      async getColors() { return []; },
      getProgress,
      async markBookOpened() {},
      getAnnotations
    },
    localDB,
    LibraryModel: { formatReadingProgress: () => '0%' },
    document: { body: { style: {} }, getElementById: () => null },
    window: {},
    console: { warn() {}, error() {} }
  });
  vm.runInContext(source('viewmodels/reader/ReaderDocumentLifecycle.js'), context);

  return {
    lifecycle: new context.window.ReaderDocumentLifecycle(reader),
    model,
    reader
  };
}

test('reader opening falls back to cached annotations after an HTTP failure', async () => {
  const cached = [{ id: 'a1', page: 3, comment: 'Last known note' }];
  let cacheWrites = 0;
  const { lifecycle, model } = createLifecycleHarness({
    getAnnotations: async () => { throw new Error('HTTP 503'); },
    cachedAnnotations: cached,
    saveCachedAnnotations: async () => { cacheWrites += 1; }
  });

  await lifecycle.open(42);

  assert.deepEqual(model.annotations, cached);
  assert.equal(cacheWrites, 0, 'A failed server response must not overwrite the local copy');
});

test('reader opening waits for a successful annotation cache write', async () => {
  const annotations = [{ id: 'a1', page: 3, comment: 'Fresh note' }];
  let releaseWrite;
  let markWriteStarted;
  const writeStarted = new Promise(resolve => { markWriteStarted = resolve; });
  const pendingWrite = new Promise(resolve => { releaseWrite = resolve; });
  let writeArgs;
  const { lifecycle, model } = createLifecycleHarness({
    getAnnotations: async () => annotations,
    cachedAnnotations: null,
    saveCachedAnnotations: async (...args) => {
      writeArgs = args;
      markWriteStarted();
      await pendingWrite;
      return true;
    }
  });

  let openCompleted = false;
  const opening = lifecycle.open(42).then(() => { openCompleted = true; });
  await writeStarted;
  await Promise.resolve();
  assert.equal(openCompleted, false, 'Opening should wait for persistence to complete');

  releaseWrite();
  await opening;
  assert.equal(model.annotations, annotations);
  assert.equal(writeArgs[0], 42);
  assert.equal(writeArgs[1], annotations);
});

test('reconnecting with a book open flushes queued changes before refreshing annotations and progress', async () => {
  const syncOrder = [];
  const remoteAnnotations = [{ id: 'remote-1', page: 2, comment: 'Synced' }];
  const { lifecycle, model, reader } = createLifecycleHarness({
    getAnnotations: async bookId => {
      syncOrder.push(['annotations', bookId]);
      return remoteAnnotations;
    },
    getProgress: async bookId => {
      syncOrder.push(['progress', bookId]);
      return { current_page: 7 };
    },
    processOutboxQueue: async () => {
      syncOrder.push(['outbox']);
      return { processed: 1, pending: 0 };
    },
    saveCachedAnnotations: async (bookId, annotations) => {
      syncOrder.push(['cache', bookId, annotations]);
    }
  });
  model.bookId = 42;
  model.currentPage = 3;
  reader.openSequence = 5;
  reader.container.style.display = 'flex';
  reader.annotations.renderDrawerAnnotations = () => syncOrder.push(['render-drawer']);
  reader.annotations.refreshPageHighlights = page => syncOrder.push(['refresh-highlights', page]);
  reader.nav.goToPage = page => {
    syncOrder.push(['go-to-page', page]);
    model.setCurrentPage(page);
  };

  assert.equal(await lifecycle.reconcileServerConnection(), true);
  assert.deepEqual(model.annotations, remoteAnnotations);
  assert.equal(model.currentPage, 7);
  assert.deepEqual(syncOrder.map(([operation]) => operation), [
    'outbox', 'annotations', 'progress', 'cache', 'render-drawer', 'refresh-highlights', 'go-to-page'
  ]);
});

test('reconnect does not replace local annotations while their queued mutations remain pending', async () => {
  const localAnnotations = [{ id: 'local-1', page: 1, comment: 'Still queued' }];
  let serverAnnotationReads = 0;
  const { lifecycle, model, reader } = createLifecycleHarness({
    getAnnotations: async () => {
      serverAnnotationReads++;
      return [];
    },
    pendingOutboxOps: [{ id: 'op_update_local-1', type: 'annotation', bookId: 42 }],
    processOutboxQueue: async () => ({ processed: 0, pending: 1 })
  });
  model.bookId = 42;
  model.currentPage = 1;
  model.annotations = localAnnotations;
  reader.container.style.display = 'flex';

  assert.equal(await lifecycle.reconcileServerConnection(), true);
  assert.equal(serverAnnotationReads, 0);
  assert.deepEqual(model.annotations, localAnnotations);
});
