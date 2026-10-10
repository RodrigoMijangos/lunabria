'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const frontend = path.resolve(__dirname, '..');
const loadedScripts = new WeakMap();
const scriptDependencies = new Map([
  ['js/mobile/MobileSelectionController.js', ['js/services/reader/ReaderTextTargetGeometry.js']],
  ['js/viewmodels/reader/ReaderNativeSelectionLoupeController.js', ['js/services/reader/ReaderTextTargetGeometry.js']],
  ['js/viewmodels/reader/ReaderDrawingViewModel.js', [
    'js/viewmodels/reader/ReaderDrawingInteractionController.js',
    'js/viewmodels/reader/ReaderDrawingPersistenceController.js',
    'js/viewmodels/reader/ReaderDrawingToolController.js'
  ]]
]);

function loadScript(context, relativePath) {
  let loaded = loadedScripts.get(context);
  if (!loaded) {
    loaded = new Set();
    loadedScripts.set(context, loaded);
  }
  if (loaded.has(relativePath)) return;
  for (const dependency of scriptDependencies.get(relativePath) || []) {
    loadScript(context, dependency);
  }
  const code = fs.readFileSync(path.join(frontend, relativePath), 'utf8');
  vm.runInContext(code, context, { filename: relativePath });
  loaded.add(relativePath);
}

function createDOMContext() {
  class EventTargetStub {
    constructor() { this.listeners = new Map(); }
    addEventListener(type, handler) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(handler);
    }
    removeEventListener(type, handler) {
      if (this.listeners.has(type)) {
        this.listeners.set(type, this.listeners.get(type).filter(h => h !== handler));
      }
    }
    async emit(type, properties = {}) {
      const event = {
        type,
        target: this,
        currentTarget: this,
        defaultPrevented: false,
        propagationStopped: false,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() { this.propagationStopped = true; },
        ...properties
      };
      for (const handler of this.listeners.get(type) || []) await handler(event);
      return event;
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
      this.innerHTML = '';
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
    getAttribute(name) { return this.attributes[name]; }
    querySelector() { return null; }
    querySelectorAll() { return []; }
    closest() { return null; }
    contains(other) {
      if (other === this) return true;
      for (const child of this.children) {
        if (child === other || (child.contains && child.contains(other))) return true;
      }
      return false;
    }
    getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 1000 }; }
    setPointerCapture() {}
    releasePointerCapture() {}
  }

  const elementsById = new Map();
  const getOrCreate = (id, tag = 'div', attrs = {}) => {
    if (!elementsById.has(id)) {
      elementsById.set(id, new ElementStub(tag, { id, ...attrs }));
    }
    return elementsById.get(id);
  };

  // Pre-populate mobile toolbar elements
  getOrCreate('mobile-draw-fab-container');
  getOrCreate('mobile-draw-main-btn', 'button');
  getOrCreate('mobile-draw-main-icon', 'span');
  getOrCreate('mobile-draw-undo-btn', 'button');
  getOrCreate('mobile-draw-tools-drawer');
  getOrCreate('mobile-tool-pen', 'button');
  getOrCreate('mobile-tool-eraser', 'button');
  getOrCreate('mobile-tool-pan', 'button');
  getOrCreate('mobile-color-contextual-menu');
  getOrCreate('pdf-viewport');
  getOrCreate('reader-body');
  getOrCreate('reader-selection-loupe');
  getOrCreate('floating-toolbar');

  const currentSelection = {
    ranges: [],
    get rangeCount() { return this.ranges.length; },
    getRangeAt(i) { return this.ranges[i] || null; },
    addRange(r) { this.ranges.push(r); },
    removeAllRanges() { this.ranges = []; },
    toString() { return this.ranges.map(r => r.toString()).join(''); },
    setBaseAndExtent(startNode, startOffset, endNode, endOffset) {
      this.ranges = [{
        startContainer: startNode,
        startOffset,
        endContainer: endNode,
        endOffset,
        cloneRange() { return this; },
        toString() { return startNode?.textContent || ''; },
        getClientRects() { return [{ left: 10, top: 20, width: 100, height: 16 }]; },
        getBoundingClientRect() { return { left: 10, top: 20, width: 100, height: 16 }; }
      }];
    }
  };

  const documentStub = new EventTargetStub();
  documentStub.body = new ElementStub('body');
  documentStub.getElementById = (id) => elementsById.get(id) || null;
  documentStub.createElement = (tag) => new ElementStub(tag);
  documentStub.querySelector = (sel) => null;
  documentStub.querySelectorAll = (sel) => [];
  documentStub.elementsFromPoint = (x, y) => [];
  documentStub.createRange = () => ({
    startContainer: null,
    startOffset: 0,
    endContainer: null,
    endOffset: 0,
    setStart(node, offset) { this.startContainer = node; this.startOffset = offset; },
    setEnd(node, offset) { this.endContainer = node; this.endOffset = offset; },
    selectNodeContents(el) {
      this.startContainer = el.firstChild || el;
      this.startOffset = 0;
      this.endContainer = el.lastChild || el;
      this.endOffset = (el.textContent || '').length;
    },
    cloneRange() { return { ...this }; },
    toString() { return this.startContainer?.textContent || ''; },
    getClientRects() { return [{ left: 10, top: 20, width: 100, height: 16 }]; },
    getBoundingClientRect() { return { left: 10, top: 20, width: 100, height: 16 }; }
  });

  const context = vm.createContext({
    console,
    Date,
    Math,
    Set,
    Map,
    Array,
    Object,
    Number,
    Boolean,
    String,
    clearTimeout,
    setTimeout,
    document: documentStub,
    localDB: {
      savePageDrawings: async () => {},
      getPageDrawings: async () => []
    },
    api: {
      savePageDrawings: async () => {},
      getPageDrawings: async () => []
    },
    navigator: {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)',
      maxTouchPoints: 5
    },
    window: (() => {
      const w = new EventTargetStub();
      w.innerWidth = 375;
      w.innerHeight = 667;
      w.devicePixelRatio = 2;
      w.getSelection = () => currentSelection;
      w.navigator = {
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)',
        maxTouchPoints: 5
      };
      return w;
    })(),
    localStorage: {
      getItem: () => null,
      setItem: () => {}
    }
  });
  context.window.document = documentStub;
  context.Element = ElementStub;
  context.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };

  return { context, elementsById, documentStub, currentSelection };
}

test('MobileDrawingToolbarView excludes active tool from drawer and syncs drawing state', () => {
  const { context, elementsById } = createDOMContext();

  loadScript(context, 'js/models/ReaderModel.js');
  loadScript(context, 'js/views/reader/DrawingCanvasView.js');
  loadScript(context, 'js/views/reader/ReaderHUDView.js');
  loadScript(context, 'js/viewmodels/reader/ReaderTextHighlightController.js');
  loadScript(context, 'js/viewmodels/reader/ReaderDrawingViewModel.js');
  loadScript(context, 'js/mobile/MobileDrawingToolbarView.js');

  const ReaderModel = context.window.ReaderModel || context.ReaderModel;
  const MobileDrawingToolbarView = context.window.MobileDrawingToolbarView || context.MobileDrawingToolbarView;

  const model = new ReaderModel();
  const fakeReader = {
    drawing: {
      setDrawTool: (tool) => { model.setDrawTool(tool); },
      setDrawColor: (c) => { model.setDrawColor(c); },
      undoLastStroke: () => {},
      toggleDrawMode: () => true
    },
    viewportEl: elementsById.get('pdf-viewport')
  };

  const fab = new MobileDrawingToolbarView(fakeReader, model);
  fab.init();

  const penBtn = elementsById.get('mobile-tool-pen');
  const eraserBtn = elementsById.get('mobile-tool-eraser');
  const panBtn = elementsById.get('mobile-tool-pan');

  // Case 1: Initial tool is pen (default in ReaderModel)
  model.setDrawTool('pen');
  fab.render();
  assert.equal(penBtn.style.display, 'none', 'Pen must be hidden from drawer when pen is active');
  assert.equal(eraserBtn.style.display, 'flex', 'Eraser must be visible in drawer when pen is active');
  assert.equal(panBtn.style.display, 'flex', 'Pan must be visible in drawer when pen is active');

  // Case 2: Switch to eraser
  model.setDrawTool('eraser');
  fab.render();
  assert.equal(penBtn.style.display, 'flex', 'Pen must be visible in drawer when eraser is active');
  assert.equal(eraserBtn.style.display, 'none', 'Eraser must be hidden from drawer when eraser is active');
  assert.equal(panBtn.style.display, 'flex', 'Pan must be visible in drawer when eraser is active');

  // Case 3: Switch to pan (move)
  model.setDrawTool('pan');
  fab.render();
  assert.equal(penBtn.style.display, 'flex', 'Pen must be visible in drawer when pan is active');
  assert.equal(eraserBtn.style.display, 'flex', 'Eraser must be visible in drawer when pan is active');
  assert.equal(panBtn.style.display, 'none', 'Pan must be hidden from drawer when pan is active');
});

