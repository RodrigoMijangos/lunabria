'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const baseline = require('./reader.baseline.test.cjs');
const frontend = path.resolve(__dirname, '..');
const source = file => fs.readFileSync(path.join(frontend, 'js', file), 'utf8');
const addedScripts = [
  'services/reader/ReaderSelectionGeometry.js',
  'services/reader/ReaderTextTargetGeometry.js',
  'services/reader/ReaderOfflineService.js',
  'viewmodels/reader/ReaderEventBindings.js',
  'viewmodels/reader/ReaderDocumentLifecycle.js'
];
const clone = value => structuredClone(value);
const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
const stylesExceptPosition = style => {
  const { left, top, ...rest } = style;
  return clone(rest);
};
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function world(original = false) {
  const trace = [], timers = new Map(), frames = [], elements = new Map();
  let timerId = 0;
  class Element {
    constructor() { this.style = {}; this.listeners = []; this.dataset = {}; }
    addEventListener(type, fn, options) { this.listeners.push({ type, fn, options }); }
    async emit(type, event = {}) {
      for (const listener of this.listeners.filter(item => item.type === type)) await listener.fn(event);
    }
    closest() { return null; }
    querySelector() { return null; }
    querySelectorAll() { return []; }
    appendChild() {}
    replaceChildren() {}
    setAttribute(name, value) { (this.attributes ||= {})[name] = value; }
    getBoundingClientRect() { return rect(0, 0, 240, 44); }
    classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
  }
  for (const id of ['reader-container', 'pdf-viewport', 'reader-body', 'reader-page-text', 'reader-scrubber',
    'floating-toolbar', 'highlight-action-menu', 'reader-drawer', 'drawer-backdrop', 'reader-page-shortcuts',
    'floating-copy-btn', 'floating-note-btn', 'highlight-action-delete-btn', 'highlight-action-note-btn']) {
    elements.set(id, new Element());
  }
  const document = new Element();
  document.body = new Element();
  document.getElementById = id => elements.get(id) || null;
  document.createElement = () => new Element();
  const window = new Element();
  Object.assign(window, { innerWidth: 900, innerHeight: 700, getSelection: () => null,
    app: { model: { getBookById: () => ({ title: 'Cached' }) }, loadHome: async () => trace.push(['home']) } });
  const pdf = { numPages: 23, destroy: () => trace.push(['destroy-document']) };
  const localDB = {
    isPdfCached: async () => true, hasAllLayoutsCached: async () => true,
    getPdfBlob: async () => null, getCachedLayoutPages: async () => new Set(),
    savePdfBlob: async id => trace.push(['save-pdf', id])
  };
  const api = {
    getColors: async () => { trace.push(['colors']); return [{ id: 'yellow', name: 'Idea', color: '#ffff00' }]; },
    getBook: async id => { trace.push(['book', id]); return { title: 'Remote' }; },
    getProgress: async id => { trace.push(['progress', id]); return { current_page: 4 }; },
    markBookOpened: async (id, progress) => trace.push(['opened', id, clone(progress)]),
    getAnnotations: async id => { trace.push(['annotations', id]); return []; },
    prefetchLayouts: async (...args) => { trace.push(['prefetch', ...args]); return true; },
    saveProgress: async (id, progress) => trace.push(['save-progress', id, clone(progress)]),
    syncPendingProgress: async reason => trace.push(['sync', reason]),
    deleteAnnotation: async id => trace.push(['delete', id]),
    updateAnnotation: async (id, data) => trace.push(['update', id, clone(data)])
  };
  const nav = {
    calculateFitWidthScale: async page => { trace.push(['fit-width', page]); return 1.75; },
    calculateFitPageScale: async page => { trace.push(['fit-page', page]); return 0.85; },
    syncViewModeUI: () => trace.push(['view-ui']), updateHUD: () => trace.push(['hud']),
    setZoom: (...args) => trace.push(['zoom', ...args])
  };
  const renderer = {
    resetViewportDOM: () => trace.push(['reset-dom']),
    renderPage: async (...args) => trace.push(['render-page', ...args]),
    renderDualPage: async (...args) => trace.push(['render-dual', ...args]),
    renderFlowMode: async (onPage, ...args) => { trace.push(['render-flow', ...args]); if (onPage) onPage(8); }
  };
  const sandbox = {
    Element, Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 }, document, window, navigator: {
      onLine: true, clipboard: { writeText: text => trace.push(['copy', text]) }
    }, localDB, api, Uint8Array, TextDecoder,
    pdfjsLib: { getDocument: arg => { trace.push(['get-document', typeof arg === 'string' ? arg : Array.from(arg.data)]); return { promise: Promise.resolve(pdf), destroy: () => trace.push(['destroy-task']) }; } },
    ReaderHUDView: { updateBookInfo: (_title, _author, book) => trace.push(['title', book?.title]) },
    LibraryModel: { formatReadingProgress: (page, total) => (page / total * 100).toFixed(2) },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    console: { warn: (message, error) => trace.push(['warn', message, error?.message]), error: (message, error) => trace.push(['error', message, error?.message]) },
    alert: message => trace.push(['alert', message]), prompt: () => null,
    setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
    clearTimeout: id => timers.delete(id), requestAnimationFrame: fn => frames.push(fn),
    fetch: async () => { throw new Error('Unexpected fetch'); },
    ReaderNavigationViewModel: function () { return nav; },
    ReaderPageRenderer: function () { return renderer; },
    ReaderDrawingViewModel: function () { return { textHighlight: { isSelecting: false } }; },
    ReaderNativeSelectionLoupeController: function () { return { bindEvents: () => trace.push(['bind-loupe']) }; },
    ReaderNotesViewModel: function () { return { renderNotesMode: () => trace.push(['render-notes']) }; },
    ReaderToolbarManager: function () { return {
      bindAllEvents: () => trace.push(['bind-toolbar']), setOfflineStatus: status => trace.push(['offline', clone(status)])
    }; }
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(source('models/ReaderModel.js'), context);
  if (!original) for (const file of addedScripts) vm.runInContext(source(file), context, { filename: file });
  vm.runInContext(original ? baseline.annotation : source('viewmodels/reader/ReaderAnnotationViewModel.js'), context);
  vm.runInContext(original ? baseline.reader : source('viewmodels/ReaderViewModel.js'), context);
  const reader = vm.runInContext('new ReaderViewModel()', context);
  const annotations = reader.annotations;
  reader.annotations = {
    renderFloatingColors: () => trace.push(['floating-colors']), renderDrawerAnnotations: () => trace.push(['drawer-annotations']),
    updateFloatingToolbar: () => trace.push(['update-toolbar']), hideQuickHighlightPalette: () => trace.push(['hide-palette']),
    clearTextSelection: () => trace.push(['clear-selection']),
    refreshAnnotations: async () => trace.push(['refresh-annotations']),
    refreshPageHighlights: page => trace.push(['refresh-page', page]),
    applyHighlight: (...args) => trace.push(['highlight', ...args])
  };
  return { context, reader, annotations, trace, timers, frames, elements, document, window, nav, renderer, api, localDB, pdf, Element };
}

async function differential(run) {
  const old = world(true), current = world();
  const expected = await run(old);
  const actual = await run(current);
  assert.deepStrictEqual(clone(actual), clone(expected));
  assert.deepStrictEqual(clone(current.trace), clone(old.trace));
  return current;
}

function selection(rects, bounds = rect(100, 100, 80, 20), lines = []) {
  const range = { getClientRects: () => rects, getBoundingClientRect: () => bounds };
  const wrapper = { getBoundingClientRect: () => rect(50, 60, 700, 1000), querySelectorAll: () => lines };
  return { range, wrapper };
}
function outcome(fn) {
  try { return { value: clone(fn()) }; }
  catch (error) { return { error: error.name, message: error.message }; }
};
function loadNativeSelectionController(context) {
  vm.runInContext(source('services/reader/ReaderTextTargetGeometry.js'), context);
  vm.runInContext(source('viewmodels/reader/ReaderNativeSelectionLoupeController.js'), context);
}

test('public methods and constructor-owned state remain available', () => {
  const old = world(true), current = world();
  const names = w => Object.getOwnPropertyNames(Object.getPrototypeOf(w.reader));
  assert.deepStrictEqual(names(current), names(old));
  assert.deepStrictEqual(clone(current.reader.model), clone(old.reader.model));
  for (const key of Object.keys(old.reader)) assert.ok(Object.hasOwn(current.reader, key), key);
  assert.equal(current.reader.openSequence, 0);
  assert.equal(current.reader.loadingTask, null);
  assert.equal(current.reader.progressDebounceTimer, null);
});

