/**
 * ReaderHUDView.js
 * Updates reader heads-up display, page scrubbers, tool buttons, and input device pills.
 */
const ReaderHUDView = {
  updateBookInfo(titleElement, authorElement, book, fallbackTitle = 'Book') {
    if (titleElement) titleElement.textContent = book?.title || fallbackTitle;
    if (authorElement) authorElement.textContent = book?.authors || '';
  },

  updatePageDisplay(pageInput, pageTotal, scrubber, pageText, page, total) {
    const pct = total > 0 ? Math.round((page / total) * 100) : 0;
    if (scrubber) {
      scrubber.max = total;
      scrubber.value = page;
    }
    if (pageInput && document.activeElement !== pageInput) {
      pageInput.value = page;
    }
    if (pageTotal) {
      pageTotal.textContent = `of ${total}`;
    }
    if (pageText) {
      pageText.textContent = `/ ${total} (${pct}%)`;
    }
  },

  updatePageShortcuts(container, currentPage, totalPages, onSelect) {
    if (!container) return;
    container.replaceChildren();
    container.hidden = totalPages < 2;
    if (container.hidden) return;

    const visiblePages = Math.min(5, totalPages);
    const firstPage = Math.min(
      Math.max(1, currentPage - Math.floor(visiblePages / 2)),
      totalPages - visiblePages + 1
    );
    const buttons = document.createDocumentFragment();

    for (let page = firstPage; page < firstPage + visiblePages; page += 1) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'page-shortcut';
      button.textContent = String(page);
      button.title = `Go to page ${page}`;
      button.setAttribute('aria-label', `Go to page ${page}`);
      if (page === currentPage) {
        button.classList.add('active');
        button.setAttribute('aria-current', 'page');
      }
      button.addEventListener('click', () => onSelect(page));
      buttons.appendChild(button);
    }

    container.appendChild(buttons);
  },

  updateDrawToolButtons(toolButtons, activeTool) {
    const { penBtn, highlighterBtn, eraserBtn, panBtn } = toolButtons;
    penBtn?.classList.toggle('active', activeTool === 'pen');
    highlighterBtn?.classList.toggle('active', activeTool === 'highlighter');
    eraserBtn?.classList.toggle('active', activeTool === 'eraser');
    panBtn?.classList.toggle('active', activeTool === 'pan');
  },

  updateColorDots(dots, activeColorHex) {
    dots.forEach(dot => {
      dot.classList.toggle('active', dot.dataset.color.toLowerCase() === activeColorHex.toLowerCase());
    });
  },

  updateWidthButtons(btns, activeWidth) {
    btns.forEach(btn => {
      btn.classList.toggle('active', Number(btn.dataset.width) === activeWidth);
    });
  },

  updateDevicePill(devicePill, deviceIcon, deviceLabel, inputType) {
    if (inputType === 'pen') {
      if (deviceIcon) deviceIcon.innerHTML = '<svg class="drawing-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg>';
      if (deviceLabel) deviceLabel.textContent = 'Digital Pen';
      if (devicePill) devicePill.classList.add('pen-active');
    } else {
      if (deviceIcon) deviceIcon.innerHTML = '<svg class="drawing-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="5" y="3" width="14" height="18" rx="7"/><path d="M12 3v6"/></svg>';
      if (deviceLabel) deviceLabel.textContent = 'Mouse / PC';
      if (devicePill) devicePill.classList.remove('pen-active');
    }
  },


};

window.ReaderHUDView = ReaderHUDView;
