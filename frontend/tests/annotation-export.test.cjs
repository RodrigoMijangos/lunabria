'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const frontend = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(frontend, relativePath), 'utf8');

test('annotation export API requests chapter scopes and sends exact selected IDs in a POST body', async () => {
  const requests = [];
  const responseQueue = [
    {
      ok: true,
      json: async () => ({ sections: [{ index: 0, title: 'Chapter One', page_start: 1, page_end: 3 }], total_pages: 5 })
    },
    {
      ok: true,
      headers: { get: name => name === 'Content-Disposition' ? 'attachment; filename="notes_book_7.json"' : null },
      blob: async () => ({ type: 'application/json' })
    },
    {
      ok: true,
      headers: { get: name => name === 'Content-Disposition' ? 'attachment; filename=notes_book_7.md' : null },
      blob: async () => ({ type: 'text/markdown' })
    }
  ];
  const context = vm.createContext({
    URLSearchParams,
    fetch: async (...args) => {
      requests.push(args);
      return responseQueue.shift();
    }
  });
  const service = vm.runInContext(`${read('js/services/annotations.js')}\ncreateAnnotationsApiService()`, context);

  const sections = await service.getAnnotationExportSections(7);
  assert.equal(sections.sections[0].title, 'Chapter One');
  assert.equal(requests[0][0], '/api/books/7/export-sections');

  const rangeExport = await service.exportAnnotations(7, {
    scope: 'range',
    start_page: 2,
    end_page: 4,
    format: 'json',
    group_by: 'page'
  });
  const rangeUrl = new URL(requests[1][0], 'https://lunabria.test');
  assert.equal(rangeUrl.pathname, '/api/books/7/export');
  assert.equal(rangeUrl.searchParams.get('scope'), 'range');
  assert.equal(rangeUrl.searchParams.get('start_page'), '2');
  assert.equal(rangeUrl.searchParams.get('end_page'), '4');
  assert.equal(rangeExport.filename, 'notes_book_7.json');

  const selectedExport = await service.exportAnnotations(7, {
    scope: 'selected',
    annotation_ids: ['note-3', 'note-1'],
    format: 'md',
    group_by: 'hierarchy'
  });
  assert.equal(requests[2][0], '/api/books/7/export');
  assert.equal(requests[2][1].method, 'POST');
  assert.deepEqual(JSON.parse(requests[2][1].body), {
    annotation_ids: ['note-3', 'note-1'],
    format: 'md',
    group_by: 'hierarchy',
    stamp: false
  });
  assert.equal(selectedExport.filename, 'notes_book_7.md');
});

test('ReaderModel retains only explicitly selected annotation IDs that still exist', () => {
  const context = vm.createContext({
    window: {},
    localStorage: { getItem: () => null, setItem: () => {} }
  });
  vm.runInContext(read('js/models/ReaderNavigationMap.js'), context);
  vm.runInContext(read('js/models/ReaderModel.js'), context);
  const model = new context.window.ReaderModel();

  model.setAnnotations([
    { id: 'same-text-a', page: 1, text: 'Same quote' },
    { id: 'same-text-b', page: 3, text: 'Same quote' }
  ]);
  assert.equal(model.setAnnotationExportSelected('same-text-a', true), true);
  assert.equal(model.setAnnotationExportSelected('same-text-b', true), true);
  model.setAnnotations([{ id: 'same-text-b', page: 3, text: 'Same quote' }]);

  assert.deepEqual(Array.from(model.selectedAnnotationIds), ['same-text-b']);
  assert.equal(model.setAnnotationExportSelected('missing', true), false);
  model.reset();
  assert.equal(model.selectedAnnotationIds.size, 0);
});

