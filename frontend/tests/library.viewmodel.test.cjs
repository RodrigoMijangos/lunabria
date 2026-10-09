'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Element {
  constructor(tag = 'div', owner) {
    this.tagName = tag;
    this.owner = owner;
    this.children = [];
    this.attributes = {};
    this.style = {};
    this.listeners = {};
    this.value = '';
    this.textContent = '';
    this.hidden = false;
    this.disabled = false;
    this.width = 800;
    this.clientWidth = 800;
    this.columns = '180px 180px 180px 180px';
    this.classes = new Set();
    this.classList = {
      toggle: (name, enabled) => enabled ? this.classes.add(name) : this.classes.delete(name),
      contains: name => this.classes.has(name)
    };
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren(...children) {
    this.children = children;
    if (this.tagName === 'select') this.value = children[0]?.value ?? '';
  }
  addEventListener(name, handler) { (this.listeners[name] ??= []).push(handler); }
  fire(name, event = {}) {
    for (const handler of this.listeners[name] ?? []) handler({ target: this, ...event });
  }
  getBoundingClientRect() { return { width: this.width }; }
  querySelector(selector) { return this.queries?.[selector] ?? null; }
  focus() { this.owner.activeElement = this; }
  blur() { this.owner.activeElement = null; this.fire('blur'); }
}

function setup({ missing = [], localDB: localDb, fetch: fetchImpl } = {}) {
  const elements = new Map();
  const document = {
    activeElement: null,
    getElementById(id) {
      if (missing.includes(id)) return null;
      if (!elements.has(id)) {
        const tag = /select$|selection-library$/.test(id) ? 'select' : 'div';
        elements.set(id, new Element(tag, document));
      }
      return elements.get(id);
    },
    querySelector() { return this.getElementById('main'); },
    createElement(tag) { return new Element(tag, document); },
    documentElement: new Element()
  };
  const calls = [];
  const window = {
    listeners: {},
    getComputedStyle: element => ({ gridTemplateColumns: element.columns }),
    addEventListener(name, callback) { this.listeners[name] = callback; },
    clearTimeout(id) { calls.push(['clearTimeout', id]); },
    setTimeout(callback, delay) {
      calls.push(['timeout', delay]);
      if (delay === 120) { this.pendingResize = callback; return 17; }
      this.pendingSearch = callback;
      return 18;
    },
    reader: { open: (...args) => calls.push(['open', ...args]) },
    serverConnectivity: { start: () => calls.push(['connectivity']) }
  };
  class Manager {
    constructor(...args) { this.args = args; }
    init() { calls.push(['initManager']); }
    openEditModal(book) { calls.push(['edit', book.id]); }
    openVirtualLibraryModal(options) { calls.push(['create', options]); }
    openUploadModal() { calls.push(['upload']); }
    closeUploadModal() { calls.push(['closeUpload']); }
  }
  const storage = new Map();
  const api = {
    async getBooks(...args) { calls.push(['books', ...args]); return []; },
    async getRecents() { calls.push(['recents']); return []; },
    async getVirtualLibraries() { calls.push(['libraries']); return []; },
    async addBooksToVirtualLibrary(id, ids) { calls.push(['add', id, [...ids]]); },
    async deleteVirtualLibrary(id) { calls.push(['delete', id]); }
  };
  const context = vm.createContext({
    window, document, navigator: {}, api, localDB: localDb, fetch: fetchImpl,
    console: { warn: (...args) => calls.push(['warn', ...args]), error: (...args) => calls.push(['error', ...args]) },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    BookUploadManager: Manager, BookMetadataManager: Manager, VirtualLibraryManager: Manager,
    HighlightColorSettingsManager: Manager, SyncSettingsManager: Manager,
    BookCardView: {
      renderBookGrid(container, books, open, edit, options) {
        calls.push(['grid', books.map(book => book.id)]);
        window.gridCallbacks = { open, edit, options };
      }
    },
    RecentReadsView: {
      renderRecentReads(container, section, books, open, edit) {
        calls.push(['recentGrid', books.map(book => book.id)]);
        if (section) section.style.display = books.length ? 'block' : 'none';
        window.recentCallbacks = { open, edit };
      }
    },
    VirtualLibraryView: {
      populateDropdown: (...args) => calls.push(['dropdown', args[1].length]),
      renderCollectionChips: (...args) => { window.chipCallbacks = args.slice(3); calls.push(['chips']); }
    },
    confirm: () => window.confirmed !== false,
    alert: message => calls.push(['alert', message])
  });
  const scripts = [
    'models/LibraryModel.js',
    'views/library/CatalogView.js',
    'views/library/CatalogPaginationView.js',
    'views/library/CatalogSelectionView.js',
    'viewmodels/library/CatalogSelectionManager.js',
    'viewmodels/LibraryViewModel.js'
  ];
  for (const script of scripts) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', script), 'utf8'), context, { filename: script });
  }
  const library = new window.LibraryViewModel();
  return { library, window, document, api, calls, storage };
}

