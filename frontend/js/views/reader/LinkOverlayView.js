class LinkOverlayView {
  constructor(pageWrapper, links, viewport, model, drawingCoordinator, onNavigate) {
    this.pageWrapper = pageWrapper;
    this.links = links;
    this.viewport = viewport;
    this.model = model;
    this.drawingCoordinator = drawingCoordinator;
    this.onNavigate = onNavigate;
    this.layer = document.createElement('div');
    this.layer.className = 'pdf-link-layer';
    this.positionedLinks = [];
    this.activePointer = null;
    this.cursorTarget = null;
    this.originalCursor = '';
    this.handleGestureMove = event => this.trackGestureMove(event);
    this.handleGestureEnd = event => this.finishGesture(event);
    this.handleGestureCancel = event => this.cancelGesture(event);
  }

  render() {
    const positionedLinks = [];
    for (const link of this.links) {
      let bounds;
      try {
        bounds = this.toViewportBounds(link.rect);
      } catch (error) {
        console.warn('[LinkOverlayView] Could not position an internal PDF link:', error);
        continue;
      }
      if (!bounds) continue;
      positionedLinks.push({ ...link, bounds: this.expandBounds(bounds) });
    }
    positionedLinks.sort((a, b) => a.bounds.top - b.bounds.top || a.bounds.left - b.bounds.left);

    for (const link of positionedLinks) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'pdf-internal-link';
      button.style.left = `${link.bounds.left}px`;
      button.style.top = `${link.bounds.top}px`;
      button.style.width = `${link.bounds.width}px`;
      button.style.height = `${link.bounds.height}px`;
      button.setAttribute('aria-label', link.label || `Go to page ${link.targetPage}`);
      button.title = link.label || `Go to page ${link.targetPage}`;
      button.addEventListener('click', event => {
        event.preventDefault();
        this.activate(link);
      });
      this.layer.appendChild(button);
      link.button = button;
    }

    this.positionedLinks = positionedLinks;
    if (!positionedLinks.length) return null;

    this.pageWrapper.addEventListener('pointerdown', event => this.startGesture(event));
    this.pageWrapper.addEventListener('pointermove', event => this.updatePointerCursor(event));
    this.pageWrapper.addEventListener('pointerleave', () => this.restorePointerCursor());
    return this.layer;
  }

  toViewportBounds(rect) {
    if (!Array.isArray(rect) || rect.length !== 4 || !rect.every(Number.isFinite)) return null;
    if (typeof this.viewport.convertToViewportRectangle !== 'function') return null;
    if (!Number.isFinite(this.viewport.width) || !Number.isFinite(this.viewport.height)) return null;

    const converted = this.viewport.convertToViewportRectangle(rect);
    if (!Array.isArray(converted) || converted.length !== 4 || !converted.every(Number.isFinite)) return null;
    const left = Math.max(0, Math.min(converted[0], converted[2]));
    const top = Math.max(0, Math.min(converted[1], converted[3]));
    const right = Math.min(this.viewport.width, Math.max(converted[0], converted[2]));
    const bottom = Math.min(this.viewport.height, Math.max(converted[1], converted[3]));
    if (right <= left || bottom <= top) return null;
    return { left, top, width: right - left, height: bottom - top };
  }

  expandBounds(bounds) {
    const width = Math.min(this.viewport.width, Math.max(24, bounds.width));
    const height = Math.min(this.viewport.height, Math.max(24, bounds.height));
    return {
      left: Math.max(0, Math.min(this.viewport.width - width, bounds.left - (width - bounds.width) / 2)),
      top: Math.max(0, Math.min(this.viewport.height - height, bounds.top - (height - bounds.height) / 2)),
      width,
      height
    };
  }

  getLinkAt(clientX, clientY) {
    const pageRect = this.pageWrapper.getBoundingClientRect();
    if (!pageRect.width || !pageRect.height) return null;
    const pageWidth = Number.parseFloat(this.pageWrapper.style.width) || pageRect.width;
    const pageHeight = Number.parseFloat(this.pageWrapper.style.height) || pageRect.height;
    const x = (clientX - pageRect.left) * pageWidth / pageRect.width;
    const y = (clientY - pageRect.top) * pageHeight / pageRect.height;
    return this.positionedLinks
      .filter(link => x >= link.bounds.left && x <= link.bounds.left + link.bounds.width &&
        y >= link.bounds.top && y <= link.bounds.top + link.bounds.height)
      .sort((a, b) => a.bounds.width * a.bounds.height - b.bounds.width * b.bounds.height)[0] || null;
  }

  allowsPointerNavigation(event) {
    if (!this.model.isDrawMode) return true;
    return event.pointerType === 'touch' && this.model.drawTool === 'pan';
  }

  startGesture(event) {
    if (event.button !== 0 || event.isPrimary === false || !this.allowsPointerNavigation(event)) return;
    const link = this.getLinkAt(event.clientX, event.clientY);
    if (!link) return;

    this.activePointer = {
      id: event.pointerId,
      pointerType: event.pointerType || 'mouse',
      link,
      x: event.clientX,
      y: event.clientY,
      startedAt: Number.isFinite(event.timeStamp) ? event.timeStamp : Date.now(),
      maxDistance: 0
    };
    window.addEventListener('pointermove', this.handleGestureMove, true);
    window.addEventListener('pointerup', this.handleGestureEnd, true);
    window.addEventListener('pointercancel', this.handleGestureCancel, true);
  }

  trackGestureMove(event) {
    const pointer = this.activePointer;
    if (!pointer || (pointer.id != null && event.pointerId !== pointer.id)) return;
    pointer.maxDistance = Math.max(pointer.maxDistance, Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y));
  }

  finishGesture(event) {
    const pointer = this.activePointer;
    if (!pointer || (pointer.id != null && event.pointerId !== pointer.id)) return;
    this.removeGestureListeners();

    if (this.pageWrapper.isConnected === false || !this.allowsPointerNavigation(pointer)) return;
    if (this.drawingCoordinator?.isDrawing) return;
    const duration = Math.max(0, (Number.isFinite(event.timeStamp) ? event.timeStamp : Date.now()) - pointer.startedAt);
    const distance = Math.max(pointer.maxDistance, Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y));
    if (distance > 8 || (pointer.pointerType === 'touch' && duration >= 400)) return;
    if (this.getLinkAt(event.clientX, event.clientY) !== pointer.link) return;
    this.activate(pointer.link);
  }

  cancelGesture(event) {
    if (this.activePointer && (this.activePointer.id == null || event.pointerId === this.activePointer.id)) {
      this.removeGestureListeners();
    }
  }

  removeGestureListeners() {
    this.activePointer = null;
    window.removeEventListener('pointermove', this.handleGestureMove, true);
    window.removeEventListener('pointerup', this.handleGestureEnd, true);
    window.removeEventListener('pointercancel', this.handleGestureCancel, true);
  }

  activate(link) {
    if (typeof this.onNavigate !== 'function') return;
    const sourcePage = Number(this.pageWrapper.dataset.page);
    this.onNavigate(link.targetPage, sourcePage, link);
  }

  updatePointerCursor(event) {
    if ((event.pointerType !== 'mouse' && event.pointerType !== 'pen') || this.model.isDrawMode) {
      this.restorePointerCursor();
      return;
    }
    const target = event.target;
    if (this.getLinkAt(event.clientX, event.clientY) && target?.style) {
      if (this.cursorTarget !== target) {
        this.restorePointerCursor();
        this.cursorTarget = target;
        this.originalCursor = target.style.cursor || '';
      }
      target.style.cursor = 'pointer';
    } else {
      this.restorePointerCursor();
    }
  }

  restorePointerCursor() {
    if (this.cursorTarget?.style) this.cursorTarget.style.cursor = this.originalCursor;
    this.cursorTarget = null;
    this.originalCursor = '';
  }
}

window.LinkOverlayView = LinkOverlayView;
