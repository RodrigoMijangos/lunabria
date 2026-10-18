'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const frontend = path.resolve(__dirname, '..');

class ElementStub {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.attributes = {};
    this.style = {};
    this.listeners = new Map();
    this.classNames = new Set();
    this.classList = {
      add: name => this.classNames.add(name),
      toggle: (name, force) => {
        const active = force === undefined ? !this.classNames.has(name) : Boolean(force);
        if (active) this.classNames.add(name);
        else this.classNames.delete(name);
        return active;
      },
      contains: name => this.classNames.has(name)
    };
    Object.defineProperty(this, 'className', {
      get: () => Array.from(this.classNames).join(' '),
      set: value => {
        this.classNames = new Set(String(value).split(/\s+/).filter(Boolean));
      }
    });
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  async emit(type, event = {}) {
    for (const handler of this.listeners.get(type) || []) await handler({ type, target: this, ...event });
  }
}

function createView(toc) {
  const elements = new Map([
    ['table-of-contents-list', new ElementStub('ul')],
    ['table-of-contents-empty', new ElementStub('p')],
    ['table-of-contents-no-results', new ElementStub('p')],
    ['toc-search-input', new ElementStub('input')],
    ['toc-search-clear', new ElementStub('button')]
  ]);
  const document = {
    getElementById: id => elements.get(id) || null,
    createElement: tagName => new ElementStub(tagName),
    querySelector: sel => sel === '.toc-search-container' ? new ElementStub('div') : null
  };
  const context = vm.createContext({ document, window: {} });
  const source = fs.readFileSync(path.join(frontend, 'js', 'views', 'reader', 'TableOfContentsView.js'), 'utf8');
  vm.runInContext(source, context, { filename: 'TableOfContentsView.js' });
  const view = new context.window.TableOfContentsView({ navigationMap: { toc }, currentPage: 1 });
  return { view, elements };
}

test('TOC renders nested chapters, page badges and the current chapter', () => {
  const { view, elements } = createView([
    {
      title: 'Part One',
      page: 1,
      level: 0,
      children: [
        { title: 'Opening', page: 3, level: 1, children: [] },
        { title: 'Next section', page: 3, level: 1, children: [] }
      ]
    },
    { title: 'Part Two', page: 3, level: 0, children: [] }
  ]);

  view.render(3);

  const list = elements.get('table-of-contents-list');
  const firstItem = list.children[0];
  const openingButton = firstItem.children[0];
  const nestedList = firstItem.children[1];
  const partTwoButton = list.children[1].children[0];
  assert.equal(list.hidden, false);
  assert.equal(elements.get('table-of-contents-empty').hidden, true);
  assert.equal(openingButton.children[0].textContent, 'Part One');
  assert.equal(openingButton.children[1].children[1].textContent, 'Page 1');
  assert.equal(nestedList.classList.contains('table-of-contents-children'), true);
  assert.equal(nestedList.children.length, 2);
  assert.equal(nestedList.children[0].children[0].style.paddingInlineStart, '24px');
  assert.equal(nestedList.children[0].children[0].children[1].children[1].textContent, 'Page 3');
  assert.equal(partTwoButton.classList.contains('active'), true);
  assert.equal(partTwoButton.attributes['aria-current'], 'location');
  assert.equal(partTwoButton.children[1].children[0].hidden, false);
  assert.equal(openingButton.classList.contains('active'), false);

  view.updateActivePage(2);
  assert.equal(openingButton.classList.contains('active'), true);
  assert.equal(partTwoButton.classList.contains('active'), false);
});

test('TOC empty state and unavailable destinations are accessible', async () => {
  const empty = createView([]).view;
  empty.render(1);
  assert.equal(empty.entries.length, 0);
  assert.equal(empty.list.hidden, true);
  assert.equal(empty.emptyState.hidden, false);

  let navigatedPage = null;
  const { view, elements } = createView([
    { title: 'Chapter without page', page: null, level: 0, children: [] }
  ]);
  view.onNavigate = page => { navigatedPage = page; };
  view.render(1);
  const button = elements.get('table-of-contents-list').children[0].children[0];
  assert.equal(button.disabled, true);
  assert.equal(button.attributes['aria-label'], 'Chapter without page, page unavailable');
  await button.emit('click');
  assert.equal(navigatedPage, null);
});

test('TOC chapter activation forwards the selected page', async () => {
  const pages = [];
  const { view, elements } = createView([
    { title: 'Chapter', page: 7, level: 0, children: [] }
  ]);
  view.onNavigate = page => pages.push(page);
  view.render(1);

  await elements.get('table-of-contents-list').children[0].children[0].emit('click');

  assert.deepEqual(pages, [7]);
});

test('TOC search filters chapters in real time and clear button resets list', async () => {
  const { view, elements } = createView([
    {
      title: 'Thermodynamics Principles',
      page: 1,
      level: 0,
      children: [
        { title: 'Entropy and Second Law', page: 15, level: 1, children: [] },
        { title: 'Heat Capacities', page: 30, level: 1, children: [] }
      ]
    },
    {
      title: 'Quantum Foundations',
      page: 50,
      level: 0,
      children: []
    }
  ]);

  view.render(1);
  const list = elements.get('table-of-contents-list');
  const searchInput = elements.get('toc-search-input');
  const clearBtn = elements.get('toc-search-clear');
  const noResults = elements.get('table-of-contents-no-results');

  assert.equal(list.children.length, 2);

  // Filter matching a child
  searchInput.value = 'entropy';
  await searchInput.emit('input');
  assert.equal(list.children.length, 1);
  assert.equal(list.children[0].children[0].children[0].textContent, 'Thermodynamics Principles');
  assert.equal(list.children[0].children[1].children[0].children[0].children[0].textContent, 'Entropy and Second Law');
  assert.equal(clearBtn.hidden, false);
  assert.equal(noResults.hidden, true);

  // Filter matching nothing
  searchInput.value = 'nonexistent topic';
  await searchInput.emit('input');
  assert.equal(list.hidden, true);
  assert.equal(noResults.hidden, false);

  // Clear search
  await clearBtn.emit('click');
  assert.equal(searchInput.value, '');
  assert.equal(clearBtn.hidden, true);
  assert.equal(noResults.hidden, true);
  assert.equal(list.hidden, false);
  assert.equal(list.children.length, 2);
});