test('selection geometry matches the original for scales, fallback, precise lines and malformed data', () => {
  const old = world(true), current = world();
  const line = (bounds, data) => ({ getBoundingClientRect: () => bounds, dataset: data });
  const cases = [
    selection([]), selection([rect(100, 100, 1, 20)], rect(90, 110, 0, 0)),
    selection([rect(100, 100, 20, 10), rect(123, 100, 10, 10)]),
    selection([rect(100, 100, 100, 12)], undefined, [line(rect(90, 98, 80, 16), { x0: '20', y0: '0', x1: '60', y1: '15' })]),

    selection([rect(100, 100, 100, 12)], undefined, [line(rect(90, 98, 80, 16), { x0: 'bad', y0: 'bad', x1: '', y1: '15' })]),
    selection([rect(100, 100, 100, 12)], undefined, [line(rect(90, 98, 80, 16), { y0: '' })])
  ];
  let seed = 7301;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 200; i++) {
    const cr = rect(random() * 1000 - 100, random() * 800, random() * 180, random() * 30);
    cases.push(selection([cr], cr, [
      line(rect(cr.left - 10, cr.top - 2, cr.width + 20, cr.height + 4), { x0: '0', y0: '1', x1: '500', y1: '30' }),
      line(rect(cr.left, cr.top + 6, cr.width, cr.height), { x0: '4', y0: '8', x1: '400', y1: '40' })
    ]));
  }
  for (const scale of [0.25, 0.85, 1, 1.3, 1.75, 5, 0]) {
    for (const { range, wrapper } of cases) {
      old.context.bestSpan = null;
      current.context.bestSpan = null;
      const expected = outcome(() => old.annotations.computeSelectionRects(range, wrapper, scale));
      const actual = outcome(() => current.annotations.computeSelectionRects(range, wrapper, scale));
      assert.deepStrictEqual(actual, expected);
    }
  }
  assert.deepStrictEqual(clone(current.annotations.computeSelectionRects(null, null, 1)), []);
});

test('selection geometry works without a prior selection creating an implicit global', () => {
  const current = world();
  const line = { getBoundingClientRect: () => rect(90, 98, 80, 16),
    dataset: { x0: '20', y0: '10', x1: '60', y1: '25' } };
  const match = selection([rect(100, 100, 100, 12)], undefined, [line]);
  const unmatched = selection([rect(100, 300, 100, 12)], undefined, [line]);
  assert.equal(Object.hasOwn(current.context, 'bestSpan'), false);
  assert.deepStrictEqual(clone(current.annotations.computeSelectionRects(match.range, match.wrapper, 2)),
    [{ x0: 25, y0: 8.8, x1: 60, y1: 26.2 }]);
  assert.deepStrictEqual(clone(current.annotations.computeSelectionRects(unmatched.range, unmatched.wrapper, 2)),
    [{ x0: 25, y0: 120, x1: 75, y1: 126 }]);
  const multi = selection([rect(100, 100, 30, 12), rect(100, 300, 30, 12)], undefined, [line]);
  assert.deepStrictEqual(clone(current.annotations.computeSelectionRects(multi.range, multi.wrapper, 2)), [
    { x0: 25, y0: 8.8, x1: 40, y1: 26.2 },
    { x0: 25, y0: 120, x1: 40, y1: 126 }
  ]);
  assert.equal(Object.hasOwn(current.context, 'bestSpan'), false);
});

test('geometry service needs no browser globals and does not mutate numeric inputs', () => {
  const context = vm.createContext({});
  vm.runInContext(source(addedScripts[0]), context);
  const geometry = vm.runInContext('ReaderSelectionGeometry', context);
  const cr = Object.freeze(rect(100, 100, 50, 20));
  const page = Object.freeze(rect(50, 60, 700, 1000));
  assert.deepStrictEqual(clone(geometry.relativeRect(cr, page, 2, null)), { x0: 25, y0: 20, x1: 50, y1: 30 });
  assert.equal(geometry.lineMatchScore(cr, rect(0, 500, 10, 10), 110), null);
});

test('floating toolbar non-position styles, selected state and RAF timing match original', async () => {
  const cases = [
    [rect(150, 100, 60, 20), rect(160, 120, 80, 20)],
    [rect(150, 400, 60, 20), rect(160, 630, 80, 20)],
    [rect(150, 0, 60, 20), rect(160, 630, 80, 20)],
    [rect(150, 0, 60, 20), rect(160, 690, 80, 20)],
    [rect(-300, 20, 60, 20), rect(2000, 600, 80, 20)],
    [rect(150, -200, 60, 20), rect(160, -100, 80, 20)],
    [rect(150, 800, 60, 20), rect(160, 900, 80, 20)]
  ];
  for (const crs of cases) for (const width of [100, 900]) for (const draw of [false, true]) {
    await differential(async w => {
      w.context.bestSpan = null;
      w.window.innerWidth = width;
      const { range, wrapper } = selection(crs, rect(crs[0].left, crs[0].top, 80, crs[1].bottom - crs[0].top));
      wrapper.dataset = { page: '9' };
      range.startContainer = { nodeType: 1, closest: () => wrapper };
      range.cloneRange = () => range;
      w.window.getSelection = () => ({ isCollapsed: false, rangeCount: 1, toString: () => ' quote ', getRangeAt: () => range });
      w.annotations.model.isDrawMode = draw;
      w.annotations.model.drawTool = 'highlighter';
      await w.annotations.updateFloatingToolbar();
      const before = stylesExceptPosition(w.annotations.floatingToolbar.style);
      const frameCount = w.frames.length;
      w.frames.forEach(fn => fn());
      return { before, after: stylesExceptPosition(w.annotations.floatingToolbar.style), frameCount,
        selectedText: w.annotations.model.selectedText, selectedPage: w.annotations.model.selectedPage,
        selectedRects: clone(w.annotations.model.selectedRects) };
    });
  }
});

test('floating toolbar prefers above the first line, then below the last, with a 12px gap', () => {
  const geometry = vm.runInContext('ReaderSelectionGeometry', world().context);
  const cases = [
    { name: 'both fit: prefer above first', first: rect(300, 200, 80, 20), last: rect(600, 300, 80, 20),
      expected: { left: 340, top: 144 } },
    { name: 'above touches safe top', first: rect(300, 66, 80, 20), last: rect(600, 300, 80, 20),
      expected: { left: 340, top: 10 } },
    { name: 'above misses safe top by one pixel', first: rect(300, 65, 80, 20), last: rect(600, 300, 80, 20),
      expected: { left: 640, top: 332 } },
    { name: 'below touches safe bottom', first: rect(300, 20, 80, 20), last: rect(600, 614, 80, 20),
      expected: { left: 640, top: 646 } }
  ];
  for (const { name, first, last, expected } of cases) {
    assert.deepStrictEqual(clone(geometry.floatingToolbarPosition(first, last, 240, 44, 900, 10, 690)), expected, name);
  }
});

test('floating toolbar docks instead of falling back above the last line of a tall selection', () => {
  const geometry = vm.runInContext('ReaderSelectionGeometry', world().context);
  const first = rect(200, 115, 80, 20), last = rect(600, 440, 80, 20);
  const position = clone(geometry.floatingToolbarPosition(first, last, 240, 44, 900, 110, 490));
  assert.deepStrictEqual(position, { left: 640, top: 446 });
  assert.notEqual(position.top, last.top - 44 - 12, 'must not use an above-last candidate inside the selection');
});

test('floating toolbar clamps horizontal edges and centers toolbars wider than the safe viewport', () => {
  const geometry = vm.runInContext('ReaderSelectionGeometry', world().context);
  for (const [name, first, last, width, viewport, expected] of [
    ['above left edge', rect(-300, 200, 60, 20), rect(600, 300, 80, 20), 240, 900, { left: 132, top: 144 }],
    ['above right edge', rect(2000, 200, 60, 20), rect(100, 300, 80, 20), 240, 900, { left: 768, top: 144 }],
    ['below left edge', rect(300, 20, 80, 20), rect(-300, 300, 60, 20), 240, 900, { left: 132, top: 332 }],
    ['below right edge', rect(300, 20, 80, 20), rect(2000, 300, 60, 20), 240, 900, { left: 768, top: 332 }],
    ['docked right edge', rect(300, 20, 80, 20), rect(2000, 670, 60, 20), 240, 900, { left: 768, top: 646 }],
    ['narrow viewport above', rect(300, 200, 80, 20), rect(600, 300, 80, 20), 240, 100, { left: 50, top: 144 }],
    ['narrow viewport below', rect(300, 20, 80, 20), rect(600, 300, 80, 20), 240, 100, { left: 50, top: 332 }],
    ['exact safe width', rect(300, 200, 80, 20), rect(600, 300, 80, 20), 76, 100, { left: 50, top: 144 }]
  ]) {
    assert.deepStrictEqual(clone(geometry.floatingToolbarPosition(first, last, width, 44, viewport, 10, 690)), expected, name);
  }
});

test('floating toolbar requires full safe-bound containment and clamps no-space docking to safe top', () => {
  const geometry = vm.runInContext('ReaderSelectionGeometry', world().context);
  for (const [name, first, last, safeTop, safeBottom, expected] of [
    ['visible HUD forces below', rect(300, 120, 80, 20), rect(600, 250, 80, 20), 110, 490, { left: 640, top: 282 }],
    ['below exceeds footer by one pixel', rect(300, 120, 80, 20), rect(600, 415, 80, 20), 110, 490, { left: 640, top: 446 }],
    ['above is beyond safe bottom', rect(300, 800, 80, 20), rect(600, 900, 80, 20), 110, 490, { left: 640, top: 446 }],
    ['below is before safe top', rect(300, -200, 80, 20), rect(600, -100, 80, 20), 110, 490, { left: 640, top: 446 }],
    ['toolbar taller than available space', rect(300, 115, 80, 20), rect(600, 120, 80, 20), 110, 140, { left: 640, top: 110 }]
  ]) {
    assert.deepStrictEqual(clone(geometry.floatingToolbarPosition(first, last, 240, 44, 900, safeTop, safeBottom)), expected, name);
  }
});

