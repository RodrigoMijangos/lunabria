/** Selection controls, library options, card feedback and status messages. */
const CatalogSelectionView = {
  syncLibraryOptions(select, libraries, busy) {
    if (!select) return false;
    const selectedValue = select.value;
    const manualLibraries = libraries.filter(library => library.type === 'manual');
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = manualLibraries.length ? 'Select a manual library' : 'No manual libraries';
    placeholder.disabled = manualLibraries.length === 0;
    select.replaceChildren(placeholder);
    manualLibraries.forEach(library => {
      const option = document.createElement('option');
      option.value = String(library.id);
      const count = Array.isArray(library.book_ids) ? library.book_ids.length : 0;
      option.textContent = `${library.name} (${count})`;
      select.appendChild(option);
    });
    select.disabled = manualLibraries.length === 0 || busy;
    if (manualLibraries.some(library => String(library.id) === selectedValue)) select.value = selectedValue;
    return true;
  },

  getSelectedLibraryId(select) {
    return Number(select?.value);
  },

  syncControls(elements, { selectionMode, selectedCount, hasManualLibraries, targetLibrary, busy }) {
    if (elements.catalogSelectionToggle) {
      elements.catalogSelectionToggle.textContent = selectionMode ? 'Cancel selection' : 'Select books';
      elements.catalogSelectionToggle.setAttribute('aria-pressed', String(selectionMode));
      elements.catalogSelectionToggle.disabled = busy;
    }
    if (elements.catalogSelectionActions) elements.catalogSelectionActions.hidden = !selectionMode;
    if (elements.catalogSelectionCount) {
      elements.catalogSelectionCount.textContent = `${selectedCount} ${selectedCount === 1 ? 'book selected' : 'books selected'}`;
    }
    if (elements.catalogSelectionLibrary) elements.catalogSelectionLibrary.disabled = !hasManualLibraries || busy;
    if (elements.catalogSelectionAddButton) {
      elements.catalogSelectionAddButton.disabled = !selectionMode || !selectedCount || !targetLibrary || busy;
    }
    if (elements.catalogSelectionCreateButton) {
      elements.catalogSelectionCreateButton.disabled = !selectionMode || !selectedCount || busy;
    }
  },

  setBookSelected(bookGrid, id, selected) {
    const card = bookGrid?.querySelector(`.book-card[data-id="${id}"]`);
    card?.classList.toggle('book-card-selected', Boolean(selected));
    const checkbox = card?.querySelector('.book-selection-toggle input');
    if (checkbox) checkbox.checked = Boolean(selected);
  },

  setStatus(status, message) {
    if (status) status.textContent = message;
  }
};

window.CatalogSelectionView = CatalogSelectionView;
