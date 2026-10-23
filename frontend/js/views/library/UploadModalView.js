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
  }
};

window.UploadModalView = UploadModalView;
