/**
 * VirtualLibraryManager.js
 * Manages virtual collections modal and creation, delegating token/item rendering
 * to VirtualLibraryTokenRenderer, query builder controls to VirtualLibraryQueryBuilder,
 * and manage-modal workflows to VirtualLibraryManageModal.
 */
const CREATE_MODAL_ID_MAP = {
  nameInput: "vl-name-input",
  queryInput: "vl-query-input",
  searchInput: "vl-manual-search",
  manualList: "vl-manual-list",
  queryTab: "vl-tab-query",
  manualTab: "vl-tab-manual",
  querySection: "vl-section-query",
  manualSection: "vl-section-manual",
  cancelBtn: "vl-cancel-btn",
  closeBtn: "vl-close-x-btn",
  saveBtn: "vl-save-btn",
  selectAllBtn: "vl-select-all-btn",
  deselectAllBtn: "vl-deselect-all-btn",
  selectedBadge: "vl-selected-count-badge",
  collectionFilterHint: "vl-collection-filter-hint",
  collectionFilterCheckbox: "vl-filter-by-current-collection",
  currentCollectionLabel: "vl-current-collection-label",
  queryPreviewContainer: "vl-query-preview-container",
  queryPreviewCount: "vl-query-preview-count",
  queryPreviewList: "vl-query-preview-list",
  fieldSelect: "vl-builder-field",
  valueInput: "vl-builder-value",
  exactCheckbox: "vl-builder-exact",
  addTermBtn: "vl-builder-add-btn",
  compiledPreview: "vl-compiled-preview",
  clearQueryBtn: "vl-query-clear-btn",
  queryTokensContainer: "vl-query-tokens",
  queryBuilderCard: "vl-query-builder",
  builderToggleBtn: "vl-builder-toggle-btn",
  builderCloseBtn: "vl-builder-close-btn",
};

class VirtualLibraryManager {
  constructor(onLibrariesChanged) {
    this.onLibrariesChanged = onLibrariesChanged;
    this.modal = typeof document !== "undefined" ? document.getElementById("vl-modal") : null;
    this.manageModal = typeof document !== "undefined" ? document.getElementById("vl-manage-modal") : null;
    this.selectedBookIds = new Set();
    this.manageSelectedBookIds = new Set();
    this.books = null;
    this.manageBooks = null;
    this.manageOpenSequence = 0;
    this.mode = "query";
    this.openSequence = 0;
    this.manualPage = 0;
    this.manualTotal = 0;
    this.manualRequestSequence = 0;
    this.filterVirtualLibraryId = null;
  }

  validateCollectionInput(name, mode, query, selectedCount) {
    if (!name) return { valid: false, error: "Please enter a name for the collection." };
    if (mode === "query" && !query) return { valid: false, error: "Enter a Calibre search expression." };
    if (mode === "manual" && selectedCount === 0) {
      return { valid: false, error: "Select at least one book for the collection." };
    }
    return { valid: true };
  }

  initializeCreateInputs(els, options) {
    const R = VirtualLibraryTokenRenderer;
    R.setProp(els.nameInput, "value", "");
    R.setProp(els.queryInput, "value", options.activeCollectionQuery || options.searchQuery || "");
    R.setProp(els.searchInput, "value", options.searchQuery || "");
    if (options.searchQuery) R.setProp(els.nameInput, "placeholder", `E.g., ${options.searchQuery}`);
    else if (options.activeCollectionName) {
      R.setProp(els.nameInput, "placeholder", `E.g., Copy of ${options.activeCollectionName}`);
    }
    this.filterVirtualLibraryId = options.activeVirtualLibraryId || null;
    R.toggleDisplay(els.collectionFilterHint, Boolean(this.filterVirtualLibraryId), "block");
    if (this.filterVirtualLibraryId) {
      const label = options.activeCollectionName || "Current";
      R.setProp(els.currentCollectionLabel, "textContent", `Filter within collection: "${label}"`);
      R.setProp(els.collectionFilterCheckbox, "checked", true);
    }
  }

