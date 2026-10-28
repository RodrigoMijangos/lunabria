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
    this.scrollTop = 0;
    this.attributes = new Map();
  }

  setAttribute(name, val) { this.attributes.set(name, String(val)); }
  removeAttribute(name) { this.attributes.delete(name); }
  hasAttribute(name) { return this.attributes.has(name); }
  querySelector() { return null; }

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

function createEnvironment(getBooks, apiOverrides = {}) {
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
    api: { getBooks, ...apiOverrides },
    ModalView: { open() {}, close() {} },
    alert() {}
  });
  const scripts = [
    ['../js/services/LunabriaQueryCompiler.js', 'LunabriaQueryCompiler.js'],
    ['../js/viewmodels/library/VirtualLibraryTokenRenderer.js', 'VirtualLibraryTokenRenderer.js'],
    ['../js/viewmodels/library/VirtualLibraryQueryBuilder.js', 'VirtualLibraryQueryBuilder.js'],
    ['../js/viewmodels/library/VirtualLibraryManageModal.js', 'VirtualLibraryManageModal.js'],
    ['../js/viewmodels/library/VirtualLibraryManager.js', 'VirtualLibraryManager.js']
  ];
  for (const [relPath, filename] of scripts) {
    vm.runInContext(
      fs.readFileSync(path.join(__dirname, relPath), 'utf8'),
      context,
      { filename }
    );
  }
  context.VirtualLibraryTokenRenderer = window.VirtualLibraryTokenRenderer;
  context.VirtualLibraryQueryBuilder = window.VirtualLibraryQueryBuilder;
  context.VirtualLibraryManageModal = window.VirtualLibraryManageModal;
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
  manualList.scrollTop = 150;
  await loadMore.onclick();
  assert.deepEqual(plain(requests[1][2]), { query: '', page: 2, pageSize: 24, sort: 'title' });
  assert.equal(manualList.children.filter(child => child.tagName === 'label').length, 25);
  assert.equal(manualList.children.some(child => child.textContent === 'Load more books'), false);
  assert.equal(manualList.scrollTop, 150);

  const searchInput = env.document.getElementById('vl-manual-search');
  searchInput.value = 'Neural';
  searchInput.oninput();
  await env.window.pendingManualSearch();
  assert.deepEqual(plain(requests[2][2]), { query: 'Neural', page: 1, pageSize: 24, sort: 'title' });
  assert.equal(manualList.children.filter(child => child.tagName === 'label').length, 1);
  assert.equal(manualList.children[0].children[1].textContent, 'Neural Book — Researcher');
});

test('virtual-library modal renders book covers, select-all, and previews Mode A query expressions', async () => {
  const requests = [];
  const sampleBooks = [
    { id: 10, title: 'Systems Engineering', authors: 'Alice' },
    { id: 11, title: 'Database Internals', authors: 'Bob' }
  ];
  const env = createEnvironment(async (...args) => {
    requests.push(args);
    return { books: sampleBooks, total: 2, page: 1, page_size: 24 };
  });
  const manager = new env.VirtualLibraryManager();

  await manager.openVirtualLibraryModal({
    searchQuery: 'Database',
    activeVirtualLibraryId: 4,
    activeCollectionName: 'Core Engineering'
  });

  const queryInput = env.document.getElementById('vl-query-input');
  assert.equal(queryInput.value, 'Database');

  const searchInput = env.document.getElementById('vl-manual-search');
  assert.equal(searchInput.value, 'Database');

  const manualList = env.document.getElementById('vl-manual-list');
  assert.equal(manualList.children.filter(child => child.tagName === 'label').length, 1);

  const firstCard = manualList.children[0];
  assert.equal(firstCard.children[0].tagName, 'input');
  assert.equal(firstCard.children[1].textContent, 'Database Internals — Bob');
  assert.equal(firstCard.children[2].children[0].src, '/api/books/11/cover');

  // Test Select All / Deselect All
  const selectAllBtn = env.document.getElementById('vl-select-all-btn');
  const deselectAllBtn = env.document.getElementById('vl-deselect-all-btn');
  selectAllBtn.onclick();
  assert.equal(manager.selectedBookIds.has(11), true);

  deselectAllBtn.onclick();
  assert.equal(manager.selectedBookIds.has(11), false);
});

test('openManageModal allows renaming manual or query collections', async () => {
  let updatedPayload = null;
  let notifiedLibrary = null;
  const env = createEnvironment(async () => [], {
    updateVirtualLibrary: async (id, data) => {
      updatedPayload = { id, data };
      return { id, name: data.name, type: 'manual', book_ids: [1, 2] };
    },
    getVirtualLibraryBooks: async () => [
      { id: 1, title: 'Book 1', authors: 'Author 1' },
      { id: 2, title: 'Book 2', authors: 'Author 2' }
    ]
  });
  const manager = new env.VirtualLibraryManager(lib => { notifiedLibrary = lib; });
  const library = { id: 5, name: 'Old Collection', type: 'manual', book_ids: [1, 2] };

  await manager.openManageModal(library);

  const nameInput = env.document.getElementById('vl-manage-name-input');
  assert.equal(nameInput.value, 'Old Collection');

  const renameBtn = env.document.getElementById('vl-manage-rename-btn');
  nameInput.value = 'New Collection Name';
  await renameBtn.onclick();

  assert.deepEqual(plain(updatedPayload), { id: 5, data: { name: 'New Collection Name' } });
  assert.equal(library.name, 'New Collection Name');
  assert.equal(notifiedLibrary?.name, 'New Collection Name');
});