test('ReaderDrawingViewModel allows touch drawing on mobile reader bypassing strict palm rejection', () => {
  const { context, elementsById, documentStub } = createDOMContext();

  loadScript(context, 'js/models/ReaderModel.js');
  loadScript(context, 'js/views/reader/DrawingCanvasView.js');
  loadScript(context, 'js/views/reader/ReaderHUDView.js');
  loadScript(context, 'js/views/reader/ReaderSelectionLoupeView.js');
  loadScript(context, 'js/viewmodels/reader/ReaderTextHighlightController.js');
  loadScript(context, 'js/viewmodels/reader/ReaderDrawingViewModel.js');

  const ReaderModel = context.window.ReaderModel || context.ReaderModel;
  const ReaderDrawingViewModel = context.window.ReaderDrawingViewModel || context.ReaderDrawingViewModel;

  const model = new ReaderModel();
  // Ensure strict palm rejection setting is present
  model.setAccessibilitySetting('palmRejection', 'strict');
  model.setDrawTool('pen');

  const viewportEl = elementsById.get('pdf-viewport');
  const bodyEl = elementsById.get('reader-body');
  const fakeReader = {
    mobile: {
      device: {
        isMobileReaderActive: () => true
      }
    }
  };

  const drawingVM = new ReaderDrawingViewModel(model, viewportEl, bodyEl, () => null, fakeReader);

  const pageWrapper = new context.Element('div');
  const drawCanvas = new context.Element('canvas');
  drawCanvas.getContext = () => ({
    clearRect() {},
    save() {},
    restore() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    quadraticCurveTo() {},
    stroke() {},
    fill() {},
    arc() {}
  });

  // Simulate touch pointerdown on mobile reader
  const touchDownEvent = {
    type: 'pointerdown',
    pointerType: 'touch',
    pointerId: 1,
    clientX: 100,
    clientY: 150,
    pressure: 0.5,
    button: 0,
    buttons: 1,
    target: drawCanvas,
    preventDefault() {},
    stopPropagation() {}
  };

  drawingVM.handleDrawingPointerDown(touchDownEvent, 1, pageWrapper, drawCanvas, 1, 1);

  assert.equal(drawingVM.isDrawing, true, 'Touch pointerdown must start drawing on mobile reader');
  assert.equal(drawingVM.strokePoints.length, 1, 'Initial stroke point must be recorded');
  assert.equal(model.isDrawMode, true, 'Draw mode must be activated when drawing with pen');
});

test('ReaderDrawingViewModel does not auto-activate draw mode on desktop mouse clicks when draw mode is off', () => {
  const { context, elementsById } = createDOMContext();

  loadScript(context, 'js/models/ReaderModel.js');
  loadScript(context, 'js/views/reader/DrawingCanvasView.js');
  loadScript(context, 'js/views/reader/ReaderHUDView.js');
  loadScript(context, 'js/views/reader/ReaderSelectionLoupeView.js');
  loadScript(context, 'js/viewmodels/reader/ReaderTextHighlightController.js');
  loadScript(context, 'js/viewmodels/reader/ReaderDrawingViewModel.js');

  const ReaderModel = context.window.ReaderModel || context.ReaderModel;
  const ReaderDrawingViewModel = context.window.ReaderDrawingViewModel || context.ReaderDrawingViewModel;

  const model = new ReaderModel();
  model.setDrawTool('pen');
  assert.equal(model.isDrawMode, false, 'Draw mode must default to false');

  const viewportEl = elementsById.get('pdf-viewport');
  const bodyEl = elementsById.get('reader-body');
  // Desktop environment: mobile reader is inactive
  const fakeReader = {
    viewportEl,
    mobile: {
      device: {
        isMobileReaderActive: () => false
      }
    }
  };

  const drawingVM = new ReaderDrawingViewModel(model, viewportEl, bodyEl, () => null, fakeReader);

  const pageWrapper = new context.Element('div');
  const drawCanvas = new context.Element('canvas');
  drawCanvas.getContext = () => ({
    clearRect() {}, save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {},
    quadraticCurveTo() {}, stroke() {}, fill() {}, arc() {}
  });

  // 1. Simulate desktop mouse click when draw mode is off
  let prevented = false;
  let stopped = false;
  const mouseDownEvent = {
    type: 'pointerdown',
    pointerType: 'mouse',
    pointerId: 1,
    clientX: 200,
    clientY: 300,
    button: 0,
    buttons: 1,
    target: pageWrapper,
    preventDefault() { prevented = true; },
    stopPropagation() { stopped = true; }
  };

  drawingVM.handleDrawingPointerDown(mouseDownEvent, 1, pageWrapper, drawCanvas, 1, 1);

  assert.equal(model.isDrawMode, false, 'Desktop mouse click must NOT activate draw mode');
  assert.equal(drawingVM.isDrawing, false, 'Desktop mouse click must NOT start drawing when draw mode is off');
  assert.equal(viewportEl.classList.contains('draw-mode-active'), false, 'Viewport must not have draw-mode-active class');
  assert.equal(bodyEl.classList.contains('draw-mode-active'), false, 'Body must not have draw-mode-active class');
  assert.equal(prevented, false, 'Default action must not be prevented so text selection can proceed');
  assert.equal(stopped, false, 'Event propagation must not be stopped');

  // 2. setDrawTool on desktop must not force draw mode on
  drawingVM.setDrawTool('eraser');
  assert.equal(model.isDrawMode, false, 'Switching tool on desktop must not force draw mode on');
  drawingVM.setDrawTool('pen');
  assert.equal(model.isDrawMode, false, 'Switching tool to pen on desktop must not force draw mode on');

  // 3. Explicitly activating draw mode enables mouse drawing
  drawingVM.toggleDrawMode(true);
  assert.equal(model.isDrawMode, true, 'Explicit toggle must activate draw mode');

  drawingVM.handleDrawingPointerDown(mouseDownEvent, 1, pageWrapper, drawCanvas, 1, 1);
  assert.equal(drawingVM.isDrawing, true, 'Mouse click must draw when draw mode is explicitly on');

  // 4. Closing draw mode stops mouse drawing
  drawingVM.toggleDrawMode(false);
  assert.equal(model.isDrawMode, false, 'Toggling draw mode off must deactivate it');
  drawingVM.isDrawing = false;

  prevented = false;
  stopped = false;
  drawingVM.handleDrawingPointerDown(mouseDownEvent, 1, pageWrapper, drawCanvas, 1, 1);
  assert.equal(model.isDrawMode, false, 'Mouse click after turning off draw mode must not reactivate it');
  assert.equal(drawingVM.isDrawing, false, 'Mouse must not draw after draw mode is turned off');
});

test('ReaderDrawingViewModel preserves pressure, strict palm rejection and desktop pan gestures', async () => {
  const { context, elementsById } = createDOMContext();
  loadScript(context, 'js/models/ReaderModel.js');
  loadScript(context, 'js/views/reader/DrawingCanvasView.js');
  loadScript(context, 'js/views/reader/ReaderHUDView.js');
  loadScript(context, 'js/views/reader/ReaderSelectionLoupeView.js');
  loadScript(context, 'js/viewmodels/reader/ReaderTextHighlightController.js');
  loadScript(context, 'js/viewmodels/reader/ReaderDrawingViewModel.js');

  const ReaderModel = context.window.ReaderModel || context.ReaderModel;
  const ReaderDrawingViewModel = context.window.ReaderDrawingViewModel || context.ReaderDrawingViewModel;
  const model = new ReaderModel();
  model.setDrawTool('pen');
  model.setAccessibilitySetting('palmRejection', 'strict');

  const viewportEl = elementsById.get('pdf-viewport');
  const bodyEl = elementsById.get('reader-body');
  const drawingVM = new ReaderDrawingViewModel(model, viewportEl, bodyEl, () => null, {
    viewportEl,
    mobile: { device: { isMobileReaderActive: () => false } }
  });
  const pageWrapper = new context.Element('div');
  pageWrapper.getBoundingClientRect = () => ({ left: 100, top: 200, width: 500, height: 800 });
  const drawCanvas = new context.Element('canvas');
  drawCanvas.width = 1000;
  drawCanvas.height = 1600;
  drawCanvas.getContext = () => ({
    clearRect() {}, save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {},
    quadraticCurveTo() {}, stroke() {}, fill() {}, arc() {}
  });
  const makeEvent = (pointerType, pointerId, clientX, clientY, pressure = 0.5) => ({
    pointerType, pointerId, clientX, clientY, pressure, button: 0, buttons: 1, target: drawCanvas,
    preventDefault() {}, stopPropagation() {}
  });

  let touchPrevented = false;
  let touchStopped = false;
  drawingVM.handleDrawingPointerDown({
    ...makeEvent('touch', 1, 150, 300),
    preventDefault() { touchPrevented = true; },
    stopPropagation() { touchStopped = true; }
  }, 1, pageWrapper, drawCanvas, 1, 1);
  assert.equal(touchPrevented, true, 'Strict palm rejection must prevent touch drawing on desktop');
  assert.equal(touchStopped, true, 'Strict palm rejection must stop touch propagation');
  assert.equal(drawingVM.isDrawing, false);

  drawingVM.toggleDrawMode(true);
  drawingVM.handleDrawingPointerDown(makeEvent('pen', 2, 150, 300, 0.75), 1, pageWrapper, drawCanvas, 1, 1);
  drawingVM.handleDrawingPointerMove(makeEvent('pen', 2, 160, 315, 0.9), 1, pageWrapper, drawCanvas, 1, 1);
  await drawingVM.handleDrawingPointerUp(makeEvent('pen', 2, 160, 315, 0.9), 1, pageWrapper, drawCanvas, 1, 1);

  const stroke = model.getPageStrokes(1)[0];
  assert.deepEqual(Array.from(stroke.points, point => point.p), [0.75, 0.9], 'Stroke points must retain pointer pressure');

  bodyEl.scrollLeft = 80;
  bodyEl.scrollTop = 100;
  drawingVM.setDrawTool('pan');
  drawingVM.handleDrawingPointerDown(makeEvent('mouse', 3, 200, 300), 1, pageWrapper, drawCanvas, 1, 1);
  assert.equal(drawingVM.isPanning, true);
  drawingVM.handleDrawingPointerMove(makeEvent('mouse', 3, 250, 340), 1, pageWrapper, drawCanvas, 1, 1);
  assert.equal(bodyEl.scrollLeft, 30);
  assert.equal(bodyEl.scrollTop, 60);
  await drawingVM.handleDrawingPointerUp(makeEvent('mouse', 3, 250, 340), 1, pageWrapper, drawCanvas, 1, 1);
  assert.equal(drawingVM.isPanning, false);
  assert.equal(viewportEl.classList.contains('panning'), false);
});

