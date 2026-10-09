const OFFLINE_FALLBACK_COVER = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300" width="100%" height="100%"><rect width="100%" height="100%" fill="%23e2e8f0"/><path d="M70 120h60M70 150h60M70 180h40" stroke="%2394a3b8" stroke-width="6" stroke-linecap="round"/><circle cx="100" cy="80" r="20" fill="%23cbd5e1"/></svg>`;

/**
 * BookCardView.js
 * Renders book cards and the main library book grid.
 */
const BookCardView = {
  createBookCard(book, onOpenBook, onEditMetadata, options = {}) {
    const card = document.createElement('div');
    card.className = 'book-card';
    card.dataset.id = book.id;
    if (options.selectionMode) {
      card.classList.add('book-card-selectable');
      if (options.selectedBookIds?.has(Number(book.id))) card.classList.add('book-card-selected');
    }

    const coverWrap = document.createElement('div');
    coverWrap.className = 'book-cover-wrap';

    const img = document.createElement('img');
    img.className = 'book-cover';
    img.alt = book.title || 'Untitled';
    img.loading = 'lazy';
    let objectUrl = null;
    const releaseObjectUrl = () => {
      if (!objectUrl) return;
      if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
        URL.revokeObjectURL(objectUrl);
      }
      objectUrl = null;
    };
    img.onerror = () => {
      releaseObjectUrl();
      img.onerror = null;
      img.onload = null;
      img.src = OFFLINE_FALLBACK_COVER;
    };
    if (typeof Blob !== 'undefined' && book.coverBlob instanceof Blob &&
        typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
      objectUrl = URL.createObjectURL(book.coverBlob);
      img.onload = () => {
        releaseObjectUrl();
        img.onload = null;
      };
      img.src = objectUrl;
    } else {
      img.src = book.has_cover && book.cover_url ? book.cover_url : '/api/books/placeholder-cover';
    }
    coverWrap.appendChild(img);

    if (options.selectionMode) {
      const selectionLabel = document.createElement('label');
      selectionLabel.className = 'book-selection-toggle';
      selectionLabel.title = 'Select book';
      selectionLabel.addEventListener('click', event => event.stopPropagation());

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = options.selectedBookIds?.has(Number(book.id)) || false;
      checkbox.setAttribute('aria-label', `Select ${book.title || 'book'}`);
      checkbox.addEventListener('click', event => event.stopPropagation());
      checkbox.addEventListener('change', () => {
        if (options.onToggleSelection) options.onToggleSelection(book.id, checkbox.checked);
      });
      selectionLabel.appendChild(checkbox);
      coverWrap.appendChild(selectionLabel);
    }

    if (options.allowEdit !== false && onEditMetadata) {
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'book-edit-btn';
      editBtn.title = 'Edit book';
      editBtn.setAttribute('aria-label', `Edit ${book.title || 'book'}`);
      editBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg>';
      editBtn.onclick = (e) => {
        e.stopPropagation();
        onEditMetadata(book);
      };
      coverWrap.appendChild(editBtn);
    }

    card.appendChild(coverWrap);

    const info = document.createElement('div');
    info.className = 'book-info';

    const title = document.createElement('h3');
    title.className = 'book-title';
    title.textContent = book.title || 'Untitled';
    title.title = book.title || '';
    info.appendChild(title);

    const author = document.createElement('p');
    author.className = 'book-author';
    author.textContent = book.authors || 'Unknown Author';
    info.appendChild(author);

    if (options.showProgress) {
      const progress = document.createElement('div');
      progress.className = 'recent-progress-meta';
      const percentage = LibraryModel.formatReadingProgress(book.current_page, book.total_pages);
      progress.textContent = `${percentage}% read`;
      info.appendChild(progress);

      const progressBar = document.createElement('div');
      progressBar.className = 'progress-bar-bg';
      const progressFill = document.createElement('div');
      progressFill.className = 'progress-bar-fill';
      progressFill.style.width = `${percentage}%`;
      progressBar.appendChild(progressFill);
      info.appendChild(progressBar);
    }

    card.appendChild(info);

    card.onclick = () => {
      if (options.selectionMode) {
        if (options.onToggleSelection) {
          options.onToggleSelection(book.id, !card.classList.contains('book-card-selected'));
        }
        return;
      }
      if (onOpenBook) {
        const page = (options.openAtCurrentPage && book.current_page) ? book.current_page : null;
        onOpenBook(book.id, page);
      }
    };

    return card;
  },

  renderBookGrid(container, books, onOpenBook, onEditMetadata, options = {}) {
    container.innerHTML = '';
    if (!books || !books.length) {
      container.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1; text-align: center; padding: 48px 16px;">
          <div class="empty-state-icon"><svg class="ui-icon" aria-hidden="true" focusable="false"><use href="./icons.svg#library"></use></svg></div>
          <h3 style="font-size: 1.1rem; font-weight: 700;">No books found</h3>
          <p style="font-size: 0.88rem; color: var(--text-secondary); margin-top: 6px;">
            Try searching for another term or add books to your library.
          </p>
        </div>
      `;
      return;
    }

    books.forEach(book => {
      const card = BookCardView.createBookCard(book, onOpenBook, onEditMetadata, options);
      container.appendChild(card);
    });
  }
};

window.BookCardView = BookCardView;
