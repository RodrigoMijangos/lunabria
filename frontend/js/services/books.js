const diagnoseUploadResponse = (xhr, bytesSent = false) => {
  let result = null;
  try {
    result = JSON.parse(xhr.responseText || '{}');
  } catch (_) {}

  const status = xhr.status;
  const responseText = xhr.responseText || '';
  const serverHeader = (typeof xhr.getResponseHeader === 'function' ? (xhr.getResponseHeader('server') || '') : '').toLowerCase();
  const isNginxOrProxy = serverHeader.includes('nginx') || responseText.toLowerCase().includes('nginx') || /<html[\s>]/i.test(responseText);

  if (status === 413 || /request entity too large|payload too large/i.test(responseText)) {
    const error = new Error("Error del proxy inverso (HTTP 413 - Payload Too Large): el archivo supera el límite permitido por el proxy. Configura 'client_max_body_size 500M;' en Nginx u otro proxy inverso.");
    error.status = status;
    error.isProxyError = true;
    error.proxyDirective = 'client_max_body_size 500M;';
    return error;
  }

  if (status === 504 || /gateway time-?out/i.test(responseText)) {
    const error = new Error("Error del proxy inverso (HTTP 504 - Gateway Timeout): el proxy agotó el tiempo de espera. Desactiva el buffering de peticiones ('proxy_request_buffering off;') y amplía 'proxy_read_timeout 600s;'.");
    error.status = status;
    error.isProxyError = true;
    error.proxyDirective = 'proxy_request_buffering off;';
    return error;
  }

  if (status === 502 || /bad gateway/i.test(responseText)) {
    const error = new Error("Error del proxy inverso (HTTP 502 - Bad Gateway): el proxy no pudo comunicarse con el backend de Lunabria.");
    error.status = status;
    error.isProxyError = true;
    return error;
  }

  if (status === 408 || /request time-?out/i.test(responseText)) {
    const error = new Error("Error del proxy inverso (HTTP 408 - Request Timeout): tiempo agotado durante la transferencia en el proxy. Desactiva el buffering con 'proxy_request_buffering off;'.");
    error.status = status;
    error.isProxyError = true;
    error.proxyDirective = 'proxy_request_buffering off;';
    return error;
  }

  if (status === 400 && (!result || !result.detail) && isNginxOrProxy) {
    const error = new Error("Error del proxy inverso (HTTP 400 - Bad Request): Nginx rechazó la subida antes de llegar a Lunabria. Típico cuando 'proxy_request_buffering on;' está activo. Añade 'proxy_request_buffering off;' a Nginx.");
    error.status = status;
    error.isProxyError = true;
    error.proxyDirective = 'proxy_request_buffering off;';
    return error;
  }

  if (result && result.detail) {
    const message = typeof result.detail === 'string'
      ? result.detail
      : (result.detail?.message || 'Error uploading book');
    const error = new Error(message);
    error.status = status;
    error.detail = result.detail;
    return error;
  }

  const message = status ? `Error en la subida (HTTP ${status})` : 'Error uploading book';
  const error = new Error(message);
  error.status = status;
  return error;
};

