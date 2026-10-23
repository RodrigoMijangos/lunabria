const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const frontend = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(frontend, file), 'utf8');

class FakeXHR {
  static last;

  constructor() {
    this.upload = {};
    FakeXHR.last = this;
  }

  open(method, url) {
    this.method = method;
    this.url = url;
  }

  send(body) {
    this.body = body;
  }

  respond(status, body) {
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.onload();
  }
}

function createBooksApi(fetch = async () => ({ ok: true, json: async () => [] })) {
  const context = vm.createContext({
    FormData,
    XMLHttpRequest: FakeXHR,
    fetch,
    console
  });
  vm.runInContext(read('js/services/books.js'), context);
  return vm.runInContext('createBooksApiService()', context);
}

test('uploadBookWithProgress reports byte progress and accepts an asynchronous job', async () => {
  const api = createBooksApi();
  const file = new Blob(['%PDF-1.7'], { type: 'application/pdf' });
  Object.defineProperty(file, 'name', { value: 'moon.pdf' });
  const progress = [];
  const pending = api.uploadBookWithProgress(file, {
    autoFetchMetadata: true,
    onProgress: value => progress.push(value)
  });
  const xhr = FakeXHR.last;

  assert.equal(xhr.method, 'POST');
  assert.equal(xhr.url, '/api/books/upload');
  assert.equal(xhr.body.get('files').name, 'moon.pdf');
  assert.equal(xhr.body.get('auto_fetch_metadata'), 'true');
  xhr.upload.onprogress({ lengthComputable: true, loaded: 25, total: 100 });
  xhr.upload.onprogress({ lengthComputable: false, loaded: 50, total: 0 });
  xhr.respond(202, { job_id: 'job-1', status: 'queued' });

  const response = await pending;
  assert.deepEqual(progress, [25]);
  assert.equal(response.job_id, 'job-1');
  assert.equal(response.status, 'queued');
});

test('uploadBookWithProgress surfaces the backend error detail', async () => {
  const api = createBooksApi();
  const file = new Blob(['invalid'], { type: 'text/plain' });
  Object.defineProperty(file, 'name', { value: 'invalid.txt' });
  const pending = api.uploadBookWithProgress(file);
  FakeXHR.last.respond(400, { detail: 'Only PDF files are supported.' });

  await assert.rejects(pending, /Only PDF files are supported/);
});

test('upload status service methods use the active-list and per-job endpoints', async () => {
  const calls = [];
  const api = createBooksApi(async url => {
    calls.push(url);
    return {
      ok: true,
      json: async () => url.endsWith('/jobs') ? [{ job_id: 'job-1' }] : { job_id: 'job/2' }
    };
  });

  const active = await api.getActiveUploadJobs();
  const job = await api.getUploadJob('job/2');
  assert.equal(active[0].job_id, 'job-1');
  assert.equal(job.job_id, 'job/2');
  assert.deepEqual(calls, [
    '/api/books/upload/jobs',
    '/api/books/upload/jobs/job%2F2'
  ]);
});

test('upload manager limits transfers to two and closing the modal does not cancel them', async () => {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) {
      elements.set(id, { id, style: {}, disabled: false, textContent: '' });
    }
    return elements.get(id);
  };
  const closed = [];
  let active = 0;
  let maxActive = 0;
  const deferred = [];
  const api = {
    uploadBookWithProgress(file) {
      active += 1;
      maxActive = Math.max(maxActive, active);
      return new Promise(resolve => deferred.push({
        file,
        resolve: result => {
          active -= 1;
          resolve(result);
        }
      }));
    }
  };
  const context = vm.createContext({
    document: { getElementById: element },
    window: {},
    ModalView: { close: modal => closed.push(modal) },
    UploadModalView: { renderQueue() {} },
    ToastView: { show() {} },
    api,
    console,
    setTimeout,
    clearTimeout
  });
  vm.runInContext(read('js/viewmodels/library/BookUploadManager.js'), context);
  const UploadManager = vm.runInContext('BookUploadManager', context);
  const queue = Array.from({ length: 3 }, (_, index) => ({
    id: `item-${index}`,
    file: { name: `book-${index}.pdf` },
    name: `book-${index}.pdf`,
    size: 100,
    status: 'pending',
    progress: 0
  }));
  const model = {
    uploadQueue: queue,
    clearUploadQueue() { this.uploadQueue = []; },
    removeUploadItem(id) { this.uploadQueue = this.uploadQueue.filter(item => item.id !== id); }
  };
  const manager = new UploadManager(model, null);
  manager.scheduleJobPolling = () => {};

  const batch = manager.startUploadBatch();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(deferred.length, 2);
  assert.equal(maxActive, 2);

  manager.closeUploadModal();
  assert.equal(closed[0], element('upload-modal'));
  assert.equal(model.uploadQueue.length, 3);

  deferred[0].resolve({ job_id: 'job-0', status: 'queued' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(deferred.length, 3);
  deferred[1].resolve({ job_id: 'job-1', status: 'queued' });
  deferred[2].resolve({ job_id: 'job-2', status: 'queued' });
  await batch;

  assert.equal(maxActive, 2);
  assert.equal(manager.isUploading, false);
  assert.deepEqual(queue.map(item => item.status), ['queued', 'queued', 'queued']);
});

test('UploadModalView renders progress bar track and updateItemProgress mutates existing row', () => {
  class FakeNode {
    constructor(tag) {
      this.tagName = tag;
      this.children = [];
      this.dataset = {};
      this.style = {};
      this.className = '';
      this.textContent = '';
    }
    appendChild(child) { this.children.push(child); return child; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = [...children]; }
    setAttribute(name, value) { this[name] = value; }
    querySelector(selector) {
      if (selector.startsWith('[data-queue-id=')) {
        const id = selector.match(/data-queue-id="([^"]+)"/)?.[1];
        return this.children.find(child => child.dataset?.queueId === id) || null;
      }
      const findClass = (node, className) => {
        if (node.className?.includes(className)) return node;
        for (const c of node.children || []) {
          const found = findClass(c, className);
          if (found) return found;
        }
        return null;
      };
      if (selector === '.upload-queue-label') return findClass(this, 'upload-queue-label');
      if (selector === '.upload-queue-progress-fill') return findClass(this, 'upload-queue-progress-fill');
      return null;
    }
  }

  const context = vm.createContext({
    document: {
      createElement: tag => new FakeNode(tag),
      createElementNS: (_ns, tag) => new FakeNode(tag)
    },
    LibraryModel: { formatFileSize: size => `${size} B` },
    window: {}
  });

  vm.runInContext(read('js/views/library/UploadModalView.js'), context);
  const View = vm.runInContext('UploadModalView', context);

  const container = new FakeNode('div');
  const queue = [{ id: 'q-1', name: 'guide.pdf', size: 1024, status: 'uploading', progress: 15 }];
  View.renderQueue(container, queue);

  assert.equal(container.children.length, 1);
  const row = container.children[0];
  assert.equal(row.dataset.queueId, 'q-1');
  const label = row.querySelector('.upload-queue-label');
  assert.equal(label.textContent, 'Uploading 15%');
  const fill = row.querySelector('.upload-queue-progress-fill');
  assert.equal(fill.style.width, '15%');

  queue[0].progress = 60;
  const updated = View.updateItemProgress(container, queue[0]);
  assert.equal(updated, true);
  assert.equal(label.textContent, 'Uploading 60%');
  assert.equal(fill.style.width, '60%');
});
