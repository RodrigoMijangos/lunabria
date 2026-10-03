/**
 * BookMetadataManager.js
 * Manages metadata editing, online ISBN scraping, and book deletion.
 */
class BookMetadataManager {
  constructor(onDataChanged) {
    this.onDataChanged = onDataChanged;
    this.modal = document.getElementById('edit-modal');
  }

  openEditModal(book) {
    if (!this.modal) return;

    document.getElementById('edit-book-id').value = book.id;
    document.getElementById('edit-title').value = book.title || '';
    document.getElementById('edit-authors').value = book.authors || '';
    document.getElementById('edit-tags').value = Array.isArray(book.tags) ? book.tags.join(', ') : (book.tags || '');
    document.getElementById('edit-isbn').value = book.isbn || '';

    const preview = document.getElementById('edit-cover-preview');
    if (preview) {
      preview.src = book.has_cover && book.cover_url ? book.cover_url : '/api/books/placeholder-cover';
    }

    const deleteBtn = document.getElementById('edit-delete-btn');
    if (deleteBtn) {
      deleteBtn.onclick = () => this.deleteCurrentBook(book.id, book.title);
    }

    const fetchBtn = document.getElementById('edit-fetch-isbn-btn');
    if (fetchBtn) {
      fetchBtn.onclick = () => this.fetchMetadataByIsbn();
    }

    const metadataSourcesSaveBtn = document.getElementById('metadata-sources-save-btn');
    if (metadataSourcesSaveBtn) {
      metadataSourcesSaveBtn.onclick = () => this.saveMetadataSources();
    }
    this.loadMetadataSources();

    const saveBtn = document.getElementById('edit-save-btn');
    if (saveBtn) {
      saveBtn.onclick = () => this.saveBookMetadata();
    }

    const cancelBtn = document.getElementById('edit-cancel-btn');
    if (cancelBtn) {
      cancelBtn.onclick = () => ModalView.close(this.modal);
    }

    ModalView.open(this.modal);
  }

  async loadMetadataSources() {
    const container = document.getElementById('metadata-sources-list');
    const status = document.getElementById('metadata-sources-status');
    const saveBtn = document.getElementById('metadata-sources-save-btn');
    if (!container) return;

    container.replaceChildren();
    if (status) status.textContent = 'Loading available sources...';
    if (saveBtn) saveBtn.disabled = true;

    try {
      const preferences = await api.getMetadataSources();
      const selectedSources = new Set(preferences.selected_sources);
      const availableSources = new Set(preferences.available_sources);
      const unavailableSources = preferences.unavailable_sources || [];
      const sources = [...preferences.available_sources, ...unavailableSources.filter(
        source => !availableSources.has(source)
      )];

      for (const source of sources) {
        const isAvailable = availableSources.has(source);
        const label = document.createElement('label');
        label.style.cssText = `display: inline-flex; align-items: center; gap: 6px; margin: 4px 12px 4px 0; cursor: ${isAvailable ? 'pointer' : 'not-allowed'};`;
        if (!isAvailable) label.title = `Install the ${source} plugin in Calibre to enable this source.`;

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = source;
        checkbox.checked = selectedSources.has(source);
        checkbox.disabled = !isAvailable;
        const labelText = isAvailable ? source : `${source} (requires Calibre plugin)`;
        label.append(checkbox, document.createTextNode(labelText));
        container.append(label);
      }

      if (status) status.textContent = `${selectedSources.size} sources selected.`;
      if (saveBtn) saveBtn.disabled = preferences.available_sources.length === 0;
    } catch (e) {
      if (status) status.textContent = `Could not load sources: ${e.message}`;
      if (saveBtn) saveBtn.disabled = true;
    }
  }

  async saveMetadataSources() {
    const container = document.getElementById('metadata-sources-list');
    const status = document.getElementById('metadata-sources-status');
    const saveBtn = document.getElementById('metadata-sources-save-btn');
    const selectedSources = Array.from(container?.querySelectorAll('input[type="checkbox"]:checked') || [])
      .map(input => input.value);

    if (!selectedSources.length) {
      if (status) status.textContent = 'Select at least one source.';
      return;
    }

    if (saveBtn) saveBtn.disabled = true;
    if (status) status.textContent = 'Saving...';
    try {
      const preferences = await api.saveMetadataSources(selectedSources);
      if (status) status.textContent = `Saved: ${preferences.selected_sources.length} sources will be used for searches and automatic imports.`;
    } catch (e) {
      if (status) status.textContent = `Could not save sources: ${e.message}`;
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  async fetchMetadataByIsbn() {
    const isbnInput = document.getElementById('edit-isbn');
    const isbn = isbnInput?.value.trim();
    if (!isbn) {
      alert('Enter a valid ISBN code (e.g., 9780132350884).');
      return;
    }

    const fetchBtn = document.getElementById('edit-fetch-isbn-btn');
    fetchBtn.disabled = true;
    fetchBtn.innerHTML = '<svg class="ui-icon ui-icon-spin" aria-hidden="true" focusable="false"><use href="./icons.svg#loader"></use></svg> Searching...';

    try {
      const data = await api.fetchMetadataByIsbn(isbn);
      if (data.title) document.getElementById('edit-title').value = data.title;
      if (data.authors?.length) document.getElementById('edit-authors').value = data.authors.join(', ');
      if (data.tags?.length) document.getElementById('edit-tags').value = data.tags.join(', ');
      if (data.cover_data_base64) {
        document.getElementById('edit-cover-preview').src = `data:image/jpeg;base64,${data.cover_data_base64}`;
      }
      alert('Metadata and cover found!');
    } catch (e) {
      alert('No metadata found for that ISBN: ' + e.message);
    } finally {
      fetchBtn.disabled = false;
      fetchBtn.innerHTML = '<svg class="ui-icon" aria-hidden="true" focusable="false"><use href="./icons.svg#search"></use></svg> Fetch from Calibre';
    }
  }

  async saveBookMetadata() {
    const bookId = Number(document.getElementById('edit-book-id').value);
    const title = document.getElementById('edit-title').value.trim();
    const authors = document.getElementById('edit-authors').value.trim();
    const tagsStr = document.getElementById('edit-tags').value.trim();
    const isbn = document.getElementById('edit-isbn').value.trim();
    const payload = {
      title,
      authors,
      tags: tagsStr,
      isbn: isbn || null
    };

    try {
      await api.updateMetadata(bookId, payload);
      ModalView.close(this.modal);
      if (this.onDataChanged) await this.onDataChanged();
    } catch (e) {
      alert('Error saving metadata: ' + e.message);
    }
  }

  async deleteCurrentBook(bookId, title) {
    if (confirm(`Are you sure you want to permanently delete "${title}" from your library?`)) {
      try {
        await api.deleteBook(bookId);
        ModalView.close(this.modal);
        if (this.onDataChanged) await this.onDataChanged();
      } catch (e) {
        alert('Error deleting book: ' + e.message);
      }
    }
  }
}

window.BookMetadataManager = BookMetadataManager;
