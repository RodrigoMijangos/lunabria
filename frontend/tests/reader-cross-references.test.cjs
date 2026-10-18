'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const frontend = path.resolve(__dirname, '..');
const textLayerSource = fs.readFileSync(
  path.join(frontend, 'js', 'views', 'reader', 'TextLayerView.js'),
  'utf8'
);
const rendererSource = fs.readFileSync(
  path.join(frontend, 'js', 'viewmodels', 'reader', 'ReaderPageRenderer.js'),
  'utf8'
);

class EventTargetStub {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }

  removeEventListener(type, handler) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter(listener => listener !== handler));
  }

  emit(type, properties = {}) {
    const event = {
      type,
      target: this,
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      ...properties
    };
    for (const handler of this.listeners.get(type) || []) handler(event);
    return event;
  }
}

class TextNodeStub {
  constructor(text) {
    this.nodeType = 3;
    this.textContent = text;
    this.parentNode = null;
  }

  splitText(offset) {
    const suffix = new TextNodeStub(this.textContent.slice(offset));
    this.textContent = this.textContent.slice(0, offset);
    this.parentNode?.insertAfter(this, suffix);
    return suffix;
  }
}

class ElementStub extends EventTargetStub {
  constructor(tagName = 'div') {
    super();
    this.nodeType = 1;
    this.tagName = tagName.toUpperCase();
    this.attributes = {};
    this.childNodes = [];
    this.dataset = {};
    this._classes = new Set();
    this.classList = {
      add: (...names) => names.forEach(name => this._classes.add(name)),
      remove: (...names) => names.forEach(name => this._classes.delete(name)),
      contains: name => this._classes.has(name)
    };
    this.style = { setProperty() {} };
  }

  set className(value) {
    this._classes = new Set(String(value).split(/\s+/).filter(Boolean));
  }

  get className() {
    return Array.from(this._classes).join(' ');
  }

  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  insertAfter(reference, child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    const index = this.childNodes.indexOf(reference);
    child.parentNode = this;
    this.childNodes.splice(index + 1, 0, child);
  }

  replaceChild(replacement, child) {
    const index = this.childNodes.indexOf(child);
    if (index < 0) throw new Error('Child not found');
    if (replacement.parentNode) replacement.parentNode.removeChild(replacement);
    replacement.parentNode = this;
    child.parentNode = null;
    this.childNodes[index] = replacement;
    return child;
  }

  removeChild(child) {
    const index = this.childNodes.indexOf(child);
    if (index >= 0) this.childNodes.splice(index, 1);
    child.parentNode = null;
    return child;
  }

