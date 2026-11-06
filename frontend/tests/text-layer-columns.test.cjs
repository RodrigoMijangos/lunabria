const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { ReaderSelectionGeometry } = require("../js/services/reader/ReaderSelectionGeometry.js");

class MockElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.style = {};
    this.dataset = {};
    this.attributes = {};
    this.children = [];
    this.childNodes = [];
    this.className = "";
    this._textContent = "";
    this.parentElement = null;
  }

  get textContent() {
    if (this.children.length > 0) {
      return this.children.map((child) => child.textContent).join("");
    }
    return this._textContent;
  }

  set textContent(value) {
    this._textContent = String(value ?? "");
    this.children = [];
    const textNode = {
      nodeType: 3,
      textContent: this._textContent,
      parentElement: this,
    };
    this.childNodes = [textNode];
  }

  get firstChild() {
    return this.childNodes[0] || null;
  }

  set innerHTML(value) {
    if (value === "") {
      this.children = [];
      this.childNodes = [];
      this._textContent = "";
    }
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    this.childNodes.push(child);
    return child;
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  contains(target) {
    if (!target) return false;
    if (target === this) return true;
    if (this.childNodes.includes(target)) return true;
    return this.children.some((child) => typeof child.contains === "function" && child.contains(target));
  }

  closest(selector) {
    const classes = selector
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.startsWith("."))
      .map((s) => s.slice(1));
    let curr = this;
    while (curr) {
      const currClasses = (curr.className || "").split(/\s+/);
      if (classes.some((cls) => currClasses.includes(cls))) return curr;
      curr = curr.parentElement;
    }
    return null;
  }

  getBoundingClientRect() {
    if (this._rect) return this._rect;
    const x0 = Number.parseFloat(this.dataset.x0);
    const y0 = Number.parseFloat(this.dataset.y0);
    const x1 = Number.parseFloat(this.dataset.x1);
    const y1 = Number.parseFloat(this.dataset.y1);
    if (Number.isFinite(x0) && Number.isFinite(y0) && Number.isFinite(x1) && Number.isFinite(y1)) {
      return {
        left: x0,
        top: y0,
        right: x1,
        bottom: y1,
        width: x1 - x0,
        height: y1 - y0,
      };
    }
    const left = Number.parseFloat(this.style.left) || 0;
    const top = Number.parseFloat(this.style.top) || 0;
    const width = Number.parseFloat(this.style.width) || 0;
    const height = Number.parseFloat(this.style.height) || 0;
    return { left, top, right: left + width, bottom: top + height, width, height };
  }

  querySelectorAll(selector) {
    const className = selector.slice(1);
    const matches = [];
    const visit = (element) => {
      for (const child of element.children) {
        if (child.className.split(/\s+/).includes(className)) matches.push(child);
        visit(child);
      }
    };
    visit(this);
    return matches;
  }
}

function createSelectionEnvironment() {
  const context = vm.createContext({
    document: {
      createElement: (tagName) => new MockElement(tagName),
      createTreeWalker: (element) => {
        let consumed = false;
        return {
          nextNode: () => {
            if (consumed) return null;
            consumed = true;
            return element.firstChild || null;
          },
        };
      },
    },
    Node: { TEXT_NODE: 3 },
    NodeFilter: { SHOW_TEXT: 4 },
    window: {},
  });
  const textLayerSource = fs.readFileSync(path.join(__dirname, "../js/views/reader/TextLayerView.js"), "utf8");
  const geometrySource = fs.readFileSync(
    path.join(__dirname, "../js/services/reader/ReaderTextTargetGeometry.js"),
    "utf8",
  );
  vm.runInContext(textLayerSource, context);
  vm.runInContext(geometrySource, context);
  return {
    TextLayerView: context.window.TextLayerView,
    ReaderTextTargetGeometry: context.window.ReaderTextTargetGeometry,
  };
}

function createTextLayerView() {
  return createSelectionEnvironment().TextLayerView;
}

test("native block and line ids separate and order multi-column rows", () => {
  const view = createTextLayerView();
  const words = [
    { text: "LEFT", x0: 50, y0: 100, x1: 95, y1: 115, block: 0, line: 0, word: 0 },
    { text: "RIGHT", x0: 320, y0: 100, x1: 370, y1: 115, block: 0, line: 0, word: 1 },
    { text: "COLUMN", x0: 50, y0: 120, x1: 105, y1: 135, block: 0, line: 1, word: 0 },
    { text: "TEXT", x0: 320, y0: 120, x1: 360, y1: 135, block: 0, line: 1, word: 1 },
  ];

  const lines = view.groupWordsIntoLines(words);

  assert.deepEqual(
    Array.from(lines, (line) => line.text),
    ["LEFT", "COLUMN", "RIGHT", "TEXT"],
  );
  assert.ok(lines.every((line) => line.x1 - line.x0 < 100));
});