test('MobileDrawingToolbarView does not auto-activate draw mode on desktop environment initialization', () => {
  const { context, elementsById, documentStub } = createDOMContext();

  loadScript(context, 'js/models/ReaderModel.js');
  loadScript(context, 'js/views/reader/DrawingCanvasView.js');
  loadScript(context, 'js/views/reader/ReaderHUDView.js');
  loadScript(context, 'js/viewmodels/reader/ReaderTextHighlightController.js');
  loadScript(context, 'js/viewmodels/reader/ReaderDrawingViewModel.js');
  loadScript(context, 'js/mobile/MobileDrawingToolbarView.js');

  const ReaderModel = context.window.ReaderModel || context.ReaderModel;
  const MobileDrawingToolbarView = context.window.MobileDrawingToolbarView || context.MobileDrawingToolbarView;

  const model = new ReaderModel();
  let toggleDrawModeCalled = false;
  const fakeReader = {
    viewportEl: elementsById.get('pdf-viewport'),
    container: elementsById.get('reader-container'),
    mobile: {
      device: {
        isMobileReaderActive: () => false
      }
    },
    drawing: {
      setDrawTool: (tool) => { model.setDrawTool(tool); },
      setDrawColor: (c) => { model.setDrawColor(c); },
      undoLastStroke: () => {},
      toggleDrawMode: () => { toggleDrawModeCalled = true; return true; }
    }
  };

  const fab = new MobileDrawingToolbarView(fakeReader, model);
  fab.init();

  assert.equal(toggleDrawModeCalled, false, 'MobileDrawingToolbarView.init must NOT activate draw mode on desktop');
  assert.equal(model.isDrawMode, false, 'Model isDrawMode must remain false');
  assert.equal(documentStub.body.classList.contains('mobile-drawing-active'), false, 'Body must not have mobile-drawing-active on desktop');
});

test('clearCurrentPageDrawings wipes strokes immediately without blocking browser with confirm dialog', () => {
  const { context, elementsById } = createDOMContext();

  loadScript(context, 'js/models/ReaderModel.js');
  loadScript(context, 'js/views/reader/DrawingCanvasView.js');
  loadScript(context, 'js/views/reader/ReaderHUDView.js');
  loadScript(context, 'js/views/reader/ReaderSelectionLoupeView.js');
  loadScript(context, 'js/viewmodels/reader/ReaderTextHighlightController.js');
  loadScript(context, 'js/viewmodels/reader/ReaderDrawingViewModel.js');

  const ReaderModel = context.window.ReaderModel || context.ReaderModel;
  const ReaderDrawingViewModel = context.window.ReaderDrawingViewModel || context.ReaderDrawingViewModel;

  const model = new ReaderModel();
  model.currentPage = 2;
  model.addStrokeToPage(2, {
    tool: 'pen',
    color: '#1e293b',
    width: 4,
    points: [{ x: 0.1, y: 0.2, p: 0.5 }, { x: 0.3, y: 0.4, p: 0.5 }]
  });

  assert.equal(model.getPageStrokes(2).length, 1, 'Page 2 should initially have 1 stroke');

  const viewportEl = elementsById.get('pdf-viewport');
  const bodyEl = elementsById.get('reader-body');
  const drawingVM = new ReaderDrawingViewModel(model, viewportEl, bodyEl, () => null);

  // Even if window.confirm is undefined or throws if called, clearCurrentPageDrawings must succeed
  context.window.confirm = () => {
    throw new Error('window.confirm should not be called!');
  };

  drawingVM.clearCurrentPageDrawings(2);

  assert.equal(model.getPageStrokes(2).length, 0, 'Page 2 strokes must be wiped completely');
  assert.equal(drawingVM.isDrawing, false, 'Drawing flag must be clean false');
  assert.equal(drawingVM.strokePoints.length, 0, 'Stroke points array must be clean empty');
});

test('MobileDrawingToolbarView two-step pen selection opens drawer first, then color menu on second tap', async () => {
  const { context, elementsById } = createDOMContext();

  loadScript(context, 'js/models/ReaderModel.js');
  loadScript(context, 'js/views/reader/DrawingCanvasView.js');
  loadScript(context, 'js/views/reader/ReaderHUDView.js');
  loadScript(context, 'js/viewmodels/reader/ReaderTextHighlightController.js');
  loadScript(context, 'js/viewmodels/reader/ReaderDrawingViewModel.js');
  loadScript(context, 'js/mobile/MobileDrawingToolbarView.js');

  const ReaderModel = context.window.ReaderModel || context.ReaderModel;
  const MobileDrawingToolbarView = context.window.MobileDrawingToolbarView || context.MobileDrawingToolbarView;

  const model = new ReaderModel();
  model.setDrawTool('pen');

  const fakeReader = {
    drawing: {
      setDrawTool: (tool) => { model.setDrawTool(tool); },
      setDrawColor: (c) => { model.setDrawColor(c); },
      undoLastStroke: () => {},
      toggleDrawMode: () => true
    },
    viewportEl: elementsById.get('pdf-viewport')
  };

  const fab = new MobileDrawingToolbarView(fakeReader, model);
  fab.init();

  const mainBtn = elementsById.get('mobile-draw-main-btn');
  const drawer = elementsById.get('mobile-draw-tools-drawer');
  const colorMenu = elementsById.get('mobile-color-contextual-menu');

  // Initial state: collapsed, no color menu
  assert.equal(fab.isExpanded, false);
  assert.equal(fab.isColorMenuOpen, false);

  // 1st tap on main pen button: unfolds drawer, color menu stays closed
  await mainBtn.emit('click');
  assert.equal(fab.isExpanded, true, 'First tap on pen FAB must unfold the drawer');
  assert.equal(fab.isColorMenuOpen, false, 'First tap on pen FAB must NOT open the color menu');
  assert.equal(drawer.classList.contains('open'), true);
  assert.equal(colorMenu.classList.contains('open'), false);

  // 2nd tap on main pen button: opens color palette without collapsing
  await mainBtn.emit('click');
  assert.equal(fab.isExpanded, true, 'Second tap on pen FAB must remain expanded');
  assert.equal(fab.isColorMenuOpen, true, 'Second tap on pen FAB must open the color menu');
  assert.equal(colorMenu.classList.contains('open'), true);

  // 3rd tap on main pen button: collapses both drawer and color menu
  await mainBtn.emit('click');
  assert.equal(fab.isExpanded, false, 'Third tap must collapse drawer');
  assert.equal(fab.isColorMenuOpen, false, 'Third tap must close color menu');
  assert.equal(drawer.classList.contains('open'), false);
  assert.equal(colorMenu.classList.contains('open'), false);

  // Now test selecting Pen from drawer when switched from another tool
  model.setDrawTool('eraser');
  fab.render();
  fab.setExpanded(true);
  const penItem = elementsById.get('mobile-tool-pen');
  await penItem.emit('click');
  assert.equal(model.drawTool, 'pen', 'Tool must be set to pen');
  assert.equal(fab.isExpanded, false, 'Selecting pen from drawer must collapse drawer');
  assert.equal(fab.isColorMenuOpen, false, 'Selecting pen from drawer must NOT open color menu');
});

test('First screen tap dismisses open drawer or color menu without drawing; second tap draws', async () => {
  const { context, elementsById } = createDOMContext();

  loadScript(context, 'js/models/ReaderModel.js');
  loadScript(context, 'js/views/reader/DrawingCanvasView.js');
  loadScript(context, 'js/views/reader/ReaderHUDView.js');
  loadScript(context, 'js/views/reader/ReaderSelectionLoupeView.js');
  loadScript(context, 'js/viewmodels/reader/ReaderTextHighlightController.js');
  loadScript(context, 'js/viewmodels/reader/ReaderDrawingViewModel.js');
  loadScript(context, 'js/mobile/MobileDrawingToolbarView.js');

  const ReaderModel = context.window.ReaderModel || context.ReaderModel;
  const ReaderDrawingViewModel = context.window.ReaderDrawingViewModel || context.ReaderDrawingViewModel;
  const MobileDrawingToolbarView = context.window.MobileDrawingToolbarView || context.MobileDrawingToolbarView;

  const model = new ReaderModel();
  model.setDrawTool('pen');

  const viewportEl = elementsById.get('pdf-viewport');
  const bodyEl = elementsById.get('reader-body');

  const fakeReader = {
    viewportEl,
    mobile: {
      device: {
        isMobileReaderActive: () => true
      },
      drawingFAB: null
    },
    drawing: null
  };

  const fab = new MobileDrawingToolbarView(fakeReader, model);
  fab.init();
  fakeReader.mobile.drawingFAB = fab;

  const drawingVM = new ReaderDrawingViewModel(model, viewportEl, bodyEl, () => null, fakeReader);
  fakeReader.drawing = drawingVM;

  const pageWrapper = new context.Element('div');
  const drawCanvas = new context.Element('canvas');
  drawCanvas.getContext = () => ({
    clearRect() {}, save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {}, stroke() {}, fill() {}, arc() {}
  });

  // Scenario A: Drawer is expanded
  fab.setExpanded(true);
  assert.equal(fab.isExpanded, true);

  const touchEvent1 = {
    type: 'pointerdown',
    pointerType: 'touch',
    pointerId: 1,
    clientX: 100,
    clientY: 150,
    pressure: 0.5,
    button: 0,
    buttons: 1,
    target: drawCanvas,
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.propagationStopped = true; }
  };

  // First tap: should dismiss drawer and suppress drawing
  drawingVM.handleDrawingPointerDown(touchEvent1, 1, pageWrapper, drawCanvas, 1, 1);
  assert.equal(fab.isExpanded, false, 'First tap must collapse drawer');
  assert.equal(drawingVM.isDrawing, false, 'First tap must NOT start drawing');
  assert.equal(drawingVM.strokePoints.length, 0, 'No stroke points should be recorded on first tap');

  // Second tap: should draw normally
  const touchEvent2 = {
    type: 'pointerdown',
    pointerType: 'touch',
    pointerId: 1,
    clientX: 100,
    clientY: 150,
    pressure: 0.5,
    button: 0,
    buttons: 1,
    target: drawCanvas,
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.propagationStopped = true; }
  };
  drawingVM.handleDrawingPointerDown(touchEvent2, 1, pageWrapper, drawCanvas, 1, 1);
  assert.equal(drawingVM.isDrawing, true, 'Second tap must start drawing');
  assert.equal(drawingVM.strokePoints.length, 1, 'Second tap must record stroke point');

  // Scenario B: Color menu is open
  drawingVM.isDrawing = false;
  drawingVM.strokePoints = [];
  fab.setExpanded(true);
  fab.toggleColorMenu(true);
  assert.equal(fab.isColorMenuOpen, true);

  const touchEvent3 = {
    type: 'pointerdown',
    pointerType: 'touch',
    pointerId: 1,
    clientX: 120,
    clientY: 180,
    pressure: 0.5,
    button: 0,
    buttons: 1,
    target: drawCanvas,
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.propagationStopped = true; }
  };
  drawingVM.handleDrawingPointerDown(touchEvent3, 1, pageWrapper, drawCanvas, 1, 1);
  assert.equal(fab.isColorMenuOpen, false, 'First tap must close color menu');
  assert.equal(fab.isExpanded, false, 'First tap must collapse drawer');
  assert.equal(drawingVM.isDrawing, false, 'First tap must NOT start drawing when color menu was open');
  assert.equal(drawingVM.strokePoints.length, 0, 'No stroke points should be recorded');
});

