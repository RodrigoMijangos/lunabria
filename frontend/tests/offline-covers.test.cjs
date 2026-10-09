'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const frontend = path.resolve(__dirname, '..');
const source = file => fs.readFileSync(path.join(frontend, 'js', file), 'utf8');

test('offline download stores the book cover alongside its cached metadata', async () => {
  const coverBlob = new Blob(['cover bytes'], { type: 'image/jpeg' });
  const fetchUrls = [];
  let savedBook = null;
  const context = vm.createContext({
    localDB: {
      async isPdfCached() { return true; },
      async getCachedLayoutPages() { return new Set([1]); },
      async hasAllLayoutsCached() { return true; },
      async saveCachedBook(book) { savedBook = book; }
    },
    fetch: async url => {
      fetchUrls.push(url);
      return { ok: true, blob: async () => coverBlob };
    },
    window: {
      app: {
        model: {
          getBookById: () => ({
            title: 'Offline book',
            authors: 'Reader',
            has_cover: true,
            cover_url: '/api/books/42/cover'
          })
        }
      }
    },
    document: { getElementById: () => null },
    Blob,
    console: { warn() {} }
  });
  vm.runInContext(source('services/reader/ReaderOfflineService.js'), context);
  const ReaderOfflineService = vm.runInContext('ReaderOfflineService', context);
  const service = new ReaderOfflineService({
    bookId: 42,
    pdfDoc: { numPages: 1 }
  });

  await service.cacheCurrentPdf();

  assert.deepEqual(fetchUrls, ['/api/books/42/cover']);
  assert.equal(savedBook.id, 42);
  assert.equal(savedBook.isOfflineComplete, true);
  assert.equal(savedBook.coverBlob, coverBlob);
});
