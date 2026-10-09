/**
 * MobileDrawingToolbarView.js
 * Implements the single-button collapsible FAB for mobile drawing:
 * - Reflects active tool
 * - Pen state: background = drawColor, border thickness = drawWidth px
 * - Unfolds basic tools: Pen, Eraser, Move (Pan)
 * - Undo button always below collapsed button; hidden when expanded
 * - Contextual color picker on pen tap; dismissed automatically when drawing starts
 */
class MobileDrawingToolbarView {
  constructor(readerViewModel, model) {
    this.reader = readerViewModel;
    this.model = model;

    this.isExpanded = false;
    this.isColorMenuOpen = false;

    this.container = null;
    this.mainBtn = null;
    this.mainIcon = null;
    this.undoBtn = null;
    this.toolsDrawer = null;
    this.colorMenu = null;

    // Available palette colors
    this.paletteColors = [
      '#1e293b', // Black / Dark Slate
      '#2563eb', // Blue
      '#dc2626', // Red
      '#eab308', // Yellow
      '#16a34a', // Green
      '#9333ea'  // Purple
    ];
  }

  init() {
    this.container = document.getElementById('mobile-draw-fab-container');
    this.mainBtn = document.getElementById('mobile-draw-main-btn');
    this.mainIcon = document.getElementById('mobile-draw-main-icon');
    this.undoBtn = document.getElementById('mobile-draw-undo-btn');
    this.toolsDrawer = document.getElementById('mobile-draw-tools-drawer');
    this.colorMenu = document.getElementById('mobile-color-contextual-menu');

    this.bindEvents();
    this.render();
  }

