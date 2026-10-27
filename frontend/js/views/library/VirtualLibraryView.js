/**
 * VirtualLibraryView.js
 * Renders the virtual library selector and collection filter chips.
 */
const VirtualLibraryView = {
  populateDropdown(selectEl, libraries, activeId) {
    if (!selectEl) return;
    selectEl.innerHTML = '<option value="">All Libraries</option>';
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

  renderCollectionChips(chipContainer, libraries, activeId, onSelect, onDelete, onEdit) {
    if (!chipContainer) return;
    chipContainer.replaceChildren();

    const allButton = document.createElement('button');
    allButton.type = 'button';
    allButton.className = 'collection-chip';
    allButton.innerHTML = '<svg class="ui-icon" aria-hidden="true" focusable="false"><use href="./icons.svg#library"></use></svg> All libraries';
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

      const editButton = document.createElement('button');
      editButton.type = 'button';
      editButton.className = 'collection-chip-edit';
      editButton.innerHTML = '<svg class="ui-icon" aria-hidden="true" focusable="false"><use href="./icons.svg#pen"></use></svg>';
      editButton.title = `Manage collection ${library.name}`;
      editButton.setAttribute('aria-label', `Manage collection ${library.name}`);
      editButton.onclick = () => onEdit?.(library);
      group.appendChild(editButton);

      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'collection-chip-delete';
      deleteButton.innerHTML = '<svg class="ui-icon" aria-hidden="true" focusable="false"><use href="./icons.svg#trash"></use></svg>';
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
  },

  createBookListItem(book, isSelected) {
    const label = document.createElement('label');
    label.className = `vl-book-item${isSelected ? ' is-selected' : ''}`;
    label.dataset.bookId = String(book.id);

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.dataset.bookId = String(book.id);
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
    return label;
  }
};

window.VirtualLibraryView = VirtualLibraryView;