  appendText(text) {
    return this.appendChild(new TextNodeStub(text));
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  closest() {
    return null;
  }

  querySelectorAll() {
    return [];
  }

  get textContent() {
    return this.childNodes.map(child => child.textContent).join('');
  }

  set textContent(value) {
    this.childNodes = [];
    if (value) this.appendText(String(value));
  }
}

function createTextLayerWorld() {
  const timers = new Map();
  let nextTimer = 0;
  const window = new EventTargetStub();
  window.getSelection = () => ({ isCollapsed: true });
  const document = { createElement: tagName => new ElementStub(tagName) };
  const context = vm.createContext({
    window,
    document,
    console,
    setTimeout: (callback, delay) => {
      const id = ++nextTimer;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout: id => timers.delete(id),
    api: { getPageLayout: async () => null },
    pdfjsLib: {}
  });
  vm.runInContext(textLayerSource, context, { filename: 'TextLayerView.js', timeout: 2000 });
  return {
    context,
    window,
    document,
    timers,
    textLayerView: vm.runInContext('TextLayerView', context)
  };
}

const navigationMap = {
  toc: [
    { title: 'Chapter 3: The Moon', page: 5, level: 0, children: [] },
    {
      title: 'Chapter IV - The Garden',
      page: 8,
      level: 0,
      children: [
        { title: 'Section 2.1.5: The Gate', page: 11, level: 1, children: [] },
        { title: '2.2 The Path', page: 12, level: 1, children: [] }
      ]
    },
    { title: '2.3 Flat section', page: 13, level: 0, children: [] }
  ]
};

function findAnchors(root) {
  const anchors = [];
  const visit = node => {
    if (node.nodeType === 1 && node.classList.contains('reader-reference-link')) {
      anchors.push(node);
    }
    for (const child of node.childNodes || []) visit(child);
  };
  visit(root);
  return anchors;
}

function decoratedReference(text = 'See Chapter 3 now.') {
  const world = createTextLayerWorld();
  const container = new ElementStub();
  container.dataset = {};
  container.appendText(text);
  const navigations = [];
  const count = world.textLayerView.decorateCrossReferences(
    container,
    navigationMap,
    4,
    (targetPage, sourcePage) => navigations.push({ targetPage, sourcePage })
  );
  return { ...world, container, navigations, count, links: findAnchors(container) };
}

test('cross-references match strict TOC chapter and section titles with accents and Roman numerals', () => {
  const { textLayerView } = createTextLayerWorld();
  const text = 'Capítulo 3, chapter iv, sección 2.1.5, section 2.2, section 2.3, chapter 9, section 3.1.';
  const references = textLayerView.findCrossReferences(text, navigationMap);

  assert.deepEqual(Array.from(references, reference => ({
    text: reference.text,
    kind: reference.kind,
    targetPage: reference.targetPage
  })), [
    { text: 'Capítulo 3', kind: 'chapter', targetPage: 5 },
    { text: 'chapter iv', kind: 'chapter', targetPage: 8 },
    { text: 'sección 2.1.5', kind: 'section', targetPage: 11 },
    { text: 'section 2.2', kind: 'section', targetPage: 12 },
    { text: 'section 2.3', kind: 'section', targetPage: 13 }
  ]);
  for (const reference of references) {
    assert.equal(text.slice(reference.start, reference.end), reference.text);
  }
});

test('text decoration preserves split DOM text and exposes one keyboard stop per reference', () => {
  const world = createTextLayerWorld();
  const container = new ElementStub();
  container.dataset = {};
  container.appendText('See Chap');
  container.appendText('ter 3 in this paragraph.');
  const originalText = container.textContent;

  const decoratedCount = world.textLayerView.decorateCrossReferences(
    container,
    navigationMap,
    4,
    () => {}
  );
  const links = findAnchors(container);

  assert.equal(decoratedCount, 2);
  assert.equal(container.textContent, originalText);
  assert.equal(links.length, 2);
  assert.equal(links[0].tabIndex, 0);
  assert.equal(links[0].getAttribute('aria-label'), 'Go to Chapter 3, page 5');
  assert.equal(links[1].tabIndex, -1);
  assert.equal(links[1].getAttribute('aria-hidden'), 'true');
  assert.equal(world.textLayerView.decorateCrossReferences(container, navigationMap, 4, () => {}), 0);
});

test('reference taps navigate, while selection, native PDF links, drags, and long holds do not', () => {
  const tap = decoratedReference();
  tap.links[0].emit('pointerdown', {
    button: 0, isPrimary: true, pointerId: 3, pointerType: 'mouse',
    clientX: 20, clientY: 20, timeStamp: 10
  });
  tap.window.emit('pointerup', { pointerId: 3, clientX: 20, clientY: 20, timeStamp: 50 });
  const tapEvent = tap.links[0].emit('click', { detail: 1, clientX: 20, clientY: 20 });
  assert.equal(tapEvent.defaultPrevented, true);
  assert.deepEqual(tap.navigations, [{ targetPage: 5, sourcePage: 4 }]);

  const touchTap = decoratedReference();
  touchTap.links[0].emit('pointerdown', {
    button: 0, isPrimary: true, pointerId: 4, pointerType: 'touch',
    clientX: 20, clientY: 20, timeStamp: 100
  });
  touchTap.window.emit('pointerup', { pointerId: 4, clientX: 20, clientY: 20, timeStamp: 350 });
  touchTap.links[0].emit('click', { detail: 1, clientX: 20, clientY: 20 });
  assert.deepEqual(touchTap.navigations, [{ targetPage: 5, sourcePage: 4 }]);

  const keyboard = decoratedReference();
  keyboard.window.getSelection = () => ({ isCollapsed: false });
  keyboard.links[0].emit('click', { detail: 0 });
  assert.deepEqual(keyboard.navigations, [{ targetPage: 5, sourcePage: 4 }]);

  const selected = decoratedReference();
  selected.window.getSelection = () => ({ isCollapsed: false });
  selected.links[0].emit('click', { detail: 1, clientX: 20, clientY: 20 });
  assert.deepEqual(selected.navigations, []);

  const nativeLink = decoratedReference();
  const pageWrapper = {
    querySelectorAll: () => [{
      getBoundingClientRect: () => ({ left: 10, right: 30, top: 10, bottom: 30 })
    }]
  };
  nativeLink.container.closest = () => pageWrapper;
  nativeLink.links[0].emit('click', { detail: 1, clientX: 20, clientY: 20 });
  assert.deepEqual(nativeLink.navigations, []);

  const dragged = decoratedReference();
  const link = dragged.links[0];
  link.emit('pointerdown', {
    button: 0, isPrimary: true, pointerId: 1, pointerType: 'mouse',
    clientX: 10, clientY: 10, timeStamp: 100
  });
  dragged.window.emit('pointermove', { pointerId: 1, clientX: 30, clientY: 10, timeStamp: 110 });
  dragged.window.emit('pointerup', { pointerId: 1, clientX: 30, clientY: 10, timeStamp: 120 });
  link.emit('click', { detail: 1, clientX: 30, clientY: 10 });
  assert.deepEqual(dragged.navigations, []);

  const held = decoratedReference();
  held.links[0].emit('pointerdown', {
    button: 0, isPrimary: true, pointerId: 2, pointerType: 'touch',
    clientX: 10, clientY: 10, timeStamp: 100
  });
  held.window.emit('pointerup', { pointerId: 2, clientX: 10, clientY: 10, timeStamp: 500 });
  held.links[0].emit('click', { detail: 1, clientX: 10, clientY: 10 });
  assert.deepEqual(held.navigations, []);
});

test('ReaderPageRenderer decorates both precise layouts and the PDF.js fallback text layer', async () => {
  const world = createTextLayerWorld();
  const trace = [];
  world.textLayerView.createTextLayerContainer = () => new ElementStub();
  world.textLayerView.groupWordsIntoLines = words => words;
  world.textLayerView.renderPreciseLines = () => trace.push('precise');
  world.textLayerView.decorateCrossReferences = (...args) => trace.push(['decorate', ...args.slice(1)]);
  world.context.pdfjsLib.TextLayer = class {
    constructor({ container }) {
      this.container = container;
    }

    async render() {
      this.container.appendText('Chapter 3');
      trace.push('fallback');
    }
  };
  vm.runInContext(rendererSource, world.context, { filename: 'ReaderPageRenderer.js', timeout: 2000 });
  const ReaderPageRenderer = vm.runInContext('ReaderPageRenderer', world.context);
  const model = { bookId: 1, totalPages: 20, navigationMap, pdfDoc: {} };
  const callback = () => {};
  const renderer = new ReaderPageRenderer(model, null, null, null, null, {
    onTextReferenceNavigate: callback
  });
  renderer.renderGeneration = 1;

  const createPageWrapper = () => ({
    style: { setProperty() {} },
    children: [],
    appendChild(child) { this.children.push(child); }
  });

  await renderer.renderTextLayer(
    createPageWrapper(),
    { getTextContent: async () => ({ items: [] }) },
    4,
    100,
    200,
    { scale: 1 },
    1,
    1
  );
  assert.equal(trace[0], 'fallback');
  assert.equal(trace[1][0], 'decorate');
  assert.equal(trace[1][1], navigationMap);
  assert.equal(trace[1][2], 4);
  assert.equal(trace[1][3], callback);

  trace.length = 0;
  world.context.api.getPageLayout = async () => ({ words: [{ text: 'Chapter 3' }], lines: [] });
  await renderer.renderTextLayer(
    createPageWrapper(),
    { getTextContent: async () => ({ items: [] }) },
    5,
    100,
    200,
    { scale: 1 },
    1,
    1
  );
  assert.equal(trace[0], 'precise');
  assert.equal(trace[1][0], 'decorate');
  assert.equal(trace[1][1], navigationMap);
  assert.equal(trace[1][2], 5);
});
