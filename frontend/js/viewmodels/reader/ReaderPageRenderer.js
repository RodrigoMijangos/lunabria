/**
 * ReaderPageRenderer.js
 * Orchestrates PDF.js page rendering, text layer injection, and viewport DOM layout.
 */
class ReaderPageRenderer {
  constructor(model, viewportEl, bodyEl, annotationCoordinator, drawingCoordinator) {
    this.model = model;
    this.viewportEl = viewportEl;
    this.bodyEl = bodyEl;
    this.annotationCoordinator = annotationCoordinator;
    this.drawingCoordinator = drawingCoordinator;
    this.intersectionObserver = null;
    this.pageObserver = null;
    this.visibleFlowPages = new Map();
    this.renderGeneration = 0;
    this.renderTasks = new Set();
  }

  resetViewportDOM() {
    this.renderGeneration += 1;
    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
      this.intersectionObserver = null;
    }
    if (this.pageObserver) {
      this.pageObserver.disconnect();
      this.pageObserver = null;
    }
    this.visibleFlowPages.clear();
    this.renderTasks.forEach(task => {
      try { task.cancel(); } catch (error) {}
    });
    this.renderTasks.clear();
    this.viewportEl.innerHTML = '';
  }

  isCurrentGeneration(generation) {
    return generation === this.renderGeneration && Boolean(this.model.pdfDoc);
  }

  async renderPage(pageNumber) {
    if (!this.model.pdfDoc) return;
    this.resetViewportDOM();
    const generation = this.renderGeneration;

    const pageWrapper = await this.createAndPopulatePageWrapper(pageNumber, null, generation);
    if (!this.isCurrentGeneration(generation)) return;
    this.viewportEl.appendChild(pageWrapper);
  }

  async renderDualPage(pageNumber) {
    if (!this.model.pdfDoc) return;
    this.resetViewportDOM();
    const generation = this.renderGeneration;

    const p1 = (pageNumber % 2 === 1) ? pageNumber : pageNumber - 1;
    const p2 = p1 + 1;

    const wrapper1 = await this.createAndPopulatePageWrapper(p1, null, generation);
    if (!this.isCurrentGeneration(generation)) return;
    this.viewportEl.appendChild(wrapper1);

    if (p2 <= this.model.totalPages) {
      const wrapper2 = await this.createAndPopulatePageWrapper(p2, null, generation);
      if (!this.isCurrentGeneration(generation)) return;
      this.viewportEl.appendChild(wrapper2);
    }

    this.model.setCurrentPage(p1);
  }

  async renderFlowMode(onPageObserved, initialPage = this.model.currentPage) {
    if (!this.model.pdfDoc) return;
    this.resetViewportDOM();
    const generation = this.renderGeneration;
    const targetPage = this.model.setCurrentPage(initialPage || this.model.currentPage);
    const referencePage = await this.model.pdfDoc.getPage(targetPage);
    if (!this.isCurrentGeneration(generation)) return;
    const referenceViewport = referencePage.getViewport({ scale: this.model.scale });
    const fragment = document.createDocumentFragment();

    for (let p = 1; p <= this.model.totalPages; p++) {
      const pageWrapper = document.createElement('div');
      pageWrapper.className = 'pdf-page-wrapper';
      pageWrapper.id = `pdf-page-${p}`;
      pageWrapper.dataset.page = p;
      pageWrapper.style.width = `${Math.floor(referenceViewport.width)}px`;
      pageWrapper.style.height = `${Math.floor(referenceViewport.height)}px`;
      fragment.appendChild(pageWrapper);
    }

    this.viewportEl.appendChild(fragment);
    this.scrollFlowToPage(targetPage);
    this.initFlowIntersectionObserver(onPageObserved, generation);
  }

  scrollFlowToPage(pageNumber) {
    const pageWrapper = this.viewportEl.querySelector(`#pdf-page-${pageNumber}`);
    if (!pageWrapper) return;
    const bodyRect = this.bodyEl.getBoundingClientRect();
    const pageRect = pageWrapper.getBoundingClientRect();
    const topPadding = parseFloat(getComputedStyle(this.bodyEl).paddingTop) || 0;
    this.bodyEl.scrollTop += pageRect.top - bodyRect.top - topPadding;
  }

  initFlowIntersectionObserver(onPageObserved, generation) {
    if (this.intersectionObserver) this.intersectionObserver.disconnect();
    if (this.pageObserver) this.pageObserver.disconnect();

    this.intersectionObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting || !this.isCurrentGeneration(generation)) return;
        const p = Number(entry.target.dataset.page);
        if (!entry.target.dataset.renderState) {
          entry.target.dataset.renderState = 'loading';
          this.populatePageWrapper(entry.target, p, null, generation)
            .then(rendered => {
              if (this.isCurrentGeneration(generation)) {
                entry.target.dataset.renderState = rendered ? 'rendered' : 'error';
              }
            })
            .catch(error => {
              if (this.isCurrentGeneration(generation)) {
                entry.target.dataset.renderState = 'error';
                console.error(`[ReaderPageRenderer] Could not render page ${p}:`, error);
              }
            });
        }
      });
    }, { root: this.bodyEl, rootMargin: '300px 0px' });

    this.pageObserver = new IntersectionObserver((entries) => {
      if (!onPageObserved || !this.isCurrentGeneration(generation)) return;
      entries.forEach(entry => {
        const page = Number(entry.target.dataset.page);
        if (entry.isIntersecting) this.visibleFlowPages.set(page, entry.target);
        else this.visibleFlowPages.delete(page);
      });

      const rootRect = this.bodyEl.getBoundingClientRect();
      const rootCenter = rootRect.top + rootRect.height / 2;
      const visiblePage = [...this.visibleFlowPages.entries()]
        .map(([page, wrapper]) => ({ page, rect: wrapper.getBoundingClientRect() }))
        .sort((a, b) => Math.abs(a.rect.top + a.rect.height / 2 - rootCenter) - Math.abs(b.rect.top + b.rect.height / 2 - rootCenter))[0];
      if (visiblePage) onPageObserved(visiblePage.page);
    }, { root: this.bodyEl, rootMargin: '0px' });

    this.viewportEl.querySelectorAll('.pdf-page-wrapper').forEach(wrapper => {
      this.intersectionObserver.observe(wrapper);
      this.pageObserver.observe(wrapper);
    });
  }

  async createAndPopulatePageWrapper(pageNumber, customScale = null, generation = this.renderGeneration) {
    const pageWrapper = document.createElement('div');
    await this.populatePageWrapper(pageWrapper, pageNumber, customScale, generation);
    return pageWrapper;
  }

  async populatePageWrapper(pageWrapper, pageNumber, customScale = null, generation = this.renderGeneration) {
    if (!this.isCurrentGeneration(generation) || pageNumber < 1 || pageNumber > this.model.totalPages) return false;
    pageWrapper.dataset.page = pageNumber;
    pageWrapper.id = `pdf-page-${pageNumber}`;

    const effectiveScale = customScale || this.model.scale;
    const page = await this.model.pdfDoc.getPage(pageNumber);
    if (!this.isCurrentGeneration(generation)) return false;
    const viewport = page.getViewport({ scale: effectiveScale });

    const pageWidth = Math.floor(viewport.width);
    const pageHeight = Math.floor(viewport.height);
    const devicePixelRatio = window.devicePixelRatio || 1;
    const maxCanvasPixels = 16 * 1024 * 1024;
    const outputScale = Math.min(devicePixelRatio, Math.sqrt(maxCanvasPixels / Math.max(1, pageWidth * pageHeight)));

    pageWrapper.innerHTML = '';
    pageWrapper.style.width = `${pageWidth}px`;
    pageWrapper.style.height = `${pageHeight}px`;

    // 1. PDF Pixel-Perfect Canvas Layer
    const canvas = PDFPageView.createPageCanvas(pageNumber, pageWidth, pageHeight, outputScale);
    pageWrapper.appendChild(canvas);
    const renderTask = PDFPageView.renderPDFPageToCanvas(page, canvas, viewport, outputScale);
    this.renderTasks.add(renderTask);
    try {
      await renderTask.promise;
    } catch (error) {
      if (error?.name === 'RenderingCancelledException') return false;
      throw error;
    } finally {
      this.renderTasks.delete(renderTask);
    }
    if (!this.isCurrentGeneration(generation)) return false;

    // 2. Exact Word Text Layer
    await this.renderTextLayer(pageWrapper, page, pageNumber, pageWidth, pageHeight, viewport, effectiveScale, generation);
    if (!this.isCurrentGeneration(generation)) return false;

    // 3. Highlight Layer
    const highlightLayer = HighlightOverlayView.createHighlightLayerContainer();
    pageWrapper.appendChild(highlightLayer);
    if (this.annotationCoordinator) {
      this.annotationCoordinator.renderPageHighlights(highlightLayer, pageNumber);
    }

    // 4. Freehand Ink & Drawing Canvas Layer
    const drawCanvas = DrawingCanvasView.createDrawingCanvas(pageNumber, pageWidth, pageHeight, outputScale);
    pageWrapper.appendChild(drawCanvas);
    if (this.drawingCoordinator) {
      await this.drawingCoordinator.setupDrawingLayer(drawCanvas, pageWrapper, pageNumber, effectiveScale, outputScale);
    }
    return this.isCurrentGeneration(generation);
  }

  async renderTextLayer(pageWrapper, page, pageNumber, width, height, viewport, effectiveScale, generation) {
    const textLayerDiv = TextLayerView.createTextLayerContainer(width, height, viewport.scale);
    pageWrapper.style.setProperty('--scale-factor', viewport.scale);
    pageWrapper.appendChild(textLayerDiv);

    let layoutData = null;
    try {
      layoutData = await api.getPageLayout(this.model.bookId, pageNumber, this.model.totalPages);
    } catch (e) {
      layoutData = null;
    }

    if (!this.isCurrentGeneration(generation)) return;
    if (layoutData && layoutData.words && layoutData.words.length > 0) {
      const lines = layoutData.lines || TextLayerView.groupWordsIntoLines(layoutData.words);
      TextLayerView.renderPreciseLines(textLayerDiv, lines, effectiveScale);
    } else {
      const textContent = await page.getTextContent();
      if (pdfjsLib.TextLayer) {
        const textLayer = new pdfjsLib.TextLayer({
          textContentSource: textContent,
          container: textLayerDiv,
          viewport: viewport
        });
        await textLayer.render();
      }
    }
  }
}

window.ReaderPageRenderer = ReaderPageRenderer;