const plain = value => JSON.parse(JSON.stringify(value));
const books = count => Array.from({ length: count }, (_, index) => ({ id: index + 1, title: `Book ${String(index + 1).padStart(2, '0')}` }));

// These assertions also run against the pre-refactor coordinator without depending on its collaborators.
test('preserves the public facade and initial state', () => {
  const { library: l } = setup();
  const methods = ['init', 'initServiceWorker', 'applyTheme', 'loadHome', 'loadVirtualLibraries', 'loadBookGrid',
    'renderBooks', 'getCatalogGridColumnCount', 'syncCatalogPageSizeOptions', 'syncCatalogSelectionLibraryOptions',
    'syncCatalogSelectionControls', 'setBookSelectionMode', 'setBookSelected', 'addSelectedBooksToLibrary',
    'createLibraryFromSelection', 'onVirtualLibrariesChanged', 'syncCatalogControls', 'getCatalogPageItems',
    'updateCatalogPagination', 'submitCatalogPageInput', 'syncSearchPresentation', 'updateBooksCountBadge',
    'renderRecents', 'filterBooks', 'updateActiveCollectionChip', 'deleteVirtualLibrary', 'selectVirtualLibrary',
    'clearCollectionFilter', 'openBook', 'openUploadModal', 'closeUploadModal', 'openEditModal', 'openVirtualLibraryModal', 'bindEvents'];
  for (const method of methods) assert.equal(typeof l[method], 'function', method);
  assert.equal(l.catalogPageCount, 1);
  assert.equal(l.catalogServerPage, null);
  assert.equal(l.catalogSearchTimeout, null);
  assert.equal(l.catalogGridColumns, 0);
  assert.equal(l.catalogResizeTimeout, null);
  assert.equal(l.selectionMode, false);
  assert.equal(l.selectedBookIds.size, 0);
  assert.equal(l.catalogSelectionBusy, false);
  l.activeVirtualLibraryId = '7';
  assert.equal(l.activeVirtualLibraryId, 7);
  const cache = books(3);
  l.allBooksCache = cache;
  assert.equal(l.allBooksCache, cache);
});

test('catalog pages retain all ellipsis boundaries', () => {
  const { library: l } = setup();
  for (const [current, total, expected] of [
    [1, 1, [1]], [4, 7, [1, 2, 3, 4, 5, 6, 7]],
    [4, 12, [1, 2, 3, 4, 5, 'ellipsis', 12]],
    [5, 12, [1, 'ellipsis', 4, 5, 6, 'ellipsis', 12]],
    [9, 12, [1, 'ellipsis', 8, 9, 10, 11, 12]]
  ]) assert.deepEqual(plain(l.getCatalogPageItems(current, total)), expected);
});

test('pagination preserves focused input, aria, buttons and live page callbacks', () => {
  const { library: l, document } = setup();
  let renders = 0;
  l.loadBookGrid = () => renders++;
  l.model.catalogPage = 5;
  l.catalogServerPage = { page: 5, pageSize: 12, total: 144 };
  l.catalogPageInput.value = 'draft';
  document.activeElement = l.catalogPageInput;
  l.updateCatalogPagination(12);
  assert.equal(l.catalogPageInput.value, 'draft');
  assert.equal(l.catalogPageStatus.textContent, 'Page 5 of 12');
  assert.equal(l.catalogPageTotal.textContent, '12');
  assert.equal(l.catalogPageCount, 12);
  assert.equal(l.catalogPageNumbers.children[1].attributes['aria-hidden'], 'true');
  const current = l.catalogPageNumbers.children.find(child => child.textContent === '5');
  assert.equal(current.attributes['aria-current'], 'page');
  current.onclick();
  assert.equal(renders, 0);
  l.model.catalogPage = 2;
  current.onclick();
  assert.equal(l.model.catalogPage, 5);
  assert.equal(renders, 1);
  document.activeElement = null;
  l.model.catalogPage = 1;
  l.updateCatalogPagination(1);
  assert.equal(l.catalogPagination.hidden, true);
  assert.equal(l.catalogPreviousButton.disabled, true);
  assert.equal(l.catalogNextButton.disabled, true);
  assert.equal(l.catalogPageInput.value, '1');
});