test('hidden selection toolbar is displayed before reading its actual dimensions', async () => {
  const w = world();
  w.annotations.model.scale = 1;
  const toolbar = w.annotations.floatingToolbar;
  toolbar.style.display = 'none';
  toolbar.style.opacity = '0';
  toolbar.style.pointerEvents = 'none';
  const reads = [];
  for (const [property, value] of [['offsetWidth', 320], ['offsetHeight', 60]]) {
    Object.defineProperty(toolbar, property, { get() {
      assert.equal(toolbar.style.display, 'flex', `${property} must be measured while visible`);
      reads.push(property);
      return value;
    } });
  }
  const first = rect(100, 200, 80, 20), last = rect(600, 300, 80, 20);
  const { range, wrapper } = selection([first, last], rect(100, 200, 580, 120));
  wrapper.dataset = { page: '9' };
  range.startContainer = { nodeType: 1, closest: () => wrapper };
  range.cloneRange = () => range;
  w.window.getSelection = () => ({ isCollapsed: false, rangeCount: 1, toString: () => ' quote ', getRangeAt: () => range });
  await w.annotations.updateFloatingToolbar();
  assert.ok(reads.includes('offsetWidth'));
  assert.ok(reads.includes('offsetHeight'));
  assert.equal(toolbar.style.left, '172px');
  assert.equal(toolbar.style.top, '128px');
  assert.equal(toolbar.style.opacity, '0');
  assert.equal(toolbar.style.pointerEvents, 'none');
  assert.equal(w.frames.length, 1);
  assert.equal(w.annotations.model.selectedRange, range);
  assert.equal(w.annotations.model.selectedText, 'quote');
  assert.equal(w.annotations.model.selectedPage, 9);
  assert.deepStrictEqual(clone(w.annotations.model.selectedRects), [
    { x0: 50, y0: 140, x1: 130, y1: 160 },
    { x0: 550, y0: 240, x1: 630, y1: 260 }
  ]);
  w.frames[0]();
  assert.equal(toolbar.style.opacity, '1');
  assert.equal(toolbar.style.pointerEvents, 'auto');
});

test('annotation toolbar placement falls back to 240x44 when offset dimensions are missing or zero', () => {
  for (const offsets of [undefined, 0]) {
    const w = world(), toolbar = w.annotations.floatingToolbar;
    toolbar.style.display = 'none';
    if (offsets === 0) toolbar.offsetWidth = toolbar.offsetHeight = 0;
    w.annotations.positionAnnotationToolbar(toolbar, rect(100, 200, 80, 20), rect(600, 300, 80, 20), 10, 690);
    assert.equal(toolbar.style.display, 'flex');
    assert.equal(toolbar.style.left, '140px');
    assert.equal(toolbar.style.top, '144px');
  }
});

test('saved highlight menu populates colors before measurement and shares visible HUD safe bounds', () => {
  for (const mode of ['visible', 'hidden', 'selector-fallback', 'no-space', 'narrow']) {
    const w = world(), menu = w.annotations.highlightActionMenu;
    const header = new w.Element(), footer = new w.Element();
    header.getBoundingClientRect = () => rect(0, 0, 900, 100);
    footer.getBoundingClientRect = () => rect(0, mode === 'no-space' ? 150 : 500, 900, 200);
    header.classList.contains = footer.classList.contains = name => name === 'hidden' && mode === 'hidden';
    if (mode === 'selector-fallback') {
      w.document.querySelector = selector => selector === '.reader-hud-header' ? header : selector === '.reader-footer' ? footer : null;
    } else {
      w.elements.set('reader-header', header);
      w.elements.set('reader-footer', footer);
    }
    if (mode === 'narrow') w.window.innerWidth = 100;
    const colors = new w.Element(), buttons = [], reads = [];
    colors.appendChild = button => buttons.push(button);
    w.elements.set('highlight-action-colors', colors);
    w.annotations.model.colors = [
      { id: 'yellow', name: 'Idea', color: '#ffff00' },
      { id: 'blue', name: 'Reference', color: '#0000ff' }
    ];
    menu.style.display = 'none';
    for (const [property, value] of [['offsetWidth', 320], ['offsetHeight', 60]]) {
      Object.defineProperty(menu, property, { get() {
        assert.equal(menu.style.display, 'flex', `${mode}: ${property} requires a displayed menu`);
        assert.equal(buttons.length, 2, `${mode}: colors must be populated before ${property}`);
        reads.push(property);
        return value;
      } });
    }
    const annotation = { id: 7, page: 9, color: 'yellow' };
    const highlight = new w.Element();
    const bounds = rect(870, 130, 60, 20);
    highlight.getBoundingClientRect = () => bounds;
    const place = w.annotations.positionAnnotationToolbar;
    assert.equal(typeof place, 'function');
    let placements = 0;
    w.annotations.positionAnnotationToolbar = function (toolbar, first, last, safeTop, safeBottom) {
      placements += 1;
      assert.equal(buttons.length, 2, `${mode}: populate colors before invoking placement`);
      assert.equal(toolbar, menu);
      assert.deepStrictEqual(clone(first), bounds);
      assert.deepStrictEqual(clone(last), bounds);
      assert.equal(safeTop, mode === 'hidden' ? 10 : 110, mode);
      assert.equal(safeBottom, mode === 'hidden' ? 690 : mode === 'no-space' ? 140 : 490, mode);
      return place.call(this, toolbar, first, last, safeTop, safeBottom);
    };
    w.annotations.openHighlightMenu(annotation, highlight);
    assert.equal(placements, 1, mode);
    assert.ok(reads.includes('offsetWidth'), mode);
    assert.ok(reads.includes('offsetHeight'), mode);
    assert.equal(menu.style.left, mode === 'narrow' ? '50px' : '728px', mode);
    assert.equal(menu.style.top, mode === 'hidden' ? '58px' : mode === 'no-space' ? '110px' : '162px', mode);
    assert.equal(w.annotations.model.activeHighlight, annotation);
    assert.equal(w.annotations.floatingToolbar.style.display, 'none');
    assert.equal(buttons[0].style.backgroundColor, '#ffff00');
    assert.equal(buttons[1].style.backgroundColor, '#0000ff');
    assert.equal(buttons[0].style.boxShadow, '0 0 0 2px var(--text-primary)');
    assert.equal(typeof buttons[1].onclick, 'function');
  }
});

test('opening preserves progress precedence, fit scale, rendering and effect order', async () => {
  for (const fitMode of ['width', 'page', null]) for (const startPage of [null, 2, 7]) {
    await differential(async w => {
      const reset = w.reader.model.reset.bind(w.reader.model);
      w.reader.model.reset = () => { reset(); w.reader.model.fitMode = fitMode; };
      await w.reader.open(42, startPage);
      return { page: w.reader.model.currentPage, scale: w.reader.model.scale, fitMode: w.reader.model.fitMode,
        book: w.reader.model.bookId, sequence: w.reader.openSequence, loading: w.reader.loadingTask,
        display: w.reader.container.style.display, overflow: w.document.body.style.overflow };
    });
  }
});

test('superseded open releases its document and does not continue opening', async () => {
  await differential(async w => {
    const pending = deferred();
    w.reader.loadPdfDocument = () => pending.promise;
    const opening = w.reader.open(42);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    w.reader.openSequence += 1;
    pending.resolve(w.pdf);
    await opening;
    return { book: w.reader.model.bookId, loading: w.reader.loadingTask, sequence: w.reader.openSequence };
  });
});

test('opening failures alert and close, metadata and mark-open failures remain nonfatal', async () => {
  for (const failure of ['colors', 'book', 'mark']) await differential(async w => {
    const fail = async () => { throw new Error(failure); };
    if (failure === 'colors') w.api.getColors = fail;
    if (failure === 'book') w.api.getBook = fail;
    if (failure === 'mark') w.api.markBookOpened = fail;
    await w.reader.open(42);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    return { book: w.reader.model.bookId, sequence: w.reader.openSequence, display: w.reader.container.style.display };
  });
});

test('PDF loading preserves online, offline, network fallback and cancellation paths', async () => {
  for (const mode of ['online', 'offline', 'fallback', 'missing', 'cancelled']) await differential(async w => {
    w.context.navigator.onLine = mode !== 'offline';
    w.localDB.getPdfBlob = async id => { w.trace.push(['cached-blob', id]); return mode === 'missing' ? null : { arrayBuffer: async () => Uint8Array.from([37, 80, 68, 70, 45]).buffer }; };
    w.context.pdfjsLib.getDocument = arg => {
      w.trace.push(['get-document', typeof arg === 'string' ? arg : Array.from(arg.data)]);
      const task = { destroy: () => w.trace.push(['destroy-task']) };
      task.promise = typeof arg === 'string' && mode !== 'online' ? Promise.reject(new Error('network')) : Promise.resolve(w.pdf);
      return task;
    };
    try {
      const result = await w.reader.loadPdfDocument(42, mode === 'cancelled' ? -1 : 0);
      return { pages: result.numPages, hasLoadingTask: !!w.reader.loadingTask };
    } catch (error) { return { error: error.message, hasLoadingTask: !!w.reader.loadingTask }; }
  });
});

