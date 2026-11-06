"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const frontend = path.resolve(__dirname, "..");
const source = (file) => fs.readFileSync(path.join(frontend, "js", file), "utf8");

test("annotation API distinguishes HTTP failure from a valid empty list", async () => {
  const context = vm.createContext({
    fetch: async () => ({ ok: false, status: 503 }),
    window: {},
  });
  vm.runInContext(source("services/annotations.js"), context);
  const service = vm.runInContext("createAnnotationsApiService()", context);

  await assert.rejects(service.getAnnotations(42), /Error fetching annotations/);
});

test("successful annotation refresh is persisted in the local database", async () => {
  const annotations = [{ id: "a1", page: 3, comment: "Saved note" }];
  const writes = [];
  const context = vm.createContext({
    api: { getAnnotations: async () => annotations },
    localDB: {
      async saveCachedAnnotations(bookId, list) {
        writes.push({ bookId, annotations: list });
      },
    },
    document: { getElementById: () => null },
    window: {},
    console,
  });
  vm.runInContext(source("viewmodels/reader/ReaderAnnotationToolbarView.js"), context);
  vm.runInContext(source("viewmodels/reader/ReaderAnnotationViewModel.js"), context);

  const model = {
    bookId: 42,
    annotations: [],
    setAnnotations(list) {
      this.annotations = list;
    },
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
  pendingOutboxOps = [],
}) {
  const model = {
    annotations: [],
    fitMode: "page",
    navigationMap: { reset() {}, setTableOfContents() {} },
    reset() {
      this.annotations = [];
      this.bookId = null;
      this.currentPage = 0;
      this.totalPages = 0;
      this.navigationMap.reset();
    },
    setColors(colors) {
      this.colors = colors;
    },
    setBook(bookId, pdfDoc, totalPages) {
      this.bookId = bookId;
      this.pdfDoc = pdfDoc;
      this.totalPages = totalPages;
    },
    setCurrentPage(page) {
      this.currentPage = page;
    },
    setAnnotations(annotations) {
      this.annotations = annotations;
    },
    setScale(scale) {
      this.scale = scale;
    },
  };
  const reader = {
    openSequence: 0,
    loadingTask: null,
    model,
    renderer: { resetViewportDOM() {} },
    toolbar: { setOfflineStatus() {} },
    container: { style: { display: "none" } },
    drawing: { toggleDrawMode() {}, setDrawTool() {} },
    annotations: {
      renderFloatingColors() {},
      renderDrawerAnnotations() {},
      refreshPageHighlights() {},
    },
    nav: {
      async calculateFitPageScale() {
        return 1;
      },
      syncViewModeUI() {},
      updateHUD() {},
      goToPage(page) {
        model.setCurrentPage(page);
      },
    },
    async updateBookInfo() {},
    destroyPdfResource() {},
    async loadPdfDocument() {
      return { numPages: 4 };
    },
    async renderCurrentViewMode() {},
  };
  const localDB = {
    async isPdfCached() {
      return false;
    },
    async hasAllLayoutsCached() {
      return false;
    },
    async getCachedAnnotations() {
      return cachedAnnotations;
    },
    async processOutboxQueue() {
      return processOutboxQueue();
    },
    async getPendingOutboxOps() {
      return pendingOutboxOps;
    },
    saveCachedAnnotations,
  };
  const context = vm.createContext({
    api: {
      async getColors() {
        return [];
      },
      getProgress,
      async markBookOpened() {},
      getAnnotations,
    },
    localDB,
    LibraryModel: { formatReadingProgress: () => "0%" },
    document: { body: { style: {} }, getElementById: () => null },
    window: {},
    console: { warn() {}, error() {} },
  });
  vm.runInContext(source("viewmodels/reader/ReaderBookReconciler.js"), context);
  vm.runInContext(source("viewmodels/reader/ReaderDocumentLifecycle.js"), context);

  return {
    lifecycle: new context.window.ReaderDocumentLifecycle(reader),
    model,
    reader,
  };
}

test("reader opening falls back to cached annotations after an HTTP failure", async () => {
  const cached = [{ id: "a1", page: 3, comment: "Last known note" }];
  let cacheWrites = 0;
  const { lifecycle, model } = createLifecycleHarness({
    getAnnotations: async () => {
      throw new Error("HTTP 503");
    },
    cachedAnnotations: cached,
    saveCachedAnnotations: async () => {
      cacheWrites += 1;
    },
  });

  await lifecycle.open(42);

  assert.deepEqual(model.annotations, cached);
  assert.equal(cacheWrites, 0, "A failed server response must not overwrite the local copy");
});

test("reader opening waits for a successful annotation cache write", async () => {
  const annotations = [{ id: "a1", page: 3, comment: "Fresh note" }];
  let releaseWrite;
  let markWriteStarted;
  const writeStarted = new Promise((resolve) => {
    markWriteStarted = resolve;
  });
  const pendingWrite = new Promise((resolve) => {
    releaseWrite = resolve;
  });
  let writeArgs;
  const { lifecycle, model } = createLifecycleHarness({
    getAnnotations: async () => annotations,
    cachedAnnotations: null,
    saveCachedAnnotations: async (...args) => {
      writeArgs = args;
      markWriteStarted();
      await pendingWrite;
      return true;
    },
  });

  let openCompleted = false;
  const opening = lifecycle.open(42).then(() => {
    openCompleted = true;
  });
  await writeStarted;
  await Promise.resolve();
  assert.equal(openCompleted, false, "Opening should wait for persistence to complete");

  releaseWrite();
  await opening;
  assert.equal(model.annotations, annotations);
  assert.equal(writeArgs[0], 42);
  assert.equal(writeArgs[1], annotations);
});

test("reconnecting with a book open flushes queued changes before refreshing annotations and progress", async () => {
  const syncOrder = [];
  const remoteAnnotations = [{ id: "remote-1", page: 2, comment: "Synced" }];
  const { lifecycle, model, reader } = createLifecycleHarness({
    getAnnotations: async (bookId) => {
      syncOrder.push(["annotations", bookId]);
      return remoteAnnotations;
    },
    getProgress: async (bookId) => {
      syncOrder.push(["progress", bookId]);
      return { current_page: 7 };
    },
    processOutboxQueue: async () => {
      syncOrder.push(["outbox"]);
      return { processed: 1, pending: 0 };
    },
    saveCachedAnnotations: async (bookId, annotations) => {
      syncOrder.push(["cache", bookId, annotations]);
    },
  });
  model.bookId = 42;
  model.currentPage = 3;
  reader.openSequence = 5;
  reader.container.style.display = "flex";
  reader.annotations.renderDrawerAnnotations = () => syncOrder.push(["render-drawer"]);
  reader.annotations.refreshPageHighlights = (page) => syncOrder.push(["refresh-highlights", page]);
  reader.nav.goToPage = (page) => {
    syncOrder.push(["go-to-page", page]);
    model.setCurrentPage(page);
  };

  assert.equal(await lifecycle.reconcileServerConnection(), true);
  assert.deepEqual(model.annotations, remoteAnnotations);
  assert.equal(model.currentPage, 7);
  assert.deepEqual(
    syncOrder.map(([operation]) => operation),
    ["outbox", "annotations", "progress", "cache", "render-drawer", "refresh-highlights", "go-to-page"],
  );
});

test("reconnect does not replace local annotations while their queued mutations remain pending", async () => {
  const localAnnotations = [{ id: "local-1", page: 1, comment: "Still queued" }];
  let serverAnnotationReads = 0;
  const { lifecycle, model, reader } = createLifecycleHarness({
    getAnnotations: async () => {
      serverAnnotationReads++;
      return [];
    },
    pendingOutboxOps: [{ id: "op_update_local-1", type: "annotation", bookId: 42 }],
    processOutboxQueue: async () => ({ processed: 0, pending: 1 }),
  });
  model.bookId = 42;
  model.currentPage = 1;
  model.annotations = localAnnotations;
  reader.container.style.display = "flex";

  assert.equal(await lifecycle.reconcileServerConnection(), true);
  assert.equal(serverAnnotationReads, 0);
  assert.deepEqual(model.annotations, localAnnotations);
});

test("annotation deletion while offline removes from model, persists to cache, and enqueues outbox delete op", async () => {
  const initialAnnots = [
    { id: "a1", page: 1, comment: "Keep me" },
    { id: "a2", page: 2, comment: "Delete me" },
  ];
  const writes = [];
  const outboxOps = [];
  const context = vm.createContext({
    api: {
      deleteAnnotation: async () => {
        throw new Error("Network unreachable");
      },
    },
    localDB: {
      async saveCachedAnnotations(bookId, list) {
        writes.push({ bookId, annotations: list });
      },
      async enqueueOutboxOp(op) {
        outboxOps.push(op);
      },
      async removeOutboxOp() {},
    },
    document: { getElementById: () => null, querySelectorAll: () => [] },
    window: {},
    console: { warn() {}, error() {} },
  });
  vm.runInContext(source("viewmodels/reader/ReaderAnnotationToolbarView.js"), context);
  vm.runInContext(source("viewmodels/reader/ReaderAnnotationViewModel.js"), context);

  const model = {
    bookId: 42,
    currentPage: 2,
    annotations: [...initialAnnots],
    setAnnotations(list) {
      this.annotations = list;
    },
    getPageAnnotations() {
      return [];
    },
    getColorMetadata() {
      return null;
    },
  };
  const viewModel = new context.window.ReaderAnnotationViewModel(
    model,
    {
      viewportEl: { querySelector: () => null },
      floatingToolbar: { style: {} },
      highlightActionMenu: { style: {} },
      notesDrawer: {},
    },
    {
      getDrawingCoordinator: () => ({}),
      onPageNeedsRefresh: () => {},
    },
  );

  await viewModel.deleteAnnotationItem({ id: "a2", page: 2 });

  // Model should immediately reflect deletion
  assert.equal(model.annotations.length, 1);
  assert.equal(model.annotations[0].id, "a1");

  // LocalDB cache should receive updated list without a2
  assert.equal(writes.length, 1);
  assert.equal(writes[0].bookId, 42);
  assert.deepEqual(writes[0].annotations, [{ id: "a1", page: 1, comment: "Keep me" }]);

  // Outbox should contain the op_del_a2 operation
  assert.equal(outboxOps.length, 1);
  assert.equal(outboxOps[0].id, "op_del_a2");
  assert.equal(outboxOps[0].action, "delete");
  assert.equal(outboxOps[0].entityId, "a2");
  assert.equal(outboxOps[0].bookId, 42);
});

test("ReaderNotesViewModel deleteNote while offline removes from model, updates cache, and queues outbox", async () => {
  const initialAnnots = [
    { id: "n1", page: 1, comment: "Note 1" },
    { id: "n2", page: 2, comment: "Note 2" },
  ];
  const writes = [];
  const outboxOps = [];
  const context = vm.createContext({
    confirm: () => true,
    api: {
      deleteAnnotation: async () => {
        throw new Error("Failed to fetch");
      },
    },
    localDB: {
      async saveCachedAnnotations(bookId, list) {
        writes.push({ bookId, annotations: list });
      },
      async enqueueOutboxOp(op) {
        outboxOps.push(op);
      },
      async removeOutboxOp() {},
    },
    document: {
      createElement: () => ({ className: "", innerHTML: "", querySelector: () => null, appendChild: () => {} }),
    },
    NotesView: {
      createNoteCard: () => ({}),
    },
    window: {},
    console: { warn() {}, error() {} },
  });
  vm.runInContext(source("viewmodels/reader/ReaderNotesViewModel.js"), context);

  const model = {
    bookId: 99,
    annotations: [...initialAnnots],
    setAnnotations(list) {
      this.annotations = list;
    },
    getColorMetadata: () => null,
  };
  const viewportEl = {
    innerHTML: "",
    appendChild: () => {},
    querySelector: () => null,
  };
  const notesVm = new context.window.ReaderNotesViewModel(model, viewportEl, {
    onJumpToPage: () => {},
    onRefreshAnnotations: async () => {},
  });

  await notesVm.deleteNote("n2");

  assert.equal(model.annotations.length, 1);
  assert.equal(model.annotations[0].id, "n1");
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].annotations, [{ id: "n1", page: 1, comment: "Note 1" }]);
  assert.equal(outboxOps.length, 1);
  assert.equal(outboxOps[0].id, "op_del_n2");
  assert.equal(outboxOps[0].action, "delete");
});

