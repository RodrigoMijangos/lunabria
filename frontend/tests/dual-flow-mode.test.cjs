const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const frontendDir = path.join(__dirname, '..');

function createDOMContext(extraGlobals = {}) {
  const elements = new Map();
  const classListSets = new Map();

  function getClasses(id) {
    if (!classListSets.has(id)) classListSets.set(id, new Set());
    return classListSets.get(id);
  }

  const documentStub = {
    getElementById: (id) => {
      const classes = getClasses(id);
      return {
        id,
        value: '',
        style: {},
        classList: {
          contains: (cls) => classes.has(cls),
          add: (cls) => classes.add(cls),
          remove: (cls) => classes.delete(cls),
          toggle: (cls, force) => {
            const has = force !== undefined ? Boolean(force) : !classes.has(cls);
            if (has) classes.add(cls);
            else classes.delete(cls);
            return has;
          }
        },
        querySelectorAll: () => [],
        querySelector: () => null,
        addEventListener: () => {},
        blur: () => {}
      };
    },
    querySelectorAll: () => [],
    querySelector: () => null,
    createElement: (tag) => ({
      tagName: tag.toUpperCase(),
      style: {},
      classList: { add: () => {}, remove: () => {}, toggle: () => {} },
      appendChild: () => {},
      addEventListener: () => {}
    }),
    body: {
      classList: {
        contains: (cls) => getClasses('body').has(cls),
        add: (cls) => getClasses('body').add(cls),
        remove: (cls) => getClasses('body').delete(cls),
        toggle: (cls, force) => {
          const has = force !== undefined ? Boolean(force) : !getClasses('body').has(cls);
          if (has) getClasses('body').add(cls);
          else getClasses('body').delete(cls);
          return has;
        }
      },
      style: {}
    }
  };

  const localStorageStub = {
    _data: {},
    getItem(k) { return this._data[k] ?? null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; }
  };

  const context = {
    console,
    Math,
    Number,
    document: documentStub,
    localStorage: localStorageStub,
    innerWidth: 1200,
    innerHeight: 800,
    ...extraGlobals
  };

  context.window = context;
  context.global = context;
  context.globalThis = context;

  vm.createContext(context);
  return context;
}

test('ReaderModel supports dual-flow viewMode normalization and persistence', () => {
  const context = createDOMContext();
  const navMapSrc = fs.readFileSync(path.join(frontendDir, 'js/models/ReaderNavigationMap.js'), 'utf8');
  const modelSrc = fs.readFileSync(path.join(frontendDir, 'js/models/ReaderModel.js'), 'utf8');
  vm.runInContext(navMapSrc, context);
  vm.runInContext(modelSrc, context);

  const model = new context.ReaderModel();
  assert.equal(model.normalizeViewMode('dual-flow'), 'dual-flow');
  assert.equal(model.normalizeViewMode('invalid-mode'), 'paginated');

  model.setViewMode('dual-flow');
  assert.equal(model.viewMode, 'dual-flow');
  assert.equal(context.localStorage.getItem('moon_reader_view_mode'), 'dual-flow');
});

test('ReaderNavigationViewModel syncs dual-flow-mode class and calculates 2-column fit scales', async () => {
  const context = createDOMContext();
  const navMapSrc = fs.readFileSync(path.join(frontendDir, 'js/models/ReaderNavigationMap.js'), 'utf8');
  const modelSrc = fs.readFileSync(path.join(frontendDir, 'js/models/ReaderModel.js'), 'utf8');
  const navVmSrc = fs.readFileSync(path.join(frontendDir, 'js/viewmodels/reader/ReaderNavigationViewModel.js'), 'utf8');
  vm.runInContext(navMapSrc, context);
  vm.runInContext(modelSrc, context);
  vm.runInContext(navVmSrc, context);

  const model = new context.ReaderModel();
  const viewportClasses = new Set();
  const viewportEl = {
    classList: {
      contains: (cls) => viewportClasses.has(cls),
      toggle: (cls, force) => {
        if (force) viewportClasses.add(cls);
        else viewportClasses.delete(cls);
      }
    }
  };

  let scrolledBy = null;
  const bodyEl = {
    clientWidth: 1000,
    clientHeight: 800,
    scrollBy: (options) => { scrolledBy = options; }
  };

  const nav = new context.ReaderNavigationViewModel(
    model,
    { viewportEl, bodyEl },
    {}
  );

  // 1. Sync UI
  model.setViewMode('dual-flow');
  nav.syncViewModeUI();
  assert.ok(viewportClasses.has('dual-flow-mode'), 'viewport must have dual-flow-mode class');
  assert.ok(!viewportClasses.has('dual-mode'), 'viewport must NOT have dual-mode class');
  assert.ok(!viewportClasses.has('flow-mode'), 'viewport must NOT have single flow-mode class');

  // 2. Next/Prev page smooth scroll in dual-flow
  nav.nextPage();
  assert.ok(scrolledBy, 'nextPage must trigger scrollBy');
  assert.equal(scrolledBy.behavior, 'smooth');
  assert.ok(scrolledBy.top > 0);

  scrolledBy = null;
  nav.prevPage();
  assert.ok(scrolledBy, 'prevPage must trigger scrollBy');
  assert.equal(scrolledBy.behavior, 'smooth');
  assert.ok(scrolledBy.top < 0);

  // 3. Fit width scale divides available width across 2 columns
  model.pdfDoc = {
    getPage: async () => ({
      getViewport: () => ({ width: 500, height: 700 })
    })
  };
  const dualFlowScale = await nav.calculateFitWidthScale(1);
  model.setViewMode('paginated');
  const singleScale = await nav.calculateFitWidthScale(1);
  assert.ok(dualFlowScale < singleScale, 'dual-flow fit width scale must be approximately half of single page scale');
});

