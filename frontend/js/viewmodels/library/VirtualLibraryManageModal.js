/**
 * VirtualLibraryManageModal.js
 * Handles the "Manage Virtual Library" modal workflow (renaming, search rule editing,
 * member book removal, and catalog book addition).
 */
const MANAGE_MODAL_ID_MAP = {
  titleEl: "vl-manage-title",
  closeBtn: "vl-manage-close-x-btn",
  doneBtn: "vl-manage-done-btn",
  nameInput: "vl-manage-name-input",
  renameBtn: "vl-manage-rename-btn",
  renameStatus: "vl-manage-rename-status",
  querySection: "vl-manage-query-section",
  queryText: "vl-manage-query-text",
  booksSection: "vl-manage-books-section",
  booksCount: "vl-manage-books-count",
  selectedCount: "vl-manage-selected-count",
  selectAllBtn: "vl-manage-select-all-btn",
  deselectAllBtn: "vl-manage-deselect-all-btn",
  removeSelectedBtn: "vl-manage-remove-selected-btn",
  searchInput: "vl-manage-search-input",
  booksList: "vl-manage-books-list",
  tabRuleBtn: "vl-manage-tab-rule-btn",
  tabBooksBtn: "vl-manage-tab-books-btn",
  tabBooksCount: "vl-manage-tab-books-count",
  queryInput: "vl-manage-query-input",
  queryClearBtn: "vl-manage-query-clear-btn",
  saveQueryBtn: "vl-manage-save-query-btn",
  queryTokensContainer: "vl-manage-query-tokens",
  compiledPreview: "vl-manage-compiled-preview",
  queryStatus: "vl-manage-query-status",
  addToggleBtn: "vl-manage-add-toggle-btn",
  addContainer: "vl-manage-add-container",
  addSearchInput: "vl-manage-add-search-input",
  addSelectedCount: "vl-manage-add-selected-count",
  addConfirmBtn: "vl-manage-add-confirm-btn",
  catalogList: "vl-manage-catalog-list",
};

class VirtualLibraryManageModal {
  static setTitle(titleEl, name) {
    VirtualLibraryTokenRenderer.setProp(
      titleEl,
      "innerHTML",
      `<svg class="ui-icon" aria-hidden="true" focusable="false"><use href="./icons.svg#folder"></use></svg> Manage: ${name}`,
    );
  }

  static updateSelectionButton(countEl, btnEl, count, activePrefix, idleLabel) {
    const R = VirtualLibraryTokenRenderer;
    R.setProp(countEl, "textContent", `${count} selected`);
    R.setProp(btnEl, "disabled", count === 0);
    R.setProp(btnEl, "textContent", count > 0 ? `${activePrefix} (${count})` : idleLabel);
  }

  static renderBookCheckboxList(container, books, selectedIds, emptyMessage) {
    if (!container || !Array.isArray(books)) return;
    const R = VirtualLibraryTokenRenderer;
    container.replaceChildren();
    if (!books.length) {
      R.renderEmptyMessage(container, emptyMessage);
      return;
    }
    books.forEach((b) => {
      container.appendChild(R.createBookCheckboxItem(b, selectedIds.has(Number(b.id)), true));
    });
  }

  static bindRenameSection(manager, library, els) {
    const R = VirtualLibraryTokenRenderer;
    this.setTitle(els.titleEl, library.name);
    R.setProp(els.nameInput, "value", library.name || "");
    R.setStatus(els.renameStatus, "", "var(--accent-color)");

    R.setProp(els.renameBtn, "onclick", async () => {
      const newName = R.getTrimmed(els.nameInput);
      if (!newName) return R.setStatus(els.renameStatus, "Please enter a valid collection name.", "#dc2626");
      if (newName === library.name) return R.setStatus(els.renameStatus, "Name is unchanged.", "var(--text-secondary)");
      els.renameBtn.disabled = true;
      try {
        const updated = await api.updateVirtualLibrary(library.id, { name: newName });
        library.name = updated.name;
        this.setTitle(els.titleEl, updated.name);
        R.setStatus(els.renameStatus, "Collection renamed successfully.", "var(--accent-color)");
        await manager.onLibrariesChanged?.(updated);
      } catch (err) {
        R.setStatus(els.renameStatus, `Error: ${err.message}`, "#dc2626");
      } finally {
        els.renameBtn.disabled = false;
      }
    });
  }

