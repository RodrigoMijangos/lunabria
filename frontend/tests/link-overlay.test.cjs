"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const frontend = path.resolve(__dirname, "..");
const source = (file) => fs.readFileSync(path.join(frontend, "js", file), "utf8");

class EventTargetStub {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, handler, capture = false) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push({ handler, capture });
  }

  removeEventListener(type, handler, capture = false) {
    this.listeners.set(
      type,
      (this.listeners.get(type) || []).filter(
        (listener) => listener.handler !== handler || listener.capture !== capture,
      ),
    );
  }

  async emit(type, properties = {}) {
    const event = { type, target: this, preventDefault() {}, ...properties };
    for (const listener of [...(this.listeners.get(type) || [])]) await listener.handler(event);
    return event;
  }
}

class ElementStub extends EventTargetStub {
  constructor(tag = "div") {
    super();
    this.tagName = tag.toUpperCase();
    this.style = {};
    this.dataset = {};
    this.children = [];
    this.attributes = {};
    this.rect = { left: 100, top: 200, width: 200, height: 100 };
    this.isConnected = true;
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getBoundingClientRect() {
    return this.rect;
  }
}

function createContext() {
  const warnings = [];
  const errors = [];
  const window = new EventTargetStub();
  const document = { createElement: (tag) => new ElementStub(tag) };
  const context = vm.createContext({
    window,
    document,
    console: {
      warn: (...args) => warnings.push(args),
      error: (...args) => errors.push(args),
    },
  });
  vm.runInContext(source("views/reader/LinkOverlayView.js"), context);
  vm.runInContext(source("viewmodels/reader/ReaderPageLayerBuilder.js"), context);
  vm.runInContext(source("viewmodels/reader/ReaderPageRenderer.js"), context);
  return { context, window, warnings, errors };
}

function makeViewport() {
  return {
    width: 200,
    height: 100,
    convertToViewportRectangle: ([left, bottom, right, top]) => [left, 100 - top, right, 100 - bottom],
  };
}

function makeOverlay({ model = { isDrawMode: false, drawTool: "pen" }, links } = {}) {
  const { context, window } = createContext();
  const pageWrapper = new ElementStub();
  pageWrapper.dataset.page = "4";
  pageWrapper.style.width = "200px";
  pageWrapper.style.height = "100px";
  const navigations = [];
  const view = new context.window.LinkOverlayView(
    pageWrapper,
    links || [{ targetPage: 8, rect: [10, 20, 30, 30], label: "Go to note 8" }],
    makeViewport(),
    model,
    { isDrawing: false },
    (targetPage, sourcePage) => navigations.push({ targetPage, sourcePage }),
  );
  const layer = view.render();
  if (layer) pageWrapper.appendChild(layer);
  return { view, layer, pageWrapper, navigations, window };
}

test("link rectangles are converted, expanded to touch size and exposed as named keyboard buttons", async () => {
  const { layer, pageWrapper, navigations } = makeOverlay();
  assert.equal(layer.className, "pdf-link-layer");
  assert.equal(pageWrapper.children[0], layer);
  const [button] = layer.children;

  assert.equal(button.tagName, "BUTTON");
  assert.equal(button.type, "button");
  assert.equal(button.className, "pdf-internal-link");
  assert.equal(button.attributes["aria-label"], "Go to note 8");
  assert.equal(button.style.left, "8px");
  assert.equal(button.style.top, "63px");
  assert.equal(button.style.width, "24px");
  assert.equal(button.style.height, "24px");

  await button.emit("click");
  assert.deepEqual(navigations, [{ targetPage: 8, sourcePage: 4 }]);
});

test("mouse taps activate links while drags do not", async () => {
  const { view, pageWrapper, navigations, window } = makeOverlay();
  await pageWrapper.emit("pointerdown", {
    button: 0,
    isPrimary: true,
    pointerType: "mouse",
    pointerId: 1,
    clientX: 120,
    clientY: 275,
    timeStamp: 10,
  });
  await window.emit("pointerup", {
    pointerType: "mouse",
    pointerId: 1,
    clientX: 120,
    clientY: 275,
    timeStamp: 40,
  });
  assert.equal(navigations.length, 1);

  await pageWrapper.emit("pointerdown", {
    button: 0,
    isPrimary: true,
    pointerType: "mouse",
    pointerId: 2,
    clientX: 120,
    clientY: 275,
    timeStamp: 100,
  });
  await window.emit("pointermove", {
    pointerType: "mouse",
    pointerId: 2,
    clientX: 129,
    clientY: 275,
    timeStamp: 110,
  });
  await window.emit("pointerup", {
    pointerType: "mouse",
    pointerId: 2,
    clientX: 129,
    clientY: 275,
    timeStamp: 120,
  });
  assert.equal(navigations.length, 1);
  assert.equal(view.activePointer, null);
});

test("mobile pan accepts short touch taps but rejects long presses and drawing gestures", async () => {
  const { view, pageWrapper, navigations, window } = makeOverlay({
    model: { isDrawMode: true, drawTool: "pan" },
  });

  await pageWrapper.emit("pointerdown", {
    button: 0,
    isPrimary: true,
    pointerType: "touch",
    pointerId: 3,
    clientX: 120,
    clientY: 275,
    timeStamp: 100,
  });
  await window.emit("pointerup", {
    pointerType: "touch",
    pointerId: 3,
    clientX: 120,
    clientY: 275,
    timeStamp: 350,
  });
  assert.equal(navigations.length, 1);

  await pageWrapper.emit("pointerdown", {
    button: 0,
    isPrimary: true,
    pointerType: "touch",
    pointerId: 4,
    clientX: 120,
    clientY: 275,
    timeStamp: 500,
  });
  await window.emit("pointerup", {
    pointerType: "touch",
    pointerId: 4,
    clientX: 120,
    clientY: 275,
    timeStamp: 900,
  });
  assert.equal(navigations.length, 1);

  const drawingMode = makeOverlay({ model: { isDrawMode: true, drawTool: "pen" } });
  await drawingMode.pageWrapper.emit("pointerdown", {
    button: 0,
    isPrimary: true,
    pointerType: "pen",
    pointerId: 5,
    clientX: 120,
    clientY: 275,
    timeStamp: 1000,
  });
  await drawingMode.window.emit("pointerup", {
    pointerType: "pen",
    pointerId: 5,
    clientX: 120,
    clientY: 275,
    timeStamp: 1020,
  });
  assert.deepEqual(drawingMode.navigations, []);
  assert.equal(view.activePointer, null);
});

test("hover cursor indicates links and restores the page cursor on exit", async () => {
  const { view, pageWrapper } = makeOverlay();
  const target = { style: { cursor: "text" } };
  await pageWrapper.emit("pointermove", {
    pointerType: "mouse",
    target,
    clientX: 120,
    clientY: 275,
  });
  assert.equal(target.style.cursor, "pointer");
  await pageWrapper.emit("pointerleave");
  assert.equal(target.style.cursor, "text");
  assert.equal(view.cursorTarget, null);
});

test("only resolvable internal PDF destinations create link buttons", async () => {
  const { context, warnings, errors } = createContext();
  const model = {
    totalPages: 6,
    navigationMap: {
      resolveDestination: (destination) => (destination === "known" ? 2 : destination === "out-of-range" ? 99 : null),
    },
    pdfDoc: {
      numPages: 6,
      getDestination: async (destination) => (destination === "named" ? [{ pageIndex: 2 }] : null),
      getPageIndex: async (reference) => reference.pageIndex,
    },
  };
  const annotations = [
    { subtype: "Link", dest: "known", rect: [10, 20, 30, 30], title: "Known destination" },
    { subtype: "Link", dest: "named", rect: [40, 20, 60, 30], contents: "Named destination" },
    { subtype: "Link", dest: [{ pageIndex: 5 }], rect: [70, 20, 90, 30] },
    { subtype: "Link", url: "https://example.test/", dest: "named", rect: [10, 40, 30, 50] },
    { subtype: "Link", unsafeUrl: "javascript:alert(1)", dest: "named", rect: [40, 40, 60, 50] },
    { subtype: "Link", action: "GoToR", dest: "named", rect: [70, 40, 90, 50] },
    { subtype: "Link", dest: "broken", rect: [10, 60, 30, 70] },
    { subtype: "Link", dest: "out-of-range", rect: [40, 60, 60, 70] },
    { subtype: "Link", dest: "known", rect: [Number.NaN, 20, 30, 30] },
  ];
  const pageWrapper = new ElementStub();
  pageWrapper.dataset.page = "4";
  pageWrapper.style.width = "200px";
  pageWrapper.style.height = "100px";
  const navigations = [];
  const renderer = new context.window.ReaderPageRenderer(model, null, null, null, null, {
    onInternalLinkNavigate: (targetPage, sourcePage) => navigations.push({ targetPage, sourcePage }),
  });

  await renderer.renderInternalLinks(pageWrapper, { getAnnotations: async () => annotations }, makeViewport(), 4, 0);

  const [layer] = pageWrapper.children;
  assert.equal(layer.className, "pdf-link-layer");
  assert.deepEqual(
    layer.children.map((button) => button.attributes["aria-label"]),
    ["Known destination", "Named destination", "Go to page 6"],
  );
  await layer.children[0].emit("click");
  assert.deepEqual(navigations, [{ targetPage: 2, sourcePage: 4 }]);
  assert.equal(warnings.length, 2);
  assert.deepEqual(errors, []);
  assert.equal(await renderer.resolveLinkDestination(99), null);
});