test('ReaderViewModel dispatches dual-flow to renderFlowMode', async () => {
  const context = createDOMContext();
  const readerVmSrc = fs.readFileSync(path.join(frontendDir, 'js/viewmodels/ReaderViewModel.js'), 'utf8');
  vm.runInContext(readerVmSrc, context);

  let flowRenderCalled = false;
  let dualRenderCalled = false;
  let pageRenderCalled = false;

  const fakeRenderer = {
    renderFlowMode: async () => { flowRenderCalled = true; },
    renderDualPage: async () => { dualRenderCalled = true; },
    renderPage: async () => { pageRenderCalled = true; }
  };

  const fakeScope = {
    model: {
      viewMode: 'dual-flow',
      currentPage: 1,
      setCurrentPage: () => {}
    },
    renderer: fakeRenderer,
    notes: {},
    nav: { updateHUD: () => {} },
    tableOfContents: { updateActivePage: () => {} },
    debounceSaveProgress: () => {}
  };

  await context.ReaderViewModel.prototype.renderCurrentViewMode.call(fakeScope, 1);
  assert.equal(flowRenderCalled, true, 'dual-flow must dispatch to renderer.renderFlowMode');
  assert.equal(dualRenderCalled, false, 'dual-flow must not call renderDualPage');
  assert.equal(pageRenderCalled, false, 'dual-flow must not call renderPage');
});

test('MobileReaderController falls back dual-flow to single flow on mobile viewports', () => {
  const context = createDOMContext();
  const navMapSrc = fs.readFileSync(path.join(frontendDir, 'js/models/ReaderNavigationMap.js'), 'utf8');
  const modelSrc = fs.readFileSync(path.join(frontendDir, 'js/models/ReaderModel.js'), 'utf8');
  const mobCtrlSrc = fs.readFileSync(path.join(frontendDir, 'js/mobile/MobileReaderController.js'), 'utf8');

  let setViewModeArg = null;
  const fakeReader = {
    container: { style: { display: 'flex' } },
    nav: {
      setViewMode: (mode) => { setViewModeArg = mode; }
    }
  };

  let isMobile = true;
  context.DeviceEnvironment = function() {
    return {
      isMobileReaderActive: () => isMobile,
      onChange: () => {}
    };
  };

  vm.runInContext(navMapSrc, context);
  vm.runInContext(modelSrc, context);
  vm.runInContext(mobCtrlSrc, context);

  const model = new context.ReaderModel();
  model.viewMode = 'dual-flow';

  const controller = new context.MobileReaderController(fakeReader, model);
  controller.syncMobileState();

  assert.equal(setViewModeArg, 'flow', 'Mobile reader must automatically fallback dual-flow to standard flow');
});

test('index.html contains dual-flow option in reading mode select', () => {
  const html = fs.readFileSync(path.join(frontendDir, 'index.html'), 'utf8');
  assert.match(html, /<select[^>]*id="view-mode-select"[^>]*>[\s\S]*?<option[^>]*value="dual-flow"[^>]*>Two Pages Flow<\/option>/);
});

test('reader-pages.css defines seamless vertical axis and row shadow for dual-flow-mode', () => {
  const css = fs.readFileSync(path.join(frontendDir, 'css/reader-pages.css'), 'utf8');
  assert.match(css, /\.pdf-viewport-container\.dual-flow-mode\s*\{[^}]*display:\s*grid/);
  assert.match(css, /\.pdf-viewport-container\.dual-flow-mode\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*max-content\)/);
  assert.match(css, /\.pdf-viewport-container\.dual-flow-mode\s*\{[^}]*gap:\s*8px\s+0/);
  assert.match(css, /\.pdf-viewport-container\.dual-flow-mode\s+\.pdf-page-wrapper\s*\{[^}]*box-shadow:\s*0\s+8px\s+8px\s+-2px/);
  assert.match(css, /\.pdf-viewport-container\.dual-flow-mode\s+\.pdf-page-wrapper:nth-child\(odd\)\s*\{[^}]*border-top-right-radius:\s*0/);
  assert.match(css, /\.pdf-viewport-container\.dual-flow-mode\s+\.pdf-page-wrapper:nth-child\(even\)\s*\{[^}]*border-top-left-radius:\s*0/);
});

test('mobile-reader.css defines column layout fallback for dual-flow-mode', () => {
  const css = fs.readFileSync(path.join(frontendDir, 'css/mobile/mobile-reader.css'), 'utf8');
  assert.match(css, /body\.mobile-reader-active\s+\.pdf-viewport-container\.dual-flow-mode\s*\{[^}]*flex-direction:\s*column\s*!important/);
});

test('design.css defines viewport zoom and lateral scroll safeguards for dual-flow-mode and dual-mode', () => {
  const css = fs.readFileSync(path.join(frontendDir, 'css/design.css'), 'utf8');
  assert.match(css, /\.pdf-viewport-container\.dual-flow-mode,\s*\.pdf-viewport-container\.dual-mode\s*\{[^}]*width:\s*max-content/);
  assert.match(css, /\.pdf-viewport-container\.dual-flow-mode,\s*\.pdf-viewport-container\.dual-mode\s*\{[^}]*max-width:\s*none/);
});