/** Books API domain. Compose on the facade to preserve dynamic this. */
const createBooksApiService = () => ({
  // Books
  async getBooks(search = null, virtualLibraryId = null, options = null) {
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    if (virtualLibraryId) params.append('virtual_library_id', virtualLibraryId);
    if (options) {
      if (options.query) params.append('q', options.query);
      if (options.page != null) params.append('page', options.page);
      if (options.pageSize != null) params.append('page_size', options.pageSize);
      if (options.sort) params.append('sort', options.sort);
      for (const id of options.excludeIds || []) params.append('exclude_ids', id);
    }
    const res = await fetch(`/api/books?${params.toString()}`);
    if (!res.ok) throw new Error('Error fetching books');
    return res.json();
  },

  async getBook(bookId) {
    const res = await fetch(`/api/books/${bookId}`);
    if (!res.ok) throw new Error('Book not found');
    return res.json();
  },

  async deleteBook(bookId) {
    console.log('[Lunabria] ❌ Deleting book:', bookId);
    const res = await fetch(`/api/books/${bookId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Error deleting book');
    const result = await res.json();
    console.log('[Lunabria] ✔️ Book successfully deleted');
    return result;
  },

  async uploadBook(file) {
    const formData = new FormData();
    formData.append('files', file, file.name);
    const res = await fetch('/api/books/upload', {
      method: 'POST',
      body: formData
    });
    if (!res.ok) {
      let detail = 'Error uploading book';
      try {
        const error = await res.json();
        detail = error.detail || detail;
      } catch (e) {}
      throw new Error(detail);
    }
    return res.json();
  },

  async uploadBooks(formData) {
    console.log('[Lunabria] 📤 Uploading book files...');
    const res = await fetch('/api/books/upload', {
      method: 'POST',
      body: formData
    });
    if (!res.ok) throw new Error('Error uploading books');
    const result = await res.json();
    console.log('[Lunabria] ✔️ Books accepted for background processing:', result);
    return result;
  },

  async uploadBookWithProgress(file, options = {}) {
    const formData = new FormData();
    formData.append('files', file, file.name);
    if (options.autoFetchMetadata !== undefined) formData.append('auto_fetch_metadata', options.autoFetchMetadata ? 'true' : 'false');
    if (options.allowDuplicate !== undefined) formData.append('allow_duplicate', options.allowDuplicate ? 'true' : 'false');

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      if (typeof options.onXhrCreated === 'function') {
        options.onXhrCreated(xhr);
      }
      xhr.open('POST', '/api/books/upload');
      xhr.timeout = 15 * 60 * 1000;

      let bytesSent = false;
      let sentFired = false;
      const notifySent = () => {
        bytesSent = true;
        if (!sentFired) {
          sentFired = true;
          if (typeof options.onSent === 'function') {
            options.onSent();
          }
        }
      };

      xhr.upload.onprogress = event => {
        if (event.lengthComputable && typeof options.onProgress === 'function') {
          const percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
          options.onProgress(percent);
          if (percent >= 100) {
            notifySent();
          }
        }
      };
      xhr.upload.onload = () => {
        notifySent();
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          let result = {};
          try {
            result = JSON.parse(xhr.responseText || '{}');
          } catch (_) {}
          resolve(result);
          return;
        }
        reject(diagnoseUploadResponse(xhr, bytesSent));
      };

      xhr.onerror = () => {
        if (bytesSent) {
          const error = new Error("Conexión interrumpida por el proxy inverso tras enviar los datos. Es probable que Nginx haya abortado por buffering. Configura 'proxy_request_buffering off;'.");
          error.status = 0;
          error.isProxyError = true;
          error.proxyDirective = 'proxy_request_buffering off;';
          reject(error);
          return;
        }
        reject(new Error('Network error while uploading book'));
      };

      xhr.ontimeout = () => {
        if (bytesSent) {
          const error = new Error("Tiempo de espera agotado tras enviar los datos. Posible buffering en el proxy inverso. Configura 'proxy_request_buffering off;'.");
          error.status = 408;
          error.isProxyError = true;
          error.proxyDirective = 'proxy_request_buffering off;';
          reject(error);
          return;
        }
        reject(new Error('Upload timed out'));
      };

      xhr.onabort = () => reject(new Error('Upload was cancelled'));
      xhr.send(formData);
    });
  },

  async getActiveUploadJobs() {
    const res = await fetch('/api/books/upload/jobs');
    if (!res.ok) throw new Error('Error fetching active upload jobs');
    return res.json();
  },

  async getUploadJob(jobId) {
    const res = await fetch(`/api/books/upload/jobs/${encodeURIComponent(jobId)}`);
    if (!res.ok) {
      let detail = 'Error fetching upload job';
      try {
        const error = await res.json();
        detail = error.detail || detail;
      } catch (_) {}
      throw new Error(detail);
    }
    return res.json();
  },

  // Recents (Top 10)
  async getRecents() {
    const res = await fetch('/api/recents');
    if (!res.ok) return [];
    return res.json();
  },
});