test('pagination retains public-helper call order and skips it when page numbers are absent', () => {
  const { library: l } = setup();
  let calls = 0;
  l.catalogPageNumbers.appendChild(new Element());
  l.getCatalogPageItems = (currentPage, pageCount) => {
    calls++;
    assert.equal(l.catalogPageCount, pageCount);
    assert.equal(l.catalogPageStatus.textContent, `Page ${currentPage} of ${pageCount}`);
    assert.equal(l.catalogPageNumbers.children.length, 0);
    return [currentPage];
  };
  l.updateCatalogPagination(3);
  assert.equal(calls, 1);
  l.catalogPageNumbers = null;
  l.updateCatalogPagination(4);
  assert.equal(calls, 1);
});

test('initialization retains manager, binding and sequential load order', async () => {
  const { library: l, window, calls } = setup();
  const order = [];
  window.serverConnectivity.start = () => order.push(['connectivity']);
  l.applyTheme = theme => order.push(['theme', theme]);
  l.initServiceWorker = () => order.push(['worker']);
  l.bindEvents = () => order.push(['bind']);
  l.syncCatalogControls = () => order.push(['controls']);
  l.loadVirtualLibraries = async () => { order.push(['libraries']); await Promise.resolve(); order.push(['loadedLibraries']); };
  l.loadHome = async () => order.push(['home']);
  await l.init();
  assert.deepEqual(order, [['theme', 'sepia'], ['worker'], ['bind'], ['controls'], ['connectivity'], ['libraries'], ['loadedLibraries'], ['home']]);

  assert.equal(calls.filter(call => call[0] === 'initManager').length, 3);
});

test('page input accepts only safe positive decimal integers and clamps to page count', () => {
  const { library: l } = setup();
  let renders = 0;
  l.loadBookGrid = () => renders++;
  l.catalogPageCount = 8;
  l.model.catalogPage = 3;
  l.catalogServerPage = { page: 3, pageSize: 12, total: 96 };
  for (const value of ['', '0', '-1', '1.5', '2e1', '+2', 'Infinity', '9007199254740992', 'text']) {
    l.catalogPageInput.value = value;
    l.submitCatalogPageInput();
    assert.equal(l.catalogPageInput.value, '3', value);
    assert.equal(l.model.catalogPage, 3);
  }
  l.catalogPageInput.value = ' 0007 ';
  l.submitCatalogPageInput();
  assert.equal(l.model.catalogPage, 7);
  l.catalogPageInput.value = '999';
  l.submitCatalogPageInput();
  assert.equal(l.model.catalogPage, 8);
  l.submitCatalogPageInput();
  assert.equal(renders, 2);
});

test('column fallbacks and option caching preserve missing-select behavior', () => {
  const { library: l } = setup();
  assert.equal(l.getCatalogGridColumnCount(), 4);
  l.bookGrid.width = 0;
  l.catalogGridColumns = 3;
  assert.equal(l.getCatalogGridColumnCount(), 3);
  l.bookGrid.width = 500;
  l.bookGrid.columns = 'none';
  assert.equal(l.getCatalogGridColumnCount(), 3);
  l.bookGrid.columns = '150px   150px';
  assert.equal(l.getCatalogGridColumnCount(), 2);
  l.syncCatalogPageSizeOptions(2, 6, 4);
  assert.deepEqual(l.catalogPageSizeSelect.children.map(child => child.value), ['2', '3', '4', '5', '6']);
  assert.equal(l.catalogPageSizeSelect.value, '4');
  const option = l.catalogPageSizeSelect.children[0];
  l.syncCatalogPageSizeOptions(2, 6, 5);
  assert.equal(l.catalogPageSizeSelect.children[0], option);
  l.catalogPageSizeSelect = null;
  l.syncCatalogPageSizeOptions(4, 12, 12);
  assert.equal(l.catalogGridColumns, 2);
});

test('rendering uses model filtering, page clamping and original card callbacks', () => {
  const { library: l, calls, window, document } = setup();
  l.model.setBooks(books(25));
  l.model.setRecentBooks([{ id: 1 }]);
  l.model.catalogPage = 99;
  l.renderBooks();
  assert.equal(l.model.catalogPage, 2);
  assert.equal(l.catalogPageCount, 2);
  assert.equal(document.getElementById('books-count-badge').textContent, '24 books');
  assert.deepEqual(plain(calls.find(call => call[0] === 'grid')[1]), Array.from({ length: 12 }, (_, index) => index + 14));
  assert.equal(window.gridCallbacks.options.selectedBookIds, l.selectedBookIds);
  window.gridCallbacks.open(4);
  window.gridCallbacks.edit({ id: 5 });
  window.gridCallbacks.options.onToggleSelection('6', true);
  assert.equal(l.selectedBookIds.has(6), true);
  assert.ok(calls.some(call => call[0] === 'open' && call[1] === 4 && call[2] === null));
  assert.ok(calls.some(call => call[0] === 'edit' && call[1] === 5));
});

