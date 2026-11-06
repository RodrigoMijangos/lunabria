'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const frontend = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(frontend, 'js/db.js'), 'utf8');

function createLocalDb(chunks) {
  const context = vm.createContext({ Blob, console });
  vm.runInContext(source, context);
  const LocalDB = vm.runInContext('LocalDB', context);
  const db = new LocalDB();
  db._get = async () => ({
    blob: null,
    chunked: true,
    totalBytes: 11,
    validator: 'file-v1',
  });
  db.getPdfChunks = async () => chunks;
  return db;
}

test('chunk-backed offline PDFs are recognized and reconstructed only when opened', async () => {
  const db = createLocalDb([
    { start: 5, totalBytes: 11, validator: 'file-v1', blob: new Blob(['world!']) },
    { start: 0, totalBytes: 11, validator: 'file-v1', blob: new Blob(['%PDF-']) },
  ]);

  assert.equal(await db.isPdfCached(42), true);
  const pdf = await db.getPdfBlob(42);
  assert.equal(await pdf.text(), '%PDF-world!');
});

test('incomplete chunk records are not reported as an offline-complete PDF', async () => {
  const db = createLocalDb([
    { start: 5, totalBytes: 11, validator: 'file-v1', blob: new Blob(['world!']) },
  ]);

  assert.equal(await db.isPdfCached(42), false);
  assert.equal(await db.getPdfBlob(42), null);
});
