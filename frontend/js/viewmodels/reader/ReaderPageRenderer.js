/**
 * ReaderPageRenderer.js
 * Orchestrates PDF.js page rendering, text layer injection, and viewport DOM layout.
 */
class ReaderPageRenderer {
  constructor(model, viewportEl, bodyEl, annotationCoordinator, drawingCoordinator, linkCallbacks = {}) {
    this.model = model;
    this.viewportEl = viewportEl;
    this.bodyEl = bodyEl;
    this.annotationCoordinator = annotationCoordinator;
    this.drawingCoordinator = drawingCoordinator;
    this.linkCallbacks = linkCallbacks || {};
    this.intersectionObserver = null;
    this.pageObserver = null;
    this.visibleFlowPages = new Map();
    this.renderGeneration = 0;
    this.renderedScale = 1.0;
    this.renderTasks = new Set();
    this.layerBuilder = new ReaderPageLayerBuilder(this);
  }

  prepareNewRender() {
    this.renderGeneration += 1;
    this.intersectionObserver?.disconnect();
    this.intersectionObserver = null;
    this.pageObserver?.disconnect();
    this.pageObserver = null;
    this.visibleFlowPages.clear();
    for (const task of this.renderTasks) {
      try {
        task.cancel();
      } catch (_) {}
    }
    this.renderTasks.clear();
    return this.renderGeneration;
  }

  resetViewportDOM() {
    this.prepareNewRender();
    this.renderedScale = this.model.scale || 1.0;
    this.viewportEl.innerHTML = "";
  }

  clearViewportTransform() {
    if (!this.viewportEl?.style) return;
    this.viewportEl.style.transform = "";
    this.viewportEl.style.transformOrigin = "";
    this.viewportEl.style.willChange = "";
  }

  calculateZoomAnchor(focalPoint) {
    if (!focalPoint || !this.bodyEl || !this.viewportEl) return null;
    const bodyRect = this.bodyEl.getBoundingClientRect();
    const style = this.viewportEl.style;
    const savedTransform = style ? style.transform : "";
    const savedOrigin = style ? style.transformOrigin : "";
    if (savedTransform && style) {
      style.transform = "";
      style.transformOrigin = "";
    }
    const viewportRect = this.viewportEl.getBoundingClientRect();
    if (savedTransform && style) {
      style.transform = savedTransform;
      style.transformOrigin = savedOrigin;
    }
    if (!bodyRect.width || !bodyRect.height) return null;

    const cx = typeof focalPoint.clientX === "number" ? focalPoint.clientX : bodyRect.left + bodyRect.width / 2;
    const cy = typeof focalPoint.clientY === "number" ? focalPoint.clientY : bodyRect.top + bodyRect.height / 2;

    return {
      cx,
      cy,
      originX: cx - viewportRect.left,
      originY: cy - viewportRect.top,
      baseScale: this.renderedScale || this.model.scale || 1.0,
      targetScale: this.model.scale,
    };
  }

  applyZoomAnchor(zoomAnchor) {
    if (!zoomAnchor || !this.bodyEl || !this.viewportEl) return;
    const newViewportRect = this.viewportEl.getBoundingClientRect();
    const ratio = zoomAnchor.baseScale > 0 ? zoomAnchor.targetScale / zoomAnchor.baseScale : 1;
    this.bodyEl.scrollLeft += newViewportRect.left + zoomAnchor.originX * ratio - zoomAnchor.cx;
    this.bodyEl.scrollTop += newViewportRect.top + zoomAnchor.originY * ratio - zoomAnchor.cy;
  }

  applyPostRenderScroll(zoomAnchor) {
    if (zoomAnchor) {
      this.applyZoomAnchor(zoomAnchor);
    } else if (this.bodyEl) {
      this.bodyEl.scrollTop = 0;
      this.bodyEl.scrollLeft = 0;
    }
  }

  isCurrentGeneration(generation) {
    return generation === this.renderGeneration && Boolean(this.model.pdfDoc);
  }

  async renderPage(pageNumber, focalPoint = null) {
    if (!this.model.pdfDoc) return;
    const zoomAnchor = this.calculateZoomAnchor(focalPoint);
    const generation = this.prepareNewRender();

    const pageWrapper = await this.createAndPopulatePageWrapper(pageNumber, null, generation);
    if (!this.isCurrentGeneration(generation)) return;

    this.clearViewportTransform();
    this.viewportEl.replaceChildren(pageWrapper);
    this.renderedScale = this.model.scale;
    this.applyPostRenderScroll(zoomAnchor);
  }

  async renderDualPage(pageNumber, focalPoint = null) {
    if (!this.model.pdfDoc) return;
    const zoomAnchor = this.calculateZoomAnchor(focalPoint);
    const generation = this.prepareNewRender();

    const p1 = pageNumber % 2 === 1 ? pageNumber : pageNumber - 1;
    const p2 = p1 + 1;

    const wrapperPromises = [this.createAndPopulatePageWrapper(p1, null, generation)];
    if (p2 <= this.model.totalPages) {
      wrapperPromises.push(this.createAndPopulatePageWrapper(p2, null, generation));
    }

    const wrappers = await Promise.all(wrapperPromises);
    if (!this.isCurrentGeneration(generation)) return;

    this.clearViewportTransform();
    this.viewportEl.replaceChildren(...wrappers);
    this.renderedScale = this.model.scale;
    this.model.setCurrentPage(p1);
    this.applyPostRenderScroll(zoomAnchor);
  }

