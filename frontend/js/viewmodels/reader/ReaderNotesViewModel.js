/**
 * ReaderNotesViewModel.js
 * Manages full notebook view mode, note cards, comment editing, and note deletion.
 */
class ReaderNotesViewModel {
  constructor(model, viewportEl, callbacks) {
    this.model = model;
    this.viewportEl = viewportEl;
    this.onJumpToPage = callbacks.onJumpToPage;
    this.onRefreshAnnotations = callbacks.onRefreshAnnotations;
    this.searchQuery = '';
    this.sortBy = 'page_asc';
  }

  renderNotesMode() {
    this.viewportEl.innerHTML = '';
    const container = document.createElement('div');
    container.className = 'notes-view-container';

    // Hero Top Header
    container.innerHTML = `
      <div class="notes-hero-top">
        <div class="notes-hero-title-wrap">
          <h2 class="notes-hero-title">Annotations Notebook</h2>
          <span class="notes-hero-badge" id="notes-count-badge">${this.model.annotations.length} notes</span>
        </div>
        <div class="notes-hero-actions">
          <button type="button" class="btn btn-secondary notes-action-btn" id="notes-back-read-btn">
            <svg class="ui-icon" aria-hidden="true" focusable="false"><use href="./icons.svg#book-open"></use></svg> Back to Reading
          </button>
        </div>
      </div>
      <div class="notes-filter-bar">
        <div class="notes-filter-top-row">
          <div class="notes-search-wrap">
            <svg class="ui-icon" aria-hidden="true" focusable="false"><use href="./icons.svg#search"></use></svg>
            <input type="text" id="notes-search-input" class="notes-search-input" placeholder="Search quotes and notes...">
          </div>
          <div class="notes-sort-wrap">
            <span class="notes-sort-label">Sort by:</span>
            <select id="notes-sort-select" class="form-select notes-sort-select">
              <option value="page_asc">Page (1 to End)</option>
              <option value="recent">Most recent</option>
              <option value="page_desc">Page (End to 1)</option>
            </select>
          </div>
        </div>
        <div class="notes-pills-row" id="notes-pills-row"></div>
      </div>
      <div class="notes-cards-list" id="notes-cards-list"></div>
    `;

    this.viewportEl.appendChild(container);

    const backBtn = container.querySelector('#notes-back-read-btn');
    if (backBtn) backBtn.onclick = () => this.goToPageFromNotes(this.model.currentPage || 1);

    const searchInput = container.querySelector('#notes-search-input');
    if (searchInput) {
      searchInput.value = this.searchQuery;
      searchInput.oninput = (e) => {
        this.searchQuery = e.target.value.toLowerCase().trim();
        this.renderNotesCardsList(container);
      };
    }

    const sortSelect = container.querySelector('#notes-sort-select');
    if (sortSelect) {
      sortSelect.value = this.sortBy;
      sortSelect.onchange = (e) => {
        this.sortBy = e.target.value;
        this.renderNotesCardsList(container);
      };
    }

    this.renderNotesCardsList(container);
  }

  renderNotesCardsList(container) {
    const listEl = container.querySelector('#notes-cards-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    let annots = [...this.model.annotations];

    if (this.searchQuery) {
      annots = annots.filter(a =>
        (a.text && a.text.toLowerCase().includes(this.searchQuery)) ||
        (a.comment && a.comment.toLowerCase().includes(this.searchQuery))
      );
    }

    if (this.sortBy === 'page_asc') {
      annots.sort((a, b) => a.page - b.page);
    } else if (this.sortBy === 'page_desc') {
      annots.sort((a, b) => b.page - a.page);
    } else if (this.sortBy === 'recent') {
      annots.sort((a, b) => (b.id || 0) - (a.id || 0));
    }

    const countBadge = container.querySelector('#notes-count-badge');
    if (countBadge) countBadge.textContent = `${annots.length} notes`;

    if (annots.length === 0) {
      listEl.innerHTML = `
        <div class="notes-empty-state">
          <div class="notes-empty-icon"><svg class="ui-icon" aria-hidden="true" focusable="false"><use href="./icons.svg#notes"></use></svg></div>
          <div class="notes-empty-title">No annotations found</div>
          <p class="notes-empty-desc">Try adjusting your search or create new annotations while reading.</p>
        </div>
      `;
      return;
    }

    annots.forEach(annot => {
      const colorMeta = this.model.getColorMetadata(annot.color);
      const card = NotesView.createNoteCard(
        annot,
        colorMeta,
        (page) => this.goToPageFromNotes(page),
        (a) => this.editNoteComment(a),
        (id) => this.deleteNote(id)
      );
      listEl.appendChild(card);
    });
  }

  goToPageFromNotes(pageNumber) {
    if (this.onJumpToPage) this.onJumpToPage(pageNumber);
  }

  async editNoteComment(annot) {
    const current = annot.comment || '';
    const updated = prompt('Edit / Add note to this highlight:', current);
    if (updated !== null) {
      await api.updateAnnotation(annot.id, { comment: updated });
      if (this.onRefreshAnnotations) await this.onRefreshAnnotations();
      this.renderNotesMode();
    }
  }

  async deleteNote(annotId) {
    if (confirm('Delete this annotation?')) {
      await api.deleteAnnotation(annotId);
      if (this.onRefreshAnnotations) await this.onRefreshAnnotations();
      this.renderNotesMode();
    }
  }
}

window.ReaderNotesViewModel = ReaderNotesViewModel;