test('offline cache preserves validation, batches, cached-page counting and progress ordering', async () => {
  for (const mode of ['all-cached', 'partial', 'download', 'bad-pdf', 'http-error', 'prefetch-error', 'incomplete', 'no-book']) {
    await differential(async w => {
      w.reader.model.setBook(mode === 'no-book' ? null : 42, w.pdf, 23);
      w.localDB.isPdfCached = async () => !['download', 'bad-pdf', 'http-error'].includes(mode);
      const cached = mode === 'all-cached' ? Array.from({ length: 23 }, (_, i) => i + 1) : Array.from({ length: 10 }, (_, i) => i + 1).concat(15, 23);
      w.localDB.getCachedLayoutPages = async () => new Set(cached);
      w.localDB.hasAllLayoutsCached = async () => mode !== 'incomplete';
      w.api.prefetchLayouts = async (...args) => { w.trace.push(['prefetch', ...args]); return mode !== 'prefetch-error'; };
      w.context.fetch = async url => { w.trace.push(['fetch', url]); return {
        ok: mode !== 'http-error', status: 503, headers: { get: () => 'text/plain' },
        blob: async () => ({ size: 10, slice: () => ({ arrayBuffer: async () => new TextEncoder().encode(mode === 'bad-pdf' ? 'oops!' : '%PDF-').buffer }) })
      }; };
      try { return { result: await w.reader.cacheCurrentPdf(data => w.trace.push(['download-progress', clone(data)])) }; }
      catch (error) { return { error: error.message }; }
    });
  }
});

test('close waits for persistence and synchronization before reset, cleanup and home', async () => {
  for (const syncFails of [false, true]) await differential(async w => {
    w.reader.model.setBook(42, w.pdf, 23);
    w.reader.model.setCurrentPage(7);
    w.reader.loadingTask = { destroy: () => w.trace.push(['destroy-pending-task']) };
    const save = deferred();
    w.api.saveProgress = (id, data) => { w.trace.push(['save-progress', id, clone(data)]); return save.promise; };
    if (syncFails) w.api.syncPendingProgress = async () => { throw new Error('sync failed'); };
    const closing = w.reader.close();
    const immediate = { book: w.reader.model.bookId, loading: w.reader.loadingTask,
      display: w.reader.container.style.display, overflow: w.document.body.style.overflow, trace: clone(w.trace) };
    save.resolve();
    await closing;
    return { immediate, book: w.reader.model.bookId, sequence: w.reader.openSequence };
  });
});

test('event registrations, capture/passive flags, pointer delays and selection debounce match', async () => {
  await differential(async w => {
    const registered = target => target.listeners.map(({ type, options }) => ({ type, options }));
    const events = { window: registered(w.window), document: registered(w.document), body: registered(w.reader.bodyEl) };
    await w.window.emit('pointerdown', { button: 0 });
    await w.document.emit('selectionchange');
    const selecting = clone(w.reader.floatingToolbar.style);
    await w.window.emit('pointerup');
    const pointerTimers = [...w.timers.values()].map(t => t.delay);
    w.timers.clear();
    await w.document.emit('selectionchange');
    const first = w.reader.selectionTimeout;
    await w.document.emit('selectionchange');
    assert.ok(!w.timers.has(first));
    const delays = [...w.timers.values()].map(t => t.delay);
    for (const timer of w.timers.values()) await timer.fn();
    w.reader.drawing.textHighlight.isSelecting = true;
    const timerCount = w.timers.size;
    await w.document.emit('selectionchange');
    assert.equal(w.timers.size, timerCount);
    return { events, selecting, pointerTimers, delays };
  });
});

test('resize retains 150ms debounce, 0.02 threshold and non-persisting fit zoom', async () => {
  for (const fitMode of ['width', 'page']) for (const delta of [0.01, 0.03]) await differential(async w => {
    w.reader.container.style.display = 'flex';
    w.reader.model.fitMode = fitMode;
    w.reader.model.scale = 1;
    w.nav.calculateFitWidthScale = w.nav.calculateFitPageScale = async () => 1 + delta;
    await w.window.emit('resize');
    const first = w.reader.resizeFitTimeout;
    await w.window.emit('resize');
    assert.ok(!w.timers.has(first));
    const delays = [...w.timers.values()].map(t => t.delay);
    for (const timer of w.timers.values()) await timer.fn();
    return { delays };
  });
});

test('scroll, outside pointer, copy/note and annotation actions retain their effects', async () => {
  await differential(async w => {
    w.reader.model.selectedRange = {};
    await w.reader.bodyEl.emit('scroll');
    await w.document.emit('pointerdown', { target: new w.Element() });
    w.reader.model.selectedText = 'hello\nworld';
    const event = { stopPropagation: () => w.trace.push(['stop']) };
    await w.elements.get('floating-copy-btn').emit('click', event);
    w.context.prompt = () => 'note';
    await w.elements.get('floating-note-btn').emit('click', event);
    w.reader.model.activeHighlight = { id: 2, page: 7 };
    await w.elements.get('highlight-action-delete-btn').emit('click', event);
    w.reader.model.activeHighlight = { id: 3, page: 8, comment: 'old' };
    await w.elements.get('highlight-action-note-btn').emit('click', event);
    return { toolbar: clone(w.reader.floatingToolbar.style), menu: clone(w.reader.highlightActionMenu.style), active: w.reader.model.activeHighlight };
  });
});

test('quick palette positioning, unclamped subpixels and RAF timing match original', async () => {
  for (const bounds of [rect(100, 5, 90, 20), rect(-200, 200, 90, 20), rect(2000.25, 200.5, 90, 20)]) {
    for (const width of [100, 900]) await differential(async w => {
      const palette = new w.Element();
      w.elements.set('reader-quick-highlight-palette', palette);
      w.window.innerWidth = width;
      await w.annotations.openQuickHighlightPalette({ id: 3, color: 'yellow' }, 4, bounds);
      const before = clone(palette.style);
      const frameCount = w.frames.length;
      w.frames.forEach(fn => fn());
      return { before, after: clone(palette.style), frameCount, attributes: clone(palette.attributes) };
    });
  }
});

test('floating toolbar respects visible HUD boundaries, empty selection and fallback dimensions', async () => {
  for (const mode of ['hud-visible', 'hud-hidden', 'collapsed', 'empty', 'zero-bounds', 'empty-client-rects']) {
    await differential(async w => {
      w.context.bestSpan = null;
      const header = new w.Element(), footer = new w.Element();
      header.getBoundingClientRect = () => rect(0, 0, 900, 100);
      footer.getBoundingClientRect = () => rect(0, 500, 900, 200);
      header.classList.contains = footer.classList.contains = () => mode === 'hud-hidden';
      w.elements.set('reader-header', header);
      w.elements.set('reader-footer', footer);
      const bounds = mode === 'zero-bounds' ? rect(150, 470, 0, 0) : rect(150, 470, 60, 20);
      const { range, wrapper } = selection(mode === 'empty-client-rects' ? [] : [bounds], bounds);
      range.startContainer = { nodeType: 3, parentElement: { closest: () => wrapper } };
      range.cloneRange = () => range;
      w.window.getSelection = () => ({ isCollapsed: mode === 'collapsed', rangeCount: 1,
        toString: () => mode === 'empty' ? '  ' : 'quote', getRangeAt: () => range });
      await w.annotations.updateFloatingToolbar();
      const before = stylesExceptPosition(w.annotations.floatingToolbar.style);
      w.frames.forEach(fn => fn());
      return { before, after: stylesExceptPosition(w.annotations.floatingToolbar.style), frames: w.frames.length,
        selectedPage: w.reader.model.selectedPage, selectedRects: clone(w.reader.model.selectedRects) };
    });
  }
});

test('stale opens stop at each existing await guard and stale metadata is ignored', async () => {
  for (const stage of ['colors', 'cache', 'progress', 'mark', 'annotations']) await differential(async w => {
    const pending = deferred();
    let started = false;
    const block = () => { started = true; return pending.promise; };
    if (stage === 'colors') w.api.getColors = block;
    if (stage === 'cache') w.localDB.isPdfCached = block;
    if (stage === 'progress') w.api.getProgress = block;
    if (stage === 'mark') w.api.markBookOpened = block;
    if (stage === 'annotations') w.api.getAnnotations = block;
    const opening = w.reader.open(42);
    for (let i = 0; !started && i < 30; i++) await Promise.resolve();
    assert.ok(started, stage);
    w.reader.openSequence += 1;
    pending.resolve(stage === 'colors' || stage === 'annotations' ? [] : stage === 'progress' ? { current_page: 10 } : true);
    await opening;
    return { book: w.reader.model.bookId, page: w.reader.model.currentPage, sequence: w.reader.openSequence };
  });
  await differential(async w => {
    const pending = deferred();
    w.api.getBook = () => pending.promise;
    w.reader.updateBookInfo(42, 0);
    w.reader.openSequence = 1;
    pending.resolve({ title: 'Stale' });
    for (let i = 0; i < 5; i++) await Promise.resolve();
    return w.reader.openSequence;
  });
});