  async renderFlowMode(onPageObserved, initialPage = this.model.currentPage, focalPoint = null) {
    if (!this.model.pdfDoc) return;
    const zoomAnchor = this.calculateZoomAnchor(focalPoint);
    const generation = this.prepareNewRender();
    const targetPage = this.model.setCurrentPage(initialPage || this.model.currentPage);
    const referencePage = await this.model.pdfDoc.getPage(targetPage);
    if (!this.isCurrentGeneration(generation)) return;
    const referenceViewport = referencePage.getViewport({ scale: this.model.scale });
    const fragment = document.createDocumentFragment();
    const widthPx = `${Math.floor(referenceViewport.width)}px`;
    const heightPx = `${Math.floor(referenceViewport.height)}px`;

    for (let p = 1; p <= this.model.totalPages; p++) {
      const pageWrapper = document.createElement("div");
      pageWrapper.className = "pdf-page-wrapper";
      pageWrapper.id = `pdf-page-${p}`;
      pageWrapper.dataset.page = p;
      pageWrapper.style.width = widthPx;
      pageWrapper.style.height = heightPx;
      fragment.appendChild(pageWrapper);
    }

    this.clearViewportTransform();
    this.viewportEl.replaceChildren(fragment);
    this.renderedScale = this.model.scale;

    if (zoomAnchor) this.applyZoomAnchor(zoomAnchor);
    else this.scrollFlowToPage(targetPage);
    this.initFlowIntersectionObserver(onPageObserved, generation);
  }

  scrollFlowToPage(pageNumber) {
    const pageWrapper = this.viewportEl.querySelector(`#pdf-page-${pageNumber}`);
    if (!pageWrapper) return;
    const bodyRect = this.bodyEl.getBoundingClientRect();
    const pageRect = pageWrapper.getBoundingClientRect();
    const topPadding = Number.parseFloat(getComputedStyle(this.bodyEl).paddingTop) || 0;
    this.bodyEl.scrollTop += pageRect.top - bodyRect.top - topPadding;
  }

  initFlowIntersectionObserver(onPageObserved, generation) {
    this.intersectionObserver?.disconnect();
    this.pageObserver?.disconnect();

    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || !this.isCurrentGeneration(generation)) continue;
          const p = Number(entry.target.dataset.page);
          if (entry.target.dataset.renderState) continue;
          entry.target.dataset.renderState = "loading";
          this.populatePageWrapper(entry.target, p, null, generation)
            .then((rendered) => {
              if (this.isCurrentGeneration(generation)) {
                entry.target.dataset.renderState = rendered ? "rendered" : "error";
              }
            })
            .catch((error) => {
              if (this.isCurrentGeneration(generation)) {
                entry.target.dataset.renderState = "error";
                console.error(`[ReaderPageRenderer] Could not render page ${p}:`, error);
              }
            });
        }
      },
      { root: this.bodyEl, rootMargin: "300px 0px" },
    );

    this.pageObserver = new IntersectionObserver(
      (entries) => {
        if (!onPageObserved || !this.isCurrentGeneration(generation)) return;
        for (const entry of entries) {
          const page = Number(entry.target.dataset.page);
          if (entry.isIntersecting) this.visibleFlowPages.set(page, entry.target);
          else this.visibleFlowPages.delete(page);
        }

        const rootRect = this.bodyEl.getBoundingClientRect();
        const rootCenter = rootRect.top + rootRect.height / 2;
        const visiblePage = [...this.visibleFlowPages.entries()]
          .map(([page, wrapper]) => ({ page, rect: wrapper.getBoundingClientRect() }))
          .sort(
            (a, b) =>
              Math.abs(a.rect.top + a.rect.height / 2 - rootCenter) -
              Math.abs(b.rect.top + b.rect.height / 2 - rootCenter),
          )[0];
        if (visiblePage) onPageObserved(visiblePage.page);
      },
      { root: this.bodyEl, rootMargin: "0px" },
    );

    for (const wrapper of this.viewportEl.querySelectorAll(".pdf-page-wrapper")) {
      this.intersectionObserver.observe(wrapper);
      this.pageObserver.observe(wrapper);
    }
  }

  async createAndPopulatePageWrapper(pageNumber, customScale = null, generation = this.renderGeneration) {
    const pageWrapper = document.createElement("div");
    await this.populatePageWrapper(pageWrapper, pageNumber, customScale, generation);
    return pageWrapper;
  }

  computeOutputScale(pageWidth, pageHeight) {
    return this.layerBuilder.computeOutputScale(pageWidth, pageHeight);
  }

  populatePageWrapper(pageWrapper, pageNumber, customScale = null, generation = this.renderGeneration) {
    return this.layerBuilder.populatePageWrapper(pageWrapper, pageNumber, customScale, generation);
  }

  isValidInternalLinkAnnotation(annotation) {
    return this.layerBuilder.isValidInternalLinkAnnotation(annotation);
  }

  renderInternalLinks(pageWrapper, page, viewport, pageNumber, generation) {
    return this.layerBuilder.renderInternalLinks(pageWrapper, page, viewport, pageNumber, generation);
  }

  resolveLinkDestination(destination) {
    return this.layerBuilder.resolveLinkDestination(destination);
  }

  renderPageErrorState(pageWrapper, pageNumber, effectiveScale, generation) {
    return this.layerBuilder.renderPageErrorState(pageWrapper, pageNumber, effectiveScale, generation);
  }

  renderTextLayer(pageWrapper, page, pageNumber, width, height, viewport, effectiveScale, generation) {
    return this.layerBuilder.renderTextLayer(
      pageWrapper,
      page,
      pageNumber,
      width,
      height,
      viewport,
      effectiveScale,
      generation,
    );
  }
}

window.ReaderPageRenderer = ReaderPageRenderer;