  async openVirtualLibraryModal(options = {}) {
    if (!this.modal) return;
    const sequence = ++this.openSequence;
    const R = VirtualLibraryTokenRenderer;
    const els = R.mapElements(CREATE_MODAL_ID_MAP);
    this.initializeCreateInputs(els, options);

    const preselectedBookIds = [options.selectedBookIds || []].flat().map(Number).filter(Number.isFinite);
    this.selectedBookIds = new Set(preselectedBookIds);
    this.books = null;
    this.manualPage = 0;
    this.manualTotal = 0;
    this.manualRequestSequence++;
    this.mode = "query";
    let searchTimeout = null;

    const updateSelectedCounter = () => {
      const count = this.selectedBookIds.size;
      R.setProp(els.selectedBadge, "textContent", `${count} selected`);
      const suffix = this.mode === "manual" && count > 0 ? ` (${count})` : "";
      R.setProp(els.saveBtn, "textContent", `Create Virtual Library${suffix}`);
    };
    updateSelectedCounter();

    const { updateQueryPreview } = VirtualLibraryQueryBuilder.bindCreateModalQuery(
      this.modal,
      els,
      () => sequence === this.openSequence,
    );

    const setMode = (mode) => {
      this.mode = mode;
      R.toggleDisplay(els.querySection, mode === "query", "");
      R.toggleDisplay(els.manualSection, mode === "manual", "");
      els.queryTab?.classList?.toggle("active", mode === "query");
      els.manualTab?.classList?.toggle("active", mode === "manual");
      updateSelectedCounter();
      if (mode === "query" && R.getTrimmed(els.queryInput)) updateQueryPreview();
    };

    const findLoadMoreBtn = (textFragment) =>
      els.manualList?.querySelector?.("button") ||
      els.manualList?.children?.find?.((c) => c.textContent?.includes?.(textFragment));

    const loadManualBooks = async ({ append = false, force = false } = {}) => {
      setMode("manual");
      if (this.books !== null && !append && !force) {
        this.renderManualBooks(els.manualList, els.searchInput?.value || "", () => loadManualBooks({ append: true }));
        return;
      }
      const query = R.getTrimmed(els.searchInput);
      const page = append ? this.manualPage + 1 : 1;
      const requestSequence = ++this.manualRequestSequence;
      const virtualLibraryId = els.collectionFilterCheckbox?.checked ? this.filterVirtualLibraryId : null;
      const previousScrollTop = Number(els.manualList?.scrollTop) || 0;

      if (!append) {
        this.books = [];
        this.manualPage = 0;
        this.manualTotal = 0;
        R.setProp(els.manualList, "textContent", "Loading books...");
      } else {
        const btn = findLoadMoreBtn("Load more");
        R.setProp(btn, "disabled", true);
        R.setProp(btn, "textContent", "Loading more books...");
      }

      try {
        const response = await api.getBooks(null, virtualLibraryId, { query, page, pageSize: 24, sort: "title" });
        if (sequence !== this.openSequence || requestSequence !== this.manualRequestSequence) return;
        const extracted = R.extractBooks(response);
        this.books = append ? [...(this.books || []), ...extracted.books] : extracted.books;
        this.manualPage = extracted.page || page;
        this.manualTotal = extracted.total;
        this.renderManualBooks(els.manualList, query, () => loadManualBooks({ append: true }));
        if (append && previousScrollTop > 0) R.setProp(els.manualList, "scrollTop", previousScrollTop);
        updateSelectedCounter();
      } catch {
        if (sequence !== this.openSequence || requestSequence !== this.manualRequestSequence) return;
        if (!append) {
          this.books = [];
          R.setProp(els.manualList, "textContent", "Could not load book catalog.");
        } else {
          const btn = findLoadMoreBtn("Loading more");
          R.setProp(btn, "disabled", false);
          R.setProp(btn, "textContent", "Load more books");
        }
      }
    };

    const initialMode = preselectedBookIds.length || options.activeVirtualLibraryId ? "manual" : "query";
    R.setProp(els.queryTab, "onclick", () => setMode("query"));
    R.setProp(els.manualTab, "onclick", () => loadManualBooks());
    setMode(initialMode);

    R.setProp(els.cancelBtn, "onclick", () => ModalView.close(this.modal));
    R.setProp(els.closeBtn, "onclick", () => ModalView.close(this.modal));
    this.modal?.addEventListener?.("click", (e) => {
      if (e.target === this.modal) ModalView.close(this.modal);
    });
    R.setProp(els.manualList, "onchange", (e) =>
      R.handleCheckboxChange(e, this.selectedBookIds, updateSelectedCounter),
    );

    const toggleAllLoadedBooks = (shouldSelect) => {
      (this.books || []).forEach((b) => {
        if (shouldSelect) this.selectedBookIds.add(Number(b.id));
        else this.selectedBookIds.delete(Number(b.id));
      });
      this.renderManualBooks(els.manualList, els.searchInput?.value || "", () => loadManualBooks({ append: true }));
      updateSelectedCounter();
    };
    R.setProp(els.selectAllBtn, "onclick", () => toggleAllLoadedBooks(true));
    R.setProp(els.deselectAllBtn, "onclick", () => toggleAllLoadedBooks(false));

    R.setProp(els.collectionFilterCheckbox, "onchange", () => {
      this.manualRequestSequence++;
      this.books = null;
      this.manualPage = 0;
      this.manualTotal = 0;
      loadManualBooks({ force: true });
    });

    R.setProp(els.searchInput, "oninput", () => {
      window.clearTimeout(searchTimeout);
      this.manualRequestSequence++;
      this.books = null;
      this.manualPage = 0;
      this.manualTotal = 0;
      R.setProp(els.manualList, "textContent", "Searching books...");
      searchTimeout = window.setTimeout(() => {
        searchTimeout = null;
        return loadManualBooks({ force: true });
      }, 250);
    });

    R.setProp(els.saveBtn, "onclick", async () => {
      const name = R.getTrimmed(els.nameInput);
      const query = R.getTrimmed(els.queryInput);
      const validation = this.validateCollectionInput(name, this.mode, query, this.selectedBookIds.size);
      if (!validation.valid) return alert(validation.error);
      els.saveBtn.disabled = true;
      try {
        const createdLibrary = await api.createVirtualLibrary({
          name,
          type: this.mode,
          query: this.mode === "query" ? query : "",
          book_ids: this.mode === "manual" ? [...this.selectedBookIds] : [],
        });
        ModalView.close(this.modal);
        await this.onLibrariesChanged?.(createdLibrary);
      } catch (e) {
        alert(`Error creating collection: ${e.message}`);
      } finally {
        els.saveBtn.disabled = false;
      }
    });

    ModalView.open(this.modal);
    if (initialMode === "manual") loadManualBooks();
    else if (R.getTrimmed(els.queryInput)) updateQueryPreview();
  }

  renderManualBooks(container, query = "", onLoadMore = null) {
    if (!container || !Array.isArray(this.books)) return;
    const R = VirtualLibraryTokenRenderer;
    const previousScrollTop = Number(container.scrollTop) || 0;
    const normalizedQuery = query.toLowerCase().trim();
    const books = this.books.filter((book) => R.matchesBookSearch(book, normalizedQuery));
    container.replaceChildren();
    if (!books.length) {
      container.textContent = "No books match your search.";
      return;
    }
    books.forEach((book) => {
      const isSelected = this.selectedBookIds.has(Number(book.id));
      container.appendChild(R.createBookCheckboxItem(book, isSelected, false));
    });
    if (this.books.length < this.manualTotal && typeof onLoadMore === "function") {
      const loadMoreButton = document.createElement("button");
      Object.assign(loadMoreButton, {
        type: "button",
        className: "btn",
        textContent: "Load more books",
        onclick: onLoadMore,
      });
      container.appendChild(loadMoreButton);
    }
    if (previousScrollTop > 0) container.scrollTop = previousScrollTop;
  }

  async openManageModal(library) {
    return VirtualLibraryManageModal.open(this, library);
  }
}

window.VirtualLibraryManager = VirtualLibraryManager;
