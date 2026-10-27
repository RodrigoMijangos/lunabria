/**
 * UploadModalView.js
 * Renders the upload queue list and background processing status.
 */
const UploadModalView = {
  renderQueue(container, queue, onRemove) {
    if (!container) return;
    container.replaceChildren();
    if (!queue || !queue.length) return;

    const states = {
      pending: ['file', 'Waiting to upload'],
      uploading: ['loader', item => (item.progress >= 100 ? 'Staging on server...' : `Uploading ${item.progress || 0}%`)],
      sent: ['loader', 'Sent, awaiting server...'],
      queued: ['loader', 'Queued for processing'],
      processing: ['loader', 'Processing on server'],
      done: ['circle-check', 'Imported'],
      error: ['warning', 'Import failed'],
      skipped: ['warning', item => item.error || 'Omitted'],
    };

    queue.forEach(item => {
      const [icon, label] = states[item.status] || states.pending;
      const row = document.createElement('div');
      row.className = `upload-queue-item upload-queue-item-${item.status}`;
      row.dataset.queueId = item.id;

      const rowTop = document.createElement('div');
      rowTop.className = 'upload-queue-row-top';

      const details = document.createElement('div');
      details.className = 'upload-queue-details';
      const statusIcon = document.createElement('span');
      statusIcon.className = 'upload-queue-status';
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', `ui-icon${['uploading', 'sent', 'queued', 'processing'].includes(item.status) ? ' ui-icon-spin' : ''}`);
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('focusable', 'false');
      const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      use.setAttribute('href', `./icons.svg#${icon}`);
      svg.appendChild(use);
      statusIcon.appendChild(svg);

      const name = document.createElement('span');
      name.className = 'upload-queue-name';
      name.textContent = item.name;
      name.title = item.name;

      const size = document.createElement('span');
      size.className = 'upload-queue-size';
      size.textContent = `(${LibraryModel.formatFileSize(item.size)})`;
      details.append(statusIcon, name, size);

      const status = document.createElement('span');
      status.className = 'upload-queue-label';
      status.textContent = typeof label === 'function' ? label(item) : label;
      if (item.status === 'error' && item.error) {
        status.textContent += `: ${item.error}`;
        status.title = item.error;
      } else if (item.status === 'skipped' && item.error) {
        status.textContent = item.error;
        status.title = item.error;
      }

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'btn btn-icon remove-upload-item-btn';
      removeBtn.title = ['uploading', 'sent'].includes(item.status) ? 'Cancel this upload' : 'Remove from upload list';
      removeBtn.setAttribute('aria-label', `${['uploading', 'sent'].includes(item.status) ? 'Cancel upload' : 'Remove'} ${item.name}`);
      removeBtn.disabled = ['queued', 'processing', 'done'].includes(item.status);
      const removeSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      removeSvg.setAttribute('class', 'ui-icon');
      removeSvg.setAttribute('aria-hidden', 'true');
      removeSvg.setAttribute('focusable', 'false');
      const removeUse = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      removeUse.setAttribute('href', './icons.svg#close');
      removeSvg.appendChild(removeUse);
      removeBtn.appendChild(removeSvg);
      removeBtn.onclick = () => onRemove?.(item.id);

      rowTop.append(details, status, removeBtn);
      row.append(rowTop);

      if (['uploading', 'sent', 'processing'].includes(item.status)) {
        const progressTrack = document.createElement('div');
        progressTrack.className = 'upload-queue-progress-track';
        const progressFill = document.createElement('div');
        const isStaging = item.status === 'sent' || (item.status === 'uploading' && item.progress >= 100);
        const isIndeterminate = item.status === 'processing' || isStaging;
        progressFill.className = `upload-queue-progress-fill${isIndeterminate ? ' is-indeterminate' : ''}`;
        progressFill.style.width = item.status === 'processing' ? '40%' : `${isStaging ? 100 : Math.max(0, Math.min(100, item.progress || 0))}%`;
        progressTrack.appendChild(progressFill);
        row.appendChild(progressTrack);
      }

      container.appendChild(row);
    });
  },

  updateItemProgress(container, item) {
    if (!container || !item || typeof container.querySelector !== 'function') return false;
    const row = container.querySelector(`[data-queue-id="${item.id}"]`);
    if (!row) return false;

    const label = row.querySelector('.upload-queue-label');
    if (label) {
      if (item.status === 'sent') {
        label.textContent = 'Sent, awaiting server...';
      } else if (item.progress >= 100) {
        label.textContent = 'Staging on server...';
      } else {
        label.textContent = `Uploading ${item.progress || 0}%`;
      }
    }

    let fill = row.querySelector('.upload-queue-progress-fill');
    const isStaging = item.status === 'sent' || (item.status === 'uploading' && item.progress >= 100);
    const isIndeterminate = item.status === 'processing' || isStaging;
    if (fill) {
      if (isStaging) {
        fill.style.width = '100%';
        if (fill.classList && typeof fill.classList.add === 'function') {
          fill.classList.add('is-indeterminate');
        }
      } else if (item.status === 'processing') {
        fill.style.width = '40%';
        if (fill.classList && typeof fill.classList.add === 'function') {
          fill.classList.add('is-indeterminate');
        }
      } else {
        fill.style.width = `${Math.max(0, Math.min(100, item.progress || 0))}%`;
        if (fill.classList && typeof fill.classList.remove === 'function') {
          fill.classList.remove('is-indeterminate');
        }
      }
    } else {
      const progressTrack = document.createElement('div');
      progressTrack.className = 'upload-queue-progress-track';
      fill = document.createElement('div');
      fill.className = `upload-queue-progress-fill${isIndeterminate ? ' is-indeterminate' : ''}`;
      fill.style.width = isStaging ? '100%' : (item.status === 'processing' ? '40%' : `${Math.max(0, Math.min(100, item.progress || 0))}%`);
      progressTrack.appendChild(fill);
      row.appendChild(progressTrack);
    }
    return true;
  },

  updateBackgroundIndicator({ queue = [], activeJobsCount = 0, isModalOpen = false, justCompletedTimestamp = null, onOpenModal } = {}) {
    if (typeof document === 'undefined' || !document?.body || typeof document.createElement !== 'function') {
      return;
    }

    const uploadingItems = queue.filter(item => ['uploading', 'sent'].includes(item.status));
    const processingItems = queue.filter(item => ['queued', 'processing'].includes(item.status));
    const hasActiveBackground = uploadingItems.length > 0 || processingItems.length > 0 || activeJobsCount > 0;

    let dock = document.getElementById('upload-background-dock');

    // Update navbar badge if #upload-btn exists
    const uploadBtn = document.getElementById('upload-btn');
    if (uploadBtn && typeof uploadBtn.querySelector === 'function') {
      let badge = uploadBtn.querySelector('.upload-btn-badge');
      if (hasActiveBackground) {
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'upload-btn-badge';
          uploadBtn.appendChild(badge);
        }
        const activeCount = uploadingItems.length + Math.max(processingItems.length, activeJobsCount);
        badge.textContent = `${activeCount}`;
        badge.title = `${activeCount} book${activeCount === 1 ? '' : 's'} in background`;
      } else if (badge && typeof badge.remove === 'function') {
        badge.remove();
      }
    }

    if (isModalOpen || (!hasActiveBackground && !justCompletedTimestamp)) {
      if (dock) dock.style.display = 'none';
      return;
    }

    if (!dock) {
      dock = document.createElement('div');
      dock.id = 'upload-background-dock';
      dock.className = 'upload-background-dock';
      dock.setAttribute('role', 'status');
      dock.setAttribute('aria-live', 'polite');
      document.body.appendChild(dock);
    }

    dock.style.display = 'flex';

    let titleText = '';
    let percent = 0;
    let isProcessing = false;

    if (uploadingItems.length > 0) {
      const activeItem = uploadingItems[0];
      percent = activeItem.progress || 0;
      const isStaging = percent >= 100 || activeItem.status === 'sent';
      if (isStaging) {
        titleText = uploadingItems.length === 1
          ? `Staging: ${activeItem.name}...`
          : `Staging ${uploadingItems.length} books on server...`;
        isProcessing = true;
      } else {
        titleText = uploadingItems.length === 1
          ? `Uploading: ${activeItem.name} (${percent}%)`
          : `Uploading ${uploadingItems.length} books (${percent}%)`;
      }
    } else if (processingItems.length > 0 || activeJobsCount > 0) {
      const count = Math.max(processingItems.length, activeJobsCount);
      titleText = count === 1
        ? 'Processing metadata with Calibre...'
        : `Processing ${count} books with Calibre...`;
      isProcessing = true;
      percent = 100;
    } else if (justCompletedTimestamp) {
      titleText = 'All books imported successfully';
      percent = 100;
    }

    if (typeof dock.replaceChildren === 'function') {
      dock.replaceChildren();
    } else {
      dock.innerHTML = '';
    }

    const header = document.createElement('div');
    header.className = 'upload-dock-header';

    const info = document.createElement('div');
    info.className = 'upload-dock-info';

    const iconSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    iconSvg.setAttribute('class', `ui-icon${isProcessing || uploadingItems.length > 0 ? ' ui-icon-spin' : ''}`);
    iconSvg.setAttribute('aria-hidden', 'true');
    const iconUse = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    iconUse.setAttribute('href', isProcessing || uploadingItems.length > 0 ? './icons.svg#loader' : './icons.svg#circle-check');
    iconSvg.appendChild(iconUse);

    const title = document.createElement('span');
    title.className = 'upload-dock-title';
    title.textContent = titleText;
    title.title = titleText;

    info.append(iconSvg, title);

    const dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.className = 'upload-dock-dismiss-btn';
    dismissBtn.setAttribute('aria-label', 'Dismiss background upload widget');
    dismissBtn.textContent = '×';
    dismissBtn.onclick = (e) => {
      e.stopPropagation();
      dock.style.display = 'none';
    };

    header.append(info, dismissBtn);

    const track = document.createElement('div');
    track.className = 'upload-dock-progress-track';
    const fill = document.createElement('div');
    fill.className = `upload-dock-progress-fill${isProcessing ? ' is-indeterminate' : ''}`;
    fill.style.width = isProcessing ? '40%' : `${percent}%`;
    track.appendChild(fill);

    dock.append(header, track);
    dock.onclick = (e) => {
      if (e.target.closest?.('.upload-dock-dismiss-btn')) return;
      onOpenModal?.();
    };
  }
};

window.UploadModalView = UploadModalView;