test('search expands catalog without changing collapsed preference and restores recents once', () => {
  const { library: l, calls } = setup();
  l.model.catalogCollapsed = true;
  l.model.recentBooks = [{ id: 1 }];
  l.model.searchQuery = 'book';
  l.syncSearchPresentation();
  assert.equal(l.mainContainer.classList.contains('search-active'), true);
  assert.equal(l.recentsSection.style.display, 'none');
  assert.equal(l.catalogContent.hidden, false);
  assert.equal(l.catalogToggleButton.disabled, true);
  assert.equal(l.model.catalogCollapsed, true);
  l.model.searchQuery = '';
  l.syncSearchPresentation();
  l.syncSearchPresentation();
  assert.equal(l.recentsSection.style.display, 'block');
  assert.equal(calls.filter(call => call[0] === 'recentGrid').length, 1);
  assert.equal(l.catalogContent.hidden, true);
  l.model.catalogSort = 'last_read_at';
  l.syncSearchPresentation();
  assert.equal(l.recentsSection.style.display, 'none');
});

test('selection preserves Set identity, numeric ids, card feedback and status on cancellation', () => {
  const { library: l } = setup();
  l.renderBooks = () => {};
  const selected = l.selectedBookIds;
  const card = new Element();
  const checkbox = new Element('input');
  card.queries = { '.book-selection-toggle input': checkbox };
  l.bookGrid.queries = { '.book-card[data-id="9"]': card };
  l.catalogSelectionStatus.textContent = 'old';
  l.setBookSelectionMode(true);
  assert.equal(l.catalogSelectionStatus.textContent, '');
  l.setBookSelected('9', true);
  l.setBookSelected('invalid', true);
  assert.equal(selected.size, 1);
  assert.equal(card.classList.contains('book-card-selected'), true);
  assert.equal(checkbox.checked, true);
  l.setBookSelected(9, false);
  assert.equal(checkbox.checked, false);
  l.setBookSelected(9, true);
  l.catalogSelectionStatus.textContent = 'keep';
  l.setBookSelectionMode(false);
  assert.equal(l.selectedBookIds, selected);
  assert.equal(selected.size, 0);
  assert.equal(l.catalogSelectionStatus.textContent, 'keep');
});

test('manual-library options preserve valid selection, busy flags and control gating', () => {
  const { library: l } = setup();
  l.model.virtualLibraries = [{ id: 1, type: 'query', name: 'Query' }, { id: 2, type: 'manual', name: 'Manual', book_ids: [3] }];
  l.catalogSelectionLibrary.value = '2';
  l.selectionMode = true;
  l.selectedBookIds.add(3);
  l.syncCatalogSelectionLibraryOptions();
  assert.equal(l.catalogSelectionLibrary.value, '2');
  assert.equal(l.catalogSelectionLibrary.children.length, 2);
  assert.equal(l.catalogSelectionLibrary.children[1].textContent, 'Manual (1)');
  assert.equal(l.catalogSelectionAddButton.disabled, false);
  assert.equal(l.catalogSelectionCreateButton.disabled, false);
  assert.equal(l.catalogSelectionCount.textContent, '1 book selected');
  l.catalogSelectionBusy = true;
  l.syncCatalogSelectionControls();
  assert.equal(l.catalogSelectionToggle.disabled, true);
  assert.equal(l.catalogSelectionLibrary.disabled, true);
  assert.equal(l.catalogSelectionAddButton.disabled, true);
  l.model.virtualLibraries = [];
  l.syncCatalogSelectionLibraryOptions();
  assert.equal(l.catalogSelectionLibrary.value, '');
  assert.equal(l.catalogSelectionLibrary.children[0].textContent, 'No manual libraries');
});