test('openManageModal renders member books and allows selective removal', async () => {
  let removedPayload = null;
  let notifiedLibrary = null;
  const env = createEnvironment(async () => [], {
    getVirtualLibraryBooks: async () => [
      { id: 10, title: 'Networks', authors: 'Tanenbaum' },
      { id: 20, title: 'Clean Code', authors: 'Martin' }
    ],
    removeBooksFromVirtualLibrary: async (id, bookIds) => {
      removedPayload = { id, bookIds };
      return { id, name: 'My List', type: 'manual', book_ids: [20] };
    }
  });
  const manager = new env.VirtualLibraryManager(lib => { notifiedLibrary = lib; });
  const library = { id: 8, name: 'My List', type: 'manual', book_ids: [10, 20] };

  await manager.openManageModal(library);

  const booksList = env.document.getElementById('vl-manage-books-list');
  assert.equal(booksList.children.filter(c => c.tagName === 'label').length, 2);

  const booksCount = env.document.getElementById('vl-manage-books-count');
  assert.equal(booksCount.textContent, '2');

  // Select all
  const selectAllBtn = env.document.getElementById('vl-manage-select-all-btn');
  selectAllBtn.onclick();
  assert.equal(manager.manageSelectedBookIds.has(10), true);
  assert.equal(manager.manageSelectedBookIds.has(20), true);

  // Deselect all
  const deselectAllBtn = env.document.getElementById('vl-manage-deselect-all-btn');
  deselectAllBtn.onclick();
  assert.equal(manager.manageSelectedBookIds.size, 0);

  // Select only book 10
  manager.manageSelectedBookIds.add(10);
  const removeBtn = env.document.getElementById('vl-manage-remove-selected-btn');
  await removeBtn.onclick();

  assert.deepEqual(plain(removedPayload), { id: 8, bookIds: [10] });
  assert.deepEqual(library.book_ids, [20]);
  assert.equal(booksList.children.filter(c => c.tagName === 'label').length, 1);
  assert.equal(notifiedLibrary?.id, 8);
});

test('openManageModal shows query info for query collections', async () => {
  const env = createEnvironment(async () => []);
  const manager = new env.VirtualLibraryManager();
  const library = { id: 9, name: 'Sci-Fi', type: 'query', query: 'tags:=Science Fiction' };

  await manager.openManageModal(library);

  const querySection = env.document.getElementById('vl-manage-query-section');
  const booksSection = env.document.getElementById('vl-manage-books-section');
  const queryText = env.document.getElementById('vl-manage-query-text');

  assert.equal(querySection.style.display, '');
  assert.equal(booksSection.style.display, 'none');
  assert.equal(queryText.textContent, 'tags:=Science Fiction');
});

test('virtual-library modal renders interactive query token pills with removable badges', async () => {
  const requests = [];
  const env = createEnvironment(async (...args) => {
    requests.push(args);
    return { books: [], total: 0, page: 1, page_size: 24 };
  });
  const manager = new env.VirtualLibraryManager();

  await manager.openVirtualLibraryModal({
    searchQuery: 'tags: "Physics" + format: epub - author: Curie'
  });

  const tokensContainer = env.document.getElementById('vl-query-tokens');
  assert.equal(tokensContainer.children.length, 3);

  // Check first token: tags: "Physics"
  const firstToken = tokensContainer.children[0];
  assert.equal(firstToken.className, 'vl-token-pill');
  assert.equal(firstToken.children[0].textContent, 'tags:');
  assert.equal(firstToken.children[1].textContent, '"Physics"');

  // Check second token: + format: epub
  const secondToken = tokensContainer.children[1];
  assert.equal(secondToken.children[0].textContent, 'AND');
  assert.equal(secondToken.children[1].textContent, 'format:');
  assert.equal(secondToken.children[2].textContent, 'epub');

  // Check third token: - author: Curie (negated)
  const thirdToken = tokensContainer.children[2];
  assert.equal(thirdToken.className, 'vl-token-pill is-negated');
  assert.equal(thirdToken.children[0].textContent, 'NOT');
  assert.equal(thirdToken.children[1].textContent, 'author:');
  assert.equal(thirdToken.children[2].textContent, 'Curie');

  // Remove the second token (format: epub)
  const removeBtn = secondToken.children[3];
  assert.equal(removeBtn.textContent, '✕');
  removeBtn.onclick();

  const queryInput = env.document.getElementById('vl-query-input');
  assert.equal(queryInput.value, 'tags: "Physics" - author: Curie');
  assert.equal(tokensContainer.children.length, 2);
});

