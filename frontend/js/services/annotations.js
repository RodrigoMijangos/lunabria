/** Annotations API domain. Compose on the facade to preserve dynamic this. */
const createAnnotationsApiService = () => ({
  async getAnnotations(bookId, color = null) {
    const url = color ? `/api/books/${bookId}/annotations?color=${encodeURIComponent(color)}` : `/api/books/${bookId}/annotations`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Error fetching annotations');
    return res.json();
  },

  async getAnnotationExportSections(bookId) {
    const res = await fetch(`/api/books/${bookId}/export-sections`);
    if (!res.ok) {
      const contentType = res.headers.get('content-type') || '';
      const message = contentType.includes('application/json')
        ? (await res.json()).detail
        : await res.text();
      throw new Error(message || 'Error fetching export chapters');
    }
    const result = await res.json();
    if (!result || !Array.isArray(result.sections)) throw new Error('Invalid export chapters response');
    return result;
  },

  async exportAnnotations(bookId, options) {
    const scope = options.scope || 'all';
    let res;
    if (scope === 'selected') {
      res = await fetch(`/api/books/${bookId}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          annotation_ids: options.annotation_ids,
          format: options.format,
          group_by: options.group_by,
          stamp: options.stamp === true
        })
      });
    } else {
      const params = new URLSearchParams({
        format: options.format || 'md',
        group_by: options.group_by || 'color',
        scope
      });
      for (const key of ['color', 'page', 'start_page', 'end_page', 'section_index']) {
        if (options[key] !== undefined && options[key] !== null && options[key] !== '') {
          params.set(key, String(options[key]));
        }
      }
      res = await fetch(`/api/books/${bookId}/export?${params.toString()}`);
    }

    if (!res.ok) {
      const contentType = res.headers.get('content-type') || '';
      const message = contentType.includes('application/json')
        ? (await res.json()).detail
        : await res.text();
      throw new Error(message || 'Error exporting annotations');
    }

    const disposition = res.headers.get('Content-Disposition') || '';
    const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] ||
      `notes_book_${bookId}.${options.format === 'md' ? 'md' : options.format || 'md'}`;
    return { blob: await res.blob(), filename };
  },

  async createAnnotation(bookId, data) {
    console.log('[Lunabria] ✏️ Saving new highlight:', {
      book: bookId,
      page: data.page,
      color: data.color,
      text: (data.text || '').substring(0, 60) + '...'
    });
    const res = await fetch(`/api/books/${bookId}/annotations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error('Error saving annotation');
    const result = await res.json();
    console.log('[Lunabria] ✔️ Highlight saved successfully');
    return result;
  },

  async updateAnnotation(annotId, data) {
    console.log('[Lunabria] 🔄 Updating highlight:', annotId, data);
    const res = await fetch(`/api/annotations/${annotId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error('Error updating annotation');
    const result = await res.json();
    console.log('[Lunabria] ✔️ Highlight updated');
    return result;
  },

  async deleteAnnotation(annotId) {
    console.log('[Lunabria] 🗑️ Deleting highlight:', annotId);
    const res = await fetch(`/api/annotations/${annotId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Error deleting annotation');
    const result = await res.json();
    console.log('[Lunabria] ✔️ Highlight deleted');
    return result;
  },
});