test('adding selection snapshots ids and preserves success ordering for active and inactive libraries', async () => {
  for (const active of [null, '2']) {
    const { library: l, api } = setup();
    const order = [];
    let finish;
    api.addBooksToVirtualLibrary = (id, ids) => {
      order.push(['add', id, [...ids]]);
      return new Promise(resolve => { finish = resolve; });
    };
    l.model.virtualLibraries = [{ id: 2, type: 'manual', name: 'Target' }];
    l.model.activeVirtualLibraryId = active;
    l.catalogSelectionLibrary.value = '2';
    l.selectionMode = true;
    l.selectedBookIds.add(4);
    const selected = l.selectedBookIds;
    l.loadVirtualLibraries = async () => order.push(['libraries', l.selectionMode, selected.size, l.catalogSelectionBusy]);
    l.loadBookGrid = async () => order.push(['reload']);
    l.renderBooks = () => order.push(['render']);
    const pending = l.addSelectedBooksToLibrary();
    assert.equal(l.catalogSelectionBusy, true);
    assert.equal(l.catalogSelectionStatus.textContent, 'Adding books…');
    l.selectedBookIds.add(5);
    finish();
    await pending;
    assert.deepEqual(order, [['add', 2, [4]], ['libraries', false, 0, true], [active === null ? 'render' : 'reload']]);
    assert.equal(l.selectedBookIds, selected);
    assert.equal(l.catalogSelectionBusy, false);
    assert.equal(l.catalogSelectionStatus.textContent, 'Selection added to «Target». Duplicates were skipped.');
  }
});

test('failed addition keeps selection and resets busy; invalid targets are no-ops', async () => {
  const { library: l, api } = setup();
  l.model.virtualLibraries = [{ id: 2, type: 'manual', name: 'Target' }];
  l.catalogSelectionLibrary.value = '2';
  l.selectionMode = true;
  l.selectedBookIds.add(7);
  api.addBooksToVirtualLibrary = async () => { throw new Error('offline'); };
  await l.addSelectedBooksToLibrary();
  assert.equal(l.catalogSelectionStatus.textContent, 'Could not add books: offline');
  assert.equal(l.catalogSelectionBusy, false);
  assert.equal(l.selectionMode, true);
  assert.equal(l.selectedBookIds.has(7), true);
  l.catalogSelectionLibrary.value = '99';
  l.catalogSelectionStatus.textContent = 'untouched';
  await l.addSelectedBooksToLibrary();
  assert.equal(l.catalogSelectionStatus.textContent, 'untouched');
});

test('creation delegates a snapshot and library-change callback retains original reset and count behavior', async () => {
  const { library: l, calls } = setup();
  l.createLibraryFromSelection();
  assert.equal(calls.length, 0);
  l.selectedBookIds.add(7);
  l.createLibraryFromSelection();
  l.selectedBookIds.add(8);
  assert.deepEqual(plain(calls[0]), ['create', { selectedBookIds: [7] }]);
  let loads = 0;
  let renders = 0;
  l.loadVirtualLibraries = async () => loads++;
  l.renderBooks = () => renders++;
  l.selectionMode = true;
  await l.onVirtualLibrariesChanged({ type: 'manual', name: 'New' });
  assert.equal(l.catalogSelectionStatus.textContent, 'Created «New» with 2 books.');
  assert.equal(l.selectedBookIds.size, 0);
  assert.equal(l.selectionMode, false);
  await l.onVirtualLibrariesChanged({ type: 'manual', name: 'Ignored', book_ids: [7] });
  assert.equal(loads, 2);
  assert.equal(renders, 1);
  l.selectionMode = true;
  await l.onVirtualLibrariesChanged({ type: 'manual', name: 'Single', book_ids: [7] });
  assert.equal(l.catalogSelectionStatus.textContent, 'Created «Single» with 1 book.');
});

test('data loading requests one catalog page and preserves presentation order', async () => {
  const { library: l, api, calls } = setup();
  api.getBooks = async (...args) => {
    calls.push(['books', ...args]);
    return { books: books(2), total: 40, page: 1, page_size: 12 };
  };
  api.getRecents = async () => { calls.push(['recents']); return [{ id: 1 }]; };
  l.renderRecents = () => calls.push(['renderRecents']);
  l.renderBooks = () => calls.push(['renderBooks']);
  l.updateActiveCollectionChip = () => calls.push(['chip']);
  await l.loadHome();
  assert.deepEqual(plain(calls), [
    ['recents'],
    ['books', null, null, { query: '', page: 1, pageSize: 12, sort: 'title', excludeIds: [1] }],
    ['renderRecents'], ['renderBooks'], ['chip']
  ]);
  assert.equal(l.catalogServerPage.total, 40);
  l.model.activeVirtualLibraryId = 4;
  calls.length = 0;
  await l.loadBookGrid();
  assert.deepEqual(plain(calls), [
    ['books', null, 4, { query: '', page: 1, pageSize: 12, sort: 'title', excludeIds: [1] }],
    ['renderBooks']
  ]);
  api.getVirtualLibraries = async () => { throw new Error('offline'); };
  l.model.virtualLibraries = [{ id: 3 }];
  await l.loadVirtualLibraries();
  assert.equal(l.model.virtualLibraries.length, 0);
  assert.equal(l.catalogSelectionLibrary.disabled, true);
});

