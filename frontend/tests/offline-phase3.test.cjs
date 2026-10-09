'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const frontend = path.resolve(__dirname, '..');
const source = file => fs.readFileSync(path.join(frontend, 'js', file), 'utf8');

function createDOM() {
  const elements = new Map();
  class Element {
    constructor(tag = 'div') {
      this.tagName = tag;
      this._id = '';
      this.children = [];
      this.attributes = {};
      this.style = {};
      this.listeners = {};
      this.dataset = {};
      this.value = '';
      this.textContent = '';
      this.innerHTML = '';
      this.hidden = false;
      this.disabled = false;
      this.classes = new Set();
      this.classList = {
        add: name => this.classes.add(name),
        remove: name => this.classes.delete(name),
        contains: name => this.classes.has(name),
        toggle: (name, force) => force ?? !this.classes.has(name) ? this.classes.add(name) : this.classes.delete(name)
      };
    }
    get id() { return this._id; }
    set id(val) {
      this._id = val;
      elements.set(val, this);
    }
    get className() { return Array.from(this.classes).join(' '); }
    set className(val) {
      this.classes.clear();
      if (val) val.split(/\s+/).filter(Boolean).forEach(c => this.classes.add(c));
    }
    setAttribute(name, val) { this.attributes[name] = String(val); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    appendChild(child) { this.children.push(child); return child; }
    prepend(child) { this.children.unshift(child); return child; }
    replaceChildren(...children) { this.children = children; }
    querySelector(sel) {
      if (sel.startsWith('.')) {
        const cls = sel.slice(1);
        const search = (node) => {
          if (node.classList?.contains(cls)) return node;
          for (const c of node.children) {
            const found = search(c);
            if (found) return found;
          }
          return null;
        };
        return search(this);
      }
      return null;
    }
    querySelectorAll(sel) {
      const results = [];
      if (sel.startsWith('.')) {
        const cls = sel.slice(1);
        const search = (node) => {
          if (node.classList?.contains(cls)) results.push(node);
          for (const c of node.children) search(c);
        };
        search(this);
      }
      return results;
    }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    fire(type, event = {}) {
      for (const h of this.listeners[type] || []) h({ target: this, stopPropagation: () => {}, ...event });
    }
  }

  const document = {
    getElementById: id => elements.get(id) || null,
    querySelector: sel => null,
    querySelectorAll: () => [],
    createElement: tag => new Element(tag)
  };

  return { elements, Element, document };
}

test('ReaderDocumentLifecycle.loadPdfDocument uses cached blob first when isBookOfflineComplete is true', async () => {
  const { document } = createDOM();
  const trace = [];

  const fakeLocalDB = {
    isBookOfflineComplete: async id => {
      trace.push(['isBookOfflineComplete', id]);
      return id === 42;
    },
    getPdfBlob: async id => {
      trace.push(['getPdfBlob', id]);
      return { arrayBuffer: async () => new Uint8Array([37, 80, 68, 70]).buffer };
    }
  };

  const fakePdfjsLib = {
    getDocument: arg => {
      trace.push(['pdfjsLib.getDocument', typeof arg === 'string' ? arg : 'data-buffer']);
      return { promise: Promise.resolve({ numPages: 10 }) };
    }
  };

  const fakeReader = {
    openSequence: 1,
    loadingTask: null,
    destroyPdfResource: () => {}
  };

  const window = {};
  const context = vm.createContext({
    document,
    window,
    navigator: { onLine: true },
    localDB: fakeLocalDB,
    pdfjsLib: fakePdfjsLib,
    Uint8Array,
    console
  });

  vm.runInContext(source('viewmodels/reader/ReaderDocumentLifecycle.js'), context);
  const ReaderDocumentLifecycle = vm.runInContext('ReaderDocumentLifecycle', context);
  const lifecycle = new ReaderDocumentLifecycle(fakeReader);

  // Book 42 is offline-complete: even though navigator.onLine is true, it MUST load the blob directly!
  const doc42 = await lifecycle.loadPdfDocument(42, 1);
  assert.equal(doc42.numPages, 10);
  assert.deepEqual(trace, [
    ['isBookOfflineComplete', 42],
    ['getPdfBlob', 42],
    ['pdfjsLib.getDocument', 'data-buffer']
  ]);

  // Book 99 is NOT offline-complete: it should fetch from network URL
  trace.length = 0;
  const doc99 = await lifecycle.loadPdfDocument(99, 1);
  assert.equal(doc99.numPages, 10);
  assert.deepEqual(trace, [
    ['isBookOfflineComplete', 99],
    ['pdfjsLib.getDocument', '/api/books/99/pdf']
  ]);
});

test('ReaderPageRenderer renders error state with retry button on canvas render failure and logs diagnostics', async () => {
  const { Element, document } = createDOM();
  const loggedErrors = [];

  const fakePage = {
    getViewport: () => ({ width: 600, height: 800, scale: 1.0 })
  };

  const fakeModel = {
    bookId: 42,
    totalPages: 5,
    scale: 1.0,
    pdfDoc: {
      getPage: async p => fakePage
    }
  };

  const PDFPageView = {
    createPageCanvas: (p, w, h, s) => new Element('canvas'),
    renderPDFPageToCanvas: (page, canvas, viewport, outputScale) => ({
      promise: Promise.reject(new Error('Canvas memory limit exceeded'))
    })
  };

  const HighlightOverlayView = {
    createHighlightLayerContainer: () => new Element('div')
  };

  const DrawingCanvasView = {
    createDrawingCanvas: () => new Element('canvas')
  };

  const TextLayerView = {
    createTextLayerContainer: () => new Element('div')
  };

  const customConsole = {
    error: (...args) => loggedErrors.push(args.join(' ')),
    warn: () => {},
    log: () => {}
  };

  const window = { devicePixelRatio: 1 };
  const context = vm.createContext({
    document,
    window,
    PDFPageView,
    HighlightOverlayView,
    DrawingCanvasView,
    TextLayerView,
    api: { getPageLayout: async () => null },
    pdfjsLib: {},
    console: customConsole,
    Math
  });

  vm.runInContext(source('viewmodels/reader/ReaderPageRenderer.js'), context);
  const ReaderPageRenderer = vm.runInContext('ReaderPageRenderer', context);

  const renderer = new ReaderPageRenderer(fakeModel, new Element('div'), new Element('div'), null, null);
  const pageWrapper = new Element('div');

  const rendered = await renderer.populatePageWrapper(pageWrapper, 1);
  assert.equal(rendered, false, 'populatePageWrapper must return false on canvas render failure');

  // Verify diagnostic log was emitted without private content
  assert.ok(loggedErrors.some(log => log.includes('Diagnostic render failure: Book 42, Page 1')));

  // Verify error state DOM was rendered
  const errorContainer = pageWrapper.querySelector('.pdf-page-render-error');
  assert.ok(errorContainer, 'Error container must be rendered inside pageWrapper');

  const retryBtn = errorContainer.querySelector('.retry-page-render-btn');
  assert.ok(retryBtn, 'Retry button must be present in error state');

  // Verify no text layer or highlight layer was rendered on top of the failed canvas
  const hlLayer = pageWrapper.querySelector('.pdf-highlight-layer');
  assert.equal(hlLayer, null, 'Highlight layer must not be appended when canvas fails');
});
