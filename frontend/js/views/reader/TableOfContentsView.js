class TableOfContentsView {
  constructor(model, callbacks = {}) {
    this.model = model;
    this.onNavigate = callbacks.onNavigate || (() => {});
    this.list = document.getElementById('table-of-contents-list');
    this.emptyState = document.getElementById('table-of-contents-empty');
    this.noResultsState = document.getElementById('table-of-contents-no-results');
    this.searchInput = document.getElementById('toc-search-input');
    this.clearBtn = document.getElementById('toc-search-clear');
    this.searchContainer = document.querySelector ? document.querySelector('.toc-search-container') : null;
    this.entries = [];
    this.filterQuery = '';

    this.bindSearchEvents();
  }

  bindSearchEvents() {
    if (this.searchInput && typeof this.searchInput.addEventListener === 'function') {
      this.searchInput.addEventListener('input', () => {
        this.filterQuery = String(this.searchInput.value ?? '').trim().toLowerCase();
        if (this.clearBtn) this.clearBtn.hidden = !this.filterQuery;
        this.render(this.model?.currentPage);
      });
      this.searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.filterQuery) {
          e.preventDefault();
          if (typeof e.stopPropagation === 'function') e.stopPropagation();
          this.clearSearch();
        }
      });
    }
    if (this.clearBtn && typeof this.clearBtn.addEventListener === 'function') {
      this.clearBtn.addEventListener('click', () => {
        this.clearSearch();
        if (typeof this.searchInput?.focus === 'function') this.searchInput.focus();
      });
    }
  }

  clearSearch() {
    this.filterQuery = '';
    if (this.searchInput) this.searchInput.value = '';
    if (this.clearBtn) this.clearBtn.hidden = true;
    this.render(this.model?.currentPage);
  }

  filterEntries(entries, query) {
    if (!query) return entries;
    const filtered = [];
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue;
      const title = String(entry.title ?? '').toLowerCase();
      const matchesSelf = title.includes(query);
      const children = Array.isArray(entry.children) ? this.filterEntries(entry.children, query) : [];
      if (matchesSelf || children.length > 0) {
        filtered.push({
          ...entry,
          children
        });
      }
    }
    return filtered;
  }

  render(currentPage = this.model?.currentPage) {
    if (!this.list) return;

    if (typeof this.list.replaceChildren === 'function') {
      this.list.replaceChildren();
    } else {
      this.list.innerHTML = '';
      this.list.children = [];
    }
    this.entries = [];

    const rawToc = Array.isArray(this.model?.navigationMap?.toc) ? this.model.navigationMap.toc : [];
    const hasToc = rawToc.length > 0;

    if (this.emptyState) this.emptyState.hidden = hasToc;
    if (this.searchContainer) this.searchContainer.hidden = !hasToc;

    if (!hasToc) {
      this.list.hidden = true;
      if (this.noResultsState) this.noResultsState.hidden = true;
      return;
    }

    const visibleToc = this.filterEntries(rawToc, this.filterQuery);
    const hasResults = visibleToc.length > 0;

    if (this.noResultsState) this.noResultsState.hidden = hasResults;
    this.list.hidden = !hasResults;

    if (hasResults) {
      this.appendEntries(visibleToc, this.list, 0);
      this.updateActivePage(currentPage);
    }
  }

  appendEntries(entries, list, depth) {
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue;

      const level = Number.isInteger(entry.level) && entry.level >= 0 ? entry.level : depth;
      const page = Number.isInteger(entry.page) && entry.page > 0 ? entry.page : null;
      const title = String(entry.title ?? '');
      const item = document.createElement('li');
      const button = document.createElement('button');
      const titleLabel = document.createElement('span');
      const meta = document.createElement('span');
      const currentLabel = document.createElement('span');
      const pageLabel = document.createElement('span');

      const clampedLevel = Math.min(level, 5);
      item.className = `toc-item toc-item-level-${clampedLevel}`;
      item.setAttribute('data-level', String(level));

      button.type = 'button';
      button.classList.add('toc-entry', `toc-level-${clampedLevel}`);
      button.setAttribute('data-level', String(level));
      button.style.paddingInlineStart = `${12 + clampedLevel * 12}px`;
      button.setAttribute('aria-label', page === null
        ? `${title}, page unavailable`
        : `Go to ${title}, page ${page}`);
      if (page === null) button.disabled = true;

      titleLabel.className = 'toc-entry-title';
      titleLabel.textContent = title;
      currentLabel.className = 'toc-current-label';
      currentLabel.textContent = 'Current';
      currentLabel.hidden = true;
      pageLabel.className = 'toc-page-badge';
      pageLabel.textContent = page === null ? 'Page unavailable' : `Page ${page}`;
      meta.className = 'toc-entry-meta';
      meta.appendChild(currentLabel);
      meta.appendChild(pageLabel);
      button.appendChild(titleLabel);
      button.appendChild(meta);
      button.addEventListener('click', () => {
        if (page !== null) this.onNavigate(page);
      });

      item.appendChild(button);
      list.appendChild(item);
      this.entries.push({ button, currentLabel, page, level });

      if (Array.isArray(entry.children) && entry.children.length > 0) {
        const children = document.createElement('ul');
        children.className = 'table-of-contents-children';
        item.appendChild(children);
        this.appendEntries(entry.children, children, level + 1);
      }
    }
  }

  updateActivePage(currentPage) {
    const page = Number(currentPage);
    let active = null;
    if (Number.isInteger(page) && page > 0) {
      for (const entry of this.entries) {
        if (entry.page === null || entry.page > page) continue;
        if (!active || entry.page >= active.page) {
          active = entry;
        }
      }
    }

    for (const entry of this.entries) {
      const isActive = entry === active;
      entry.button.classList.toggle('active', isActive);
      entry.button.setAttribute('aria-current', isActive ? 'location' : 'false');
      entry.currentLabel.hidden = !isActive;
    }
    return active?.page ?? null;
  }
}

window.TableOfContentsView = TableOfContentsView;