test('reader export options distinguish one page, inclusive ranges, and exact selections', () => {
  const context = vm.createContext({
    window: {},
    document: { getElementById: () => null }
  });
  vm.runInContext(read('js/viewmodels/reader/ReaderToolbarManager.js'), context);
  const manager = new context.window.ReaderToolbarManager(
    { bookId: 7, currentPage: 2, totalPages: 8, selectedAnnotationIds: new Set(['note-a', 'note-c']) },
    {},
    {}
  );

  manager.exportFormatSelect = { value: 'md_hierarchy' };
  manager.exportScopeSelect = { value: 'page' };
  manager.exportPageInput = { value: '4' };
  assert.deepEqual(JSON.parse(JSON.stringify(manager.buildExportOptions())), {
    format: 'md',
    group_by: 'hierarchy',
    scope: 'page',
    page: 4
  });

  manager.exportScopeSelect.value = 'range';
  manager.exportStartPageInput = { value: '2' };
  manager.exportEndPageInput = { value: '5' };
  assert.deepEqual(JSON.parse(JSON.stringify(manager.buildExportOptions())), {
    format: 'md',
    group_by: 'hierarchy',
    scope: 'range',
    start_page: 2,
    end_page: 5
  });

  manager.exportScopeSelect.value = 'selected';
  assert.deepEqual(JSON.parse(JSON.stringify(manager.buildExportOptions())), {
    format: 'md',
    group_by: 'hierarchy',
    scope: 'selected',
    annotation_ids: ['note-a', 'note-c']
  });
});

test('annotation selection checkboxes update the exact-ID count and enable selected export', async () => {
  class Element {
    constructor(value = '') {
      this.value = value;
      this.listeners = new Map();
      this.hidden = false;
      this.disabled = false;
      this.textContent = '';
    }
    addEventListener(type, handler) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(handler);
    }
    async emit(type, event) {
      for (const handler of this.listeners.get(type) || []) await handler(event);
    }
  }

  const ids = new Map([
    ['export-notes-btn', new Element()],
    ['export-format-select', new Element('json')],
    ['export-scope-select', new Element('selected')],
    ['export-selection-count', new Element()],
    ['export-clear-selection-btn', new Element()],
    ['annotations-list', new Element()]
  ]);
  const context = vm.createContext({
    window: { addEventListener() {} },
    document: { getElementById: id => ids.get(id) || null }
  });
  vm.runInContext(read('js/viewmodels/reader/ReaderToolbarManager.js'), context);
  const model = {
    currentPage: 1,
    totalPages: 4,
    selectedAnnotationIds: new Set(),
    setAnnotationExportSelected(id, selected) {
      if (selected) this.selectedAnnotationIds.add(String(id));
      else this.selectedAnnotationIds.delete(String(id));
      return true;
    },
    clearAnnotationExportSelection() {
      this.selectedAnnotationIds.clear();
    }
  };
  const manager = new context.window.ReaderToolbarManager(model, {}, {});
  manager.bindExportControls();
  assert.equal(ids.get('export-notes-btn').disabled, true);

  await ids.get('annotations-list').emit('change', {
    target: {
      classList: { contains: name => name === 'annotation-export-checkbox' },
      dataset: { annotationId: 'note-b' },
      checked: true
    }
  });

  assert.deepEqual(Array.from(model.selectedAnnotationIds), ['note-b']);
  assert.equal(ids.get('export-selection-count').textContent, '1 annotation selected');
  assert.equal(ids.get('export-notes-btn').disabled, false);
});

test('annotation export controls include labeled scope fields and touch-sized per-annotation selection', () => {
  const html = read('index.html');
  const css = read('css/design.css');

  for (const id of [
    'export-format-select',
    'export-scope-select',
    'export-section-select',
    'export-page-input',
    'export-start-page-input',
    'export-end-page-input',
    'export-selection-count',
    'export-status'
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /<option value="selected">Selected annotations<\/option>/);
  assert.match(html, /role="status" aria-live="polite"/);
  assert.match(css, /\.annotation-export-select\s*\{[\s\S]*?min-height:\s*44px/);
});
