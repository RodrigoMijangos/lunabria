/**
 * http.js - Resilient HTTP fetch helper with configurable timeouts and typed errors.
 * Part of Lunabria Offline & Sync Infrastructure.
 */

class HttpTimeoutError extends Error {
  constructor(message = 'Request timed out', url = '') {
    super(message);
    this.name = 'HttpTimeoutError';
    this.url = url;
    this.isTimeout = true;
  }
}

class HttpNetworkError extends Error {
  constructor(message = 'Network error', url = '') {
    super(message);
    this.name = 'HttpNetworkError';
    this.url = url;
    this.isNetworkError = true;
  }
}

class HttpResponseError extends Error {
  constructor(status, statusText, url = '', data = null) {
    super(`HTTP ${status} (${statusText || 'Error'})`);
    this.name = 'HttpResponseError';
    this.status = status;
    this.statusText = statusText;
    this.url = url;
    this.data = data;
    this.isHttpError = true;
  }
}

const DEFAULT_TIMEOUT_MS = 8000;

/**
 * Fetch wrapper with timeout and AbortController.
 * @param {string|Request} url
 * @param {object} options Options including timeout (ms)
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url, options = {}) {
  const timeoutMs = options.timeout ?? DEFAULT_TIMEOUT_MS;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const externalSignal = options.signal;

  let timerId = null;
  let didTimeout = false;

  const onExternalAbort = () => {
    if (controller) controller.abort();
  };

  if (externalSignal) {
    if (externalSignal.aborted) {
      if (controller) controller.abort();
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  const fetchOptions = { ...options };
  delete fetchOptions.timeout;
  if (controller) {
    fetchOptions.signal = controller.signal;
  }

  const fetchPromise = (async () => {
    try {
      const response = await fetch(url, fetchOptions);
      return response;
    } catch (err) {
      if (didTimeout) {
        throw new HttpTimeoutError(`Request to ${url} timed out after ${timeoutMs}ms`, String(url));
      }
      if (err.name === 'AbortError') {
        throw err;
      }
      throw new HttpNetworkError(err.message || 'Network request failed', String(url));
    } finally {
      if (timerId !== null) clearTimeout(timerId);
      if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
    }
  })();

  if (timeoutMs > 0 && controller) {
    timerId = setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, timeoutMs);
  }

  return fetchPromise;
}

if (typeof window !== 'undefined') {
  window.HttpTimeoutError = HttpTimeoutError;
  window.HttpNetworkError = HttpNetworkError;
  window.HttpResponseError = HttpResponseError;
  window.fetchWithTimeout = fetchWithTimeout;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    HttpTimeoutError,
    HttpNetworkError,
    HttpResponseError,
    fetchWithTimeout
  };
}
