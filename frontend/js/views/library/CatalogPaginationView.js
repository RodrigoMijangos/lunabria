/** Pagination controls and input presentation, independent of the model. */
const CatalogPaginationView = {
  getPageItems(currentPage, pageCount) {
    if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => index + 1);
    if (currentPage <= 4) return [1, 2, 3, 4, 5, 'ellipsis', pageCount];
    if (currentPage >= pageCount - 3) {
      return [1, 'ellipsis', ...Array.from({ length: 5 }, (_, index) => pageCount - 4 + index)];
    }
    return [1, 'ellipsis', currentPage - 1, currentPage, currentPage + 1, 'ellipsis', pageCount];
  },

  render(elements, currentPage, pageCount, getPageItems, onSelectPage) {
    if (elements.catalogPagination) elements.catalogPagination.hidden = pageCount <= 1;
    if (elements.catalogPageStatus) {
      elements.catalogPageStatus.textContent = `Page ${currentPage} of ${pageCount}`;
    }
    if (elements.catalogPageTotal) elements.catalogPageTotal.textContent = String(pageCount);
    if (elements.catalogPageInput && document.activeElement !== elements.catalogPageInput) {
      elements.catalogPageInput.value = String(currentPage);
    }
    if (elements.catalogPreviousButton) elements.catalogPreviousButton.disabled = currentPage <= 1;
    if (elements.catalogNextButton) elements.catalogNextButton.disabled = currentPage >= pageCount;
    if (!elements.catalogPageNumbers) return;
    elements.catalogPageNumbers.replaceChildren();
    getPageItems().forEach(item => {
      if (item === 'ellipsis') {
        const ellipsis = document.createElement('span');
        ellipsis.className = 'catalog-page-ellipsis';
        ellipsis.textContent = '…';
        ellipsis.setAttribute('aria-hidden', 'true');
        elements.catalogPageNumbers.appendChild(ellipsis);
        return;
      }
      const pageButton = document.createElement('button');
      pageButton.type = 'button';
      pageButton.className = 'catalog-page-number';
      pageButton.textContent = String(item);
      pageButton.setAttribute('aria-label', `Go to page ${item}`);
      pageButton.setAttribute('aria-current', String(item === currentPage ? 'page' : 'false'));
      pageButton.title = `Go to page ${item}`;
      pageButton.onclick = () => onSelectPage(item);
      elements.catalogPageNumbers.appendChild(pageButton);
    });
  },

  readRequestedPage(input) {
    if (!input) return null;
    const value = input.value.trim();
    const requestedPage = /^\d+$/.test(value) ? Number(value) : NaN;
    return Number.isSafeInteger(requestedPage) && requestedPage >= 1 ? requestedPage : NaN;
  },

  setInputPage(input, page) {
    if (input) input.value = String(page);
  }
};

window.CatalogPaginationView = CatalogPaginationView;
