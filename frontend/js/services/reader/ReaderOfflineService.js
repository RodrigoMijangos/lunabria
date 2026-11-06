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
    if (!isPdfCached) await this.cachePdfInChunks(bookId, onProgress);
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

    const appBook = window.app?.model?.getBookById?.(Number(bookId));
    let coverBlob = null;
    const coverUrl = appBook?.cover_url || (appBook?.has_cover ? `/api/books/${bookId}/cover` : null);
    if (coverUrl) {
      try {
        const response = await fetch(coverUrl);
        if (!response.ok) throw new Error(`Could not download cover (HTTP ${response.status}).`);

        const blob = await response.blob();
        if (!blob.size || (blob.type && !blob.type.startsWith('image/'))) {
          throw new Error('Server did not return a valid cover image.');
        }
        coverBlob = blob;
      } catch (err) {
        console.warn('[ReaderOfflineService] Could not cache book cover for offline use:', err);
      }
    }

    try {
      if (typeof localDB?.saveCachedBook === 'function') {
        const titleEl = document.getElementById('reader-book-title');
        const authorEl = document.getElementById('reader-book-author');
        await localDB.saveCachedBook({
          id: Number(bookId),
          title: appBook?.title || titleEl?.textContent || `Book ${bookId}`,
          authors: appBook?.authors || authorEl?.textContent || '',
          cover_path: appBook?.cover_path || '',
          coverBlob,
          total_pages: totalPages,
          isOfflineComplete: true
        });
      }
    } catch (err) {
      console.warn('[ReaderOfflineService] Could not persist book metadata for offline catalog:', err);
    }

    return true;
  }

  async cachePdfInChunks(bookId, onProgress) {
    if (typeof localDB.getPdfChunks !== 'function') {
      onProgress({ stage: 'pdf' });
      const response = await fetch(`/api/books/${bookId}/pdf`);
      if (!response.ok) throw new Error(`Could not download PDF (HTTP ${response.status}).`);
      const blob = await response.blob();
      await this.validatePdfBlob(blob, response);
      await localDB.savePdfBlob(bookId, blob);
      return;
    }

    const chunkSize = 1024 * 1024;
    const url = `/api/books/${bookId}/pdf`;
    let cachedChunks = await localDB.getPdfChunks(bookId);
    let chunksByStart = new Map(cachedChunks.map((chunk) => [chunk.start, chunk]));
    let totalBytes = cachedChunks[0]?.totalBytes ?? null;
    let validator = cachedChunks[0]?.validator || "";
    let downloadedBytes = cachedChunks.reduce((sum, chunk) => sum + (chunk.blob?.size || 0), 0);
    let start = 0;
    onProgress({ stage: 'pdf', completed: downloadedBytes, total: totalBytes });

    while (totalBytes == null || start < totalBytes) {
      const cached = chunksByStart.get(start);
      const mustValidateFirstChunk = start === 0;
      if (cached && !mustValidateFirstChunk) {
        start += chunkSize;
        continue;
      }

      let rangeBlob = null;
      let rangeTotal = null;
      let rangeValidator = "";
      let lastError = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const end = start + chunkSize - 1;
          const response = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
          if (response.status === 200 && start === 0) {
            const fullBlob = await response.blob();
            await this.validatePdfBlob(fullBlob, response);
            await localDB.savePdfBlob(bookId, fullBlob);
            await localDB.clearPdfChunks(bookId);
            return;
          }
          if (response.status !== 206) {
            throw new Error(`Could not download PDF range (HTTP ${response.status}).`);
          }

          const contentRange = response.headers?.get?.('content-range') || '';
          const match = contentRange.match(/^bytes (\d+)-(\d+)\/(\d+)$/i);
          if (!match) throw new Error('Server returned an invalid PDF range.');
          const rangeStart = Number(match[1]);
          const rangeEnd = Number(match[2]);
          rangeTotal = Number(match[3]);
          const expectedRangeEnd = Math.min(start + chunkSize - 1, rangeTotal - 1);
          if (rangeStart !== start || rangeEnd !== expectedRangeEnd) {
            throw new Error('Server returned an unexpected PDF range.');
          }
          rangeBlob = await response.blob();
          if (rangeBlob.size !== rangeEnd - rangeStart + 1) {
            throw new Error('Server returned an incomplete PDF range.');
          }
          rangeValidator = response.headers?.get?.('x-file-version') || '';
          break;
        } catch (error) {
          lastError = error;
          if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 100 * (2 ** attempt)));
        }
      }
      if (!rangeBlob || rangeTotal == null) throw lastError || new Error('Could not download PDF range.');

      const cachedTotal = totalBytes;
      const validatorChanged = validator && rangeValidator && validator !== rangeValidator;
      if ((cachedTotal != null && cachedTotal !== rangeTotal) || validatorChanged) {
        await localDB.clearPdfChunks(bookId);
        chunksByStart.clear();
        downloadedBytes = 0;
      }
      totalBytes = rangeTotal;
      validator = rangeValidator || validator;

      if (cached && cached.totalBytes === totalBytes && (!validator || !cached.validator || cached.validator === validator)) {
        start += chunkSize;
        continue;
      }
      await localDB.savePdfChunk(bookId, start, totalBytes, rangeBlob, validator);
      chunksByStart.set(start, { start, totalBytes, validator, blob: rangeBlob });
      downloadedBytes += rangeBlob.size;
      onProgress({ stage: 'pdf', completed: downloadedBytes, total: totalBytes });
      start += chunkSize;
    }

    cachedChunks = await localDB.getPdfChunks(bookId);
    const orderedChunks = cachedChunks.sort((left, right) => left.start - right.start);
    let expectedStart = 0;
    for (const chunk of orderedChunks) {
      if (chunk.start !== expectedStart || chunk.totalBytes !== totalBytes) {
        throw new Error('Cached PDF ranges are incomplete. Please retry the offline download.');
      }
      if (validator && chunk.validator && chunk.validator !== validator) {
        throw new Error('Cached PDF ranges belong to different versions. Please retry the offline download.');
      }
      expectedStart += chunk.blob.size;
    }
    if (expectedStart !== totalBytes) {
      throw new Error('Cached PDF ranges are incomplete. Please retry the offline download.');
    }

    const signature = new TextDecoder().decode(await orderedChunks[0].blob.slice(0, 5).arrayBuffer());
    if (signature !== '%PDF-') throw new Error('Server did not return a valid PDF.');
    await localDB.savePdfChunksComplete(bookId, totalBytes, validator);
  }

  async validatePdfBlob(blob, response = null) {
    const signature = new TextDecoder().decode(await blob.slice(0, 5).arrayBuffer());
    const contentType = response?.headers?.get?.('content-type') || '';
    if (blob.size < 5 || (!contentType.includes('application/pdf') && signature !== '%PDF-')) {
      throw new Error('Server did not return a valid PDF.');
    }
  }

}

window.ReaderOfflineService = ReaderOfflineService;