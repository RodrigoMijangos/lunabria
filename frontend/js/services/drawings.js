/** Drawings API domain. Compose on the facade to preserve dynamic this. */
const createDrawingsApiService = () => ({
  // Freehand Page Drawings (Smart pencil, stylus, and canvas drawings)
  async getPageDrawings(bookId, page) {
    try {
      const res = await fetch(`/api/books/${bookId}/pages/${page}/drawings`);
      if (!res.ok) return [];
      return res.json();
    } catch (e) {
      return [];
    }
  },

  async savePageDrawings(bookId, page, strokes) {
    try {
      const res = await fetch(`/api/books/${bookId}/pages/${page}/drawings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strokes })
      });
      if (!res.ok) return null;
      return res.json();
    } catch (e) {
      return null;
    }
  },

  async clearPageDrawings(bookId, page) {
    try {
      const res = await fetch(`/api/books/${bookId}/pages/${page}/drawings`, {
        method: 'DELETE'
      });
      return res.ok;
    } catch (e) {
      return false;
    }
  }
});