test('last-opened catalog requests every page from the paginated books endpoint', async () => {
  const { library: l, api } = setup();
  let request;
  let recentRequests = 0;
  api.getBooks = async (...args) => {
    request = args;
    return { books: [{ id: 305, title: 'Recently opened', last_read_at: '2026-10-09 02:00:00' }], total: 83, page: 1, page_size: 12 };
  };
  api.getRecents = async () => { recentRequests++; return [{ id: 305 }]; };
  l.model.setCatalogSort('last_read_at');
  l.renderBooks = () => {};
  l.updateActiveCollectionChip = () => {};

  await l.loadHome();

  assert.equal(recentRequests, 0);
  assert.deepEqual(plain(request), [null, null, {
    query: '', page: 1, pageSize: 12, sort: 'last_read_at', excludeIds: []
  }]);
  assert.equal(l.catalogServerPage.total, 83);
  assert.equal(l.model.allBooks[0].id, 305);
  assert.equal(l.recentsSection.style.display, 'none');
});


test('catalog requests include the current server page, search and sort', async () => {
  const { library: l, api } = setup();
  let request;
  api.getBooks = async (...args) => {
    request = args;
    return { books: [{ id: 42, title: 'Science' }], total: 35, page: 3, page_size: 12 };
  };
  l.model.setActiveVirtualLibrary(8);
  l.model.setSearchQuery('science');
  l.model.setCatalogSort('date_added');
  l.model.setCatalogPage(3);
  l.renderBooks = () => {};

  await l.loadBookGrid();

  assert.deepEqual(plain(request), [null, 8, {
    query: 'science', page: 3, pageSize: 12, sort: 'date_added', excludeIds: []
  }]);
  assert.equal(l.catalogServerPage.total, 35);
  assert.equal(l.catalogServerPage.page, 3);
  assert.equal(l.model.allBooks[0].id, 42);
});

test('search is debounced and sends the text to the paginated catalog endpoint', async () => {
  const { library: l, api, window } = setup();
  let request;
  api.getBooks = async (...args) => {
    request = args;
    return { books: [], total: 0, page: 1, page_size: 12 };
  };
  l.renderBooks = () => {};
  l.filterBooks('  SCIENCE  ');
  assert.equal(l.model.searchQuery, 'science');
  await window.pendingSearch();
  assert.deepEqual(plain(request), [null, null, {
    query: 'science', page: 1, pageSize: 12, sort: 'title', excludeIds: []
  }]);
});

test('catalog API errors do not show offline mode when health checks succeed', async () => {
  const { library: l, api, window, calls } = setup();
  let offlineFallbacks = 0;
  l.showOfflineBooks = async () => { offlineFallbacks++; };
  window.serverConnectivity.checkServer = async () => true;
  api.getBooks = async () => { throw new Error('HTTP 500'); };

  await l.loadBookGrid();

  assert.equal(offlineFallbacks, 0);
  assert.ok(calls.some(call => call[0] === 'error' && call[1].includes('server is reachable')));
});

test('catalog page requests fall back to locally paginated offline books on failure', async () => {
  const offlineBooks = books(15);
  const localDB = { async getOfflineCompleteBooks() { return offlineBooks; } };
  const { library: l, api } = setup({ localDB });
  api.getBooks = async () => { throw new Error('offline'); };
  l.model.setCatalogPage(2);
  l.renderBooks = () => {};

  await l.loadBookGrid();

  assert.equal(l.catalogServerPage, null);
  assert.equal(l.model.allBooks.length, 15);
  assert.equal(l.model.catalogPage, 2);
});