test("offline complete background reconciliation skips server annotations when pending annotation outbox ops exist", async () => {
  let serverFetched = false;
  const context = vm.createContext({
    api: {
      markBookOpened: async () => {},
      getProgress: async () => null,
      getAnnotations: async () => {
        serverFetched = true;
        return [{ id: "server-1", page: 1 }];
      },
    },
    localDB: {
      getPendingOutboxOps: async () => [{ id: "op_del_local", type: "annotation", bookId: 101 }],
      saveCachedAnnotations: async () => {},
    },
    LibraryModel: { formatReadingProgress: () => "0%" },
    window: {},
    console: { warn() {}, error() {} },
  });
  vm.runInContext(source("viewmodels/reader/ReaderBookReconciler.js"), context);

  const model = {
    bookId: 101,
    currentPage: 1,
    totalPages: 5,
    annotations: [],
    setAnnotations(annots) {
      this.annotations = annots;
    },
  };
  const reader = {
    openSequence: 1,
    model,
    annotations: { renderDrawerAnnotations() {}, refreshPageHighlights() {} },
  };

  const reconciler = new context.window.ReaderBookReconciler(reader);
  reconciler.reconcileOfflineCompleteBookInBackground(101, 1, 1);

  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(
    model.annotations.length,
    0,
    "Server annotations must not overwrite local annotations when outbox op is pending",
  );
  assert.equal(serverFetched, false, "Server annotations should not even be requested if pending outbox ops exist");
});

