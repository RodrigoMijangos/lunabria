/**
 * ReaderSelectionLoupeView.js
 * Renders a magnified crop of the PDF below a text-selection pointer.
 */
class ReaderSelectionLoupeView {
  constructor(element = document.getElementById('reader-selection-loupe')) {
    this.element = element;
    this.canvas = element?.querySelector('canvas') || null;
    this.size = 144;
    this.zoom = 2.4;
  }

  update(clientX, clientY, pageWrapper) {
    if (!this.element || !this.canvas) return;
    const pageCanvas = pageWrapper.querySelector('.pdf-page-canvas');
    if (!pageCanvas || !pageCanvas.width || !pageCanvas.height) return;

    const pageRect = pageWrapper.getBoundingClientRect();
    const context = this.canvas.getContext('2d');
    if (!context || !pageRect.width || !pageRect.height) return;

    const scaleX = pageCanvas.width / pageRect.width;
    const scaleY = pageCanvas.height / pageRect.height;
    const sourceWidth = this.canvas.width / this.zoom;
    const sourceHeight = this.canvas.height / this.zoom;
    const centerX = (clientX - pageRect.left) * scaleX;
    const centerY = (clientY - pageRect.top) * scaleY;
    const sourceX = Math.max(0, Math.min(pageCanvas.width - sourceWidth, centerX - sourceWidth / 2));
    const sourceY = Math.max(0, Math.min(pageCanvas.height - sourceHeight, centerY - sourceHeight / 2));

    context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    context.drawImage(
      pageCanvas,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      this.canvas.width,
      this.canvas.height
    );

    const highlightedElement = this.drawHighlights(
      context,
      pageWrapper,
      pageRect,
      scaleX,
      scaleY,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      clientX,
      clientY
    );
    this.setTargetIndicator(highlightedElement);

    const left = Math.max(6, Math.min(window.innerWidth - this.size - 6, clientX - this.size / 2));
    const headerBottom = document.getElementById('reader-header')?.getBoundingClientRect().bottom || 0;
    const minTop = Math.min(headerBottom + 6, window.innerHeight - this.size - 6);
    let top = clientY - this.size - 24;
    if (top < minTop) top = clientY + 24;
    top = Math.max(minTop, Math.min(window.innerHeight - this.size - 6, top));
    this.element.style.left = `${left}px`;
    this.element.style.top = `${top}px`;
    this.element.style.display = 'block';
    this.element.setAttribute('aria-hidden', 'false');
  }

  drawHighlights(context, pageWrapper, pageRect, scaleX, scaleY, sourceX, sourceY, sourceWidth, sourceHeight, clientX, clientY) {
    const highlights = pageWrapper.querySelectorAll('.pdf-highlight-rect');
    const sourceRight = sourceX + sourceWidth;
    const sourceBottom = sourceY + sourceHeight;
    const outputScaleX = this.canvas.width / sourceWidth;
    const outputScaleY = this.canvas.height / sourceHeight;
    let highlightedElement = null;

    highlights.forEach(element => {
      const rect = element.getBoundingClientRect();
      const x = (rect.left - pageRect.left) * scaleX;
      const y = (rect.top - pageRect.top) * scaleY;
      const width = rect.width * scaleX;
      const height = rect.height * scaleY;
      const isUnderPointer = clientX >= rect.left && clientX <= rect.right &&
        clientY >= rect.top && clientY <= rect.bottom;

      if (isUnderPointer) highlightedElement = element;
      if (x + width <= sourceX || x >= sourceRight || y + height <= sourceY || y >= sourceBottom) return;

      const style = getComputedStyle(element);
      const blendMode = style.mixBlendMode === 'multiply' || style.mixBlendMode === 'screen'
        ? style.mixBlendMode
        : 'source-over';
      context.save();
      context.globalAlpha = Number.parseFloat(style.opacity) || 0;
      context.globalCompositeOperation = blendMode;
      context.fillStyle = style.backgroundColor;
      context.fillRect(
        (x - sourceX) * outputScaleX,
        (y - sourceY) * outputScaleY,
        width * outputScaleX,
        height * outputScaleY
      );
      context.restore();
    });

    return highlightedElement;
  }

  setTargetIndicator(highlightedElement) {
    if (!this.element) return;
    const isNote = highlightedElement?.title?.startsWith('Note: ');
    const label = highlightedElement ? (isNote ? 'Annotation' : 'Highlight') : '';
    this.element.dataset.targetLabel = label;
    this.element.classList.toggle('has-highlight-target', Boolean(highlightedElement));
    this.element.setAttribute('aria-label', label === 'Annotation'
      ? 'Loupe over an annotation'
      : label ? 'Loupe over a highlight' : 'Selection loupe');
  }

  hide() {
    if (!this.element) return;
    this.element.style.display = 'none';
    this.element.classList.remove('has-highlight-target');
    delete this.element.dataset.targetLabel;
    this.element.setAttribute('aria-label', 'Selection loupe');
    this.element.setAttribute('aria-hidden', 'true');
  }
}

window.ReaderSelectionLoupeView = ReaderSelectionLoupeView;