test('resource cleanup catches sync and async destroy failures without rejecting close', async () => {
  await differential(async w => {
    w.reader.destroyPdfResource(null);
    w.reader.destroyPdfResource({});
    w.reader.destroyPdfResource({ destroy() { throw new Error('sync destroy'); } });
    w.reader.destroyPdfResource({ destroy: () => Promise.reject(new Error('async destroy')) });
    for (let i = 0; i < 5; i++) await Promise.resolve();
    return w.reader.loadingTask;
  });
});

test('render mode dispatch and flow progress callback stay unchanged', async () => {
  for (const mode of ['notes', 'flow', 'dual', 'paginated']) await differential(async w => {
    w.reader.model.setBook(42, w.pdf, 23);
    w.reader.model.viewMode = mode;
    await w.reader.renderCurrentViewMode(7, { x: 100, y: 200 });
    return { page: w.reader.model.currentPage, delays: [...w.timers.values()].map(t => t.delay) };
  });
});

test('close still stops before sync and cleanup if immediate persistence fails', async () => {
  await differential(async w => {
    w.reader.model.setBook(42, w.pdf, 23);
    w.api.saveProgress = async () => { throw new Error('save failed'); };
    let error;
    try { await w.reader.close(); } catch (failure) { error = failure.message; }
    return { error, book: w.reader.model.bookId, display: w.reader.container.style.display };
  });
});

test('progress still debounces for 400ms and reads current state at execution', async () => {
  await differential(async w => {
    w.reader.model.setBook(42, w.pdf, 23);
    w.reader.debounceSaveProgress();
    const first = w.reader.progressDebounceTimer;
    w.reader.debounceSaveProgress();
    assert.ok(!w.timers.has(first));
    w.reader.model.setCurrentPage(12);
    const delays = [...w.timers.values()].map(t => t.delay);
    for (const timer of w.timers.values()) await timer.fn();
    return { delays };
  });
});

test('ReaderNativeSelectionLoupeController suppresses loupe on click and activates during drag selection', () => {
  const context = vm.createContext({
    document: {
      elementFromPoint: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {}
    },
    window: {
      addEventListener: () => {},
      getSelection: () => ({ collapse: () => {}, setBaseAndExtent: () => {} })
    },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    Element: class {},
    Node: { TEXT_NODE: 3 },
    NodeFilter: { SHOW_TEXT: 4 },
    ReaderSelectionLoupeView: class {
      constructor() { this.visible = false; this.updates = []; }
      update(x, y, pw) { this.visible = true; this.updates.push({ x, y, pw }); }
      hide() { this.visible = false; }
    }
  });

  vm.runInContext(source('models/ReaderModel.js'), context);
  loadNativeSelectionController(context);

  const model = new context.window.ReaderModel();
  const controller = new context.window.ReaderNativeSelectionLoupeController(model, null, null);

  const fakeNode = { textContent: 'Hello World', nodeType: 3 };
  const fakeSpan = { textContent: 'Hello World', contains: () => true };
  const fakeRect = { top: 10, bottom: 30, left: 10, right: 100, width: 90, height: 20 };
  const fakeWrapper = {
    isConnected: true,
    querySelectorAll: () => [fakeWrapper],
    getBoundingClientRect: () => ({ top: 0, bottom: 500, left: 0, right: 400 }),
    querySelector: () => ({
      querySelectorAll: () => [fakeSpan]
    })
  };

  controller.getPageWrapperAt = () => fakeWrapper;
  controller.findTextTargetWithinGap = (x, y, textLayer, gx, gy, isDragging) => {
    return { node: fakeNode, offset: Math.min(11, Math.max(0, Math.round((x - 10) / 10))), span: fakeSpan, rect: fakeRect };
  };

  const targetEl = new context.Element();
  targetEl.closest = () => null;

  // 1. Pointerdown (simple click start)
  controller.startSelection({ pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, clientX: 20, clientY: 20, target: targetEl });
  assert.equal(controller.loupe.visible, false, 'Loupe must NOT be visible immediately on pointerdown click');
  assert.equal(controller.isSelecting, false);

  // 2. Pointerup without moving (simple click finish)
  controller.endSelection({ clientX: 20, clientY: 20 });
  assert.equal(controller.loupe.visible, false, 'Loupe must remain hidden after simple click');
  assert.equal(controller.isSelecting, false);

  // 3. Pointerdown again, followed by dragging/moving across text
  controller.startSelection({ pointerId: 2, pointerType: 'mouse', isPrimary: true, button: 0, clientX: 20, clientY: 20, target: targetEl });
  assert.equal(controller.loupe.visible, false);

  controller.updateSelection({ pointerId: 2, buttons: 1, clientX: 60, clientY: 20 });
  assert.equal(controller.isSelecting, true, 'isSelecting should become true on drag');
  assert.equal(controller.loupe.visible, true, 'Loupe should be shown during drag selection');
  assert.equal(controller.loupe.updates.length > 0, true);

  // 4. Pointerup finishes selection and hides loupe
  controller.endSelection({ clientX: 60, clientY: 20 });
  assert.equal(controller.loupe.visible, false, 'Loupe must hide on pointerup');
});

test('ReaderNativeSelectionLoupeController resolves element and stale caret results to the word under the pointer', () => {
  let reportedCaret = null;
  const textNodes = new Map();
  const context = vm.createContext({
    document: {
      elementFromPoint: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {},
      caretPositionFromPoint: () => reportedCaret,
      createTreeWalker: element => ({ nextNode: () => textNodes.get(element) || null })
    },
    window: { addEventListener: () => {}, getSelection: () => null },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    Element: class {},
    Node: { TEXT_NODE: 3 },
    NodeFilter: { SHOW_TEXT: 4 },
    ReaderSelectionLoupeView: class { update() {} hide() {} }
  });
  vm.runInContext(source('models/ReaderModel.js'), context);
  loadNativeSelectionController(context);

  const words = [];
  const nodes = [];
  const textLayerParent = {};
  for (const [text, left, right] of [['The', 0, 30], ['granularity', 40, 130], ['Instagram', 140, 220]]) {
    const node = { textContent: text, nodeType: 3 };
    const bounds = rect(left, 10, right - left, 20);
    const span = { textContent: text, contains: candidate => candidate === node,
      closest: selector => selector === '.precise-word' ? span : selector === '.textLayer' ? textLayerParent : null,
      getBoundingClientRect: () => bounds, querySelectorAll: () => [] };
    node.parentElement = span;
    textNodes.set(span, node);
    words.push(span);
    nodes.push(node);
  }
  const line = { textContent: 'The granularity Instagram', contains: node => nodes.includes(node),
    getBoundingClientRect: () => rect(0, 10, 220, 20),
    querySelectorAll: selector => selector === '.precise-word' ? words : [] };
  textNodes.set(line, nodes[0]);
  const textLayer = { querySelectorAll: selector => selector === '.precise-line' ? [line] : [] };
  const controller = new context.window.ReaderNativeSelectionLoupeController(new context.window.ReaderModel(), null, null);
  for (const [x, caret] of [[180, { offsetNode: line, offset: 2 }], [180, { offsetNode: nodes[0], offset: 2 }],
    [138, { offsetNode: nodes[0], offset: 2 }]]) {
    reportedCaret = caret;
    const target = controller.findTextTargetWithinGap(x, 20, textLayer);
    assert.equal(target.node, nodes[2]);
    assert.equal(target.span, words[2]);
    assert.equal(controller.getWordBoundaries(target).fullText, 'Instagram');
  }
  reportedCaret = { offsetNode: line, offset: 2 };
  const directTarget = { closest: selector => selector === '.precise-word' ? words[2] : null };
  const directWord = controller.directWordTarget(directTarget, 180, 20);
  assert.equal(directWord.node, nodes[2]);
  assert.equal(controller.getWordBoundaries(directWord).fullText, 'Instagram');
});

test('ReaderNativeSelectionLoupeController uses the caret span in a PDF.js fallback text layer', () => {
  let caret = null;
  const context = vm.createContext({
    document: {
      caretPositionFromPoint: () => caret,
      createTreeWalker: element => ({ nextNode: () => element.node }),
      querySelectorAll: () => [],
      addEventListener: () => {}
    },
    window: { addEventListener: () => {}, getSelection: () => null },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    Node: { TEXT_NODE: 3 },
    NodeFilter: { SHOW_TEXT: 4 },
    ReaderSelectionLoupeView: class { update() {} hide() {} }
  });
  vm.runInContext(source('models/ReaderModel.js'), context);
  loadNativeSelectionController(context);

  const textLayer = { querySelectorAll: selector => selector === 'span' ? spans : [], contains: node => nodes.includes(node) };
  const nodes = [], spans = [];
  for (const [text, left, width] of [['The', 0, 30], ['quick', 40, 40], ['brown', 90, 50]]) {
    const node = { textContent: text, nodeType: 3 };
    const span = {
      textContent: text,
      getBoundingClientRect: () => rect(left, 10, width, 20),
      closest: selector => selector === 'span' ? span : selector === '.textLayer' ? textLayer : null,
      contains: candidate => candidate === node,
      querySelectorAll: () => [],
      node
    };
    node.parentElement = span;
    nodes.push(node);
    spans.push(span);
  }

  caret = { offsetNode: nodes[1], offset: 1 };
  const controller = new context.window.ReaderNativeSelectionLoupeController(new context.window.ReaderModel(), null, null);
  const target = controller.findTextTargetWithinGap(50, 15, textLayer, 80, 40, false);
  assert.equal(target.node, nodes[1]);
  assert.equal(target.offset, 1);
  assert.equal(target.span, spans[1]);
  assert.equal(controller.getWordBoundaries(target).fullText, 'quick');
});