test("ReaderEventBindings highlight-action-delete-btn immediately closes menu and removes highlight before server sync", async () => {
  const elements = new Map();
  const deletedElements = [];
  const fakeElement = (id) => ({
    id,
    style: { display: "flex" },
    closest: () => null,
    addEventListener(_event, fn) {
      this._handler = fn;
    },
    async click() {
      if (this._handler) await this._handler({ stopPropagation() {} });
    },
    remove() {
      deletedElements.push(this);
    },
  });

  const menu = fakeElement("highlight-action-menu");
  const deleteBtn = fakeElement("highlight-action-delete-btn");
  const highlightEl = fakeElement("hl-1");
  highlightEl.dataset = { annotationId: "target-1" };

  elements.set("highlight-action-menu", menu);
  elements.set("highlight-action-delete-btn", deleteBtn);

  let serverResolved = false;
  let serverPromiseResolve;
  const serverPromise = new Promise((resolve) => {
    serverPromiseResolve = () => {
      serverResolved = true;
      resolve({ success: true });
    };
  });

  const context = vm.createContext({
    document: {
      getElementById: (id) => elements.get(id) || null,
      addEventListener: () => {},
      querySelectorAll: (sel) => {
        if (sel.includes("target-1")) return [highlightEl];
        return [];
      },
    },
    window: {
      addEventListener: () => {},
    },
    api: {
      deleteAnnotation: async () => {
        return serverPromise;
      },
    },
    localDB: {
      saveCachedAnnotations: async () => {},
      enqueueOutboxOp: async () => {},
      removeOutboxOp: async () => {},
    },
    Element: function () {},
    ReaderModel: { normalizeText: (t) => t },
    console: { warn() {}, error() {} },
  });

  vm.runInContext(source("viewmodels/reader/ReaderEventBindings.js"), context);

  const model = {
    bookId: 50,
    annotations: [
      { id: "target-1", page: 2 },
      { id: "keep-1", page: 2 },
    ],
    activeHighlight: { id: "target-1", page: 2 },
    setAnnotations(list) {
      this.annotations = list;
    },
  };

  let pageRefreshed = false;
  const reader = {
    model,
    highlightActionMenu: menu,
    toolbar: { bindAllEvents: () => {} },
    selectionLoupe: { bindEvents: () => {} },
    annotations: {
      renderFloatingColors: () => {},
      renderDrawerAnnotations: () => {},
      refreshAnnotations: async () => {},
      refreshPageHighlights: () => {
        pageRefreshed = true;
      },
    },
    drawing: { textHighlight: { isSelecting: false } },
    bodyEl: { addEventListener: () => {} },
  };

  const bindings = new context.window.ReaderEventBindings(reader);
  bindings.bind();

  const clickPromise = deleteBtn.click();

  assert.equal(menu.style.display, "none", "Menu must close immediately");
  assert.equal(model.activeHighlight, null, "Active highlight must be cleared immediately");
  assert.equal(model.annotations.length, 1, "Model annotations must be updated immediately");
  assert.equal(model.annotations[0].id, "keep-1");
  assert.equal(deletedElements.length, 1, "Highlight element must be removed from DOM immediately");
  assert.equal(pageRefreshed, false, "Page highlights will be fully refreshed after sync");
  assert.equal(serverResolved, false, "Server sync is still in flight");

  serverPromiseResolve();
  await clickPromise;
  assert.equal(serverResolved, true);
  assert.equal(pageRefreshed, true, "Page highlights refreshed after sync");
});

