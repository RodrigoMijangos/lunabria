/**
 * VirtualLibraryManager.js
 * Manages virtual collections modal and creation.
 */
class VirtualLibraryManager {
  constructor(onLibrariesChanged) {
    this.onLibrariesChanged = onLibrariesChanged;
    this.modal = typeof document !== 'undefined' ? document.getElementById('vl-modal') : null;
    this.selectedBookIds = new Set();
    this.books = null;
    this.mode = 'query';
    this.openSequence = 0;
    this.manualPage = 0;
    this.manualTotal = 0;
    this.manualRequestSequence = 0;
    this.filterVirtualLibraryId = null;
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
    const closeBtn = document.getElementById('vl-close-x-btn');
    const saveBtn = document.getElementById('vl-save-btn');
    const selectAllBtn = document.getElementById('vl-select-all-btn');
    const deselectAllBtn = document.getElementById('vl-deselect-all-btn');
    const selectedBadge = document.getElementById('vl-selected-count-badge');
    const collectionFilterHint = document.getElementById('vl-collection-filter-hint');
    const collectionFilterCheckbox = document.getElementById('vl-filter-by-current-collection');
    const currentCollectionLabel = document.getElementById('vl-current-collection-label');
    const queryPreviewContainer = document.getElementById('vl-query-preview-container');
    const queryPreviewCount = document.getElementById('vl-query-preview-count');
    const queryPreviewList = document.getElementById('vl-query-preview-list');

    if (nameInput) nameInput.value = '';
    if (queryInput) queryInput.value = options.activeCollectionQuery || options.searchQuery || '';
    if (searchInput) searchInput.value = options.searchQuery || '';

    if (options.searchQuery && nameInput && !nameInput.value) {
      nameInput.placeholder = `E.g., ${options.searchQuery}`;
    } else if (options.activeCollectionName && nameInput && !nameInput.value) {
      nameInput.placeholder = `E.g., Copy of ${options.activeCollectionName}`;
    }

    if (options.activeVirtualLibraryId) {
      this.filterVirtualLibraryId = options.activeVirtualLibraryId;
      if (collectionFilterHint) collectionFilterHint.style.display = 'block';
      if (currentCollectionLabel) {
        currentCollectionLabel.textContent = `Filter within collection: "${options.activeCollectionName || 'Current'}"`;
      }
      if (collectionFilterCheckbox) collectionFilterCheckbox.checked = true;
    } else {
      this.filterVirtualLibraryId = null;
      if (collectionFilterHint) collectionFilterHint.style.display = 'none';
    }

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
    let querySearchTimeout = null;

    const updateSelectedCounter = () => {
      const count = this.selectedBookIds.size;
      if (selectedBadge) {
        selectedBadge.textContent = `${count} selected`;
      }
      if (saveBtn && this.mode === 'manual') {
        saveBtn.textContent = count > 0 ? `Create Virtual Library (${count})` : 'Create Virtual Library';
      } else if (saveBtn) {
        saveBtn.textContent = 'Create Virtual Library';
      }
    };
    updateSelectedCounter();

    const updateQueryPreview = async () => {
      if (!queryPreviewList) return;
      const calibreQuery = queryInput?.value.trim() || '';
      if (!calibreQuery) {
        if (queryPreviewContainer) queryPreviewContainer.style.display = 'none';
        queryPreviewList.replaceChildren();
        return;
      }

      if (queryPreviewContainer) queryPreviewContainer.style.display = 'block';
      if (queryPreviewCount) queryPreviewCount.textContent = 'Checking matching books...';
      queryPreviewList.textContent = 'Searching books matching expression...';

      try {
        const response = await api.getBooks(calibreQuery, null, { pageSize: 100 });
        if (sequence !== this.openSequence) return;
        const pageBooks = Array.isArray(response)
          ? response
          : (Array.isArray(response?.books) ? response.books : []);
        const total = Array.isArray(response) ? pageBooks.length : (response?.total ?? pageBooks.length);

        if (queryPreviewCount) {
          queryPreviewCount.textContent = `Matching books (${total}):`;
        }
        queryPreviewList.replaceChildren();

        if (!pageBooks.length) {
          queryPreviewList.textContent = 'No books match this Calibre search expression.';
          return;
        }

        pageBooks.forEach(book => {
          const card = document.createElement('div');
          card.className = 'vl-book-item vl-book-preview-item';

          const coverWrap = document.createElement('div');
          coverWrap.className = 'vl-book-cover-wrap';
          const coverImg = document.createElement('img');
          coverImg.className = 'vl-book-cover';
          coverImg.alt = book.title || '';
          coverImg.loading = 'lazy';
          coverImg.src = book.cover_url || `/api/books/${book.id}/cover`;
          coverImg.onerror = () => {
            coverImg.onerror = null;
            coverImg.src = typeof OFFLINE_FALLBACK_COVER !== 'undefined'
              ? OFFLINE_FALLBACK_COVER
              : 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300"><rect width="100%" height="100%" fill="%232d3748"/><path d="M70 120h60M70 150h60" stroke="%23718096" stroke-width="6"/><circle cx="100" cy="80" r="18" fill="%23a0aec0"/></svg>';
          };
          coverWrap.appendChild(coverImg);

          const title = document.createElement('span');
          title.className = 'vl-book-title-author';
          title.textContent = `${book.title} — ${book.authors || ''}`;

          card.append(coverWrap, title);
          queryPreviewList.appendChild(card);
        });
      } catch (err) {
        if (sequence !== this.openSequence) return;
        if (queryPreviewCount) queryPreviewCount.textContent = 'Matching books (0):';
        queryPreviewList.textContent = 'Invalid Calibre search expression or no books match.';
      }
    };

    const setMode = (mode) => {
      this.mode = mode;
      querySection.style.display = mode === 'query' ? '' : 'none';
      manualSection.style.display = mode === 'manual' ? '' : 'none';
      queryTab.classList.toggle('active', mode === 'query');
      manualTab.classList.toggle('active', mode === 'manual');
      updateSelectedCounter();
      if (mode === 'query' && queryInput?.value.trim()) {
        updateQueryPreview();
      }
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
      const virtualLibraryId = (collectionFilterCheckbox?.checked && this.filterVirtualLibraryId)
        ? this.filterVirtualLibraryId
        : null;

      const previousScrollTop = typeof manualList?.scrollTop === 'number' ? manualList.scrollTop : 0;

      if (!append) {
        this.books = [];
        this.manualPage = 0;
        this.manualTotal = 0;
        if (manualList) manualList.textContent = 'Loading books...';
      } else {
        const loadMoreBtn = manualList?.querySelector?.('button') ||
          (Array.isArray(manualList?.children)
            ? manualList.children.find(c => c.textContent?.includes?.('Load more'))
            : null);
        if (loadMoreBtn) {
          loadMoreBtn.disabled = true;
          loadMoreBtn.textContent = 'Loading more books...';
        }
      }

      try {
        const response = await api.getBooks(null, virtualLibraryId, {
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
        if (append && manualList && previousScrollTop > 0) {
          manualList.scrollTop = previousScrollTop;
          if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => {
              manualList.scrollTop = previousScrollTop;
            });
          }
        }
        updateSelectedCounter();
      } catch (error) {
        if (sequence !== this.openSequence || requestSequence !== this.manualRequestSequence) return;
        if (!append) {
          this.books = [];
          if (manualList) manualList.textContent = 'Could not load book catalog.';
        } else {
          const loadMoreBtn = manualList?.querySelector?.('button') ||
            (Array.isArray(manualList?.children)
              ? manualList.children.find(c => c.textContent?.includes?.('Loading more'))
              : null);
          if (loadMoreBtn) {
            loadMoreBtn.disabled = false;
            loadMoreBtn.textContent = 'Load more books';
          }
        }
      }
    };

    const initialMode = preselectedBookIds.length ? 'manual' : (options.activeVirtualLibraryId ? 'manual' : 'query');
    if (queryTab && manualTab && querySection && manualSection) {
      queryTab.onclick = () => setMode('query');
      manualTab.onclick = () => loadManualBooks();
      setMode(initialMode);
    }
    if (cancelBtn) cancelBtn.onclick = () => ModalView.close(this.modal);
    if (closeBtn) closeBtn.onclick = () => ModalView.close(this.modal);

    if (this.modal && typeof this.modal.addEventListener === 'function') {
      this.modal.addEventListener('click', event => {
        if (event.target === this.modal) ModalView.close(this.modal);
      });
    }

    if (manualList) {
      manualList.onchange = (event) => {
        const checkbox = event.target.dataset?.bookId ? event.target : event.target.closest?.('input[data-book-id]');
        if (!checkbox) return;
        const id = Number(checkbox.dataset.bookId);
        const isChecked = checkbox.checked;
        if (isChecked) this.selectedBookIds.add(id);
        else this.selectedBookIds.delete(id);
        const itemLabel = checkbox.closest?.('.vl-book-item');
        if (itemLabel?.classList) {
          itemLabel.classList.toggle('is-selected', isChecked);
        }
        updateSelectedCounter();
      };
    }

    if (selectAllBtn) {
      selectAllBtn.onclick = () => {
        if (!Array.isArray(this.books)) return;
        this.books.forEach(b => this.selectedBookIds.add(Number(b.id)));
        this.renderManualBooks(manualList, searchInput?.value || '', () => loadManualBooks({ append: true }));
        updateSelectedCounter();
      };
    }

    if (deselectAllBtn) {
      deselectAllBtn.onclick = () => {
        if (!Array.isArray(this.books)) return;
        this.books.forEach(b => this.selectedBookIds.delete(Number(b.id)));
        this.renderManualBooks(manualList, searchInput?.value || '', () => loadManualBooks({ append: true }));
        updateSelectedCounter();
      };
    }

    if (collectionFilterCheckbox) {
      collectionFilterCheckbox.onchange = () => {
        this.manualRequestSequence++;
        this.books = null;
        this.manualPage = 0;
        this.manualTotal = 0;
        loadManualBooks({ force: true });
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

    if (queryInput) {
      queryInput.oninput = () => {
        if (querySearchTimeout !== null) window.clearTimeout(querySearchTimeout);
        querySearchTimeout = window.setTimeout(updateQueryPreview, 250);
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
    else if (queryInput?.value.trim()) updateQueryPreview();
  }

  renderManualBooks(container, query = '', onLoadMore = null) {
    if (!container || !Array.isArray(this.books)) return;
    const previousScrollTop = typeof container.scrollTop === 'number' ? container.scrollTop : 0;
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
      const isSelected = this.selectedBookIds.has(Number(book.id));
      const label = document.createElement('label');
      label.className = `vl-book-item${isSelected ? ' is-selected' : ''}`;
      label.dataset.bookId = String(book.id);

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.dataset.bookId = book.id;
      checkbox.checked = isSelected;

      const description = document.createElement('span');
      description.className = 'vl-book-title-author';
      description.textContent = `${book.title} — ${book.authors || ''}`;

      const coverWrap = document.createElement('div');
      coverWrap.className = 'vl-book-cover-wrap';
      const coverImg = document.createElement('img');
      coverImg.className = 'vl-book-cover';
      coverImg.alt = book.title || '';
      coverImg.loading = 'lazy';
      coverImg.src = book.cover_url || `/api/books/${book.id}/cover`;
      coverImg.onerror = () => {
        coverImg.onerror = null;
        coverImg.src = typeof OFFLINE_FALLBACK_COVER !== 'undefined'
          ? OFFLINE_FALLBACK_COVER
          : 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300"><rect width="100%" height="100%" fill="%232d3748"/><path d="M70 120h60M70 150h60" stroke="%23718096" stroke-width="6"/><circle cx="100" cy="80" r="18" fill="%23a0aec0"/></svg>';
      };
      coverWrap.appendChild(coverImg);

      label.append(checkbox, description, coverWrap);
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

    if (previousScrollTop > 0) {
      container.scrollTop = previousScrollTop;
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => {
          container.scrollTop = previousScrollTop;
        });
      }
    }
  }
}

window.VirtualLibraryManager = VirtualLibraryManager;
