/** Coordinates selection workflows; the facade remains the single state owner. */
class CatalogSelectionManager {
  constructor(viewModel) {
    // Keep the public Set and flags live, including writes by existing callers.
    this.viewModel = viewModel;
  }

  syncLibraryOptions() {
    const vm = this.viewModel;
    if (CatalogSelectionView.syncLibraryOptions(
      vm.catalogSelectionLibrary, vm.model.virtualLibraries, vm.catalogSelectionBusy
    )) vm.syncCatalogSelectionControls();
  }

  syncControls() {
    const vm = this.viewModel;
    const selectedLibraryId = CatalogSelectionView.getSelectedLibraryId(vm.catalogSelectionLibrary);
    const activeLibrary = vm.model.virtualLibraries.find(
      library => Number(library.id) === Number(vm.model.activeVirtualLibraryId)
    );
    CatalogSelectionView.syncControls(vm, {
      selectionMode: vm.selectionMode,
      selectedCount: vm.selectedBookIds.size,
      hasManualLibraries: vm.model.virtualLibraries.some(library => library.type === 'manual'),
      targetLibrary: vm.model.virtualLibraries.find(
        library => library.type === 'manual' && library.id === selectedLibraryId
      ),
      activeLibrary,
      busy: vm.catalogSelectionBusy
    });
  }

  setMode(enabled) {
    const vm = this.viewModel;
    vm.selectionMode = Boolean(enabled);
    if (!vm.selectionMode) vm.selectedBookIds.clear();
    else CatalogSelectionView.setStatus(vm.catalogSelectionStatus, '');
    vm.syncCatalogSelectionControls();
    vm.renderBooks();
  }

  setBookSelected(bookId, selected) {
    const vm = this.viewModel;
    const id = Number(bookId);
    if (!Number.isFinite(id)) return;
    if (selected) vm.selectedBookIds.add(id);
    else vm.selectedBookIds.delete(id);
    CatalogSelectionView.setBookSelected(vm.bookGrid, id, selected);
    vm.syncCatalogSelectionControls();
  }

  async addToLibrary() {
    const vm = this.viewModel;
    const libraryId = CatalogSelectionView.getSelectedLibraryId(vm.catalogSelectionLibrary);
    const library = vm.model.virtualLibraries.find(item => item.type === 'manual' && item.id === libraryId);
    const selectedIds = [...vm.selectedBookIds];
    if (!library || !selectedIds.length) return;
    vm.catalogSelectionBusy = true;
    vm.syncCatalogSelectionControls();
    CatalogSelectionView.setStatus(vm.catalogSelectionStatus, 'Adding books…');
    try {
      await api.addBooksToVirtualLibrary(library.id, selectedIds);
      vm.selectionMode = false;
      vm.selectedBookIds.clear();
      await vm.loadVirtualLibraries();
      if (Number(vm.model.activeVirtualLibraryId) === library.id) await vm.loadBookGrid();
      else vm.renderBooks();
      CatalogSelectionView.setStatus(vm.catalogSelectionStatus,
        `Selection added to «${library.name}». Duplicates were skipped.`);
    } catch (error) {
      CatalogSelectionView.setStatus(vm.catalogSelectionStatus, `Could not add books: ${error.message}`);
    } finally {
      vm.catalogSelectionBusy = false;
      vm.syncCatalogSelectionControls();
    }
  }

  async removeFromLibrary() {
    const vm = this.viewModel;
    const activeLibrary = vm.model.virtualLibraries.find(
      library => Number(library.id) === Number(vm.model.activeVirtualLibraryId)
    );
    const selectedIds = [...vm.selectedBookIds];
    if (!activeLibrary || activeLibrary.type !== 'manual' || !selectedIds.length) return;
    vm.catalogSelectionBusy = true;
    vm.syncCatalogSelectionControls();
    CatalogSelectionView.setStatus(vm.catalogSelectionStatus, 'Removing books…');
    try {
      await api.removeBooksFromVirtualLibrary(activeLibrary.id, selectedIds);
      vm.selectionMode = false;
      vm.selectedBookIds.clear();
      await vm.loadVirtualLibraries();
      await vm.loadBookGrid();
      CatalogSelectionView.setStatus(vm.catalogSelectionStatus,
        `Removed ${selectedIds.length} ${selectedIds.length === 1 ? 'book' : 'books'} from «${activeLibrary.name}».`);
    } catch (error) {
      CatalogSelectionView.setStatus(vm.catalogSelectionStatus, `Could not remove books: ${error.message}`);
    } finally {
      vm.catalogSelectionBusy = false;
      vm.syncCatalogSelectionControls();
    }
  }

  createLibrary() {
    const vm = this.viewModel;
    const selectedIds = [...vm.selectedBookIds];
    if (!selectedIds.length) return;
    vm.vlManager.openVirtualLibraryModal({ selectedBookIds: selectedIds });
  }

  async onLibrariesChanged(createdLibrary = null) {
    const vm = this.viewModel;
    await vm.loadVirtualLibraries();
    if (!vm.selectionMode) return;
    const selectedCount = vm.selectedBookIds.size;
    vm.selectionMode = false;
    vm.selectedBookIds.clear();
    vm.syncCatalogSelectionControls();
    vm.renderBooks();
    if (createdLibrary?.type === 'manual' && vm.catalogSelectionStatus) {
      const createdCount = Array.isArray(createdLibrary.book_ids) ? createdLibrary.book_ids.length : selectedCount;
      CatalogSelectionView.setStatus(vm.catalogSelectionStatus,
        `Created «${createdLibrary.name}» with ${createdCount} ${createdCount === 1 ? 'book' : 'books'}.`);
    }
  }
}

window.CatalogSelectionManager = CatalogSelectionManager;