test('MobileSelectionController long-press shows loupe and preserves pan mode without auto-highlighting', async () => {
  const { context, elementsById, documentStub, currentSelection } = createDOMContext();

  loadScript(context, 'js/models/ReaderModel.js');
  loadScript(context, 'js/views/reader/DrawingCanvasView.js');
  loadScript(context, 'js/views/reader/ReaderHUDView.js');
  loadScript(context, 'js/views/reader/ReaderSelectionLoupeView.js');
  loadScript(context, 'js/viewmodels/reader/ReaderTextHighlightController.js');
  loadScript(context, 'js/viewmodels/reader/ReaderDrawingViewModel.js');
  loadScript(context, 'js/mobile/MobileSelectionController.js');

  const ReaderModel = context.window.ReaderModel || context.ReaderModel;
  const MobileSelectionController = context.window.MobileSelectionController || context.MobileSelectionController;

  const model = new ReaderModel();
  model.setDrawTool('pan');

  const viewportEl = elementsById.get('pdf-viewport');
  const loupeEl = elementsById.get('reader-selection-loupe');
  const floatingToolbar = elementsById.get('floating-toolbar');

  // Set up mock page wrapper with textLayer and precise-word
  const pageWrapper = new context.Element('div', { class: 'pdf-page-wrapper', 'data-page': '1' });
  const textLayer = new context.Element('div', { class: 'textLayer' });
  const wordSpan = new context.Element('span', { class: 'precise-word' });
  const textNode = { nodeType: 3, textContent: 'Lunabria' };
  wordSpan.firstChild = textNode;
  wordSpan.textContent = 'Lunabria';
  wordSpan.closest = (sel) => sel && sel.includes('precise-word') ? wordSpan : null;

  textLayer.appendChild(wordSpan);
  pageWrapper.appendChild(textLayer);
  viewportEl.appendChild(pageWrapper);

  documentStub.elementsFromPoint = (x, y) => [wordSpan, textLayer, pageWrapper];

  let floatingToolbarUpdated = false;
  const fakeReader = {
    viewportEl,
    floatingToolbar,
    mobile: {
      device: { isMobileReaderActive: () => true }
    },
    drawing: {
      setDrawTool: (tool) => { model.setDrawTool(tool); }
    },
    annotations: {
      updateFloatingToolbar: () => { floatingToolbarUpdated = true; },
      computeSelectionRects: () => [{ left: 10, top: 20, width: 50, height: 16 }]
    }
  };

  const selectionController = new MobileSelectionController(fakeReader, model);
  // Mock loupe update/hide tracking
  let loupeUpdated = false;
  let loupeHidden = false;
  selectionController.loupe = {
    update: (x, y, wrapper) => { loupeUpdated = true; loupeHidden = false; },
    hide: () => { loupeHidden = true; }
  };

  selectionController.init();

  // 1. Long-press triggers selection
  selectionController.startLongPressSelection({ x: 50, y: 100 });

  assert.equal(selectionController.isSelecting, true, 'Long press must start selection mode');
  assert.equal(model.drawTool, 'pan', 'Draw tool must remain pan mode (never forced to highlighter)');
  assert.equal(loupeUpdated, true, 'Selection loupe must be displayed during long press');
  assert.equal(currentSelection.rangeCount > 0, true, 'Text range must be selected');

  // 2. Dragging updates selection and keeps loupe visible
  loupeUpdated = false;
  selectionController.updateSelectionToPoint(70, 100, pageWrapper);
  assert.equal(selectionController.isSelecting, true, 'Still selecting while dragging');

  // 3. Releasing pointer completes selection
  await viewportEl.emit('touchend');
  assert.equal(selectionController.isSelecting, false, 'Pointer release ends selection mode');
  assert.equal(loupeHidden, true, 'Selection loupe must be hidden after gesture completes');
  assert.equal(model.drawTool, 'pan', 'Draw tool must strictly remain pan mode after gesture');
  assert.equal(floatingToolbarUpdated, true, 'Contextual highlight menu (floating toolbar) must be presented upon release');
});

test('MobileSelectionController allows spatial tolerance slack (holgura) around words without strict pixel hit', () => {
  const { context, elementsById, documentStub, currentSelection } = createDOMContext();

  loadScript(context, 'js/models/ReaderModel.js');
  loadScript(context, 'js/views/reader/DrawingCanvasView.js');
  loadScript(context, 'js/views/reader/ReaderHUDView.js');
  loadScript(context, 'js/views/reader/ReaderSelectionLoupeView.js');
  loadScript(context, 'js/viewmodels/reader/ReaderTextHighlightController.js');
  loadScript(context, 'js/viewmodels/reader/ReaderDrawingViewModel.js');
  loadScript(context, 'js/mobile/MobileSelectionController.js');

  const ReaderModel = context.window.ReaderModel || context.ReaderModel;
  const MobileSelectionController = context.window.MobileSelectionController || context.MobileSelectionController;

  const model = new ReaderModel();
  model.setDrawTool('pan');

  const viewportEl = elementsById.get('pdf-viewport');
  const pageWrapper = new context.Element('div', { class: 'pdf-page-wrapper', 'data-page': '1' });
  const textLayer = new context.Element('div', { class: 'textLayer' });
  const wordSpan = new context.Element('span', { class: 'precise-word' });
  const textNode = { nodeType: 3, textContent: 'Holgura' };
  wordSpan.firstChild = textNode;
  wordSpan.textContent = 'Holgura';
  wordSpan.getBoundingClientRect = () => ({ left: 50, top: 100, right: 120, bottom: 120, width: 70, height: 20 });
  wordSpan.closest = (sel) => sel && sel.includes('precise-word') ? wordSpan : null;

  textLayer.appendChild(wordSpan);
  textLayer.querySelectorAll = (sel) => sel.includes('precise-word') ? [wordSpan] : [];
  pageWrapper.appendChild(textLayer);
  pageWrapper.querySelector = (sel) => sel.includes('textLayer') ? textLayer : null;
  viewportEl.appendChild(pageWrapper);

  // When point is at (35, 90), which is 15px to the left and 10px above the word rect:
  // elementsFromPoint returns [] (empty / exact pixel miss)
  documentStub.elementsFromPoint = (x, y) => [];

  const fakeReader = {
    viewportEl,
    mobile: { device: { isMobileReaderActive: () => true } },
    drawing: { setDrawTool: (tool) => { model.setDrawTool(tool); } },
    annotations: { updateFloatingToolbar: () => {} }
  };

  const selectionController = new MobileSelectionController(fakeReader, model);
  selectionController.loupe = { update: () => {}, hide: () => {} };
  selectionController.init();

  // Test findNearbyTarget directly with offset point
  const nearby = selectionController.findNearbyTarget(35, 90, pageWrapper, 44, 30);
  assert.notEqual(nearby, null, 'Nearby target must be found within tolerance slack');
  assert.equal(nearby.span, wordSpan, 'Nearest element must match target wordSpan');

  // Test startLongPressSelection with offset point
  selectionController.startLongPressSelection({ x: 35, y: 90 });
  assert.equal(selectionController.isSelecting, true, 'Selection must activate with tolerance slack');
  assert.equal(currentSelection.rangeCount > 0, true, 'Text range must be selected despite offset');
});

