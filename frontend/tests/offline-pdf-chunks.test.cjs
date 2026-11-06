'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const frontend = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(frontend, 'js/services/reader/ReaderOfflineService.js'), 'utf8');
const chunkSize = 1024 * 1024;

function createHarness() {
  const bytes = new Uint8Array(chunkSize + 17);
  bytes.set(new TextEncoder().encode('%PDF-'));
  bytes.fill(65, 5);
  const sourceBlob = new Blob([bytes], { type: 'application/pdf' });
  const chunks = new Map();
  const requests = [];
  let completion = null;
  let fullPdfWrites = 0;
  let failedSecondAttempts = 0;

  const context = vm.createContext({
    localDB: {
      async getPdfChunks() { return [...chunks.values()]; },
      async savePdfChunk(bookId, start, totalBytes, blob, validator) {
        chunks.set(start, { bookId, start, totalBytes, blob, validator });
      },
      async clearPdfChunks() { chunks.clear(); },
      async savePdfBlob() { fullPdfWrites += 1; },
      async savePdfChunksComplete(_bookId, totalBytes, validator) {
        completion = { totalBytes, validator };
      },
    },
    async fetch(_url, options) {
      const range = options.headers.Range.match(/^bytes=(\d+)-(\d+)$/);
      const start = Number(range[1]);
      const end = Math.min(Number(range[2]), sourceBlob.size - 1);
      requests.push(start);
      if (start === chunkSize && failedSecondAttempts < 3) {
        failedSecondAttempts += 1;
        return { status: 503, headers: { get: () => null } };
      }
      return {
        status: 206,
        headers: {
          get(name) {
            if (name.toLowerCase() === 'content-range') return `bytes ${start}-${end}/${sourceBlob.size}`;
            if (name.toLowerCase() === 'x-file-version') return '"sample-v1"';
            if (name.toLowerCase() === 'content-type') return 'application/pdf';
            return null;
          },
        },
        async blob() { return sourceBlob.slice(start, end + 1); },
      };
    },
    Blob,
    TextDecoder,
    setTimeout,
    console: { warn() {} },
    window: {},
    document: { getElementById: () => null },
  });
  vm.runInContext(source, context);
  const service = new context.window.ReaderOfflineService({ bookId: 42, pdfDoc: { numPages: 1 } });
  return {
    service,
    chunks,
    requests,
    sourceBlob,
    get completion() { return completion; },
    get fullPdfWrites() { return fullPdfWrites; },
  };
}

test('offline PDF downloads resume from persisted ranges after an interruption', async () => {
  const harness = createHarness();
  const progress = [];

  await assert.rejects(harness.service.cachePdfInChunks(42, (state) => progress.push(state)), /HTTP 503/);
  assert.deepEqual([...harness.chunks.keys()], [0]);

  await harness.service.cachePdfInChunks(42, (state) => progress.push(state));

  assert.deepEqual(harness.requests, [0, chunkSize, chunkSize, chunkSize, 0, chunkSize]);
  assert.deepEqual(harness.completion, { totalBytes: harness.sourceBlob.size, validator: '"sample-v1"' });
  assert.equal(harness.fullPdfWrites, 0, 'completed chunks should not be duplicated as a full IndexedDB blob');
  assert.equal(harness.chunks.size, 2, 'the complete offline PDF remains stored as resumable chunks');
  assert.equal(progress.some((state) => state.completed === harness.sourceBlob.size), true);
});
