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
    if (options.autoFetchMetadata) formData.append('auto_fetch_metadata', 'true');

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/books/upload');
      xhr.timeout = 10 * 60 * 1000;
      xhr.upload.onprogress = event => {
        if (event.lengthComputable && typeof options.onProgress === 'function') {
          const percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
          options.onProgress(percent);
        }
      };
      xhr.onload = () => {
        let result = {};
        try {
          result = JSON.parse(xhr.responseText || '{}');
        } catch (_) {}

        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(result);
          return;
        }
        reject(new Error(result.detail || 'Error uploading book'));
      };
      xhr.onerror = () => reject(new Error('Network error while uploading book'));
      xhr.ontimeout = () => reject(new Error('Upload timed out'));
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