test('Mobile selection reuses native nearest-word geometry without requiring controller state', () => {
  const { context, documentStub } = createDOMContext();
  context.Node = { TEXT_NODE: 3 };
  context.NodeFilter = { SHOW_TEXT: 4 };
  loadScript(context, 'js/models/ReaderModel.js');
  loadScript(context, 'js/viewmodels/reader/ReaderNativeSelectionLoupeController.js');
  loadScript(context, 'js/mobile/MobileSelectionController.js');

  const ReaderModel = context.window.ReaderModel || context.ReaderModel;
  const model = new ReaderModel();
  const nodes = ['alpha', 'beta'].map(text => ({ nodeType: 3, textContent: text }));
  const word = (node, left, width) => {
    const span = {
      textContent: node.textContent,
      firstChild: node,
      getBoundingClientRect: () => ({ left, top: 0, right: left + width, bottom: 20, width, height: 20 }),
      contains: candidate => candidate === node,
      querySelectorAll: () => []
    };
    node.parentElement = span;
    return span;
  };
  const words = [word(nodes[0], 0, 40), word(nodes[1], 100, 80)];
  const line = {
    textContent: 'alpha beta',
    firstChild: nodes[0],
    contains: node => nodes.includes(node),
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 180, bottom: 20, width: 180, height: 20 }),
    querySelectorAll: selector => selector === '.precise-word' ? words : []
  };
  const textLayer = {
    querySelectorAll: selector => selector === '.precise-line' ? [line] : []
  };
  const pageWrapper = { querySelector: selector => selector === '.textLayer' ? textLayer : null };
  documentStub.caretPositionFromPoint = () => ({ offsetNode: nodes[0], offset: 1 });
  documentStub.createTreeWalker = element => ({ nextNode: () => element.firstChild || null });

  const MobileSelectionController = context.window.MobileSelectionController || context.MobileSelectionController;
  const controller = new MobileSelectionController({}, model);
  const target = controller.findNearbyTarget(175, 10, pageWrapper, 80, 40);

  assert.equal(target.node, nodes[1]);
  assert.equal(target.span, words[1]);
  assert.equal(target.offset, 4);
});

test('MobileSelectionController locks reader scroll and prevents horizontal page displacement or pointer cancellation during drag', async () => {
  const { context, elementsById, documentStub, currentSelection } = createDOMContext();

  loadScript(context, 'js/models/ReaderModel.js');
  loadScript(context, 'js/views/reader/ReaderSelectionLoupeView.js');
  loadScript(context, 'js/mobile/MobileSelectionController.js');

  const ReaderModel = context.window.ReaderModel || context.ReaderModel;
  const MobileSelectionController = context.window.MobileSelectionController || context.MobileSelectionController;

  const model = new ReaderModel();
  model.setDrawTool('pan');

  const viewportEl = elementsById.get('pdf-viewport');
  const readerBody = elementsById.get('reader-body');
  readerBody.scrollLeft = 40;
  readerBody.scrollTop = 20;

  let pointerCaptured = null;
  let pointerReleased = null;
  viewportEl.setPointerCapture = (id) => { pointerCaptured = id; };
  viewportEl.releasePointerCapture = (id) => { pointerReleased = id; };

  const pageWrapper = new context.Element('div', { class: 'pdf-page-wrapper', 'data-page': '1' });
  const textLayer = new context.Element('div', { class: 'textLayer' });
  const wordSpan = new context.Element('span', { class: 'precise-word' });
  wordSpan.firstChild = { nodeType: 3, textContent: 'Lunabria' };
  wordSpan.textContent = 'Lunabria';
  wordSpan.closest = (sel) => sel && sel.includes('precise-word') ? wordSpan : null;
  textLayer.appendChild(wordSpan);
  pageWrapper.appendChild(textLayer);
  viewportEl.appendChild(pageWrapper);

  documentStub.elementsFromPoint = (x, y) => [wordSpan, textLayer, pageWrapper];

  const fakeReader = {
    viewportEl,
    floatingToolbar: elementsById.get('floating-toolbar'),
    mobile: { device: { isMobileReaderActive: () => true } },
    drawing: { setDrawTool: (tool) => { model.setDrawTool(tool); } },
    annotations: { updateFloatingToolbar: () => {} }
  };

  const selectionController = new MobileSelectionController(fakeReader, model);
  let loupeHidden = false;
  selectionController.loupe = { update: () => {}, hide: () => { loupeHidden = true; } };
  selectionController.init();

  // 1. Start selection with pointer ID 10
  selectionController.activePointerId = 10;
  selectionController.startLongPressSelection({ x: 50, y: 100 });

  assert.equal(selectionController.isSelecting, true, 'Selection must be active');
  assert.equal(documentStub.body.classList.contains('mobile-text-selecting'), true, 'Body must have mobile-text-selecting class');
  assert.equal(pointerCaptured, 10, 'Pointer 10 must be captured on viewport');
  assert.equal(selectionController.lockedScrollLeft, 40, 'readerBody scrollLeft must be locked');

  // 2. Browser fires pointercancel (e.g. scroll heuristic test): must NOT abort selection or hide loupe
  await viewportEl.emit('pointercancel');
  assert.equal(selectionController.isSelecting, true, 'Active selection must ignore pointercancel');
  assert.equal(loupeHidden, false, 'Loupe must not hide on pointercancel during active selection');

  // 3. Movement prevents horizontal displacement
  readerBody.scrollLeft = 85; // Attempted drift
  const moveEvt = await viewportEl.emit('touchmove', {
    cancelable: true,
    touches: [{ clientX: 60, clientY: 100 }]
  });
  assert.equal(moveEvt.defaultPrevented, true, 'Touchmove during selection must be defaultPrevented');
  assert.equal(readerBody.scrollLeft, 40, 'readerBody scrollLeft must be restored to locked coordinate');

  // 4. Release ends selection and releases lock
  await viewportEl.emit('touchend');
  assert.equal(selectionController.isSelecting, false, 'Selection ends on touchend');
  assert.equal(documentStub.body.classList.contains('mobile-text-selecting'), false, 'mobile-text-selecting class removed');
  assert.equal(pointerReleased, 10, 'Pointer capture must be released');
  assert.equal(selectionController.lockedScrollLeft, null, 'Scroll lock cleared');
});





test('MobileReaderController does not apply mobile-reader-active or mobile-drawing-active when reader is closed (home page)', () => {
  const { context, elementsById, documentStub } = createDOMContext();

  loadScript(context, 'js/models/ReaderModel.js');
  loadScript(context, 'js/mobile/DeviceEnvironment.js');
  loadScript(context, 'js/views/reader/DrawingCanvasView.js');
  loadScript(context, 'js/views/reader/ReaderHUDView.js');
  loadScript(context, 'js/views/reader/ReaderSelectionLoupeView.js');
  loadScript(context, 'js/viewmodels/reader/ReaderTextHighlightController.js');
  loadScript(context, 'js/viewmodels/reader/ReaderDrawingViewModel.js');
  loadScript(context, 'js/mobile/MobileDrawingToolbarView.js');
  loadScript(context, 'js/mobile/MobileSelectionController.js');
  loadScript(context, 'js/mobile/MobileReaderController.js');

  const ReaderModel = context.window.ReaderModel || context.ReaderModel;
  const MobileReaderController = context.window.MobileReaderController || context.MobileReaderController;

  const model = new ReaderModel();
  const readerContainer = new context.Element('div', { id: 'reader-container' });
  readerContainer.style.display = 'none';

  const fakeReader = {
    container: readerContainer,
    viewportEl: elementsById.get('pdf-viewport'),
    floatingToolbar: elementsById.get('floating-toolbar'),
    drawing: {
      setDrawTool: (tool) => { model.setDrawTool(tool); },
      toggleDrawMode: () => true
    }
  };

  const controller = new MobileReaderController(fakeReader, model);
  controller.init();

  assert.equal(documentStub.body.classList.contains('mobile-reader-active'), false, 'Body must not have mobile-reader-active when reader is closed');
  assert.equal(documentStub.body.classList.contains('mobile-drawing-active'), false, 'Body must not have mobile-drawing-active when reader is closed');

  readerContainer.style.display = 'flex';
  controller.onBookOpened();
  assert.equal(documentStub.body.classList.contains('mobile-reader-active'), true, 'Body must have mobile-reader-active when reader is open');

  readerContainer.style.display = 'none';
  controller.onBookClosed();
  assert.equal(documentStub.body.classList.contains('mobile-reader-active'), false, 'Body must remove mobile-reader-active when reader is closed');
  assert.equal(documentStub.body.classList.contains('mobile-drawing-active'), false, 'Body must remove mobile-drawing-active when reader is closed');
});

test('MobileSelectionController preserves scroll position and targets correct page during long-press selection', async () => {
  const { context, elementsById, documentStub } = createDOMContext();

  loadScript(context, 'js/models/ReaderModel.js');
  loadScript(context, 'js/views/reader/ReaderSelectionLoupeView.js');
  loadScript(context, 'js/mobile/MobileSelectionController.js');

  const ReaderModel = context.window.ReaderModel || context.ReaderModel;
  const MobileSelectionController = context.window.MobileSelectionController || context.MobileSelectionController;

  const model = new ReaderModel();
  model.currentPage = 2;

  const viewportEl = elementsById.get('pdf-viewport');
  const readerBody = elementsById.get('reader-body');
  readerBody.scrollTop = 1250;
  readerBody.scrollLeft = 0;

  const page1 = new context.Element('div', { class: 'pdf-page-wrapper', 'data-page': '1' });
  page1.dataset = { page: '1' };
  page1.getBoundingClientRect = () => ({ left: 0, top: -1250, right: 375, bottom: -450, width: 375, height: 800 });

  const page2 = new context.Element('div', { class: 'pdf-page-wrapper', 'data-page': '2' });
  page2.dataset = { page: '2' };
  page2.getBoundingClientRect = () => ({ left: 0, top: 100, right: 375, bottom: 900, width: 375, height: 800 });

  const textLayer2 = new context.Element('div', { class: 'textLayer' });
  const wordSpan2 = new context.Element('span', { class: 'precise-word' });
  wordSpan2.firstChild = { nodeType: 3, textContent: 'MobileChapter' };
  wordSpan2.textContent = 'MobileChapter';
  wordSpan2.closest = (sel) => sel && sel.includes('precise-word') ? wordSpan2 : null;
  textLayer2.appendChild(wordSpan2);
  page2.appendChild(textLayer2);

  viewportEl.appendChild(page1);
  viewportEl.appendChild(page2);

  viewportEl.querySelectorAll = (sel) => {
    if (sel.includes('.pdf-page-wrapper')) return [page1, page2];
    return [];
  };

  documentStub.elementsFromPoint = (x, y) => [wordSpan2, textLayer2, page2];

  const fakeReader = {
    viewportEl,
    floatingToolbar: elementsById.get('floating-toolbar'),
    mobile: { device: { isMobileReaderActive: () => true } },
    drawing: { setDrawTool: (tool) => { model.setDrawTool(tool); } },
    annotations: { updateFloatingToolbar: () => {} }
  };

  const selectionController = new MobileSelectionController(fakeReader, model);
  selectionController.loupe = { update: () => {}, hide: () => {} };
  selectionController.init();

  selectionController.startLongPressSelection({ x: 150, y: 200 });

  assert.equal(selectionController.isSelecting, true, 'Selection must be active');
  assert.equal(readerBody.scrollTop, 1250, 'readerBody scrollTop must be preserved, not reset to 0');
  assert.equal(model.currentPage, 2, 'ReaderModel currentPage must remain page 2');
  assert.equal(selectionController.lockedScrollTop, 1250, 'lockedScrollTop must capture readerBody.scrollTop');
  assert.equal(selectionController.pageWrapper, page2, 'pageWrapper must be page 2, not page 1');
});