  static bindCatalogAddSection(manager, library, sequence, els, loadManageBooks) {
    const R = VirtualLibraryTokenRenderer;
    const updateAddCounter = () =>
      this.updateSelectionButton(
        els.addSelectedCount,
        els.addConfirmBtn,
        manager.manageAddSelectedBookIds.size,
        "Add selected",
        "Add to Collection",
      );

    const renderCatalogBooks = () =>
      this.renderBookCheckboxList(
        els.catalogList,
        manager.manageCatalogBooks,
        manager.manageAddSelectedBookIds,
        "No matching books found in catalog.",
      );

    R.setProp(els.catalogList, "onchange", (e) =>
      R.handleCheckboxChange(e, manager.manageAddSelectedBookIds, updateAddCounter),
    );

    const loadCatalogBooks = async () => {
      R.setProp(els.catalogList, "textContent", "Searching catalog...");
      try {
        const res = await api.getBooks(null, null, { query: R.getTrimmed(els.addSearchInput), pageSize: 40 });
        if (sequence !== manager.manageOpenSequence) return;
        manager.manageCatalogBooks = R.extractBooks(res).books;
        renderCatalogBooks();
      } catch {
        if (sequence === manager.manageOpenSequence)
          R.setProp(els.catalogList, "textContent", "Could not load catalog books.");
      }
    };

    R.setProp(els.addToggleBtn, "onclick", async () => {
      const isHidden = els.addContainer?.style?.display !== "block";
      R.toggleDisplay(els.addContainer, isHidden, "block");
      if (isHidden && !manager.manageCatalogBooks) await loadCatalogBooks();
    });

    let catalogSearchTimeout = null;
    R.setProp(els.addSearchInput, "oninput", () => {
      window.clearTimeout(catalogSearchTimeout);
      catalogSearchTimeout = window.setTimeout(loadCatalogBooks, 250);
    });

    R.setProp(els.addConfirmBtn, "onclick", async () => {
      const idsToAdd = [...manager.manageAddSelectedBookIds];
      if (!idsToAdd.length) return;
      els.addConfirmBtn.disabled = true;
      try {
        const updated = await api.addBooksToVirtualLibrary(library.id, idsToAdd);
        library.book_ids = updated.book_ids;
        manager.manageAddSelectedBookIds.clear();
        updateAddCounter();
        await loadManageBooks();
        await manager.onLibrariesChanged?.(updated);
        R.setDisplay(els.addContainer, "none");
      } catch (err) {
        alert(`Error adding books: ${err.message}`);
      } finally {
        els.addConfirmBtn.disabled = manager.manageAddSelectedBookIds.size === 0;
      }
    });
  }

