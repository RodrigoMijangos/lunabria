/**
 * ReaderPageLayerBuilder.js
 * Builds individual PDF page wrappers: canvas rendering, text layer, internal links, highlights, and error UI.
 */
class ReaderPageLayerBuilder {
  constructor(renderer) {
    this.renderer = renderer;
  }

  computeOutputScale(pageWidth, pageHeight) {
    const devicePixelRatio = window.devicePixelRatio || 1;
    const scaleByPixels = Math.sqrt((16 * 1024 * 1024) / Math.max(1, pageWidth * pageHeight));
    const scaleByDim = Math.min(8192 / Math.max(1, pageWidth), 8192 / Math.max(1, pageHeight));
    return Math.max(0.1, Math.min(devicePixelRatio, scaleByPixels, scaleByDim));
  }

  async populatePageWrapper(pageWrapper, pageNumber, customScale = null, generation = this.renderer.renderGeneration) {
    const renderer = this.renderer;
    if (!renderer.isCurrentGeneration(generation) || pageNumber < 1 || pageNumber > renderer.model.totalPages) {
      return false;
    }
    pageWrapper.className = "pdf-page-wrapper";
    pageWrapper.dataset.page = pageNumber;
    pageWrapper.id = `pdf-page-${pageNumber}`;

    const effectiveScale = customScale || renderer.model.scale;
    const page = await renderer.model.pdfDoc.getPage(pageNumber);
    if (!renderer.isCurrentGeneration(generation)) return false;
    const viewport = page.getViewport({ scale: effectiveScale });

    const pageWidth = Math.floor(viewport.width);
    const pageHeight = Math.floor(viewport.height);
    const outputScale = renderer.computeOutputScale(pageWidth, pageHeight);

    pageWrapper.innerHTML = "";
    pageWrapper.style.width = `${pageWidth}px`;
    pageWrapper.style.height = `${pageHeight}px`;

    const canvas = PDFPageView.createPageCanvas(pageNumber, pageWidth, pageHeight, outputScale);
    pageWrapper.appendChild(canvas);
    const renderTask = PDFPageView.renderPDFPageToCanvas(page, canvas, viewport, outputScale);
    renderer.renderTasks.add(renderTask);
    let renderSuccess = false;
    try {
      await renderTask.promise;
      renderSuccess = true;
    } catch (error) {
      if (error?.name === "RenderingCancelledException") return false;
      console.error(
        `[ReaderPageRenderer] Diagnostic render failure: Book ${renderer.model.bookId || "unknown"}, Page ${pageNumber}, Cause: ${error?.name || "Error"} (${error?.message || "render failed"})`,
      );
    } finally {
      renderer.renderTasks.delete(renderTask);
    }
    if (!renderer.isCurrentGeneration(generation)) return false;

    if (!renderSuccess) {
      renderer.renderPageErrorState(pageWrapper, pageNumber, effectiveScale, generation);
      return false;
    }

    await renderer.renderTextLayer(
      pageWrapper,
      page,
      pageNumber,
      pageWidth,
      pageHeight,
      viewport,
      effectiveScale,
      generation,
    );
    if (!renderer.isCurrentGeneration(generation)) return false;

    await renderer.renderInternalLinks(pageWrapper, page, viewport, pageNumber, generation);
    if (!renderer.isCurrentGeneration(generation)) return false;

    const highlightLayer = HighlightOverlayView.createHighlightLayerContainer();
    pageWrapper.appendChild(highlightLayer);
    renderer.annotationCoordinator?.renderPageHighlights(highlightLayer, pageNumber);

    const drawCanvas = DrawingCanvasView.createDrawingCanvas(pageNumber, pageWidth, pageHeight, outputScale);
    pageWrapper.appendChild(drawCanvas);
    await renderer.drawingCoordinator?.setupDrawingLayer(
      drawCanvas,
      pageWrapper,
      pageNumber,
      effectiveScale,
      outputScale,
    );
    return renderer.isCurrentGeneration(generation);
  }

  isValidInternalLinkAnnotation(annotation) {
    return Boolean(
      annotation?.subtype === "Link" &&
        !annotation.url &&
        !annotation.unsafeUrl &&
        (!annotation.action || annotation.action === "GoTo") &&
        Array.isArray(annotation.rect) &&
        annotation.rect.length === 4 &&
        annotation.rect.every(Number.isFinite) &&
        annotation.dest != null,
    );
  }

  async renderInternalLinks(pageWrapper, page, viewport, pageNumber, generation) {
    const renderer = this.renderer;
    if (typeof page.getAnnotations !== "function") {
      console.error(`[ReaderPageRenderer] PDF.js annotations are unavailable for page ${pageNumber}.`);
      return;
    }

    let annotations;
    try {
      annotations = await page.getAnnotations({ intent: "display" });
    } catch (error) {
      console.error(`[ReaderPageRenderer] Could not read PDF links for page ${pageNumber}:`, error);
      return;
    }
    if (!Array.isArray(annotations)) {
      console.error(`[ReaderPageRenderer] Invalid PDF annotations response for page ${pageNumber}.`);
      return;
    }
    if (!renderer.isCurrentGeneration(generation)) return;

    const internalLinks = annotations.filter((a) => renderer.isValidInternalLinkAnnotation(a));
    const links = await Promise.all(
      internalLinks.map(async (annotation) => {
        try {
          const targetPage = await renderer.resolveLinkDestination(annotation.dest);
          if (!targetPage) {
            console.warn(`[ReaderPageRenderer] Ignoring an unresolved internal PDF link on page ${pageNumber}.`);
            return null;
          }
          return {
            targetPage,
            rect: annotation.rect,
            label: String(annotation.title || annotation.contents || `Go to page ${targetPage}`),
          };
        } catch (error) {
          console.warn(`[ReaderPageRenderer] Could not resolve an internal PDF link on page ${pageNumber}:`, error);
          return null;
        }
      }),
    );
    if (!renderer.isCurrentGeneration(generation)) return;

    const layer = new LinkOverlayView(
      pageWrapper,
      links.filter(Boolean),
      viewport,
      renderer.model,
      renderer.drawingCoordinator,
      renderer.linkCallbacks.onInternalLinkNavigate,
    ).render();
    if (layer) pageWrapper.appendChild(layer);
  }