test('MobileHUDView performs real-time live GPU scaling on viewportEl during pinch-to-zoom without waiting for touchend', async () => {
  const { context, elementsById, documentStub } = createDOMContext();

  const frames = [];
  context.requestAnimationFrame = (fn) => {
    frames.push(fn);
    return frames.length;
  };
  context.window.requestAnimationFrame = context.requestAnimationFrame;
  context.cancelAnimationFrame = () => {};
  context.window.cancelAnimationFrame = context.cancelAnimationFrame;

  loadScript(context, 'js/models/ReaderModel.js');
  loadScript(context, 'js/mobile/MobileHUDView.js');

  const ReaderModel = context.window.ReaderModel || context.ReaderModel;
  const MobileHUDView = context.window.MobileHUDView || context.MobileHUDView;

  const model = new ReaderModel();
  model.scale = 1.0;

  const bodyEl = elementsById.get('reader-body');
  const viewportEl = elementsById.get('pdf-viewport');
  viewportEl.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 1000 });

  let committedScale = null;
  let committedFocal = null;

  const fakeReader = {
    bodyEl,
    viewportEl,
    nav: {
      setZoom: (scale, clearFit, focal) => {
        committedScale = scale;
        committedFocal = focal;
      }
    },
    drawing: { isDrawing: false }
  };

  const hudView = new MobileHUDView(fakeReader, model);
  hudView.init();

  // 1. Two fingers touch down (distance = 100)
  await bodyEl.emit('touchstart', {
    touches: [
      { clientX: 200, clientY: 300 },
      { clientX: 300, clientY: 300 }
    ]
  });

  assert.equal(hudView.isPinching, true, 'Pinch should be active');
  assert.equal(viewportEl.style.transformOrigin, '250px 300px', 'transformOrigin must be anchored at focal midpoint');

  // 2. Fingers move apart during gesture (distance = 150 -> 1.5x zoom)
  await bodyEl.emit('touchmove', {
    cancelable: true,
    touches: [
      { clientX: 175, clientY: 300 },
      { clientX: 325, clientY: 300 }
    ]
  });

  assert.equal(frames.length, 1, 'RAF frame must be scheduled during move');
  frames.shift()();

  // In live gesture: viewportEl MUST have real-time live GPU transform BEFORE touchend
  assert.ok(viewportEl.style.transform.includes('scale(1.5)'), 'viewportEl must scale live in real time during pinch');
  assert.equal(committedScale, null, 'setZoom must NOT be called before gesture completes (avoiding render cancellation)');

  // 3. User finishes gesture (fingers lift)
  await bodyEl.emit('touchend', {
    touches: []
  });

  assert.equal(hudView.isPinching, false, 'Pinch must end');
  assert.equal(committedScale, 1.5, 'Final committed scale must be 1.5');
  assert.equal(committedFocal?.clientX, 250);
  assert.equal(committedFocal?.clientY, 300);
});

test('clearCurrentPageDrawings with no arguments clears the active or visible page with strokes and syncs with localDB and api', async () => {
  const { context, elementsById } = createDOMContext();

  loadScript(context, 'js/models/ReaderModel.js');
  loadScript(context, 'js/views/reader/DrawingCanvasView.js');
  loadScript(context, 'js/views/reader/ReaderHUDView.js');
  loadScript(context, 'js/views/reader/ReaderSelectionLoupeView.js');
  loadScript(context, 'js/viewmodels/reader/ReaderTextHighlightController.js');
  loadScript(context, 'js/viewmodels/reader/ReaderDrawingViewModel.js');

  const ReaderModel = context.window.ReaderModel || context.ReaderModel;
  const ReaderDrawingViewModel = context.window.ReaderDrawingViewModel || context.ReaderDrawingViewModel;

  const model = new ReaderModel();
  model.bookId = 99;
  model.currentPage = 1;
  model.addStrokeToPage(3, {
    tool: 'pen',
    color: '#000000',
    width: 2,
    points: [{ x: 0.1, y: 0.1, p: 0.5 }]
  });

  const viewportEl = elementsById.get('pdf-viewport');
  const bodyEl = elementsById.get('reader-body');

  let localDBCleared = null;
  let apiCleared = null;

  context.localDB.clearPageDrawings = async (bookId, page) => {
    localDBCleared = { bookId, page };
  };
  context.api.clearPageDrawings = async (bookId, page) => {
    apiCleared = { bookId, page };
  };

  const drawingVM = new ReaderDrawingViewModel(model, viewportEl, bodyEl, () => null);
  drawingVM.activeDrawPage = 3;

  await drawingVM.clearCurrentPageDrawings();

  assert.equal(model.getPageStrokes(3).length, 0, 'Page 3 strokes must be cleared');
  assert.deepEqual(localDBCleared, { bookId: 99, page: 3 }, 'localDB.clearPageDrawings must be called for page 3');
  assert.deepEqual(apiCleared, { bookId: 99, page: 3 }, 'api.clearPageDrawings must be called for page 3');
});

test('Highlighter in draw mode forwards targetPage and computes rects, rendering highlight on correct page', async () => {
  const { context, elementsById, currentSelection } = createDOMContext();

  loadScript(context, 'js/models/ReaderModel.js');
  loadScript(context, 'js/views/reader/HighlightOverlayView.js');
  loadScript(context, 'js/views/reader/DrawingCanvasView.js');
  loadScript(context, 'js/views/reader/ReaderHUDView.js');
  loadScript(context, 'js/views/reader/ReaderSelectionLoupeView.js');
  loadScript(context, 'js/viewmodels/reader/ReaderAnnotationViewModel.js');
  loadScript(context, 'js/viewmodels/reader/ReaderTextHighlightController.js');
  loadScript(context, 'js/viewmodels/reader/ReaderDrawingViewModel.js');

  const ReaderModel = context.window.ReaderModel || context.ReaderModel;
  const ReaderTextHighlightController = context.window.ReaderTextHighlightController || context.ReaderTextHighlightController;
  const ReaderAnnotationViewModel = context.window.ReaderAnnotationViewModel || context.ReaderAnnotationViewModel;

  const model = new ReaderModel();
  model.bookId = 77;
  model.currentPage = 1;
  model.drawTool = 'highlighter';
  model.drawColor = '#fef08a';

  const viewportEl = elementsById.get('pdf-viewport');
  const bodyEl = elementsById.get('reader-body');

  const pageWrapper2 = new context.Element('div', { id: 'pdf-page-2', class: 'pdf-page-wrapper' });
  pageWrapper2.dataset = { page: '2' };
  pageWrapper2.getBoundingClientRect = () => ({ left: 0, top: 500, width: 600, height: 800, right: 600, bottom: 1300 });

  const textLayer2 = new context.Element('div', { class: 'textLayer' });
  pageWrapper2.appendChild(textLayer2);
  viewportEl.appendChild(pageWrapper2);

  viewportEl.querySelector = (sel) => {
    if (sel && (sel.includes('pdf-page-2') || sel.includes('page="2"'))) return pageWrapper2;
    return null;
  };

  let savedAnnotation = null;
  let refreshedPage = null;

  context.api.createAnnotation = async (bookId, annot) => {
    savedAnnotation = annot;
    return { id: 101, ...annot };
  };
  context.api.getAnnotations = async () => [];

  const annotVM = new ReaderAnnotationViewModel(model, viewportEl, bodyEl, () => null);
  annotVM.renderDrawerAnnotations = () => {};
  annotVM.openQuickHighlightPalette = () => {};
  annotVM.refreshPageHighlights = (page) => { refreshedPage = page; return true; };
  annotVM.computeSelectionRects = () => [{ left: 50, top: 100, width: 200, height: 20 }];

  const textController = new ReaderTextHighlightController(model, () => annotVM);

  currentSelection.setBaseAndExtent({ textContent: 'Selected in draw mode' }, 0, { textContent: 'Selected in draw mode' }, 21);

  textController.gesture = {
    pointerId: 1,
    pageNumber: 2,
    pageWrapper: pageWrapper2,
    isDragging: true
  };

  const handled = await textController.handlePointerUp({
    pointerId: 1,
    clientX: 100,
    clientY: 550,
    preventDefault: () => {},
    stopPropagation: () => {}
  });

  assert.equal(handled, true);
  assert.ok(savedAnnotation, 'Annotation should have been saved');
  assert.equal(savedAnnotation.page, 2, 'Saved annotation must target page 2 from gesture, not currentPage 1');
  assert.equal(refreshedPage, 2, 'Page 2 highlights must have been refreshed');
});