test('ReaderNativeSelectionLoupeController uses the caret span in a PDF.js fallback text layer', () => {
  let caret = null;
  const context = vm.createContext({
    document: {
      caretPositionFromPoint: () => caret,
      createTreeWalker: element => ({ nextNode: () => element.node }),
      querySelectorAll: () => [],
      addEventListener: () => {}
    },
    window: { addEventListener: () => {}, getSelection: () => null },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    Node: { TEXT_NODE: 3 },
    NodeFilter: { SHOW_TEXT: 4 },
    ReaderSelectionLoupeView: class { update() {} hide() {} }
  });
  vm.runInContext(source('models/ReaderModel.js'), context);
  loadNativeSelectionController(context);

  const nodes = [], spans = [];
  const textLayer = { querySelectorAll: selector => selector === 'span' ? spans : [], contains: node => nodes.includes(node) };
  for (const [text, left, width] of [['The', 0, 30], ['quick', 40, 40], ['brown', 90, 50]]) {
    const node = { textContent: text, nodeType: 3 };
    const span = {
      textContent: text,
      getBoundingClientRect: () => rect(left, 10, width, 20),
      closest: selector => selector === 'span' ? span : selector === '.textLayer' ? textLayer : null,
      contains: candidate => candidate === node,
      querySelectorAll: () => [],
      node
    };
    node.parentElement = span;
    nodes.push(node);
    spans.push(span);
  }

  caret = { offsetNode: nodes[1], offset: 1 };
  const controller = new context.window.ReaderNativeSelectionLoupeController(new context.window.ReaderModel(), null, null);
  const target = controller.findTextTargetWithinGap(50, 15, textLayer, 80, 40, false);
  assert.equal(target.node, nodes[1]);
  assert.equal(target.offset, 1);
  assert.equal(target.span, spans[1]);
  assert.equal(controller.getWordBoundaries(target).fullText, 'quick');
});

test('ReaderNativeSelectionLoupeController fixes first-span double-clicks without collapsing drags', () => {
  const bodyListeners = new Map(), windowListeners = new Map();
  let lastSelection = null, lastCollapse = null, preventedEmptyHit = false, preventedMouseDown = 0;
  const context = vm.createContext({
    document: { elementFromPoint: () => null, querySelectorAll: () => [], addEventListener: () => {} },
    window: {
      addEventListener: (name, handler) => windowListeners.set(name, handler),
      getSelection: () => ({
        setBaseAndExtent: (...args) => { lastSelection = args; },
        collapse: (...args) => { lastCollapse = args; }
      })
    },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    Element: class {},
    Node: { TEXT_NODE: 3, DOCUMENT_POSITION_FOLLOWING: 4, DOCUMENT_POSITION_PRECEDING: 2 },
    NodeFilter: { SHOW_TEXT: 4 },
    ReaderSelectionLoupeView: class { update() {} hide() {} }
  });
  vm.runInContext(source('models/ReaderModel.js'), context);
  loadNativeSelectionController(context);

  const word1 = { textContent: 'granularity', nodeType: 3 };
  const word2 = { textContent: 'organization', nodeType: 3 };
  word1.compareDocumentPosition = other => other === word2 ? 4 : 0;
  word2.compareDocumentPosition = other => other === word1 ? 2 : 0;
  const span1 = { textContent: word1.textContent, contains: node => node === word1,
    closest: selector => selector === '.precise-word' ? span1 : null };
  const span2 = { textContent: word2.textContent, contains: node => node === word2,
    closest: selector => selector === '.precise-word' ? span2 : null };
  word1.parentElement = span1;
  word2.parentElement = span2;
  const target = new context.Element();
  target.closest = () => null;
  const textLayer = {};
  const wrapper = { isConnected: true, querySelector: () => textLayer };
  const body = { addEventListener: (name, handler) => bodyListeners.set(name, handler) };
  const controller = new context.window.ReaderNativeSelectionLoupeController(new context.window.ReaderModel(), {}, body);
  controller.bindEvents();
  controller.getPageWrapperAt = () => wrapper;
  let forceFocusToFirstWord = false;
  controller.findTextTargetWithinGap = x => x < 100 || forceFocusToFirstWord
    ? { node: word1, offset: 4, span: span1 }
    : { node: word2, offset: 5, span: span2 };

  const down = { target, pointerId: 7, pointerType: 'mouse', isPrimary: true, button: 0,
    detail: 2, clientX: 50, clientY: 20, preventDefault() { preventedMouseDown += 1; } };
  bodyListeners.get('pointerdown')(down);
  bodyListeners.get('mousedown')(down);
  assert.equal(preventedMouseDown, 1, 'native mousedown selection must not replace the custom anchor');
  assert.deepStrictEqual(lastSelection, [word1, 0, word1, word1.textContent.length]);

  windowListeners.get('pointermove')({ pointerId: 7, buttons: 1, clientX: 150, clientY: 20 });
  assert.deepStrictEqual(lastSelection, [word1, 0, word2, word2.textContent.length]);
  windowListeners.get('pointerup')({ pointerId: 7 });
  windowListeners.get('mouseup')({});
  assert.deepStrictEqual(lastSelection, [word1, 0, word2, word2.textContent.length],
    'release must not collapse the expanded word selection back to the cursor word');
  let clickPrevented = false;
  bodyListeners.get('click')({ target, detail: 2, clientX: 150, clientY: 20, preventDefault() { clickPrevented = true; } });
  assert.equal(clickPrevented, false, 'a drag ending in a double click must preserve its expanded range');
  assert.deepStrictEqual(lastSelection, [word1, 0, word2, word2.textContent.length]);

  bodyListeners.get('pointerdown')({ ...down, clientX: 150 });
  bodyListeners.get('mousedown')({ ...down, clientX: 150 });
  forceFocusToFirstWord = true;
  windowListeners.get('pointermove')({ pointerId: 7, buttons: 1, clientX: 155, clientY: 20 });
  windowListeners.get('pointerup')({ pointerId: 7 });
  windowListeners.get('mouseup')({});
  assert.equal(controller.completedSelectionDrag, false,
    'a range difference without physical pointer movement is not a drag');
  forceFocusToFirstWord = false;
  lastSelection = [word1, 0, word2, word2.textContent.length];
  bodyListeners.get('click')({ target, detail: 2, clientX: 150, clientY: 20, preventDefault() { clickPrevented = true; } });
  assert.equal(clickPrevented, true, 'a stationary double click must replace a range anchored on the first span');
  assert.deepStrictEqual(lastSelection, [word2, 0, word2, word2.textContent.length]);

  const directTextTarget = new context.Element();
  directTextTarget.closest = selector => selector.includes('.textLayer') ? span2 : null;
  controller.findTextTargetWithinGap = () => ({ node: word2, offset: 6, span: span2 });
  let preventedSingleClick = false;
  bodyListeners.get('mousedown')({ ...down, target: directTextTarget, detail: 1, clientX: 150,
    preventDefault() { preventedSingleClick = true; } });
  assert.equal(preventedSingleClick, true, 'simple text clicks must suppress the browser anchor default');
  assert.deepStrictEqual(lastCollapse, [word2, 6]);

  controller.findTextTargetWithinGap = () => null;
  bodyListeners.get('mousedown')({ ...down, preventDefault: () => { preventedEmptyHit = true; } });
  assert.equal(preventedEmptyHit, true, 'empty page margins must not start native container selection');
});