  async resolveLinkDestination(destination) {
    const renderer = this.renderer;
    const pdfDoc = renderer.model.pdfDoc;
    const pageCount = renderer.model.totalPages || pdfDoc.numPages;
    if (!Number.isInteger(pageCount) || pageCount < 1) return null;

    const knownPage = renderer.model.navigationMap?.resolveDestination(destination);
    if (Number.isInteger(knownPage) && knownPage > 0 && knownPage <= pageCount) return knownPage;

    const resolved = typeof destination === "string" ? await pdfDoc.getDestination?.(destination) : destination;
    if (!Array.isArray(resolved) || resolved.length === 0) return null;

    const pageReference = resolved[0];
    const pageIndex = Number.isInteger(pageReference) ? pageReference : await pdfDoc.getPageIndex?.(pageReference);
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pageCount) return null;
    return pageIndex + 1;
  }

  renderPageErrorState(pageWrapper, pageNumber, effectiveScale, _generation) {
    const renderer = this.renderer;
    pageWrapper.innerHTML = "";
    const errContainer = document.createElement("div");
    errContainer.className = "pdf-page-render-error";
    Object.assign(errContainer.style, {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "24px",
      textAlign: "center",
      color: "var(--text-secondary, #64748b)",
      width: "100%",
      height: "100%",
      minHeight: "280px",
      background: "var(--bg-secondary, rgba(0, 0, 0, 0.03))",
      borderRadius: "8px",
    });

    const iconWrap = document.createElement("div");
    iconWrap.style.marginBottom = "8px";
    iconWrap.innerHTML =
      '<svg class="ui-icon" aria-hidden="true" focusable="false" style="width:32px;height:32px;"><use href="./icons.svg#warning"></use></svg>';

    const msg = document.createElement("p");
    msg.textContent = `No se pudo dibujar la página ${pageNumber}.`;
    msg.style.margin = "0 0 12px 0";
    msg.style.fontWeight = "500";

    const retryBtn = document.createElement("button");
    retryBtn.type = "button";
    retryBtn.className = "btn btn-secondary retry-page-render-btn";
    retryBtn.textContent = "Reintentar página";
    retryBtn.style.cursor = "pointer";
    retryBtn.onclick = (e) => {
      e.stopPropagation();
      delete pageWrapper.dataset.renderState;
      renderer.populatePageWrapper(pageWrapper, pageNumber, effectiveScale, renderer.renderGeneration);
    };

    errContainer.appendChild(iconWrap);
    errContainer.appendChild(msg);
    errContainer.appendChild(retryBtn);
    pageWrapper.appendChild(errContainer);
  }

  async renderTextLayer(pageWrapper, page, pageNumber, width, height, viewport, effectiveScale, generation) {
    const renderer = this.renderer;
    const textLayerDiv = TextLayerView.createTextLayerContainer(width, height, viewport.scale);
    pageWrapper.style.setProperty("--scale-factor", viewport.scale);
    pageWrapper.appendChild(textLayerDiv);

    const layoutData = await api
      .getPageLayout(renderer.model.bookId, pageNumber, renderer.model.totalPages)
      .catch(() => null);

    if (!renderer.isCurrentGeneration(generation)) return;
    if (layoutData?.words?.length > 0) {
      const lines =
        layoutData.lines?.length > 0 && Array.isArray(layoutData.lines[0].words)
          ? layoutData.lines
          : TextLayerView.groupWordsIntoLines(layoutData.words);
      TextLayerView.renderPreciseLines(textLayerDiv, lines, effectiveScale);
    } else {
      const textContent = await page.getTextContent();
      if (pdfjsLib.TextLayer) {
        const textLayer = new pdfjsLib.TextLayer({
          textContentSource: textContent,
          container: textLayerDiv,
          viewport,
        });
        await textLayer.render();
      }
    }

    if (
      renderer.isCurrentGeneration(generation) &&
      typeof renderer.linkCallbacks.onTextReferenceNavigate === "function"
    ) {
      try {
        TextLayerView.decorateCrossReferences(
          textLayerDiv,
          renderer.model.navigationMap,
          pageNumber,
          renderer.linkCallbacks.onTextReferenceNavigate,
        );
      } catch (error) {
        console.error(`[ReaderPageRenderer] Could not link text references on page ${pageNumber}:`, error);
      }
    }
  }
}

window.ReaderPageLayerBuilder = ReaderPageLayerBuilder;
