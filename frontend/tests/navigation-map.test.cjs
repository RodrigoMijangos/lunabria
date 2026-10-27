'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const frontend = path.resolve(__dirname, '..');
const source = file => fs.readFileSync(path.join(frontend, 'js', file), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));

function createContext() {
  const warnings = [];
  const context = vm.createContext({
    window: {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    console: { warn: (...args) => warnings.push(args) },
    document: { body: { style: {} } },
    alert() {}
  });
  vm.runInContext(source('models/ReaderNavigationMap.js'), context);
  vm.runInContext(source('models/ReaderModel.js'), context);
  vm.runInContext(source('viewmodels/reader/ReaderDocumentLifecycle.js'), context);
  return { context, warnings };
}

function createReader(context, offline, pdfDoc) {
  const model = new context.window.ReaderModel();
  const rendered = [];
  const reader = {
    model,
    openSequence: 0,
    loadingTask: null,
    container: { style: {} },
    renderer: { resetViewportDOM() {} },
    toolbar: { setOfflineStatus() {} },
    annotations: { renderFloatingColors() {}, renderDrawerAnnotations() {} },
    nav: {
      calculateFitWidthScale: async () => 1,
      calculateFitPageScale: async () => 1,
      syncViewModeUI() {},
      updateHUD() {}
    },
    renderCurrentViewMode: async page => rendered.push(page),
    updateBookInfo() {},
    destroyPdfResource() {},
    loadPdfDocument: async () => pdfDoc
  };
  const localDB = {
    isBookOfflineComplete: async () => offline,
    isPdfCached: async () => false,
    hasAllLayoutsCached: async () => false,
    getLocalProgress: async () => null,
    getCachedAnnotations: async () => []
  };
  const api = {
    getColors: async () => [],
    getProgress: async () => ({ current_page: 1 }),
    markBookOpened: async () => {},
    getAnnotations: async () => []
  };
  Object.assign(context, {
    localDB,
    api,
    LibraryModel: { formatReadingProgress: () => '0' }
  });
  return { reader, rendered };
}

test('ReaderNavigationMap initializes, resolves destinations and resets with ReaderModel', () => {
  const { context } = createContext();
  const model = new context.window.ReaderModel();
  const navigationMap = model.navigationMap;
  const destinations = vm.runInContext('new Map([["intro", 2]])', context);

  assert.deepEqual(plain(navigationMap.toc), []);
  assert.equal(navigationMap.resolveDestination('missing'), null);
  navigationMap.setTableOfContents(
    [{ title: 'Introduction', page: 2, level: 0, children: [] }],
    destinations
  );

  assert.equal(navigationMap.resolveDestination('intro'), 2);
  assert.equal(navigationMap.resolveDestination(6), 6);
  assert.equal(navigationMap.resolveDestination('7'), 7);
  assert.equal(navigationMap.resolveDestination(0), null);
  assert.equal(navigationMap.pushJump(2), true);
  assert.equal(navigationMap.pushJump(5), true);
  assert.equal(navigationMap.hasJumpHistory(), true);
  assert.equal(navigationMap.peekJumpOrigin(), 5);
  assert.equal(navigationMap.popJump(), 5);
  assert.equal(navigationMap.peekJumpOrigin(), 2);
  assert.equal(navigationMap.popJump(), 2);
  assert.equal(navigationMap.peekJumpOrigin(), null);
  assert.equal(navigationMap.popJump(), null);
  assert.equal(navigationMap.pushJump(0), false);

  model.reset();
  assert.equal(model.navigationMap, navigationMap);
  assert.deepEqual(plain(navigationMap.toc), []);
  assert.equal(navigationMap.resolveDestination('intro'), null);
  assert.equal(navigationMap.hasJumpHistory(), false);
});

test('ReaderDocumentLifecycle.open extracts nested outlines online and offline and tolerates broken outlines', async () => {
  for (const offline of [false, true]) {
    const { context, warnings } = createContext();
    const pageIndexes = new Map([['front', 0], ['section-one', 2]]);
    const pdfDoc = {
      numPages: 5,
      getOutline: async () => [
        {
          title: 'Introduction',
          dest: 'front',
          items: [{ title: 'Section One', dest: 'section-one', items: [] }]
        },
        { title: 'Appendix', dest: [4], items: [] }
      ],
      getDestination: async name => [{ name }, 'XYZ', null, null],
      getPageIndex: async ref => pageIndexes.get(ref.name) ?? -1
    };
    const { reader, rendered } = createReader(context, offline, pdfDoc);
    const lifecycle = new context.window.ReaderDocumentLifecycle(reader);

    await lifecycle.open(11, 1);

    assert.deepEqual(plain(reader.model.navigationMap.toc), [
      {
        title: 'Introduction',
        page: 1,
        level: 0,
        children: [{ title: 'Section One', page: 3, level: 1, children: [] }]
      },
      { title: 'Appendix', page: 5, level: 0, children: [] }
    ]);
    assert.equal(reader.model.navigationMap.resolveDestination('section-one'), 3);
    assert.deepEqual(rendered, [1]);
    assert.deepEqual(warnings, []);
  }

  const { context, warnings } = createContext();
  const pdfDoc = {
    numPages: 1,
    getOutline: async () => { throw new Error('invalid outline'); }
  };
  const { reader, rendered } = createReader(context, false, pdfDoc);
  await new context.window.ReaderDocumentLifecycle(reader).open(12, 1);

  assert.deepEqual(plain(reader.model.navigationMap.toc), []);
  assert.deepEqual(rendered, [1]);
  assert.equal(warnings.length, 1);
});

test('ReaderDocumentLifecycle prepares mobile state before revealing and rendering the reader', async () => {
  const { context } = createContext();
  const { reader } = createReader(context, false, {
    numPages: 1,
    getOutline: async () => []
  });
  const events = [];
  reader.container.style.display = 'none';
  reader.mobile = {
    prepareForBookOpen() {
      assert.equal(reader.container.style.display, 'none');
      events.push('prepare');
    },
    onBookOpened() {
      events.push('opened');
    }
  };
  reader.renderCurrentViewMode = async () => {
    assert.equal(reader.container.style.display, 'flex');
    events.push('render');
  };

  await new context.window.ReaderDocumentLifecycle(reader).open(13, 1);

  assert.deepEqual(events, ['prepare', 'render', 'opened']);
});

test('ReaderDocumentLifecycle skips mobile open completion when a render is superseded', async () => {
  const { context } = createContext();
  const { reader } = createReader(context, false, {
    numPages: 1,
    getOutline: async () => []
  });
  let finishRender;
  let notifyRenderStarted;
  const renderStarted = new Promise(resolve => { notifyRenderStarted = resolve; });
  const events = [];
  reader.mobile = {
    prepareForBookOpen() {},
    onBookOpened() {
      events.push('opened');
    }
  };
  reader.renderCurrentViewMode = () => {
    events.push('render');
    notifyRenderStarted();
    return new Promise(resolve => { finishRender = resolve; });
  };

  const opening = new context.window.ReaderDocumentLifecycle(reader).open(14, 1);
  await renderStarted;
  reader.openSequence += 1;
  finishRender();
  await opening;

  assert.deepEqual(events, ['render']);
});
