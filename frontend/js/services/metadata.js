/** Metadata API domain. Compose on the facade to preserve dynamic this. */
const createMetadataApiService = () => ({
  // Metadata
  async getMetadataSources() {
    const res = await fetch('/api/metadata/sources');
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Error fetching metadata sources');
    }
    return res.json();
  },

  async saveMetadataSources(selectedSources) {
    const res = await fetch('/api/metadata/sources', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selected_sources: selectedSources })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Error saving metadata sources');
    }
    return res.json();
  },

  async fetchMetadataOnline(data) {
    console.log('[Lunabria] 🔍 Fetching online metadata with Calibre:', data);
    const res = await fetch('/api/metadata/fetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Error fetching metadata with Calibre');
    }
    return res.json();
  },

  async fetchMetadataByIsbn(isbn) {
    return this.fetchMetadataOnline({ isbn });
  },

  async updateMetadata(bookId, data) {
    console.log('[Lunabria] 🏷️ Updating book metadata:', bookId, data);
    const res = await fetch(`/api/metadata/${bookId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Error updating metadata');
    }
    const result = await res.json();
    console.log('[Lunabria] ✔️ Metadata saved successfully');
    return result;
  },
});