test("geometric fallback separates same-height columns and bounds line height", () => {
  const view = createTextLayerView();
  const words = [
    { text: "LEFT1", x0: 50, y0: 100, x1: 95, y1: 115 },
    { text: "RIGHT1", x0: 320, y0: 100, x1: 370, y1: 115 },
    { text: "LEFT2", x0: 50, y0: 120, x1: 95, y1: 135 },
    { text: "RIGHT2", x0: 320, y0: 120, x1: 370, y1: 135 },
  ];

  const lines = view.groupWordsIntoLines(words);

  assert.equal(lines.length, 4);
  assert.deepEqual(
    Array.from(lines, (line) => line.text),
    ["LEFT1", "LEFT2", "RIGHT1", "RIGHT2"],
  );
  assert.ok(lines.every((line) => line.words.length === 1));
  assert.ok(lines.every((line) => line.y1 - line.y0 <= 40));
});

test("vertical margin words render as isolated rotated lines and trail horizontal body blocks", () => {
  const view = createTextLayerView();
  const lines = view.groupWordsIntoLines([
    {
      text: "MARGIN",
      x0: 550,
      y0: 300,
      x1: 562,
      y1: 350,
      block: 0,
      line: 0,
      word: 0,
    },
    {
      text: "TITLE",
      x0: 550,
      y0: 250,
      x1: 562,
      y1: 295,
      block: 0,
      line: 0,
      word: 1,
      direction: [0, -1],
    },
    {
      text: "FOOTER",
      x0: 100,
      y0: 760,
      x1: 220,
      y1: 774,
      block: 1,
      line: 0,
      word: 0,
    },
    {
      text: "BODY",
      x0: 70,
      y0: 60,
      x1: 140,
      y1: 76,
      block: 2,
      line: 0,
      word: 0,
    },
  ]);
  const container = new MockElement("div");

  assert.deepEqual(
    Array.from(lines, (line) => line.text),
    ["BODY", "FOOTER", "MARGIN", "TITLE"],
  );
  assert.ok(lines.slice(2).every((line) => line.is_vertical));
  view.renderPreciseLines(container, lines, 2);

  assert.equal(container.children[0].dataset.isVertical, "false");
  assert.ok(container.children.slice(2).every((line) => line.dataset.isVertical === "true"));
  assert.ok(container.children.slice(2).every((line) => Number.parseFloat(line.style.height) <= 100));
  assert.ok(
    container.children
      .slice(2)
      .every((line) => line.querySelectorAll(".precise-word")[0].style.transform.startsWith("rotate(-90deg)")),
  );
});