test('virtual-library modal makes query builder card optional and toggleable', async () => {
  const env = createEnvironment(async () => ({ books: [], total: 0 }));
  const manager = new env.VirtualLibraryManager();

  await manager.openVirtualLibraryModal();

  const queryBuilderCard = env.document.getElementById('vl-query-builder');
  const toggleBtn = env.document.getElementById('vl-builder-toggle-btn');
  const closeBtn = env.document.getElementById('vl-builder-close-btn');

  // By default, query builder is hidden/optional
  assert.equal(queryBuilderCard.hasAttribute('hidden'), true);
  assert.equal(queryBuilderCard.style.display, 'none');

  // Clicking toggle button expands query builder
  toggleBtn.onclick();
  assert.equal(queryBuilderCard.hasAttribute('hidden'), false);
  assert.equal(queryBuilderCard.style.display, '');

  // Updating query text must NOT collapse or close the builder
  const queryInput = env.document.getElementById('vl-query-input');
  queryInput.value = 'tags: Science';
  queryInput.oninput();
  assert.equal(queryBuilderCard.hasAttribute('hidden'), false);
  assert.equal(queryBuilderCard.style.display, '');

  // Clicking close button collapses it
  closeBtn.onclick();
  assert.equal(queryBuilderCard.hasAttribute('hidden'), true);
  assert.equal(queryBuilderCard.style.display, 'none');
});

test('virtual-library modal renders OR token pill when query contains commas', async () => {
  const env = createEnvironment(async () => ({ books: [], total: 0 }));
  const manager = new env.VirtualLibraryManager();

  await manager.openVirtualLibraryModal({
    searchQuery: 'tags: linux, comment: linux'
  });

  const tokensContainer = env.document.getElementById('vl-query-tokens');
  assert.equal(tokensContainer.children.length, 2);

  const firstToken = tokensContainer.children[0];
  assert.equal(firstToken.children[0].textContent, 'tags:');
  assert.equal(firstToken.children[1].textContent, 'linux');

  const secondToken = tokensContainer.children[1];
  assert.equal(secondToken.children[0].textContent, 'OR');
  assert.equal(secondToken.children[1].textContent, 'comment:');
  assert.equal(secondToken.children[2].textContent, 'linux');
});

test('openManageModal allows editing search rule and adding books from catalog', async () => {
  let updatedQueryPayload = null;
  let addedBooksPayload = null;
  const env = createEnvironment(async () => ({
    books: [{ id: 50, title: 'Catalog Linux', authors: 'Linus' }],
    total: 1
  }), {
    updateVirtualLibrary: async (id, data) => {
      updatedQueryPayload = { id, data };
      return { id, name: 'Linux', type: 'query', query: data.query, book_ids: [] };
    },
    getVirtualLibraryBooks: async () => [
      { id: 10, title: 'Book 10', authors: 'Auth' }
    ],
    addBooksToVirtualLibrary: async (id, bookIds) => {
      addedBooksPayload = { id, bookIds };
      return { id, name: 'Linux', type: 'query', query: 'tags: linux', book_ids: bookIds };
    }
  });

  const manager = new env.VirtualLibraryManager();
  const library = { id: 7, name: 'Linux', type: 'query', query: 'tags: arch' };
  await manager.openManageModal(library);

  // Test query editing
  const queryInput = env.document.getElementById('vl-manage-query-input');
  assert.equal(queryInput.value, 'tags: arch');
  queryInput.value = 'tags: linux';
  queryInput.oninput();

  const preview = env.document.getElementById('vl-manage-compiled-preview');
  assert.equal(preview.textContent, 'Calibre: tags:linux');

  const saveBtn = env.document.getElementById('vl-manage-save-query-btn');
  await saveBtn.onclick();
  assert.deepEqual(plain(updatedQueryPayload), { id: 7, data: { query: 'tags: linux' } });
  assert.equal(library.query, 'tags: linux');

  // Test catalog search & add books
  const addToggleBtn = env.document.getElementById('vl-manage-add-toggle-btn');
  await addToggleBtn.onclick();
  const catalogList = env.document.getElementById('vl-manage-catalog-list');
  assert.equal(catalogList.children.length, 1);

  // Simulate checking the book
  const checkbox = catalogList.children[0].children[0];
  checkbox.checked = true;
  catalogList.onchange({ target: checkbox });
  assert.equal(manager.manageAddSelectedBookIds.has(50), true);

  const addConfirmBtn = env.document.getElementById('vl-manage-add-confirm-btn');
  await addConfirmBtn.onclick();
  assert.deepEqual(plain(addedBooksPayload), { id: 7, bookIds: [50] });
});
