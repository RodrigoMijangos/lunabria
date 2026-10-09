/** Downloads and verifies the PDF and layout cache without changing reader state. */
class ReaderOfflineService {
  constructor(model) {
    this.model = model;
  }

  async cacheCurrentPdf(onProgress = () => {}) {
    const bookId = this.model.bookId;
    const totalPages = this.model.pdfDoc?.numPages;
    if (!bookId || !totalPages) throw new Error('No book is currently open to save.');

    const isPdfCached = await localDB.isPdfCached(bookId);
    if (!isPdfCached) {
      onProgress({ stage: 'pdf' });
      const response = await fetch(`/api/books/${bookId}/pdf`);
      if (!response.ok) throw new Error(`Could not download PDF (HTTP ${response.status}).`);

      const blob = await response.blob();
      const signature = new TextDecoder().decode(await blob.slice(0, 5).arrayBuffer());
      if (blob.size < 5 || (!response.headers.get('content-type')?.includes('application/pdf') && signature !== '%PDF-')) {
        throw new Error('Server did not return a valid PDF.');
      }

      await localDB.savePdfBlob(bookId, blob);
    }
    onProgress({ stage: 'pdf-complete' });

    const cachedPages = await localDB.getCachedLayoutPages(bookId);
    const isPageCached = (page) => cachedPages.has(page);
    let completedPages = 0;
    for (let page = 1; page <= totalPages; page += 1) {
      if (isPageCached(page)) completedPages += 1;
    }
    onProgress({ stage: 'layouts', completed: completedPages, total: totalPages });

    const batchSize = 10;
    for (let startPage = 1; startPage <= totalPages; startPage += batchSize) {
      const endPage = Math.min(totalPages, startPage + batchSize - 1);
      let batchIsCached = true;
      for (let page = startPage; page <= endPage; page += 1) {
        if (!isPageCached(page)) {
          batchIsCached = false;
          break;
        }
      }
      if (batchIsCached) continue;

      const downloaded = await api.prefetchLayouts(bookId, startPage, endPage);
      if (!downloaded) {
        throw new Error(`Could not save layouts for pages ${startPage}-${endPage}.`);
      }

      for (let page = startPage; page <= endPage; page += 1) {
        if (!isPageCached(page)) {
          cachedPages.add(page);
          completedPages += 1;
        }
      }
      onProgress({ stage: 'layouts', completed: completedPages, total: totalPages });
    }

    if (!(await localDB.hasAllLayoutsCached(bookId, totalPages))) {
      throw new Error('Download completed, but some layouts could not be saved. Please try again.');
    }

    try {
      if (typeof localDB?.saveCachedBook === 'function') {
        const appBook = window.app?.model?.getBookById?.(Number(bookId));
        const titleEl = document.getElementById('reader-book-title');
        const authorEl = document.getElementById('reader-book-author');
        await localDB.saveCachedBook({
          id: Number(bookId),
          title: appBook?.title || titleEl?.textContent || `Book ${bookId}`,
          authors: appBook?.authors || authorEl?.textContent || '',
          cover_path: appBook?.cover_path || '',
          total_pages: totalPages,
          isOfflineComplete: true
        });
      }
    } catch (err) {
      console.warn('[ReaderOfflineService] Could not persist book metadata for offline catalog:', err);
    }

    return true;
  }

}
