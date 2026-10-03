/** Virtual Libraries API domain. Compose on the facade to preserve dynamic this. */
const createVirtualLibrariesApiService = () => ({
  // Virtual Libraries
  async getVirtualLibraries() {
    const res = await fetch('/api/virtual-libraries');
    if (!res.ok) return [];
    return res.json();
  },

  async createVirtualLibrary(data) {
    console.log('[Lunabria] 📚 Creating virtual library:', data.name);
    const res = await fetch('/api/virtual-libraries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Error creating virtual library');
    }
    const result = await res.json();
    console.log('[Lunabria] ✔️ Virtual library created:', result);
    return result;
  },

  async addBooksToVirtualLibrary(id, bookIds) {
    const res = await fetch(`/api/virtual-libraries/${id}/books`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ book_ids: bookIds })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Error adding books to virtual library');
    }
    return res.json();
  },

  async deleteVirtualLibrary(id) {
    console.log('[Lunabria] 🗑️ Deleting virtual library:', id);
    const res = await fetch(`/api/virtual-libraries/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Error deleting virtual library');
    return res.json();
  },

  async getVirtualLibraryBooks(id) {
    const res = await fetch(`/api/virtual-libraries/${id}/books`);
    if (!res.ok) throw new Error('Error fetching books from virtual library');
    return res.json();
  },
});