test('HighlightOverlayView clamps width and height to at least 1px', () => {
  const { context } = createDOMContext();
  loadScript(context, 'js/views/reader/HighlightOverlayView.js');
  const HighlightOverlayView = context.window.HighlightOverlayView || context.HighlightOverlayView;

  const container = new context.Element('div');
  const annotations = [
    {
      id: 'h1',
      color: 'yellow',
      rects: [
        { x0: 10, y0: 20, x1: 10.001, y1: 20.001 }
      ]
    }
  ];

  HighlightOverlayView.renderPageHighlights(container, annotations, 1.0, [{ id: 'yellow', color: '#fef08a' }]);
  assert.equal(container.children.length, 1);
  const mark = container.children[0];
  assert.equal(mark.style.width, '1px', 'Width should be clamped to at least 1px');
  assert.equal(mark.style.height, '1px', 'Height should be clamped to at least 1px');
});

test('MobileReaderController and LibraryViewModel do not request fullscreen when opening a book on mobile', () => {
  const { context, elementsById } = createDOMContext();

  loadScript(context, 'js/mobile/DeviceEnvironment.js');
  loadScript(context, 'js/mobile/MobileReaderController.js');
  loadScript(context, 'js/viewmodels/LibraryViewModel.js');

  const MobileReaderController = context.window.MobileReaderController || context.MobileReaderController;
  const LibraryViewModel = context.window.LibraryViewModel || context.LibraryViewModel;

  let fullscreenRequested = false;
  context.document.documentElement = {
    requestFullscreen: async () => { fullscreenRequested = true; },
    webkitRequestFullscreen: () => { fullscreenRequested = true; }
  };

  const fakeReader = {
    container: elementsById.get('reader-container') || new context.Element('div'),
    drawing: {
      toggleDrawMode: () => {},
      setDrawTool: () => {}
    },
    open: (bookId, page) => {}
  };

  const controller = new MobileReaderController(fakeReader, { isDrawMode: false });
  controller.requestFullscreenIfMobile();
  assert.equal(fullscreenRequested, false, 'requestFullscreenIfMobile must not request fullscreen');

  context.window.reader = {
    ...fakeReader,
    mobile: controller
  };

  LibraryViewModel.prototype.openBook.call({}, 1);
  assert.equal(fullscreenRequested, false, 'LibraryViewModel.openBook must not request fullscreen');
});

test('Double click with mouse in highlighter mode switches to pen tool and vice-versa', () => {
  const { context, elementsById } = createDOMContext();

  loadScript(context, 'js/models/ReaderModel.js');
  loadScript(context, 'js/views/reader/DrawingCanvasView.js');
  loadScript(context, 'js/views/reader/ReaderHUDView.js');
  loadScript(context, 'js/views/reader/ReaderSelectionLoupeView.js');
  loadScript(context, 'js/viewmodels/reader/ReaderTextHighlightController.js');
  loadScript(context, 'js/viewmodels/reader/ReaderDrawingViewModel.js');

  const ReaderModel = context.window.ReaderModel || context.ReaderModel;
  const ReaderDrawingViewModel = context.window.ReaderDrawingViewModel || context.ReaderDrawingViewModel;

  const model = new ReaderModel();
  model.isDrawMode = true;
  model.drawTool = 'highlighter';

  const viewportEl = elementsById.get('pdf-viewport');
  const bodyEl = elementsById.get('reader-body');
  const drawingVM = new ReaderDrawingViewModel(model, viewportEl, bodyEl, () => null);

  const pageWrapper = new context.Element('div', { id: 'pdf-page-1' });
  const drawCanvas = new context.Element('canvas');
  drawCanvas.getContext = () => ({
    clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    save() {}, restore() {}, scale() {}, fill() {}, arc() {}
  });

  // Click 1 in highlighter mode (mouse)
  drawingVM.handleDrawingPointerDown(
    { pointerType: 'mouse', button: 0, detail: 1, clientX: 100, clientY: 100, isPrimary: true, preventDefault() {}, stopPropagation() {} },
    1, pageWrapper, drawCanvas, 1.0, 1.0
  );
  assert.equal(model.drawTool, 'highlighter');

  // Click 2 in highlighter mode (mouse, detail: 2) -> must switch to pen
  drawingVM.handleDrawingPointerDown(
    { pointerType: 'mouse', button: 0, detail: 2, clientX: 102, clientY: 101, isPrimary: true, preventDefault() {}, stopPropagation() {} },
    1, pageWrapper, drawCanvas, 1.0, 1.0
  );
  assert.equal(model.drawTool, 'pen', 'Double click with mouse in highlighter mode must switch to pen');

  // Now in pen mode: click 1
  drawingVM.handleDrawingPointerDown(
    { pointerType: 'mouse', button: 0, detail: 1, clientX: 200, clientY: 200, isPrimary: true, preventDefault() {}, stopPropagation() {} },
    1, pageWrapper, drawCanvas, 1.0, 1.0
  );
  assert.equal(model.drawTool, 'pen');

  // Click 2 in pen mode (mouse, detail: 2) -> must switch to highlighter
  drawingVM.handleDrawingPointerDown(
    { pointerType: 'mouse', button: 0, detail: 2, clientX: 202, clientY: 201, isPrimary: true, preventDefault() {}, stopPropagation() {} },
    1, pageWrapper, drawCanvas, 1.0, 1.0
  );
  assert.equal(model.drawTool, 'highlighter', 'Double click with mouse in pen mode must switch to highlighter');
});

test('Space key in draw mode prevents default on initial press and on key repeats', () => {
  const { context, elementsById } = createDOMContext();

  loadScript(context, 'js/models/ReaderModel.js');
  loadScript(context, 'js/viewmodels/reader/ReaderToolbarManager.js');

  const ReaderModel = context.window.ReaderModel || context.ReaderModel;
  const ReaderToolbarManager = context.window.ReaderToolbarManager || context.ReaderToolbarManager;

  const model = new ReaderModel();
  model.isDrawMode = true;

  const viewportEl = elementsById.get('pdf-viewport');
  const bodyEl = elementsById.get('reader-body');
  const container = elementsById.get('reader-container') || new context.Element('div');
  container.style.display = 'flex';

  const toolbarManager = new ReaderToolbarManager(
    model,
    { viewportEl, bodyEl, container, scrubber: null, pageText: null },
    { nav: null, drawing: null, annotations: null }
  );

  let keydownListener = null;
  let keyupListener = null;
  context.window.addEventListener = (event, fn) => {
    if (event === 'keydown') keydownListener = fn;
    if (event === 'keyup') keyupListener = fn;
  };

  toolbarManager.bindKeyboardShortcuts();
  assert.ok(keydownListener, 'keydown listener must be registered');

  let preventedInitial = false;
  keydownListener({
    code: 'Space',
    repeat: false,
    target: bodyEl,
    preventDefault() { preventedInitial = true; }
  });
  assert.equal(preventedInitial, true, 'Initial Space keydown must call preventDefault');
  assert.equal(model.isSpacePanActive, true, 'Space pan must be active');

  // Key repeat event (after ~400ms holding Space)
  let preventedRepeat = false;
  keydownListener({
    code: 'Space',
    repeat: true,
    target: bodyEl,
    preventDefault() { preventedRepeat = true; }
  });
  assert.equal(preventedRepeat, true, 'Repeated Space keydown must also call preventDefault to prevent browser scrolling');
  assert.equal(model.isSpacePanActive, true, 'Space pan must remain active during key repeats');

  // Keyup releases space pan
  keyupListener({ code: 'Space' });
  assert.equal(model.isSpacePanActive, false, 'Space pan must be deactivated on keyup');
});

test('ReaderDrawingViewModel.toggleDrawMode(false) and ReaderModel.reset() reset drawTool to pen', () => {
  const { context, elementsById } = createDOMContext();

  loadScript(context, 'js/models/ReaderModel.js');
  loadScript(context, 'js/views/reader/DrawingCanvasView.js');
  loadScript(context, 'js/views/reader/ReaderHUDView.js');
  loadScript(context, 'js/views/reader/ReaderSelectionLoupeView.js');
  loadScript(context, 'js/viewmodels/reader/ReaderTextHighlightController.js');
  loadScript(context, 'js/viewmodels/reader/ReaderDrawingViewModel.js');

  const ReaderModel = context.window.ReaderModel || context.ReaderModel;
  const ReaderDrawingViewModel = context.window.ReaderDrawingViewModel || context.ReaderDrawingViewModel;

  const model = new ReaderModel();
  model.isDrawMode = true;
  model.setDrawTool('highlighter');
  assert.equal(model.drawTool, 'highlighter');

  const viewportEl = elementsById.get('pdf-viewport');
  const bodyEl = elementsById.get('reader-body');
  const drawingVM = new ReaderDrawingViewModel(model, viewportEl, bodyEl, () => null);

  // Exiting draw mode resets draw tool to 'pen'
  drawingVM.toggleDrawMode(false);
  assert.equal(model.isDrawMode, false);
  assert.equal(model.drawTool, 'pen', 'Closing draw mode must reset drawTool to pen');

  // Resetting the model also resets draw tool to 'pen'
  model.setDrawTool('highlighter');
  model.reset();
  assert.equal(model.drawTool, 'pen', 'ReaderModel.reset() must reset drawTool to pen');
});