test("ReaderAnnotationViewModel.refreshAnnotations does not overwrite local annotations when outbox ops are pending", async () => {
  let serverFetchAttempted = false;
  const context = vm.createContext({
    api: {
      getAnnotations: async () => {
        serverFetchAttempted = true;
        return [{ id: "stale-server-annot", page: 1 }];
      },
    },
    localDB: {
      getPendingOutboxOps: async () => [{ id: "op_del_1", type: "annotation", bookId: 77 }],
    },
    document: { getElementById: () => null },
    window: {},
    console: { warn() {}, error() {} },
  });

  vm.runInContext(source("viewmodels/reader/ReaderAnnotationToolbarView.js"), context);
  vm.runInContext(source("viewmodels/reader/ReaderAnnotationViewModel.js"), context);

  const localList = [{ id: "fresh-local-annot", page: 1 }];
  const model = {
    bookId: 77,
    annotations: [...localList],
    setAnnotations(list) {
      this.annotations = list;
    },
  };

  const vmInstance = new context.window.ReaderAnnotationViewModel(model, {}, {});
  const result = await vmInstance.refreshAnnotations();

  assert.equal(serverFetchAttempted, false, "Server should not be polled when local outbox ops are pending");
  assert.deepEqual(model.annotations, localList, "Local annotations must remain intact");
  assert.deepEqual(result, localList);
});