test("merges justified same-row line fragments and keeps upward drag on the preceding line in the same column", () => {
  const { TextLayerView, ReaderTextTargetGeometry } = createSelectionEnvironment();
  const words = [
    // Block 0: vertical margin citation on the right margin
    { text: "Revista", x0: 547, y0: 580, x1: 558, y1: 635, block: 0, line: 0, word: 0, direction: [0, -1] },
    { text: "Luciernaga", x0: 547, y0: 640, x1: 558, y1: 710, block: 0, line: 0, word: 1, direction: [0, -1] },
    // Block 1: left column lines
    { text: "Left", x0: 70, y0: 598, x1: 120, y1: 616, block: 1, line: 0, word: 0 },
    { text: "column", x0: 128, y0: 598, x1: 286, y1: 616, block: 1, line: 0, word: 1 },
    { text: "Adjacent", x0: 70, y0: 623, x1: 150, y1: 641, block: 1, line: 1, word: 0 },
    { text: "text", x0: 158, y0: 623, x1: 286, y1: 641, block: 1, line: 1, word: 1 },
    { text: "Lower", x0: 70, y0: 636, x1: 140, y1: 654, block: 1, line: 2, word: 0 },
    { text: "left", x0: 148, y0: 636, x1: 286, y1: 654, block: 1, line: 2, word: 1 },
    // Block 2: right column lines (with a short line and a fragmented justified line)
    { text: "author.", x0: 300, y0: 573, x1: 338, y1: 591, block: 2, line: 0, word: 0 },
    { text: "Overall,", x0: 300, y0: 598, x1: 355, y1: 616, block: 2, line: 1, word: 0 },
    { text: "editors", x0: 362, y0: 598, x1: 420, y1: 616, block: 2, line: 1, word: 1 },
    { text: "provided", x0: 428, y0: 598, x1: 518, y1: 616, block: 2, line: 1, word: 2 },
    { text: "including", x0: 300, y0: 623, x1: 350, y1: 641, block: 2, line: 2, word: 0 },
    { text: "within", x0: 365, y0: 623, x1: 399, y1: 641, block: 2, line: 3, word: 0 },
    { text: "the", x0: 414, y0: 623, x1: 433, y1: 641, block: 2, line: 4, word: 0 },
    { text: "Philosophical", x0: 448, y0: 623, x1: 518, y1: 641, block: 2, line: 5, word: 0 },
    { text: "Transactions.", x0: 300, y0: 636, x1: 380, y1: 654, block: 2, line: 6, word: 0 },
    { text: "On", x0: 388, y0: 636, x1: 410, y1: 654, block: 2, line: 6, word: 1 },
    { text: "hand", x0: 418, y0: 636, x1: 518, y1: 654, block: 2, line: 6, word: 2 },
  ];

  const lines = TextLayerView.groupWordsIntoLines(words);
  const container = new MockElement("div");
  TextLayerView.renderPreciseLines(container, lines, 1);

  const horizontalTexts = lines.filter((l) => !l.is_vertical).map((l) => l.text);
  assert.ok(horizontalTexts.includes("including within the Philosophical"));

  // Start selection on "Transactions." in right column (x=310, y=645)
  const anchor = ReaderTextTargetGeometry.findTextTargetWithinGap(310, 645, container, 44, 30, false);
  assert.equal(anchor.span.textContent.trim(), "Transactions.");

  // Drag upward to the preceding line with slight leftward drift into the column gutter (x=292, y=632)
  const focusGutter = ReaderTextTargetGeometry.findTextTargetWithinGap(
    292,
    632,
    container,
    Infinity,
    Infinity,
    true,
    anchor,
  );
  assert.equal(focusGutter.span.closest(".precise-line").dataset.isVertical, "false");
  assert.equal(focusGutter.span.textContent.trim(), "including");

  // Drag upward to the preceding line near the right margin (x=535, y=632) — must not jump to vertical margin text
  const focusRightMargin = ReaderTextTargetGeometry.findTextTargetWithinGap(
    535,
    632,
    container,
    Infinity,
    Infinity,
    true,
    anchor,
  );
  assert.equal(focusRightMargin.span.closest(".precise-line").dataset.isVertical, "false");
  assert.equal(focusRightMargin.span.textContent.trim(), "Philosophical");

  // Start selection on "provided" (x=470, y=607) and drag straight up to the short line "author." (x=470, y=582)
  const anchorProvided = ReaderTextTargetGeometry.findTextTargetWithinGap(470, 607, container, 44, 30, false);
  assert.equal(anchorProvided.span.textContent.trim(), "provided");
  const focusShortLine = ReaderTextTargetGeometry.findTextTargetWithinGap(
    470,
    582,
    container,
    Infinity,
    Infinity,
    true,
    anchorProvided,
  );
  assert.equal(focusShortLine.span.textContent.trim(), "author.");
});

test("selection geometry clips oversized line data to the selected text rect", () => {
  const result = ReaderSelectionGeometry.relativeRect(
    { left: 20, right: 70, top: 200, bottom: 212 },
    { left: 0, top: 0 },
    1,
    { x0: "0", y0: "100", x1: "500", y1: "700" },
  );

  assert.deepEqual(result, { x0: 20, y0: 198.8, x1: 70, y1: 213.2 });
  assert.ok(result.y1 - result.y0 < 50);
});

test("selection line matching ignores tall vertical margin text outside the selected column", () => {
  const selectionRect = { left: 100, right: 180, top: 200, bottom: 215 };
  const rotatedMarginText = { left: 550, right: 563, top: 100, bottom: 700 };
  const bodyLine = { left: 90, right: 400, top: 198, bottom: 218 };

  assert.equal(ReaderSelectionGeometry.lineMatchScore(selectionRect, rotatedMarginText, 207.5), null);
  assert.ok(ReaderSelectionGeometry.lineMatchScore(selectionRect, bodyLine, 207.5) > 0);
});