test('a delayed offline fallback cannot replace a newer online page', async () => {
  let finishOfflineRead;
  let markOfflineReadStarted;
  const offlineReadStarted = new Promise(resolve => { markOfflineReadStarted = resolve; });
  const offlineBooks = new Promise(resolve => { finishOfflineRead = resolve; });
  const localDB = {
    getOfflineCompleteBooks() {
      markOfflineReadStarted();
      return offlineBooks;
    }
  };
  const { library: l, api } = setup({ localDB });
  let requests = 0;
  api.getBooks = async () => {
    requests++;
    if (requests === 1) throw new Error('temporarily unavailable');
    return { books: [{ id: 99, title: 'New online page' }], total: 1, page: 1, page_size: 12 };
  };
  l.renderBooks = () => {};

  const delayedOfflineRequest = l.loadBookGrid();
  await offlineReadStarted;
  await l.loadBookGrid();
  finishOfflineRead([{ id: 1, title: 'Stale offline book' }]);
  await delayedOfflineRequest;

  assert.deepEqual(plain(l.model.allBooks.map(book => book.id)), [99]);
  assert.equal(l.catalogServerPage.total, 1);
});

test('online catalog and recents restore covers saved from previous visits', async () => {
  const coverBlob = new Blob(['cover bytes'], { type: 'image/jpeg' });
  const localDB = {
    async getAllCachedBooks() { return [{ id: 42, coverBlob }]; },
    async saveCachedBooks() {},
    async getOfflineCompleteBooks() { return []; },
    async saveCachedBook() {}
  };
  const { library: l, api } = setup({ localDB });
  api.getBooks = async () => [{ id: 42, title: 'Book 42', has_cover: true, cover_url: '/api/books/42/cover' }];
  api.getRecents = async () => [{ id: 42, current_page: 3, total_pages: 10, has_cover: true, cover_url: '/api/books/42/cover' }];
  l.renderRecents = () => {};
  l.renderBooks = () => {};

  await l.loadHome();
  assert.equal(l.model.allBooks[0].coverBlob, coverBlob);
  assert.equal(l.model.recentBooks[0].coverBlob, coverBlob);

  l.model.activeVirtualLibraryId = 7;
  api.getBooks = async () => ({ books: [{ id: 42, title: 'Book 42', has_cover: true, cover_url: '/api/books/42/cover' }], total: 1, page: 1, page_size: 12 });
  await l.loadBookGrid();
  assert.equal(l.model.allBooks[0].coverBlob, coverBlob);
});

test('catalog refresh backfills covers for previously downloaded offline books', async () => {
  const coverBlob = new Blob(['cover bytes'], { type: 'image/jpeg' });
  const cachedOfflineBook = { id: 42, isOfflineComplete: true };
  const savedBooks = [];
  const fetchedUrls = [];
  const localDB = {
    async getAllCachedBooks() { return []; },
    async saveCachedBooks() {},
    async getOfflineCompleteBooks() { return [cachedOfflineBook]; },
    async saveCachedBook(book) { savedBooks.push(book); }
  };
  const { library: l, api } = setup({
    localDB,
    fetch: async url => {
      fetchedUrls.push(url);
      return { ok: true, status: 200, blob: async () => coverBlob };
    }
  });
  api.getBooks = async () => [{
    id: 42,
    title: 'Book 42',
    authors: 'Author',
    has_cover: true,
    cover_url: '/api/books/42/cover'
  }];
  api.getRecents = async () => [];

  await l.loadHome();
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(fetchedUrls, ['/api/books/42/cover']);
  assert.equal(savedBooks.length, 1);
  assert.equal(savedBooks[0].id, 42);
  assert.equal(savedBooks[0].coverBlob, coverBlob);
});

