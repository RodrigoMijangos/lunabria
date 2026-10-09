'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  HttpTimeoutError,
  HttpNetworkError,
  HttpResponseError,
  fetchWithTimeout
} = require('../js/services/http.js');

test('fetchWithTimeout returns response on fast network', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    return { ok: true, status: 200, url, text: async () => 'hello' };
  };

  try {
    const res = await fetchWithTimeout('/api/health', { timeout: 1000 });
    assert.equal(res.ok, true);
    assert.equal(res.status, 200);
  } finally {
    global.fetch = originalFetch;
  }
});

test('fetchWithTimeout throws HttpTimeoutError when timeout expires', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url, opts) => {
    return new Promise((resolve, reject) => {
      opts.signal.addEventListener('abort', () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        reject(err);
      });
    });
  };

  try {
    await assert.rejects(
      async () => {
        await fetchWithTimeout('/api/slow', { timeout: 50 });
      },
      (err) => {
        assert.ok(err instanceof HttpTimeoutError);
        assert.equal(err.name, 'HttpTimeoutError');
        assert.equal(err.isTimeout, true);
        assert.ok(err.message.includes('50ms'));
        return true;
      }
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('fetchWithTimeout throws HttpNetworkError on network failure', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };

  try {
    await assert.rejects(
      async () => {
        await fetchWithTimeout('/api/broken', { timeout: 1000 });
      },
      (err) => {
        assert.ok(err instanceof HttpNetworkError);
        assert.equal(err.name, 'HttpNetworkError');
        assert.equal(err.isNetworkError, true);
        return true;
      }
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('fetchWithTimeout propagates external signal cancellation', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url, opts) => {
    return new Promise((resolve, reject) => {
      opts.signal.addEventListener('abort', () => {
        const err = new Error('User aborted');
        err.name = 'AbortError';
        reject(err);
      });
    });
  };

  const controller = new AbortController();
  try {
    const promise = fetchWithTimeout('/api/cancel', {
      timeout: 5000,
      signal: controller.signal
    });
    controller.abort();
    await assert.rejects(
      async () => await promise,
      (err) => {
        assert.equal(err.name, 'AbortError');
        return true;
      }
    );
  } finally {
    global.fetch = originalFetch;
  }
});
