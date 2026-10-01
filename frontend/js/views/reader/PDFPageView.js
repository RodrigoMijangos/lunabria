/**
 * PDFPageView.js
 * Creates DOM wrappers and canvas elements for PDF pages.
 */
const PDFPageView = {
  createPageWrapper(pageNumber, width, height) {
    const wrapper = document.createElement('div');
    wrapper.className = 'pdf-page-wrapper';
    wrapper.id = `pdf-page-${pageNumber}`;
    wrapper.dataset.page = pageNumber;
    wrapper.style.width = `${width}px`;
    wrapper.style.height = `${height}px`;
    return wrapper;
  },

  createPageCanvas(pageNumber, width, height, outputScale) {
    const canvas = document.createElement('canvas');
    canvas.className = 'pdf-page-canvas';
    canvas.width = Math.floor(width * outputScale);
    canvas.height = Math.floor(height * outputScale);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    return canvas;
  },

  renderPDFPageToCanvas(page, canvas, viewport, outputScale) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not create canvas context to render PDF');
    const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;
    return page.render({
      canvasContext: ctx,
      transform: transform,
      viewport: viewport
    });
  }
};

window.PDFPageView = PDFPageView;