  static async open(manager, library) {
    if (!library || typeof document === "undefined") return;
    const manageModal = manager.manageModal || document.getElementById("vl-manage-modal");
    if (!manageModal) return;
    manager.manageModal = manageModal;
    const sequence = ++manager.manageOpenSequence;
    const R = VirtualLibraryTokenRenderer;
    const els = R.mapElements(MANAGE_MODAL_ID_MAP);

    R.setProp(els.searchInput, "value", "");
    manager.manageSelectedBookIds = new Set();
    manager.manageBooks = null;
    manager.manageAddSelectedBookIds = new Set();
    manager.manageCatalogBooks = null;

    const updateSelectedCounter = () =>
      this.updateSelectionButton(
        els.selectedCount,
        els.removeSelectedBtn,
        manager.manageSelectedBookIds.size,
        "Remove selected",
        "Remove selected",
      );
    updateSelectedCounter();

    const closeModal = () => ModalView.close(manageModal);
    R.setProp(els.closeBtn, "onclick", closeModal);
    R.setProp(els.doneBtn, "onclick", closeModal);
    manageModal.addEventListener?.("click", (e) => {
      if (e.target === manageModal) closeModal();
    });

    this.bindRenameSection(manager, library, els);
    const setManageTab = (tab) => {
      R.toggleDisplay(els.querySection, tab === "rule", "");
      R.toggleDisplay(els.booksSection, tab === "books", "");
      els.tabRuleBtn?.classList?.toggle("active", tab === "rule");
      els.tabBooksBtn?.classList?.toggle("active", tab === "books");
    };
    R.setProp(els.tabRuleBtn, "onclick", () => setManageTab("rule"));
    R.setProp(els.tabBooksBtn, "onclick", () => setManageTab("books"));
    setManageTab(library.type === "query" ? "rule" : "books");

    const renderBooks = () => {
      if (!els.booksList || !Array.isArray(manager.manageBooks)) return;
      const query = R.getTrimmed(els.searchInput).toLowerCase();
      const filtered = manager.manageBooks.filter((b) => R.matchesBookSearch(b, query));
      R.setProp(els.booksCount, "textContent", String(manager.manageBooks.length));
      const emptyMsg =
        manager.manageBooks.length === 0 ? "No books in this collection." : "No books match your search.";
      this.renderBookCheckboxList(els.booksList, filtered, manager.manageSelectedBookIds, emptyMsg);
    };

    R.setProp(els.booksList, "onchange", (e) =>
      R.handleCheckboxChange(e, manager.manageSelectedBookIds, updateSelectedCounter),
    );
    R.setProp(els.selectAllBtn, "onclick", () => {
      const query = R.getTrimmed(els.searchInput).toLowerCase();
      (manager.manageBooks || []).forEach((b) => {
        if (R.matchesBookSearch(b, query)) manager.manageSelectedBookIds.add(Number(b.id));
      });
      renderBooks();
      updateSelectedCounter();
    });
    R.setProp(els.deselectAllBtn, "onclick", () => {
      manager.manageSelectedBookIds.clear();
      renderBooks();
      updateSelectedCounter();
    });
    R.setProp(els.searchInput, "oninput", renderBooks);

    R.setProp(els.removeSelectedBtn, "onclick", async () => {
      const idsToRemove = [...manager.manageSelectedBookIds];
      if (!idsToRemove.length) return;
      els.removeSelectedBtn.disabled = true;
      try {
        const updated = await api.removeBooksFromVirtualLibrary(library.id, idsToRemove);
        library.book_ids = updated.book_ids;
        manager.manageBooks = (manager.manageBooks || []).filter((b) => !idsToRemove.includes(Number(b.id)));
        manager.manageSelectedBookIds.clear();
        renderBooks();
        updateSelectedCounter();
        await manager.onLibrariesChanged?.(updated);
      } catch (err) {
        alert(`Error removing books: ${err.message}`);
      } finally {
        els.removeSelectedBtn.disabled = manager.manageSelectedBookIds.size === 0;
      }
    });

    const loadManageBooks = async () => {
      R.setProp(els.booksList, "textContent", "Loading collection books...");
      try {
        const fetchedBooks = await api.getVirtualLibraryBooks(library.id);
        if (sequence !== manager.manageOpenSequence) return;
        manager.manageBooks = Array.isArray(fetchedBooks) ? fetchedBooks : [];
        R.setProp(els.tabBooksCount, "textContent", String(manager.manageBooks.length));
        renderBooks();
      } catch {
        if (sequence === manager.manageOpenSequence)
          R.setProp(els.booksList, "textContent", "Could not load collection books.");
      }
    };

    VirtualLibraryQueryBuilder.bindManageRuleSection(manager, library, els, loadManageBooks);
    this.bindCatalogAddSection(manager, library, sequence, els, loadManageBooks);
    loadManageBooks();
    ModalView.open(manageModal);
  }
}

window.VirtualLibraryManageModal = VirtualLibraryManageModal;
