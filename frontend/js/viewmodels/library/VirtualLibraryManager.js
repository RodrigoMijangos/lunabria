/**
 * VirtualLibraryManager.js
 * Manages virtual collections modal and creation.
 */
class VirtualLibraryManager {
  constructor(onLibrariesChanged) {
    this.onLibrariesChanged = onLibrariesChanged;
    this.modal = document.getElementById('vl-modal');
    this.selectedBookIds = new Set();
    this.books = null;
    this.mode = 'query';
    this.openSequence = 0;
    this.manualPage = 0;
    this.manualTotal = 0;
    this.manualRequestSequence = 0;
  }

  async openVirtualLibraryModal(options = {}) {
    if (!this.modal) return;
    const sequence = ++this.openSequence;

    const nameInput = document.getElementById('vl-name-input');
    const queryInput = document.getElementById('vl-query-input');
    const searchInput = document.getElementById('vl-manual-search');
    const manualList = document.getElementById('vl-manual-list');
    const queryTab = document.getElementById('vl-tab-query');
    const manualTab = document.getElementById('vl-tab-manual');
    const querySection = document.getElementById('vl-section-query');
    const manualSection = document.getElementById('vl-section-manual');
    const cancelBtn = document.getElementById('vl-cancel-btn');
    const saveBtn = document.getElementById('vl-save-btn');

    if (nameInput) nameInput.value = '';
    if (queryInput) queryInput.value = '';
    if (searchInput) searchInput.value = '';
    const preselectedBookIds = Array.isArray(options.selectedBookIds)
      ? options.selectedBookIds.map(Number).filter(Number.isFinite)
      : [];
    this.selectedBookIds = new Set(preselectedBookIds);
    this.books = null;
    this.manualPage = 0;
    this.manualTotal = 0;
    this.manualRequestSequence++;
    this.mode = 'query';
    let searchTimeout = null;

    const setMode = (mode) => {
      this.mode = mode;
      querySection.style.display = mode === 'query' ? '' : 'none';
      manualSection.style.display = mode === 'manual' ? '' : 'none';
      queryTab.classList.toggle('active', mode === 'query');
      manualTab.classList.toggle('active', mode === 'manual');
    };

    const loadManualBooks = async ({ append = false, force = false } = {}) => {
      setMode('manual');
      if (this.books !== null && !append && !force) {
        this.renderManualBooks(manualList, searchInput?.value || '', () => loadManualBooks({ append: true }));
        return;
      }

      const query = searchInput?.value.trim() || '';
      const page = append ? this.manualPage + 1 : 1;
      const requestSequence = ++this.manualRequestSequence;
      if (!append) {
        this.books = [];
        this.manualPage = 0;
        this.manualTotal = 0;
      }
      if (manualList) manualList.textContent = append ? 'Loading more books...' : 'Loading books...';

      try {
        const response = await api.getBooks(null, null, {
          query,
          page,
          pageSize: 24,
          sort: 'title'
        });
        if (sequence !== this.openSequence || requestSequence !== this.manualRequestSequence) return;
        const pageBooks = Array.isArray(response)
          ? response
          : (Array.isArray(response?.books) ? response.books : []);
        this.books = append ? [...(this.books || []), ...pageBooks] : pageBooks;
        this.manualPage = Array.isArray(response) ? 1 : Number(response?.page) || page;
        const total = Array.isArray(response) ? pageBooks.length : Number(response?.total);
        this.manualTotal = Number.isFinite(total) ? total : this.books.length;
        this.renderManualBooks(manualList, query, () => loadManualBooks({ append: true }));
      } catch (error) {
        if (sequence !== this.openSequence || requestSequence !== this.manualRequestSequence) return;
        this.books = [];
        if (manualList) manualList.textContent = 'Could not load book catalog.';
      }
    };

    const initialMode = preselectedBookIds.length ? 'manual' : 'query';
    if (queryTab && manualTab && querySection && manualSection) {
      queryTab.onclick = () => setMode('query');
      manualTab.onclick = () => loadManualBooks();
      setMode(initialMode);
    }
    if (cancelBtn) cancelBtn.onclick = () => ModalView.close(this.modal);

    if (manualList) {
      manualList.onchange = (event) => {
        const checkbox = event.target.closest('input[data-book-id]');
        if (!checkbox) return;
        const id = Number(checkbox.dataset.bookId);
        if (checkbox.checked) this.selectedBookIds.add(id);
        else this.selectedBookIds.delete(id);
      };
    }
    if (searchInput) {
      searchInput.oninput = () => {
        if (searchTimeout !== null) window.clearTimeout(searchTimeout);
        this.manualRequestSequence++;
        this.books = null;
        this.manualPage = 0;
        this.manualTotal = 0;
        if (manualList) manualList.textContent = 'Searching books...';
        searchTimeout = window.setTimeout(() => {
          searchTimeout = null;
          return loadManualBooks({ force: true });
        }, 250);
      };
    }

    if (saveBtn) {
      saveBtn.onclick = async () => {
        const name = nameInput?.value.trim() || '';
        const query = queryInput?.value.trim() || '';
        if (!name) {
          alert('Please enter a name for the collection.');
          return;
        }
        if (this.mode === 'query' && !query) {
          alert('Enter a Calibre search expression.');
          return;
        }
        if (this.mode === 'manual' && this.selectedBookIds.size === 0) {
          alert('Select at least one book for the collection.');
          return;
        }

        saveBtn.disabled = true;
        try {
          const createdLibrary = await api.createVirtualLibrary({
            name,
            type: this.mode,
            query: this.mode === 'query' ? query : '',
            book_ids: this.mode === 'manual' ? [...this.selectedBookIds] : []
          });
          ModalView.close(this.modal);
          if (this.onLibrariesChanged) await this.onLibrariesChanged(createdLibrary);
        } catch (e) {
          alert('Error creating collection: ' + e.message);
        } finally {
          saveBtn.disabled = false;
        }
      };
    }

    ModalView.open(this.modal);
    if (initialMode === 'manual') loadManualBooks();
  }

  renderManualBooks(container, query = '', onLoadMore = null) {
    if (!container || !Array.isArray(this.books)) return;
    const normalizedQuery = query.toLowerCase().trim();
    const books = this.books.filter(book => {
      const tags = Array.isArray(book.tags) ? book.tags.join(' ') : (book.tags || '');
      const searchableText = `${book.title || ''} ${book.authors || ''} ${tags}`.toLowerCase();
      return !normalizedQuery || searchableText.includes(normalizedQuery);
    });
    container.replaceChildren();

    if (!books.length) {
      container.textContent = 'No books match your search.';
      return;
    }

    books.forEach(book => {
      const label = document.createElement('label');
      label.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid var(--border-color);cursor:pointer;';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.dataset.bookId = book.id;
      checkbox.checked = this.selectedBookIds.has(Number(book.id));
      const description = document.createElement('span');
      description.textContent = `${book.title} — ${book.authors}`;
      label.append(checkbox, description);
      container.appendChild(label);
    });

    if (this.books.length < this.manualTotal && typeof onLoadMore === 'function') {
      const loadMoreButton = document.createElement('button');
      loadMoreButton.type = 'button';
      loadMoreButton.className = 'btn';
      loadMoreButton.textContent = 'Load more books';
      loadMoreButton.onclick = onLoadMore;
      container.appendChild(loadMoreButton);
    }
  }
}

window.VirtualLibraryManager = VirtualLibraryManager;
