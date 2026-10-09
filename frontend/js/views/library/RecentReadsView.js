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
    if (!recentBooks || !recentBooks.length) {
      if (sectionWrapper) sectionWrapper.style.display = 'none';
      BookCardView.renderBookCards(container, [], onOpenBook, onEditBook, {
        showProgress: true,
        openAtCurrentPage: true
      });
      return;
    }

    if (sectionWrapper) sectionWrapper.style.display = 'block';
    const columns = window.getComputedStyle(container).gridTemplateColumns.trim();
    const visibleCount = columns && columns !== 'none'
      ? columns.split(/\s+/).length
      : recentBooks.length;
    BookCardView.renderBookCards(
      container,
      recentBooks.slice(0, visibleCount),
      onOpenBook,
      onEditBook,
      { showProgress: true, openAtCurrentPage: true }
    );
  }
};

window.RecentReadsView = RecentReadsView;
