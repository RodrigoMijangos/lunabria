/** Catalog DOM presentation. State and commands remain in the ViewModel. */
const CatalogView = {
  captureElements() {
    const elements = {
      bookGrid: document.getElementById("book-grid"),
      mainContainer: document.querySelector("main.container"),
      recentsContainer: document.getElementById("recents-list"),
      recentsSection: document.getElementById("recents-section"),
      vlSelect: document.getElementById("vl-select"),
      activeCollectionChip: document.getElementById("collections-chips"),
    };
    const ids = {
      catalogContent: "catalog-content",
      catalogSortSelect: "catalog-sort-select",
      catalogToggleButton: "catalog-toggle-btn",
      catalogPagination: "catalog-pagination",
      catalogPageStatus: "catalog-page-status",
      catalogPageNumbers: "catalog-page-numbers",
      catalogPageInput: "catalog-page-input",
      catalogPageTotal: "catalog-page-total",
      catalogPreviousButton: "catalog-page-previous",
      catalogNextButton: "catalog-page-next",
      catalogPageSizeSelect: "catalog-page-size-select",
      catalogPageSizeInfo: "catalog-page-size-info",
      catalogSelectionToggle: "catalog-selection-toggle",
      catalogSelectionActions: "catalog-selection-actions",
      catalogSelectionCount: "catalog-selection-count",
      catalogSelectionLibrary: "catalog-selection-library",
      catalogSelectionAddButton: "catalog-selection-add-btn",
      catalogSelectionCreateButton: "catalog-selection-create-btn",
      catalogSelectionRemoveButton: "catalog-selection-remove-btn",
      catalogSelectionStatus: "catalog-selection-status",
    };
    for (const [name, id] of Object.entries(ids)) {
      elements[name] = document.getElementById(id);
    }
    return elements;
  },

  applyTheme(theme) {
    if (typeof document === "undefined") return;
    document.documentElement?.setAttribute?.("data-theme", theme);
    const select = typeof document.getElementById === "function" ? document.getElementById("theme-select") : null;
    if (select) select.value = theme;
    const themeColorMeta =
      typeof document.querySelector === "function" ? document.querySelector('meta[name="theme-color"]') : null;
    const themeColors = { sepia: "#f4ecd8", dark: "#151a24", amoled: "#000000" };
    themeColorMeta?.setAttribute?.("content", themeColors[theme] || "#f4ecd8");
  },

  getGridColumnCount(bookGrid, previousColumns) {
    if (!bookGrid || typeof window.getComputedStyle !== "function") {
      return previousColumns || 4;
    }
    const gridWidth = bookGrid.getBoundingClientRect().width;
    if (gridWidth <= 0) return previousColumns || 4;
    const templateColumns = window.getComputedStyle(bookGrid).gridTemplateColumns.trim();
    if (!templateColumns || templateColumns === "none") return previousColumns || 4;
    const columnCount = templateColumns.split(/\s+/).filter(Boolean).length;
    return columnCount || previousColumns || 4;
  },

  syncPageSizeOptions(elements, columns, maxPageSize, pageSize, previousColumns) {
    const select = elements.catalogPageSizeSelect;
    let gridColumns = previousColumns;
    if (select && previousColumns !== columns) {
      select.replaceChildren();
      for (let count = columns; count <= maxPageSize; count += 1) {
        const option = document.createElement("option");
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
      const action = isExpanded ? "Collapse" : "Expand";
      button.textContent = isExpanded ? "−" : "+";
      button.title = `${action} catalog`;
      button.setAttribute("aria-label", `${action} catalog`);
      button.setAttribute("aria-expanded", String(isExpanded));
      button.disabled = isSearching;
    }
  },

  syncSearchPresentation(elements, { searchQuery, catalogSort, recentBooks }, onShowRecents) {
    const isSearching = Boolean(searchQuery);
    if (elements.mainContainer) {
      elements.mainContainer.classList.toggle("search-active", isSearching);
    }
    if (elements.recentsSection) {
      const wasHidden = elements.recentsSection.style.display === "none";
      const shouldShow = !isSearching && catalogSort !== "last_read_at" && recentBooks.length > 0;
      elements.recentsSection.style.display = shouldShow ? "block" : "none";
      if (shouldShow && wasHidden) onShowRecents();
    }
  },

  updateBooksCountBadge(count) {
    const badge = document.getElementById("books-count-badge");
    if (badge) badge.textContent = `${count} ${count === 1 ? "book" : "books"}`;
  },

  bindEvents(vm) {
    document.getElementById("theme-select")?.addEventListener("change", (e) => {
      vm.applyTheme(e.target.value);
    });
    document.getElementById("brand-link")?.addEventListener("click", () => {
      vm.clearCollectionFilter();
    });
    vm.catalogSortSelect?.addEventListener("change", (event) => {
      vm.model.setCatalogSort(event.target.value);
      vm.model.setCatalogPage(1);
      vm.catalogServerPage = null;
      vm.loadHome();
    });
    vm.catalogToggleButton?.addEventListener("click", () => {
      vm.model.setCatalogCollapsed(!vm.model.catalogCollapsed);
      vm.syncCatalogControls();
      if (!vm.catalogContent?.hidden) vm.renderBooks();
    });
    vm.catalogPageSizeSelect?.addEventListener("change", (event) => {
      vm.model.setCatalogPageSize(event.target.value);
      if (vm.catalogServerPage) vm.loadBookGrid();
      else vm.renderBooks();
    });
    vm.catalogSelectionToggle?.addEventListener("click", () => {
      vm.setBookSelectionMode(!vm.selectionMode);
    });
    vm.catalogSelectionLibrary?.addEventListener("change", () => vm.syncCatalogSelectionControls());
    vm.catalogSelectionAddButton?.addEventListener("click", () => vm.addSelectedBooksToLibrary());
    vm.catalogSelectionCreateButton?.addEventListener("click", () => vm.createLibraryFromSelection());
    vm.catalogSelectionRemoveButton?.addEventListener("click", () => vm.removeSelectedBooksFromLibrary());
    window.addEventListener("resize", () => {
      window.clearTimeout(vm.catalogResizeTimeout);
      vm.catalogResizeTimeout = window.setTimeout(() => {
        if (!vm.catalogContent?.hidden && vm.getCatalogGridColumnCount() !== vm.catalogGridColumns) {
          vm.loadBookGrid();
        }
        if (!vm.model.searchQuery && vm.recentsContainer?.clientWidth > 0) vm.renderRecents();
      }, 120);
    });
    window.addEventListener("lunabria:server-connectivity-change", (event) => {
      if (event.detail?.available) {
        if (event.detail.previousState === "unknown") return;
        const reader = window.reader;
        if (reader?.model?.bookId && reader.container?.style.display === "flex") {
          reader.reconcileServerConnection?.();
        }
        vm.loadHome();
      } else {
        vm.showOfflineBooks();
      }
    });
    vm.catalogPageInput?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      vm.submitCatalogPageInput();
      vm.catalogPageInput.blur();
    });
    vm.catalogPageInput?.addEventListener("blur", () => vm.submitCatalogPageInput());
    vm.catalogPreviousButton?.addEventListener("click", () => {
      vm.navigateCatalogPage(vm.model.catalogPage - 1);
    });
    vm.catalogNextButton?.addEventListener("click", () => {
      vm.navigateCatalogPage(vm.model.catalogPage + 1);
    });
    vm.vlSelect?.addEventListener("change", (e) => {
      vm.selectVirtualLibrary(e.target.value ? Number(e.target.value) : null);
    });
    CatalogView.bindSearchInput(vm);
    document.getElementById("new-vl-btn")?.addEventListener("click", () => vm.openVirtualLibraryModal());
    document.getElementById("upload-btn")?.addEventListener("click", () => vm.openUploadModal());
  },

  bindSearchInput(vm) {
    const searchInput = document.getElementById("search-input");
    const searchClear = document.getElementById("search-clear-btn");
    const searchBox = searchInput?.closest ? searchInput.closest(".search-box") : null;

    const updateSearchClearVisibility = (val) => {
      const hasVal = Boolean(val && String(val).length > 0);
      if (searchClear) searchClear.style.display = hasVal ? "inline-flex" : "none";
      if (searchBox?.classList) searchBox.classList.toggle("has-query", hasVal);
    };

    if (searchInput) {
      if (searchInput.value) updateSearchClearVisibility(searchInput.value);
      searchInput.oninput = (e) => {
        const val = e.target.value;
        updateSearchClearVisibility(val);
        vm.filterBooks(val);
      };
    }
    if (searchClear) {
      const clearSearch = (e) => {
        e?.preventDefault?.();
        e?.stopPropagation?.();
        if (searchInput) {
          searchInput.value = "";
          updateSearchClearVisibility("");
          vm.filterBooks("");
          searchInput.focus?.();
        }
      };
      searchClear.addEventListener?.("pointerdown", clearSearch);
      searchClear.addEventListener?.("mousedown", clearSearch);
      searchClear.onclick = clearSearch;
    }
  },
};

window.CatalogView = CatalogView;