test('event bindings preserve page submission, search, selection and debounced resize', () => {
  const { library: l, window, document, storage } = setup();
  let renders = 0;
  let recents = 0;
  let pageRequests = 0;
  l.renderBooks = () => renders++;
  l.renderRecents = () => recents++;
  l.loadHome = () => renders++;
  l.loadBookGrid = () => { pageRequests++; renders++; };
  l.bindEvents();
  l.catalogSortSelect.value = 'date_added';
  l.catalogSortSelect.fire('change');
  assert.equal(storage.get('moon_catalog_sort'), 'date_added');
  l.catalogPageSizeSelect.value = '5';
  l.catalogPageSizeSelect.fire('change');
  assert.equal(l.model.catalogPageSizePreference, 5);
  l.catalogSelectionToggle.fire('click');
  assert.equal(l.selectionMode, true);
  l.catalogPageCount = 10;
  l.catalogPageInput.value = '3';
  l.catalogPageInput.focus();
  let prevented = false;
  const beforeEnter = renders;
  l.catalogPageInput.fire('keydown', { key: 'Enter', preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(l.model.catalogPage, 3);
  assert.equal(renders, beforeEnter + 1);
  assert.equal(pageRequests, 0);

  const beforeLocalNavigation = renders;
  l.catalogNextButton.fire('click');
  assert.equal(l.model.catalogPage, 4);
  l.catalogPreviousButton.fire('click');
  assert.equal(l.model.catalogPage, 3);
  assert.equal(renders, beforeLocalNavigation + 2);
  assert.equal(pageRequests, 0);

  l.catalogServerPage = { page: 3, pageSize: 12, total: 120 };
  l.catalogNextButton.fire('click');
  assert.equal(l.model.catalogPage, 4);
  assert.equal(pageRequests, 1);
  const input = document.getElementById('search-input');
  input.value = '  BOOK  ';
  input.oninput({ target: input });
  assert.equal(l.model.searchQuery, 'book');
  assert.equal(document.getElementById('search-clear-btn').style.display, 'inline-flex');
  document.getElementById('search-clear-btn').onclick();
  assert.equal(l.model.searchQuery, '');
  assert.equal(document.activeElement, input);
  assert.equal(typeof window.pendingSearch, 'function');
  l.catalogGridColumns = 4;
  window.listeners.resize();
  assert.equal(l.catalogResizeTimeout, 17);
  const beforeResize = renders;
  window.pendingResize();
  assert.equal(renders, beforeResize);
  assert.equal(recents, 1);
  l.bookGrid.columns = '100px 100px';
  window.listeners.resize();
  window.pendingResize();
  assert.equal(renders, beforeResize + 1);
});

test('server recovery reconciles the active reader without reopening the book', () => {
  const { library: l, window } = setup();
  let reconciliations = 0;
  let homeLoads = 0;
  window.reader.model = { bookId: 42 };
  window.reader.container = { style: { display: 'flex' } };
  window.reader.reconcileServerConnection = () => { reconciliations++; };
  l.loadHome = () => { homeLoads++; };
  l.bindEvents();

  window.listeners['lunabria:server-connectivity-change']({
    detail: { available: true, previousState: 'unavailable' }
  });

  assert.equal(reconciliations, 1);
  assert.equal(homeLoads, 1);
});

test('initial server detection does not duplicate the startup catalog load', () => {
  const { library: l, window } = setup();
  let homeLoads = 0;
  l.loadHome = () => { homeLoads++; };
  l.bindEvents();

  window.listeners['lunabria:server-connectivity-change']({
    detail: { available: true, previousState: 'unknown' }
  });

  assert.equal(homeLoads, 0);
});

test('collection commands preserve reset semantics, cancellation and delete failures', async () => {
  const { library: l, api, window, calls } = setup();
  l.loadVirtualLibraries = async () => calls.push(['reloadLibraries']);
  l.loadHome = async () => calls.push(['home']);
  l.loadBookGrid = async () => 'grid result';
  l.model.catalogPage = 4;
  assert.equal(await l.selectVirtualLibrary('2'), 'grid result');
  assert.equal(l.model.catalogPage, 1);
  assert.equal(l.vlSelect.value, '2');
  window.confirmed = false;
  await l.deleteVirtualLibrary({ id: 2, name: 'Target' });
  assert.equal(calls.some(call => call[0] === 'delete'), false);
  window.confirmed = true;
  await l.deleteVirtualLibrary({ id: 2, name: 'Target' });
  assert.equal(l.activeVirtualLibraryId, null);
  assert.equal(l.vlSelect.value, '');
  assert.deepEqual(calls.slice(-3), [['delete', 2], ['reloadLibraries'], ['home']]);
  api.deleteVirtualLibrary = async () => { throw new Error('offline'); };
  await l.deleteVirtualLibrary({ id: 3, name: 'Failed' });
  assert.deepEqual(calls.at(-1), ['alert', 'Could not delete virtual library: offline']);
  assert.equal(l.clearCollectionFilter(), undefined);
});

test('optional elements are tolerated without altering state defaults', () => {
  const { library: l, window } = setup({ missing: ['book-grid', 'catalog-page-input', 'catalog-page-numbers',
    'catalog-page-size-select', 'catalog-selection-library', 'catalog-selection-status', 'recents-section'] });
  assert.equal(l.getCatalogGridColumnCount(), 4);
  l.syncCatalogPageSizeOptions(4, 12, 12);
  assert.equal(l.catalogGridColumns, 0);
  l.submitCatalogPageInput();
  l.updateCatalogPagination(4);
  l.syncCatalogSelectionLibraryOptions();
  l.syncCatalogSelectionControls();
  l.syncSearchPresentation();
  l.setBookSelected(2, true);
  l.bindEvents();
  window.getComputedStyle = undefined;
  assert.equal(l.getCatalogGridColumnCount(), 4);
});
