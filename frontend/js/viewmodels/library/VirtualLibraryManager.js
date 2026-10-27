/**
 * VirtualLibraryManager.js
 * Manages virtual collections modal and creation.
 */
class VirtualLibraryManager {
  constructor(onLibrariesChanged) {
    this.onLibrariesChanged = onLibrariesChanged;
    this.modal = typeof document !== 'undefined' ? document.getElementById('vl-modal') : null;
    this.manageModal = typeof document !== 'undefined' ? document.getElementById('vl-manage-modal') : null;
    this.selectedBookIds = new Set();
    this.manageSelectedBookIds = new Set();
    this.books = null;
    this.manageBooks = null;
    this.manageOpenSequence = 0;
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

    const fieldSelect = document.getElementById('vl-builder-field');
    const valueInput = document.getElementById('vl-builder-value');
    const exactCheckbox = document.getElementById('vl-builder-exact');
    const addTermBtn = document.getElementById('vl-builder-add-btn');
    const compiledPreview = document.getElementById('vl-compiled-preview');
    const clearQueryBtn = document.getElementById('vl-query-clear-btn');
    const queryTokensContainer = document.getElementById('vl-query-tokens');
    const queryBuilderCard = document.getElementById('vl-query-builder');
    const builderToggleBtn = document.getElementById('vl-builder-toggle-btn');
    const builderCloseBtn = document.getElementById('vl-builder-close-btn');
    const helperBtns = this.modal?.querySelectorAll ? this.modal.querySelectorAll('.vl-helper-btn') : [];

    const setBuilderVisible = (visible) => {
      if (!queryBuilderCard) return;
      if (visible) {
        if (typeof queryBuilderCard.removeAttribute === 'function') {
          queryBuilderCard.removeAttribute('hidden');
        }
        if (queryBuilderCard.style) queryBuilderCard.style.display = '';
      } else {
        if (typeof queryBuilderCard.setAttribute === 'function') {
          queryBuilderCard.setAttribute('hidden', '');
        }
        if (queryBuilderCard.style) queryBuilderCard.style.display = 'none';
      }
      if (builderToggleBtn) {
        if (typeof builderToggleBtn.setAttribute === 'function') {
          builderToggleBtn.setAttribute('aria-expanded', visible ? 'true' : 'false');
        }
        if (builderToggleBtn.classList?.toggle) {
          builderToggleBtn.classList.toggle('active', visible);
        }
        const textSpan = builderToggleBtn.querySelector ? builderToggleBtn.querySelector('span') : null;
        if (textSpan) {
          textSpan.textContent = visible ? 'Hide Builder' : 'Query Builder';
        }
      }
    };

    if (builderToggleBtn) {
      builderToggleBtn.onclick = () => {
        const isHidden = queryBuilderCard
          ? (Boolean(queryBuilderCard.hasAttribute?.('hidden')) || queryBuilderCard.style?.display === 'none')
          : false;
        setBuilderVisible(isHidden);
      };
    }

    if (builderCloseBtn) {
      builderCloseBtn.onclick = () => {
        setBuilderVisible(false);
      };
    }

    const renderQueryTokens = () => {
      if (!queryTokensContainer) return;
      const raw = queryInput?.value?.trim?.() || '';
      if (!raw || typeof LunabriaQueryCompiler === 'undefined' || typeof LunabriaQueryCompiler.parseClauses !== 'function') {
        if (typeof queryTokensContainer.replaceChildren === 'function') {
          queryTokensContainer.replaceChildren();
        } else {
          queryTokensContainer.textContent = '';
        }
        return;
      }
      const clauses = LunabriaQueryCompiler.parseClauses(raw);
      if (typeof queryTokensContainer.replaceChildren === 'function') {
        queryTokensContainer.replaceChildren();
      } else {
        queryTokensContainer.textContent = '';
      }
      if (!clauses.length) return;

      clauses.forEach((cl, idx) => {
        const pill = document.createElement('div');
        pill.className = `vl-token-pill${cl.op === '-' ? ' is-negated' : ''}`;

        if (cl.op === '-') {
          const opSpan = document.createElement('span');
          opSpan.className = 'vl-token-op vl-token-op-not';
          opSpan.textContent = 'NOT';
          pill.appendChild(opSpan);
        } else if (idx > 0) {
          const opSpan = document.createElement('span');
          opSpan.className = 'vl-token-op vl-token-op-and';
          opSpan.textContent = 'AND';
          pill.appendChild(opSpan);
        }

        if (cl.field) {
          const fieldSpan = document.createElement('span');
          fieldSpan.className = 'vl-token-field';
          fieldSpan.textContent = `${cl.field}:`;
          pill.appendChild(fieldSpan);
        }

        const valSpan = document.createElement('span');
        valSpan.className = 'vl-token-value';
        valSpan.textContent = cl.values.map(v => v.isQuoted ? `"${v.value}"` : v.value).join(', ');
        pill.appendChild(valSpan);

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'vl-token-remove';
        if (typeof removeBtn.setAttribute === 'function') {
          removeBtn.setAttribute('aria-label', `Remove filter ${cl.field ? cl.field + ' ' : ''}${valSpan.textContent}`);
        }
        removeBtn.textContent = '�';
        removeBtn.onclick = (e) => {
          if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
          clauses.splice(idx, 1);
          const nextVal = LunabriaQueryCompiler.formatClauses(clauses);
          if (queryInput) queryInput.value = nextVal;
          updateQueryPreview();
        };
        pill.appendChild(removeBtn);

        queryTokensContainer.appendChild(pill);
      });
    };

    const updateQueryPreview = async () => {
      renderQueryTokens();
      if (!queryPreviewList) return;
      const rawQuery = queryInput?.value.trim() || '';
      const compiledQuery = typeof LunabriaQueryCompiler !== 'undefined'
        ? LunabriaQueryCompiler.compile(rawQuery)
        : rawQuery;

      if (compiledPreview) {
        compiledPreview.textContent = compiledQuery ? `Calibre: ${compiledQuery}` : '';
      }

      if (!rawQuery) {
        if (queryPreviewContainer) queryPreviewContainer.style.display = 'none';
        queryPreviewList.replaceChildren();
        return;
      }

      if (queryPreviewContainer) queryPreviewContainer.style.display = 'block';
      if (queryPreviewCount) queryPreviewCount.textContent = 'Checking matching books...';
      queryPreviewList.textContent = 'Searching books matching expression...';

      try {
        const response = await api.getBooks(compiledQuery, null, { pageSize: 100 });
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
    renderQueryTokens();
    setBuilderVisible(false);
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

    if (addTermBtn) {
      addTermBtn.onclick = () => {
        const val = valueInput?.value.trim() || '';
        if (!val || !queryInput) return;
        const field = fieldSelect?.value || 'tags:';
        const isExact = exactCheckbox?.checked ?? true;
        const formattedVal = isExact ? `"${val}"` : val;
        const term = `${field} ${formattedVal}`;
        const current = queryInput.value.trim();
        queryInput.value = current ? `${current} + ${term}` : term;
        if (valueInput) valueInput.value = '';
        updateQueryPreview();
      };
    }

    if (clearQueryBtn) {
      clearQueryBtn.onclick = () => {
        if (queryInput) queryInput.value = '';
        if (compiledPreview) compiledPreview.textContent = '';
        renderQueryTokens();
        updateQueryPreview();
      };
    }

    helperBtns.forEach(btn => {
      btn.onclick = () => {
        const insert = btn.dataset.insert;
        if (!insert || !queryInput) return;
        const current = queryInput.value.trim();
        if (insert.startsWith(' + ') || insert.startsWith(', ') || insert.startsWith(' - ')) {
          queryInput.value = current ? `${current}${insert}` : (insert.trim().startsWith('-') ? '- ' : '');
        } else {
          queryInput.value = current ? `${current} + ${insert}` : insert;
        }
        updateQueryPreview();
      };
    });

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

  async openManageModal(library) {
    if (!library) return;
    const manageModal = typeof document !== 'undefined'
      ? (this.manageModal || document.getElementById('vl-manage-modal'))
      : null;
    if (!manageModal) return;
    this.manageModal = manageModal;
    const sequence = ++this.manageOpenSequence;

    const titleEl = document.getElementById('vl-manage-title');
    const closeBtn = document.getElementById('vl-manage-close-x-btn');
    const doneBtn = document.getElementById('vl-manage-done-btn');
    const nameInput = document.getElementById('vl-manage-name-input');
    const renameBtn = document.getElementById('vl-manage-rename-btn');
    const renameStatus = document.getElementById('vl-manage-rename-status');

    const querySection = document.getElementById('vl-manage-query-section');
    const queryText = document.getElementById('vl-manage-query-text');

    const booksSection = document.getElementById('vl-manage-books-section');
    const booksCount = document.getElementById('vl-manage-books-count');
    const selectedCount = document.getElementById('vl-manage-selected-count');
    const selectAllBtn = document.getElementById('vl-manage-select-all-btn');
    const deselectAllBtn = document.getElementById('vl-manage-deselect-all-btn');
    const removeSelectedBtn = document.getElementById('vl-manage-remove-selected-btn');
    const searchInput = document.getElementById('vl-manage-search-input');
    const booksList = document.getElementById('vl-manage-books-list');

    if (titleEl) {
      titleEl.innerHTML = `<svg class="ui-icon" aria-hidden="true" focusable="false"><use href="./icons.svg#folder"></use></svg> Manage: ${library.name}`;
    }
    if (nameInput) nameInput.value = library.name || '';
    if (renameStatus) {
      renameStatus.textContent = '';
      renameStatus.style.color = 'var(--accent-color)';
    }
    if (searchInput) searchInput.value = '';

    this.manageSelectedBookIds = new Set();
    this.manageBooks = null;

    const updateManageSelectedCounter = () => {
      const count = this.manageSelectedBookIds.size;
      if (selectedCount) {
        selectedCount.textContent = `${count} selected`;
      }
      if (removeSelectedBtn) {
        removeSelectedBtn.disabled = count === 0;
        removeSelectedBtn.textContent = count > 0 ? `Remove selected (${count})` : 'Remove selected';
      }
    };
    updateManageSelectedCounter();

    const closeModal = () => ModalView.close(manageModal);
    if (closeBtn) closeBtn.onclick = closeModal;
    if (doneBtn) doneBtn.onclick = closeModal;

    if (manageModal && typeof manageModal.addEventListener === 'function') {
      manageModal.addEventListener('click', event => {
        if (event.target === manageModal) closeModal();
      });
    }

    if (renameBtn) {
      renameBtn.onclick = async () => {
        const newName = nameInput?.value.trim() || '';
        if (!newName) {
          if (renameStatus) {
            renameStatus.textContent = 'Please enter a valid collection name.';
            renameStatus.style.color = '#dc2626';
          }
          return;
        }
        if (newName === library.name) {
          if (renameStatus) {
            renameStatus.textContent = 'Name is unchanged.';
            renameStatus.style.color = 'var(--text-secondary)';
          }
          return;
        }

        renameBtn.disabled = true;
        try {
          const updated = await api.updateVirtualLibrary(library.id, { name: newName });
          library.name = updated.name;
          if (titleEl) {
            titleEl.innerHTML = `<svg class="ui-icon" aria-hidden="true" focusable="false"><use href="./icons.svg#folder"></use></svg> Manage: ${updated.name}`;
          }
          if (renameStatus) {
            renameStatus.textContent = 'Collection renamed successfully.';
            renameStatus.style.color = 'var(--accent-color)';
          }
          if (this.onLibrariesChanged) await this.onLibrariesChanged(updated);
        } catch (err) {
          if (renameStatus) {
            renameStatus.textContent = `Error: ${err.message}`;
            renameStatus.style.color = '#dc2626';
          }
        } finally {
          renameBtn.disabled = false;
        }
      };
    }

    if (library.type === 'query') {
      if (querySection) querySection.style.display = '';
      if (booksSection) booksSection.style.display = 'none';
      if (queryText) queryText.textContent = library.query || '(empty)';
    } else {
      if (querySection) querySection.style.display = 'none';
      if (booksSection) booksSection.style.display = '';

      const renderBooks = () => {
        if (!booksList || !Array.isArray(this.manageBooks)) return;
        const query = searchInput?.value.toLowerCase().trim() || '';
        const filtered = this.manageBooks.filter(book => {
          const tags = Array.isArray(book.tags) ? book.tags.join(' ') : (book.tags || '');
          const text = `${book.title || ''} ${book.authors || ''} ${tags}`.toLowerCase();
          return !query || text.includes(query);
        });

        if (booksCount) {
          booksCount.textContent = String(this.manageBooks.length);
        }
        booksList.replaceChildren();

        if (!filtered.length) {
          const empty = document.createElement('div');
          empty.style.padding = '12px';
          empty.style.textAlign = 'center';
          empty.style.color = 'var(--text-secondary)';
          empty.textContent = this.manageBooks.length === 0
            ? 'No books in this collection.'
            : 'No books match your search.';
          booksList.appendChild(empty);
          return;
        }

        filtered.forEach(book => {
          const isSelected = this.manageSelectedBookIds.has(Number(book.id));
          const label = document.createElement('label');
          label.className = `vl-book-item${isSelected ? ' is-selected' : ''}`;
          label.dataset.bookId = String(book.id);

          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.dataset.bookId = String(book.id);
          checkbox.checked = isSelected;

          const description = document.createElement('span');
          description.className = 'vl-book-title-author';
          description.textContent = `${book.title} ? ${book.authors || ''}`;

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
          booksList.appendChild(label);
        });
      };

      if (booksList) {
        booksList.onchange = (event) => {
          const checkbox = event.target.dataset?.bookId ? event.target : event.target.closest?.('input[data-book-id]');
          if (!checkbox) return;
          const id = Number(checkbox.dataset.bookId);
          const isChecked = checkbox.checked;
          if (isChecked) this.manageSelectedBookIds.add(id);
          else this.manageSelectedBookIds.delete(id);
          const itemLabel = checkbox.closest?.('.vl-book-item');
          if (itemLabel?.classList) {
            itemLabel.classList.toggle('is-selected', isChecked);
          }
          updateManageSelectedCounter();
        };
      }

      if (selectAllBtn) {
        selectAllBtn.onclick = () => {
          if (!Array.isArray(this.manageBooks)) return;
          const query = searchInput?.value.toLowerCase().trim() || '';
          this.manageBooks.forEach(b => {
            const tags = Array.isArray(b.tags) ? b.tags.join(' ') : (b.tags || '');
            const text = `${b.title || ''} ${b.authors || ''} ${tags}`.toLowerCase();
            if (!query || text.includes(query)) {
              this.manageSelectedBookIds.add(Number(b.id));
            }
          });
          renderBooks();
          updateManageSelectedCounter();
        };
      }

      if (deselectAllBtn) {
        deselectAllBtn.onclick = () => {
          this.manageSelectedBookIds.clear();
          renderBooks();
          updateManageSelectedCounter();
        };
      }

      if (searchInput) {
        searchInput.oninput = () => {
          renderBooks();
        };
      }

      if (removeSelectedBtn) {
        removeSelectedBtn.onclick = async () => {
          const idsToRemove = [...this.manageSelectedBookIds];
          if (!idsToRemove.length) return;
          removeSelectedBtn.disabled = true;
          try {
            const updated = await api.removeBooksFromVirtualLibrary(library.id, idsToRemove);
            library.book_ids = updated.book_ids;
            this.manageBooks = (this.manageBooks || []).filter(b => !idsToRemove.includes(Number(b.id)));
            this.manageSelectedBookIds.clear();
            renderBooks();
            updateManageSelectedCounter();
            if (this.onLibrariesChanged) await this.onLibrariesChanged(updated);
          } catch (err) {
            alert(`Error removing books: ${err.message}`);
          } finally {
            removeSelectedBtn.disabled = this.manageSelectedBookIds.size === 0;
          }
        };
      }

      if (booksList) booksList.textContent = 'Loading collection books...';
      try {
        const fetchedBooks = await api.getVirtualLibraryBooks(library.id);
        if (sequence !== this.manageOpenSequence) return;
        this.manageBooks = Array.isArray(fetchedBooks) ? fetchedBooks : [];
        renderBooks();
      } catch (err) {
        if (sequence !== this.manageOpenSequence) return;
        if (booksList) booksList.textContent = 'Could not load collection books.';
      }
    }

    ModalView.open(manageModal);
  }
}

window.VirtualLibraryManager = VirtualLibraryManager;