  bindEvents() {
    // Main button toggle
    this.mainBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!this.isExpanded) {
        this.setExpanded(true);
        this.closeColorMenu();
      } else {
        if (this.model.drawTool === 'pen' && !this.isColorMenuOpen) {
          this.toggleColorMenu(true);
        } else {
          this.setExpanded(false);
          this.closeColorMenu();
        }
      }
    });

    // Undo button
    this.undoBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.reader.drawing.undoLastStroke();
    });

    // Tool item clicks
    document.getElementById('mobile-tool-pen')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const wasAlreadyPen = this.model.drawTool === 'pen';
      if (!wasAlreadyPen) {
        this.reader.drawing.setDrawTool('pen');
        this.setExpanded(false);
        this.closeColorMenu();
      } else {
        if (!this.isColorMenuOpen) {
          this.toggleColorMenu(true);
        } else {
          this.closeColorMenu();
          this.setExpanded(false);
        }
      }
      this.render();
      this.syncActiveDrawingMode();
    });

    document.getElementById('mobile-tool-eraser')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.reader.drawing.setDrawTool('eraser');
      this.closeColorMenu();
      this.setExpanded(false);
      this.render();
      this.syncActiveDrawingMode();
    });

    document.getElementById('mobile-tool-pan')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.reader.drawing.setDrawTool('pan');
      this.closeColorMenu();
      this.setExpanded(false);
      this.render();
      this.syncActiveDrawingMode();
    });

    // Dismiss contextual color menu and drawer when tapping outside
    const handleOutside = (target) => {
      if (this.container && !this.container.contains(target)) {
        if (this.isColorMenuOpen) this.closeColorMenu();
        if (this.isExpanded) this.setExpanded(false);
      }
    };
    document.addEventListener('pointerdown', (e) => handleOutside(e.target));
    document.addEventListener('touchstart', (e) => {
      if (e.touches && e.touches[0]) handleOutside(e.touches[0].target);
    }, { passive: true });

    // Dismiss contextual color menu and drawer when drawing or touching the viewport
    const viewport = this.reader?.viewportEl || document.getElementById('pdf-viewport');
    const dismissIfOpen = (e) => {
      if (this.isColorMenuOpen || this.isExpanded) {
        if (this.isColorMenuOpen) {
          this.closeColorMenu();
        }
        if (this.isExpanded) {
          this.setExpanded(false);
        }
        if (e) {
          e.stopPropagation();
          if (typeof e.preventDefault === 'function') {
            e.preventDefault();
          }
        }
      }
    };
    viewport?.addEventListener('pointerdown', dismissIfOpen, { capture: true });
    viewport?.addEventListener('touchstart', dismissIfOpen, { capture: true });

    this.populateColorSwatches();
  }

  syncActiveDrawingMode() {
    const isDrawing = this.model.drawTool === 'pen' || this.model.drawTool === 'eraser';
    if (isDrawing && !this.model.isDrawMode) {
      this.reader?.drawing?.toggleDrawMode(true);
    }
    const isReaderOpen = !this.reader?.container || this.reader.container.style.display !== 'none';
    const active = isDrawing && isReaderOpen;
    document.body.classList.toggle('mobile-drawing-active', active);
    const viewport = this.reader.viewportEl || document.getElementById('pdf-viewport');
    viewport?.classList.toggle('mobile-drawing-active', active);
  }

  populateColorSwatches() {
    if (!this.colorMenu) return;
    this.colorMenu.innerHTML = '';

    for (const hex of this.paletteColors) {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'mobile-color-swatch';
      swatch.dataset.color = hex;
      swatch.style.backgroundColor = hex;
      swatch.title = `Color ${hex}`;
      swatch.setAttribute('aria-label', `Color ${hex}`);

      if (this.model.drawColor.toLowerCase() === hex.toLowerCase()) {
        swatch.classList.add('active');
      }

      swatch.addEventListener('click', (e) => {
        e.stopPropagation();
        this.reader.drawing.setDrawColor(hex);
        this.closeColorMenu();
        this.setExpanded(false);
        this.render();
      });

      this.colorMenu.appendChild(swatch);
    }
  }

  setExpanded(state) {
    this.isExpanded = Boolean(state);
    if (!this.isExpanded) {
      this.closeColorMenu();
    }
    this.toolsDrawer?.classList.toggle('open', this.isExpanded);

    // Requirement: Undo button is always below the simple button and disappears in the expanded context
    if (this.undoBtn) {
      this.undoBtn.style.display = this.isExpanded ? 'none' : 'flex';
    }
  }

  toggleColorMenu(force = null) {
    const next = force !== null ? force : !this.isColorMenuOpen;
    this.isColorMenuOpen = next;
    this.colorMenu?.classList.toggle('open', this.isColorMenuOpen);
  }

  closeColorMenu() {
    this.isColorMenuOpen = false;
    this.colorMenu?.classList.remove('open');
  }

  render() {
    if (!this.mainBtn) return;

    const tool = this.model.drawTool || 'pan';
    const isPen = tool === 'pen';
    const color = this.model.drawColor || '#1e293b';
    const width = Math.max(1, Math.min(10, this.model.drawWidth || 4));

    // Update main button icon
    if (this.mainIcon) {
      this.mainIcon.innerHTML = this.getToolIconSvg(tool, isPen ? '#ffffff' : 'currentColor');
    }

    // Dynamic styling for Pen tool: background = color, border = width px
    if (isPen) {
      this.mainBtn.classList.add('is-pen-tool');
      this.mainBtn.style.backgroundColor = color;
      this.mainBtn.style.borderWidth = `${width}px`;
      this.mainBtn.style.borderColor = 'rgba(255, 255, 255, 0.9)';
      this.mainBtn.title = `Lápiz activo (${color}, ${width}px) — Toca para desplegar`;
    } else {
      this.mainBtn.classList.remove('is-pen-tool');
      this.mainBtn.style.backgroundColor = '';
      this.mainBtn.style.borderWidth = '2px';
      this.mainBtn.style.borderColor = '';
      this.mainBtn.title = `${tool === 'eraser' ? 'Borrador' : 'Mover'} activo — Toca para desplegar`;
    }

    // Update active classes on drawer items and exclude currently active tool
    const penEl = document.getElementById('mobile-tool-pen');
    const eraserEl = document.getElementById('mobile-tool-eraser');
    const panEl = document.getElementById('mobile-tool-pan');

    if (penEl) {
      penEl.classList.toggle('active', isPen);
      penEl.style.display = isPen ? 'none' : 'flex';
    }
    if (eraserEl) {
      eraserEl.classList.toggle('active', tool === 'eraser');
      eraserEl.style.display = tool === 'eraser' ? 'none' : 'flex';
    }
    if (panEl) {
      panEl.classList.toggle('active', tool === 'pan');
      panEl.style.display = tool === 'pan' ? 'none' : 'flex';
    }

    // Update active swatch
    this.colorMenu?.querySelectorAll('.mobile-color-swatch').forEach(swatch => {
      swatch.classList.toggle('active', swatch.dataset.color.toLowerCase() === color.toLowerCase());
    });

    this.syncActiveDrawingMode();
  }

  getToolIconSvg(tool, strokeColor = 'currentColor') {
    switch (tool) {
      case 'pen':
        return `<svg class="drawing-icon" viewBox="0 0 24 24" fill="none" stroke="${strokeColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg>`;
      case 'eraser':
        return `<svg class="drawing-icon" viewBox="0 0 24 24" fill="none" stroke="${strokeColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m7 21-4.3-4.3a2.4 2.4 0 0 1 0-3.4l7.6-7.6a2.4 2.4 0 0 1 3.4 0l6.6 6.6a2.4 2.4 0 0 1 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5.5 11.5 7 7"/></svg>`;
      case 'pan':
      default:
        return `<svg class="drawing-icon" viewBox="0 0 24 24" fill="none" stroke="${strokeColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 2v20M2 12h20"/><path d="m8 6 4-4 4 4M8 18l4 4 4-4M6 8l-4 4 4 4M18 8l4 4-4 4"/></svg>`;
    }
  }
}

window.MobileDrawingToolbarView = MobileDrawingToolbarView;
