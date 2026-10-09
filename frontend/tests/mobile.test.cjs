'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const frontend = path.resolve(__dirname, '..');

function loadScript(context, relativePath) {
  const code = fs.readFileSync(path.join(frontend, relativePath), 'utf8');
  vm.runInContext(code, context);
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
    window: {
      addEventListener: () => {},
      removeEventListener: () => {},
      innerWidth: 375,
      innerHeight: 667,
      devicePixelRatio: 2,
      getSelection: () => currentSelection,
      navigator: {
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)',
        maxTouchPoints: 5
      }
    },
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
