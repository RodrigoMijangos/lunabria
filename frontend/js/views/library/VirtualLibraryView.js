/**
 * VirtualLibraryView.js
 * Renders the virtual library selector and collection filter chips.
 */
const VirtualLibraryView = {
  populateDropdown(selectEl, libraries, activeId) {
    if (!selectEl) return;
    selectEl.innerHTML = '<option value="">📚 All Libraries</option>';
    (libraries || []).forEach(vl => {
      const opt = document.createElement('option');
      opt.value = vl.id;
      const count = vl.type === 'manual' && Array.isArray(vl.book_ids) ? ` (${vl.book_ids.length})` : '';
      opt.textContent = `${vl.name}${count}`;
      if (activeId && vl.id === activeId) {
        opt.selected = true;
      }
      selectEl.appendChild(opt);
    });
  },

  renderCollectionChips(chipContainer, libraries, activeId, onSelect, onDelete) {
    if (!chipContainer) return;
    chipContainer.replaceChildren();

    const allButton = document.createElement('button');
    allButton.type = 'button';
    allButton.className = 'collection-chip';
    allButton.textContent = '📚 All libraries';
    allButton.setAttribute('aria-pressed', String(activeId == null));
    if (activeId == null) allButton.classList.add('active');
    allButton.onclick = () => onSelect?.(null);
    chipContainer.appendChild(allButton);

    (libraries || []).forEach(library => {
      const group = document.createElement('div');
      group.className = 'collection-chip-group';
      const isActive = Number(library.id) === Number(activeId);
      if (isActive) group.classList.add('active');

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'collection-chip';
      if (isActive) button.classList.add('active');
      button.setAttribute('aria-pressed', String(isActive));
      button.setAttribute('aria-label', `Show collection ${library.name}`);

      const name = document.createElement('span');
      name.textContent = library.name;
      button.appendChild(name);

      if (library.type === 'manual' && Array.isArray(library.book_ids)) {
        const count = document.createElement('span');
        count.className = 'chip-badge';
        count.textContent = String(library.book_ids.length);
        button.appendChild(count);
      }

      button.onclick = () => onSelect?.(library.id);
      group.appendChild(button);

      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'collection-chip-delete';
      deleteButton.textContent = '🗑️';
      deleteButton.title = `Delete library ${library.name}`;
      deleteButton.setAttribute('aria-label', `Delete library ${library.name}`);
      deleteButton.onclick = async () => {
        deleteButton.disabled = true;
        try {
          await onDelete?.(library);
        } finally {
          if (deleteButton.isConnected) deleteButton.disabled = false;
        }
      };
      group.appendChild(deleteButton);
      chipContainer.appendChild(group);
    });
  }
};

window.VirtualLibraryView = VirtualLibraryView;