test('ReaderNativeSelectionLoupeController preserves full initial word and expands word-by-word on double-click drag', () => {
  let lastSelection = null;
  const context = vm.createContext({
    document: {
      elementFromPoint: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {}
    },
    window: {
      addEventListener: () => {},
      getSelection: () => ({
        collapse: () => {},
        setBaseAndExtent: (startNode, startOffset, endNode, endOffset) => {
          lastSelection = { startNode, startOffset, endNode, endOffset };
        }
      })
    },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    Element: class {},
    Node: {
      TEXT_NODE: 3,
      DOCUMENT_POSITION_FOLLOWING: 4,
      DOCUMENT_POSITION_PRECEDING: 2,
      DOCUMENT_POSITION_CONTAINED_BY: 16,
      DOCUMENT_POSITION_CONTAINS: 8
    },
    NodeFilter: { SHOW_TEXT: 4 },
    ReaderSelectionLoupeView: class {
      constructor() { this.visible = false; this.updates = []; }
      update(x, y, pw) { this.visible = true; this.updates.push({ x, y, pw }); }
      hide() { this.visible = false; }
    }
  });

  vm.runInContext(source('models/ReaderModel.js'), context);
  vm.runInContext(source('viewmodels/reader/ReaderNativeSelectionLoupeController.js'), context);

  const model = new context.window.ReaderModel();
  const controller = new context.window.ReaderNativeSelectionLoupeController(model, null, null);

  const word1 = { textContent: 'timeline,', nodeType: 3, compareDocumentPosition: other => (other === word2 ? 4 : 0) };
  const span1 = { textContent: 'timeline,', contains: () => true, closest: sel => (sel === '.precise-word' ? span1 : null) };
  const word2 = { textContent: 'search.', nodeType: 3, compareDocumentPosition: other => (other === word1 ? 2 : 0) };
  const span2 = { textContent: 'search.', contains: () => true, closest: sel => (sel === '.precise-word' ? span2 : null) };

  const fakeWrapper = {
    isConnected: true,
    querySelectorAll: () => [fakeWrapper],
    getBoundingClientRect: () => ({ top: 0, bottom: 500, left: 0, right: 400 }),
    querySelector: () => ({ querySelectorAll: () => [span1, span2] })
  };

  controller.getPageWrapperAt = () => fakeWrapper;

  const targetEl = new context.Element();
  targetEl.closest = () => null;

  // 1. Double click on middle of word1 (offset 3)
  controller.findTextTargetWithinGap = () => ({ node: word1, offset: 3, span: span1, rect: { top: 10, bottom: 30, left: 10, right: 60 } });
  controller.startSelection({ pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, clientX: 30, clientY: 20, detail: 2, target: targetEl });

  assert.equal(controller.clickDetail, 2);
  assert.equal(controller.anchorWord.startNode, word1);
  assert.equal(controller.anchorWord.startOffset, 0);
  assert.equal(controller.anchorWord.endNode, word1);
  assert.equal(controller.anchorWord.endOffset, 9);
  assert.equal(controller.anchorWord.fullText, 'timeline,');

  // 2. Drag forward to word2
  controller.findTextTargetWithinGap = () => ({ node: word2, offset: 2, span: span2, rect: { top: 10, bottom: 30, left: 70, right: 120 } });
  controller.updateSelection({ pointerId: 1, buttons: 1, clientX: 90, clientY: 20 });

  assert.equal(lastSelection.startNode, word1, 'Forward drag startNode must be word1');
  assert.equal(lastSelection.startOffset, 0, 'Forward drag startOffset must be 0');
  assert.equal(lastSelection.endNode, word2, 'Forward drag endNode must be word2');
  assert.equal(lastSelection.endOffset, 7, 'Forward drag endOffset must be word2 end');

  // 3. Drag backward before word1
  const word0 = { textContent: 'the', nodeType: 3, compareDocumentPosition: other => (other === word1 ? 4 : 0) };
  word1.compareDocumentPosition = other => (other === word0 ? 2 : other === word2 ? 4 : 0);
  const span0 = { textContent: 'the', contains: () => true, closest: sel => (sel === '.precise-word' ? span0 : null) };

  controller.findTextTargetWithinGap = () => ({ node: word0, offset: 1, span: span0, rect: { top: 10, bottom: 30, left: -40, right: 0 } });
  controller.updateSelection({ pointerId: 1, buttons: 1, clientX: -20, clientY: 20 });

  assert.equal(lastSelection.startNode, word1, 'Backward drag startNode must be word1');
  assert.equal(lastSelection.startOffset, 9, 'Backward drag startOffset must be word1 end');
  assert.equal(lastSelection.endNode, word0, 'Backward drag endNode must be word0');
  assert.equal(lastSelection.endOffset, 0, 'Backward drag endOffset must be word0 start');

  controller.endSelection({ clientX: -20, clientY: 20 });
  assert.equal(controller.anchorWord, null);
  assert.equal(controller.clickDetail, 1);
});

test('ReaderToolbarManager wheel zoom uses fast 0.25 step with delta intensity scaling', () => {
  const frames = [];
  const registeredListeners = [];
  let currentZoom = null;

  const context = vm.createContext({
    document: {
      getElementById: () => ({ addEventListener: () => {} }),
      addEventListener: () => {}
    },
    window: {
      addEventListener: (type, fn, opts) => registeredListeners.push({ type, fn, opts }),
      innerHeight: 800
    },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    Element: class {},
    requestAnimationFrame: fn => { frames.push(fn); return 1; }
  });

  vm.runInContext(source('models/ReaderModel.js'), context);
  vm.runInContext(source('viewmodels/reader/ReaderToolbarManager.js'), context);

  const model = new context.window.ReaderModel();
  model.scale = 1.0;
  const container = { style: { display: 'flex' } };
  const viewportEl = { classList: { remove: () => {} } };
  const nav = { setZoom: (scale, clearFit, focal) => { currentZoom = scale; } };

  const toolbar = new context.window.ReaderToolbarManager(model, { container, viewportEl }, { nav });
  toolbar.bindWheelZoom();

  const wheelListener = registeredListeners.find(l => l.type === 'wheel')?.fn;
  assert.ok(wheelListener, 'Wheel listener must be registered');

  // Single wheel tick up (zoom in)
  const eventIn = { ctrlKey: true, metaKey: false, deltaY: -100, clientX: 100, clientY: 100, preventDefault: () => {} };
  wheelListener(eventIn);
  assert.equal(frames.length, 1);
  frames.shift()();
  assert.equal(currentZoom, 1.25, 'Zoom in should step by +0.25 on standard wheel tick');

  // Single wheel tick down (zoom out) from 1.25
  model.scale = 1.25;
  const eventOut = { ctrlKey: true, metaKey: false, deltaY: 100, clientX: 100, clientY: 100, preventDefault: () => {} };
  wheelListener(eventOut);
  frames.shift()();
  assert.equal(currentZoom, 1.0, 'Zoom out should step by -0.25 on standard wheel tick');
});

test('ReaderToolbarManager continuous trackpad pinch zoom scales proportionally without discrete jumps', () => {
  const frames = [];
  const registeredListeners = [];
  let currentZoom = null;
  let currentFocal = null;

  const context = vm.createContext({
    document: {
      getElementById: () => ({ addEventListener: () => {} }),
      addEventListener: () => {}
    },
    window: {
      addEventListener: (type, fn, opts) => registeredListeners.push({ type, fn, opts }),
      innerHeight: 800
    },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    Element: class {},
    requestAnimationFrame: fn => { frames.push(fn); return 1; }
  });

  vm.runInContext(source('models/ReaderModel.js'), context);
  vm.runInContext(source('viewmodels/reader/ReaderToolbarManager.js'), context);

  const model = new context.window.ReaderModel();
  model.scale = 1.0;
  const container = { style: { display: 'flex' } };
  const viewportEl = { classList: { remove: () => {} } };
  const nav = { setZoom: (scale, clearFit, focal) => { currentZoom = scale; currentFocal = focal; } };

  const toolbar = new context.window.ReaderToolbarManager(model, { container, viewportEl }, { nav });
  toolbar.bindWheelZoom();

  const wheelListener = registeredListeners.find(l => l.type === 'wheel')?.fn;
  assert.ok(wheelListener, 'Wheel listener must be registered');

  // Small trackpad pinch movement (deltaY: -15, slow gentle pinch)
  wheelListener({ ctrlKey: true, metaKey: false, deltaY: -15, clientX: 250, clientY: 350, preventDefault: () => {} });
  assert.equal(frames.length, 1);
  frames.shift()();
  assert.ok(currentZoom > 1.0 && currentZoom < 1.10, 'Expected continuous fractional zoom, got ' + currentZoom);
  assert.equal(currentFocal?.clientX, 250);
  assert.equal(currentFocal?.clientY, 350);

  // Faster trackpad pinch movement (deltaY: -60, higher velocity)
  model.scale = 1.0;
  wheelListener({ ctrlKey: true, metaKey: false, deltaY: -60, clientX: 300, clientY: 400, preventDefault: () => {} });
  assert.equal(frames.length, 1);
  frames.shift()();
  assert.ok(currentZoom > 1.10, 'Faster pinch velocity should yield larger continuous zoom, got ' + currentZoom);
});

test('TextLayerView keeps the text layer selectable without leaking selection into empty containers', () => {
  let selectionStyle = null;
  const context = vm.createContext({
    document: {
      head: { appendChild: style => { selectionStyle = style; } },
      getElementById: () => null,
      createElement: () => ({ id: '', textContent: '' })
    },
    window: {}
  });
  vm.runInContext(source('views/reader/TextLayerView.js'), context);
  context.window.TextLayerView._ensureSelectionStyles();
  assert.match(selectionStyle.textContent, /\.textLayer\s*\{[^}]*user-select:\s*text\s*!important;/);
  assert.doesNotMatch(selectionStyle.textContent, /\.textLayer\s*\{[^}]*user-select:\s*none\s*!important;/);
  assert.match(selectionStyle.textContent, /\.textLayer :is\(\.precise-line, \.precise-word, \.precise-space, span\)\s*\{[^}]*user-select:\s*text\s*!important;/);
});

