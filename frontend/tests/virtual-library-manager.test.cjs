'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.classList = { toggle() {} };
    this._textContent = '';
  }

  set textContent(value) {
    this._textContent = value;
    this.children = [];
  }

  get textContent() { return this._textContent; }

  append(...elements) {
    elements.forEach(element => this.appendChild(element));
  }

  appendChild(element) {
    this.children.push(element);
    return element;
  }

  replaceChildren(...elements) {
    this.children = [];
    this._textContent = '';
    elements.forEach(element => this.appendChild(element));
  }
}

function createEnvironment(getBooks) {
  const elements = new Map();
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new FakeElement());
      return elements.get(id);
    },
    createElement(tagName) { return new FakeElement(tagName); }
  };
  const window = {
    clearTimeout() {},
    setTimeout(callback) {
      this.pendingManualSearch = callback;
      return 1;
    }
  };
  const context = vm.createContext({
    document,
    window,
    api: { getBooks },
    ModalView: { open() {}, close() {} },
    alert() {}
  });
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '../js/viewmodels/library/VirtualLibraryManager.js'), 'utf8'),
    context,
    { filename: 'VirtualLibraryManager.js' }
  );
  return { document, window, VirtualLibraryManager: window.VirtualLibraryManager };
}

const plain = value => JSON.parse(JSON.stringify(value));

test('manual virtual-library selection fetches pages and searches on the server', async () => {
  const requests = [];
  const firstPage = Array.from({ length: 24 }, (_, index) => ({
    id: index + 1,
    title: `Book ${index + 1}`,
    authors: 'Author'
  }));
  const env = createEnvironment(async (...args) => {
    requests.push(args);
    if (requests.length === 1) {
      return { books: firstPage, total: 25, page: 1, page_size: 24 };
    }
    if (requests.length === 2) {
      return { books: [{ id: 25, title: 'Book 25', authors: 'Author' }], total: 25, page: 2, page_size: 24 };
    }
    return { books: [{ id: 26, title: 'Neural Book', authors: 'Researcher' }], total: 1, page: 1, page_size: 24 };
  });
  const manager = new env.VirtualLibraryManager();

  await manager.openVirtualLibraryModal();
  await env.document.getElementById('vl-tab-manual').onclick();
  assert.deepEqual(plain(requests[0][2]), { query: '', page: 1, pageSize: 24, sort: 'title' });

  const manualList = env.document.getElementById('vl-manual-list');
  let loadMore = manualList.children.find(child => child.textContent === 'Load more books');
  assert.ok(loadMore);
  await loadMore.onclick();
  assert.deepEqual(plain(requests[1][2]), { query: '', page: 2, pageSize: 24, sort: 'title' });
  assert.equal(manualList.children.filter(child => child.tagName === 'label').length, 25);
  assert.equal(manualList.children.some(child => child.textContent === 'Load more books'), false);

  const searchInput = env.document.getElementById('vl-manual-search');
  searchInput.value = 'Neural';
  searchInput.oninput();
  await env.window.pendingManualSearch();
  assert.deepEqual(plain(requests[2][2]), { query: 'Neural', page: 1, pageSize: 24, sort: 'title' });
  assert.equal(manualList.children.filter(child => child.tagName === 'label').length, 1);
  assert.equal(manualList.children[0].children[1].textContent, 'Neural Book — Researcher');
});
