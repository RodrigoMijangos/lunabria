/** Annotations API domain. Compose on the facade to preserve dynamic this. */
const createAnnotationsApiService = () => ({
  async getAnnotations(bookId, color = null) {
    const url = color ? `/api/books/${bookId}/annotations?color=${encodeURIComponent(color)}` : `/api/books/${bookId}/annotations`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Error fetching annotations');
    return res.json();
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
