/** Catalog DOM presentation. State and commands remain in the ViewModel. */
const CatalogView = {
  captureElements() {
    const elements = {
      bookGrid: document.getElementById('book-grid'),
      mainContainer: document.querySelector('main.container'),
      recentsContainer: document.getElementById('recents-list'),
      recentsSection: document.getElementById('recents-section'),
      vlSelect: document.getElementById('vl-select'),
      activeCollectionChip: document.getElementById('collections-chips')
    };
    const ids = {
      catalogContent: 'catalog-content',
      catalogSortSelect: 'catalog-sort-select',
      catalogToggleButton: 'catalog-toggle-btn',
      catalogPagination: 'catalog-pagination',
      catalogPageStatus: 'catalog-page-status',
      catalogPageNumbers: 'catalog-page-numbers',
      catalogPageInput: 'catalog-page-input',
      catalogPageTotal: 'catalog-page-total',
      catalogPreviousButton: 'catalog-page-previous',
      catalogNextButton: 'catalog-page-next',
      catalogPageSizeSelect: 'catalog-page-size-select',
      catalogPageSizeInfo: 'catalog-page-size-info',
      catalogSelectionToggle: 'catalog-selection-toggle',
      catalogSelectionActions: 'catalog-selection-actions',
      catalogSelectionCount: 'catalog-selection-count',
      catalogSelectionLibrary: 'catalog-selection-library',
      catalogSelectionAddButton: 'catalog-selection-add-btn',
      catalogSelectionCreateButton: 'catalog-selection-create-btn',
      catalogSelectionStatus: 'catalog-selection-status'
    };
    Object.entries(ids).forEach(([name, id]) => {
      elements[name] = document.getElementById(id);
    });
    return elements;
  },

  getGridColumnCount(bookGrid, previousColumns) {
    if (!bookGrid || typeof window.getComputedStyle !== 'function') {
      return previousColumns || 4;
    }
    const gridWidth = bookGrid.getBoundingClientRect().width;
    if (gridWidth <= 0) return previousColumns || 4;
    const templateColumns = window.getComputedStyle(bookGrid).gridTemplateColumns.trim();
    if (!templateColumns || templateColumns === 'none') return previousColumns || 4;
    const columnCount = templateColumns.split(/\s+/).filter(Boolean).length;
    return columnCount || previousColumns || 4;
  },

  syncPageSizeOptions(elements, columns, maxPageSize, pageSize, previousColumns) {
    const select = elements.catalogPageSizeSelect;
    let gridColumns = previousColumns;
    if (select && previousColumns !== columns) {
      select.replaceChildren();
      for (let count = columns; count <= maxPageSize; count += 1) {
        const option = document.createElement('option');
        option.value = String(count);
        option.textContent = `${count} books`;
        select.appendChild(option);
      }
      gridColumns = columns;
    }
    if (select) {
      select.value = String(pageSize);
      select.disabled = maxPageSize < 1;
    }
    if (elements.catalogPageSizeInfo) {
      elements.catalogPageSizeInfo.textContent = `${columns} columns · maximum ${maxPageSize} books (3 rows)`;
    }
    return gridColumns;
  },

  syncControls(elements, { searchQuery, catalogCollapsed, catalogSort }) {
    const isSearching = Boolean(searchQuery);
    const isExpanded = isSearching || !catalogCollapsed;
    if (elements.catalogSortSelect) elements.catalogSortSelect.value = catalogSort;
    if (elements.catalogContent) elements.catalogContent.hidden = !isExpanded;
    const button = elements.catalogToggleButton;
    if (button) {
      const action = isExpanded ? 'Collapse' : 'Expand';
      button.textContent = isExpanded ? '−' : '+';
      button.title = `${action} catalog`;
      button.setAttribute('aria-label', `${action} catalog`);
      button.setAttribute('aria-expanded', String(isExpanded));
      button.disabled = isSearching;
    }
  },

  syncSearchPresentation(elements, { searchQuery, catalogSort, recentBooks }, onShowRecents) {
    const isSearching = Boolean(searchQuery);
    if (elements.mainContainer) elements.mainContainer.classList.toggle('search-active', isSearching);
    if (elements.recentsSection) {
      const wasHidden = elements.recentsSection.style.display === 'none';
      const shouldShow = !isSearching && catalogSort !== 'last_read_at' && recentBooks.length > 0;
      elements.recentsSection.style.display = shouldShow ? 'block' : 'none';
      if (shouldShow && wasHidden) onShowRecents();
    }
  },

  updateBooksCountBadge(count) {
    const badge = document.getElementById('books-count-badge');
    if (badge) badge.textContent = `${count} ${count === 1 ? 'book' : 'books'}`;
  }
};

window.CatalogView = CatalogView;