test('Space key pan activates and blurs buttons when a toolbar button has focus', () => {
  const { context, elementsById } = createDOMContext();

  loadScript(context, 'js/models/ReaderModel.js');
  loadScript(context, 'js/viewmodels/reader/ReaderToolbarManager.js');

  const ReaderModel = context.window.ReaderModel || context.ReaderModel;
  const ReaderToolbarManager = context.window.ReaderToolbarManager || context.ReaderToolbarManager;

  const model = new ReaderModel();
  model.isDrawMode = true;

  const viewportEl = elementsById.get('pdf-viewport');
  const bodyEl = elementsById.get('reader-body');
  const container = elementsById.get('reader-container') || new context.Element('div');
  container.style.display = 'flex';

  const toolbarManager = new ReaderToolbarManager(
    model,
    { viewportEl, bodyEl, container, scrubber: null, pageText: null },
    { nav: null, drawing: null, annotations: null }
  );

  let keydownListener = null;
  context.window.addEventListener = (event, fn) => {
    if (event === 'keydown') keydownListener = fn;
  };

  toolbarManager.bindKeyboardShortcuts();

  // Create a button element that simulates having focus (e.g. reader-draw-toggle-btn)
  const drawToggleBtn = new context.Element('button', { id: 'reader-draw-toggle-btn' });
  let blurred = false;
  drawToggleBtn.blur = () => { blurred = true; };

  let prevented = false;
  keydownListener({
    code: 'Space',
    repeat: false,
    target: drawToggleBtn,
    preventDefault() { prevented = true; }
  });

  assert.equal(prevented, true, 'Space keydown on button must preventDefault');
  assert.equal(blurred, true, 'Space keydown on button must blur the button');
  assert.equal(model.isSpacePanActive, true, 'Space pan must become active even when a button had focus');
});

test('Pressing E in eraser mode returns to previous drawing tool (pen, highlighter, pan)', () => {
  const { context, elementsById } = createDOMContext();

  loadScript(context, 'js/models/ReaderModel.js');
  loadScript(context, 'js/views/reader/DrawingCanvasView.js');
  loadScript(context, 'js/views/reader/ReaderHUDView.js');
  loadScript(context, 'js/views/reader/ReaderSelectionLoupeView.js');
  loadScript(context, 'js/viewmodels/reader/ReaderTextHighlightController.js');
  loadScript(context, 'js/viewmodels/reader/ReaderDrawingViewModel.js');
  loadScript(context, 'js/viewmodels/reader/ReaderToolbarManager.js');

  const ReaderModel = context.window.ReaderModel || context.ReaderModel;
  const ReaderDrawingViewModel = context.window.ReaderDrawingViewModel || context.ReaderDrawingViewModel;
  const ReaderToolbarManager = context.window.ReaderToolbarManager || context.ReaderToolbarManager;

  const model = new ReaderModel();
  model.isDrawMode = true;

  const viewportEl = elementsById.get('pdf-viewport');
  const bodyEl = elementsById.get('reader-body');
  const container = elementsById.get('reader-container') || new context.Element('div');
  container.style.display = 'flex';

  const drawingVM = new ReaderDrawingViewModel(model, viewportEl, bodyEl, () => null);

  const toolbarManager = new ReaderToolbarManager(
    model,
    { viewportEl, bodyEl, container, scrubber: null, pageText: null },
    { nav: null, drawing: drawingVM, annotations: null }
  );

  let keydownListener = null;
  context.window.addEventListener = (event, fn) => {
    if (event === 'keydown') keydownListener = fn;
  };
  toolbarManager.bindKeyboardShortcuts();

  // 1. Pen -> Eraser -> Pen
  drawingVM.setDrawTool('pen');
  assert.equal(model.drawTool, 'pen');

  // Press E
  keydownListener({ key: 'e', code: 'KeyE', target: bodyEl, preventDefault() {} });
  assert.equal(model.drawTool, 'eraser', 'First E press must switch pen to eraser');

  // Press E again
  keydownListener({ key: 'e', code: 'KeyE', target: bodyEl, preventDefault() {} });
  assert.equal(model.drawTool, 'pen', 'Second E press must revert back to pen');

  // 2. Highlighter -> Eraser -> Highlighter
  drawingVM.setDrawTool('highlighter');
  assert.equal(model.drawTool, 'highlighter');

  // Press E
  keydownListener({ key: 'E', code: 'KeyE', target: bodyEl, preventDefault() {} });
  assert.equal(model.drawTool, 'eraser', 'Pressing E while in highlighter must switch to eraser');

  // Press E again
  keydownListener({ key: 'E', code: 'KeyE', target: bodyEl, preventDefault() {} });
  assert.equal(model.drawTool, 'highlighter', 'Pressing E again while in eraser must revert back to highlighter');
  assert.equal(bodyEl.classList.contains('text-highlight-mode'), true, 'Body must have text-highlight-mode active');

  // 3. Pan -> Eraser -> Pan
  drawingVM.setDrawTool('pan');
  assert.equal(model.drawTool, 'pan');

  // Press E
  keydownListener({ key: 'e', code: 'KeyE', target: bodyEl, preventDefault() {} });
  assert.equal(model.drawTool, 'eraser');

  // Press E again
  keydownListener({ key: 'e', code: 'KeyE', target: bodyEl, preventDefault() {} });
  assert.equal(model.drawTool, 'pan', 'Pressing E again must revert back to pan tool');
});

test('MobileSelectionController suppresses browser default action on long press and prevents premature cancellation', async () => {
  const { context, elementsById, documentStub } = createDOMContext();

  loadScript(context, 'js/models/ReaderModel.js');
  loadScript(context, 'js/views/reader/DrawingCanvasView.js');
  loadScript(context, 'js/views/reader/ReaderHUDView.js');
  loadScript(context, 'js/views/reader/ReaderSelectionLoupeView.js');
  loadScript(context, 'js/viewmodels/reader/ReaderTextHighlightController.js');
  loadScript(context, 'js/viewmodels/reader/ReaderDrawingViewModel.js');
  loadScript(context, 'js/mobile/MobileSelectionController.js');

  const ReaderModel = context.window.ReaderModel || context.ReaderModel;
  const MobileSelectionController = context.window.MobileSelectionController || context.MobileSelectionController;

  const model = new ReaderModel();
  model.setDrawTool('pan');

  const viewportEl = elementsById.get('pdf-viewport');
  const pageWrapper = new context.Element('div', { class: 'pdf-page-wrapper', 'data-page': '1' });
  const textLayer = new context.Element('div', { class: 'textLayer' });
  const wordSpan = new context.Element('span', { class: 'precise-word' });
  wordSpan.firstChild = { nodeType: 3, textContent: 'Lunabria' };
  wordSpan.textContent = 'Lunabria';
  wordSpan.closest = (sel) => sel && (sel.includes('precise-word') || sel.includes('textLayer')) ? wordSpan : null;
  textLayer.appendChild(wordSpan);
  pageWrapper.appendChild(textLayer);
  viewportEl.appendChild(pageWrapper);

  documentStub.elementsFromPoint = (x, y) => [wordSpan, textLayer, pageWrapper];

  const fakeReader = {
    viewportEl,
    floatingToolbar: elementsById.get('floating-toolbar'),
    mobile: { device: { isMobileReaderActive: () => true } },
    drawing: { setDrawTool: (tool) => { model.setDrawTool(tool); } },
    annotations: { updateFloatingToolbar: () => {} }
  };

  const selectionController = new MobileSelectionController(fakeReader, model);
  selectionController.loupe = { update: () => {}, hide: () => {} };
  selectionController.init();

  // 1. Initial pointerdown sets activePointerId and starts longPressTimer
  await viewportEl.emit('pointerdown', { pointerType: 'touch', clientX: 50, clientY: 100, pointerId: 42, target: wordSpan });
  assert.equal(selectionController.activePointerId, 42, 'Pointer ID must be captured');
  assert.notEqual(selectionController.longPressTimer, null, 'Long press timer must be active');

  // 2. Subsequent touchstart in same gesture must not wipe activePointerId or cancel timer
  await viewportEl.emit('touchstart', { touches: [{ clientX: 50, clientY: 100 }], target: wordSpan });
  assert.equal(selectionController.activePointerId, 42, 'Pointer ID must be preserved after touchstart');
  assert.notEqual(selectionController.longPressTimer, null, 'Long press timer must remain pending');

  // 3. Premature pointercancel during hold must NOT cancel longPressTimer
  await viewportEl.emit('pointercancel');
  assert.notEqual(selectionController.longPressTimer, null, 'pointercancel must not cancel pending longPressTimer');

  // 4. contextmenu in reader area must be defaultPrevented
  const menuEvt = await viewportEl.emit('contextmenu', { cancelable: true, target: wordSpan });
  assert.equal(menuEvt.defaultPrevented, true, 'contextmenu on viewport must be suppressed');

  const winMenuEvt = await context.window.emit('contextmenu', { cancelable: true, target: wordSpan });
  assert.equal(winMenuEvt.defaultPrevented, true, 'contextmenu on window must be suppressed');

  // 5. selectstart during hold/selection must be defaultPrevented
  const selectEvt = await viewportEl.emit('selectstart', { cancelable: true, target: wordSpan });
  assert.equal(selectEvt.defaultPrevented, true, 'selectstart must be suppressed during long press');

  // 6. Completing the timer activates selection
  selectionController.startLongPressSelection(selectionController.targetPoint);
  assert.equal(selectionController.isSelecting, true, 'Long press activates selection');

  // 7. Releasing ends selection cleanly
  await viewportEl.emit('touchend');
  assert.equal(selectionController.isSelecting, false, 'Selection ends on release');
  assert.equal(selectionController.longPressTimer, null, 'Timer is cleared on release');

  // 8. mobile-reader.css contains -webkit-touch-callout: none
  const mobileCss = fs.readFileSync(path.join(frontend, 'css/mobile/mobile-reader.css'), 'utf8');
  assert.ok(mobileCss.includes('-webkit-touch-callout: none !important'));
});