test('TextLayerView renders 3-phase subpixel layout with precise words, spaces, and linebreaks', () => {
  class MockElement {
    constructor(tagName = 'div') {
      this.tagName = tagName;
      this.style = {};
      this.dataset = {};
      this.children = [];
      this.childNodes = [];
      this.attributes = {};
    }
    appendChild(child) {
      this.childNodes.push(child);
      if (child instanceof MockElement) {
        this.children.push(child);
      }
      return child;
    }
    setAttribute(name, val) {
      this.attributes[name] = val;
    }
    getBoundingClientRect() {
      const textLen = this.textContent ? this.textContent.length : 0;
      return { width: textLen * 8, height: 16, top: 0, left: 0, right: textLen * 8, bottom: 16 };
    }
    querySelectorAll(selector) {
      const res = [];
      for (const ch of this.children) {
        if (selector === '.precise-word' && ch.className === 'precise-word') res.push(ch);
        if (selector === '.precise-space' && ch.className === 'precise-space') res.push(ch);
        if (selector === '.precise-line' && ch.className === 'precise-line') res.push(ch);
        res.push(...ch.querySelectorAll(selector));
      }
      return res;
    }
  }

  class MockTextNode {
    constructor(text) {
      this.textContent = text;
      this.nodeType = 3;
    }
  }

  const context = vm.createContext({
    document: {
      createElement: tag => new MockElement(tag),
      createTextNode: text => new MockTextNode(text)
    },
    window: {}
  });

  vm.runInContext(source('views/reader/TextLayerView.js'), context);
  const TextLayerView = context.window.TextLayerView;

  // 1. Test groupWordsIntoLines preserves words array
  const rawWords = [
    { text: 'Hello', x0: 10, y0: 20, x1: 50, y1: 35, block: 0, line: 0, word: 0 },
    { text: 'World', x0: 55, y0: 20, x1: 95, y1: 35, block: 0, line: 0, word: 1 }
  ];
  const groupedLines = TextLayerView.groupWordsIntoLines(rawWords);
  assert.equal(groupedLines.length, 1);
  assert.equal(groupedLines[0].text, 'Hello World');
  assert.equal(groupedLines[0].words.length, 2);
  assert.equal(groupedLines[0].x0, 10);
  assert.equal(groupedLines[0].x1, 95);

  // 2. Test renderPreciseLines 3-phase execution
  const container = new MockElement('div');
  TextLayerView.renderPreciseLines(container, groupedLines, 1.5);

  assert.equal(container.children.length, 1);
  const lineSpan = container.children[0];
  assert.equal(lineSpan.className, 'precise-line');
  assert.equal(lineSpan.style.left, '15px'); // 10 * 1.5
  assert.equal(lineSpan.style.top, '30px');  // 20 * 1.5
  assert.equal(lineSpan.style.width, '127.5px'); // (95 - 10) * 1.5

  // Check Phase 1: precise words
  const words = lineSpan.querySelectorAll('.precise-word');
  assert.equal(words.length, 2);
  assert.equal(words[0].textContent, 'Hello');
  assert.equal(words[0].style.left, '0px'); // (10 - 10) * 1.5
  assert.equal(words[1].textContent, 'World');
  assert.equal(words[1].style.left, '67.5px'); // (55 - 10) * 1.5

  // Check Phase 2: precise space
  const spaces = lineSpan.querySelectorAll('.precise-space');
  assert.equal(spaces.length, 1);
  assert.equal(spaces[0].style.left, '60px'); // (50 - 10) * 1.5
  // The layout engine now measures " " and scales it, width is not forced to gap * scale directly.
  assert.equal(spaces[0].attributes['role'], 'presentation');

  // Check Phase 3: trailing newline text node inside a positioning span
  const lastChild = lineSpan.childNodes[lineSpan.childNodes.length - 1];
  assert.equal(lastChild.className, 'precise-linebreak');
  assert.equal(lastChild.style.position, 'absolute');
  assert.equal(lastChild.style.left, '127.5px');
  assert.equal(lastChild.textContent, '\n');
});

test('ReaderModel.getPageAnnotations matches string and numeric page numbers and getColorMetadata matches case-insensitively', () => {
  const context = vm.createContext({
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    window: {}
  });
  vm.runInContext(source('models/ReaderModel.js'), context);
  const model = new context.window.ReaderModel();
  model.setAnnotations([
    { id: 'a1', page: 2, color: 'Green', text: 'Sample definition' },
    { id: 'a2', page: 3, color: 'blue', text: 'Sample reference' }
  ]);

  // Matches numeric 2
  assert.equal(model.getPageAnnotations(2).length, 1);
  // Matches string "2" (e.g. from dataset.page)
  assert.equal(model.getPageAnnotations('2').length, 1);
  assert.equal(model.getPageAnnotations('2')[0].id, 'a1');

  // Case-insensitive color lookup
  const greenMeta = model.getColorMetadata('GREEN');
  assert.equal(greenMeta.id, 'green');
  assert.equal(greenMeta.name, 'Definition');

  const blueMeta = model.getColorMetadata('Blue');
  assert.equal(blueMeta.id, 'blue');
  assert.equal(blueMeta.name, 'Reference');
});

test('ReaderAnnotationViewModel.changeHighlightColor updates model and DOM immediately and targets annot.page', async () => {
  const dummyEl = {
    style: { backgroundColor: '#fef08a' },
    dataset: { annotationId: 'test-annot-1' }
  };

  let updatedPage = null;
  let updatedPayload = null;

  const context = vm.createContext({
    document: {
      querySelectorAll: (sel) => {
        if (sel.includes('data-annotation-id="test-annot-1"')) return [dummyEl];
        return [];
      },
      getElementById: () => null
    },
    window: {},
    api: {
      updateAnnotation: async (id, data) => { updatedPayload = { id, data }; },
      getAnnotations: async () => [{ id: 'test-annot-1', page: 5, color: 'blue', category: 'Reference' }]
    },
    ReaderSelectionGeometry: {
      quickPalettePosition: () => ({ left: 0, top: 0, opensBelow: false })
    },
    ReaderModel: class {
      constructor() {
        this.currentPage = 1; // Reader currently at page 1
        this.annotations = [{ id: 'test-annot-1', page: 5, color: 'yellow', category: 'Key Idea' }];
        this.colors = [
          { id: 'yellow', name: 'Key Idea', color: '#fef08a' },
          { id: 'blue', name: 'Reference', color: '#bfdbfe' }
        ];
      }
      getColorMetadata(id) {
        return this.colors.find(c => c.id.toLowerCase() === String(id).toLowerCase()) || this.colors[0];
      }
      setAnnotations(annots) { this.annotations = annots; }
    }
  });

  vm.runInContext(source('viewmodels/reader/ReaderAnnotationViewModel.js'), context);

  const model = new context.ReaderModel();
  const vmInstance = new context.window.ReaderAnnotationViewModel(
    model,
    { querySelector: () => null },
    {},
    {}
  );
  vmInstance.refreshPageHighlights = (page) => { updatedPage = page; };
  vmInstance.renderDrawerAnnotations = () => {};

  // Calling changeHighlightColor without passing pageNumber (simulating openHighlightMenu dot click)
  await vmInstance.changeHighlightColor('test-annot-1', 'blue');

  // 1. Direct DOM update was applied immediately
  assert.equal(dummyEl.style.backgroundColor, '#bfdbfe');
  // 2. Target page was annot.page (5), NOT currentPage (1)
  assert.equal(updatedPage, 5);
  // 3. Backend was called with blue and Reference
  assert.equal(updatedPayload.id, 'test-annot-1');
  assert.equal(updatedPayload.data.color, 'blue');
  assert.equal(updatedPayload.data.category, 'Reference');
  // 4. Model annotations updated
  assert.equal(model.annotations[0].color, 'blue');
  assert.equal(model.annotations[0].category, 'Reference');
});

test('HighlightColorSettingsManager.save synchronizes palette with window.reader and refreshes highlights', async () => {
  let savedColors = null;
  let refreshedPages = [];
  let drawerRefreshed = false;

  const mockReader = {
    model: {
      bookId: 42,
      colors: [],
      viewMode: 'paginated',
      setColors(c) { this.colors = c; }
    },
    annotations: {
      renderFloatingColors: () => {},
      refreshPageHighlights: (page) => { refreshedPages.push(page); },
      renderDrawerAnnotations: () => { drawerRefreshed = true; }
    }
  };

  const pageWrapper = {
    dataset: { page: '3' },
    id: 'pdf-page-3'
  };

  const context = vm.createContext({
    document: {
      getElementById: (id) => {
        if (id === 'colors-modal') return {};
        if (id === 'colors-status') return { textContent: '' };
        if (id === 'colors-save-btn') return { disabled: false };
        return null;
      },
      querySelectorAll: (sel) => {
        if (sel === '#colors-list .highlight-color-row') {
          return [{
            dataset: { colorId: 'yellow' },
            querySelector: (q) => {
              if (q === '.highlight-color-name') return { value: 'Idea Principal' };
              if (q === '.highlight-color-value') return { value: '#ffee00' };
              return null;
            }
          }];
        }
        if (sel === '.pdf-page-wrapper') return [pageWrapper];
        return [];
      }
    },
    window: {
      reader: mockReader
    },
    api: {
      saveColors: async (c) => { savedColors = c; }
    },
    ModalView: { close: () => {} }
  });

  vm.runInContext(source('viewmodels/library/HighlightColorSettingsManager.js'), context);

  const manager = new context.window.HighlightColorSettingsManager();
  manager.colors = [{ id: 'yellow', name: 'Key Idea', color: '#fef08a' }];

  await manager.save();

  assert.equal(savedColors.length, 1);
  assert.equal(savedColors[0].name, 'Idea Principal');
  assert.equal(savedColors[0].color, '#ffee00');
  // Check synchronization with window.reader
  assert.equal(mockReader.model.colors[0].name, 'Idea Principal');
  assert.equal(refreshedPages.includes(3), true);
  assert.equal(drawerRefreshed, true);
});
