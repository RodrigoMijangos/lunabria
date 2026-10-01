/**
 * RecentReadsView.js
 * Renders the responsive recent reads row and progress badges.
 */
const RecentReadsView = {
  createRecentCard(book, onOpenBook, onEditBook) {
    return BookCardView.createBookCard(book, onOpenBook, onEditBook, {
      showProgress: true,
      openAtCurrentPage: true
    });
  },

  renderRecentReads(container, sectionWrapper, recentBooks, onOpenBook, onEditBook) {
    if (!container) return;
    container.innerHTML = '';
    if (!recentBooks || !recentBooks.length) {
      if (sectionWrapper) sectionWrapper.style.display = 'none';
      return;
    }

    if (sectionWrapper) sectionWrapper.style.display = 'block';
    recentBooks.forEach(book => {
      const card = RecentReadsView.createRecentCard(book, onOpenBook, onEditBook);
      container.appendChild(card);
    });

    const columns = window.getComputedStyle(container).gridTemplateColumns.trim();
    const visibleCount = columns && columns !== 'none'
      ? columns.split(/\s+/).length
      : recentBooks.length;
    Array.from(container.children).slice(visibleCount).forEach(card => card.remove());
  }
};

window.RecentReadsView = RecentReadsView;
