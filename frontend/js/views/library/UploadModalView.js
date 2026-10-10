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
      uploading: ['loader', item => `Uploading ${item.progress || 0}%`],
      queued: ['loader', 'Queued for processing'],
      processing: ['loader', 'Processing on server'],
      done: ['circle-check', 'Imported'],
      error: ['warning', 'Import failed'],
    };

    queue.forEach(item => {
      const [icon, label] = states[item.status] || states.pending;
      const row = document.createElement('div');
      row.className = `upload-queue-item upload-queue-item-${item.status}`;

      const details = document.createElement('div');
      details.className = 'upload-queue-details';
      const statusIcon = document.createElement('span');
      statusIcon.className = 'upload-queue-status';
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', `ui-icon${['uploading', 'queued', 'processing'].includes(item.status) ? ' ui-icon-spin' : ''}`);
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
      }

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'btn btn-icon remove-upload-item-btn';
      removeBtn.title = 'Remove from upload list';
      removeBtn.setAttribute('aria-label', `Remove ${item.name} from upload list`);
      removeBtn.disabled = !['pending', 'error'].includes(item.status);
      const removeSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      removeSvg.setAttribute('class', 'ui-icon');
      removeSvg.setAttribute('aria-hidden', 'true');
      removeSvg.setAttribute('focusable', 'false');
      const removeUse = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      removeUse.setAttribute('href', './icons.svg#close');
      removeSvg.appendChild(removeUse);
      removeBtn.appendChild(removeSvg);
      removeBtn.onclick = () => onRemove?.(item.id);

      row.append(details, status, removeBtn);
      container.appendChild(row);
    });
  }
};

window.UploadModalView = UploadModalView;
