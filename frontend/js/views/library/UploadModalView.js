/**
 * UploadModalView.js
 * Renders the upload queue list and status badges.
 */
const UploadModalView = {
  renderQueue(container, queue, onRemove) {
    if (!container) return;
    container.innerHTML = '';
    if (!queue || !queue.length) return;

    queue.forEach(item => {
      const el = document.createElement('div');
      el.className = 'upload-queue-item';

      const statusIcon = item.status === 'done' ? 'circle-check' : item.status === 'uploading' ? 'loader' : item.status === 'error' ? 'warning' : 'file';
      const statusClass = item.status === 'uploading' ? ' ui-icon-spin' : '';

      el.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          <span class="upload-queue-status"><svg class="ui-icon${statusClass}" aria-hidden="true" focusable="false"><use href="./icons.svg#${statusIcon}"></use></svg></span>
          <span style="font-weight: 600; max-width: 280px; overflow: hidden; text-overflow: ellipsis;">${item.name}</span>
          <span style="font-size: 0.76rem; color: var(--text-secondary);">(${LibraryModel.formatFileSize(item.size)})</span>
        </div>
        <button type="button" class="btn btn-icon remove-upload-item-btn" title="Remove from queue" aria-label="Remove file from queue" style="padding: 2px 6px; font-size: 0.8rem;"><svg class="ui-icon" aria-hidden="true" focusable="false"><use href="./icons.svg#close"></use></svg></button>
      `;

      const removeBtn = el.querySelector('.remove-upload-item-btn');
      if (removeBtn) {
        removeBtn.onclick = () => {
          if (onRemove) onRemove(item.id);
        };
      }

      container.appendChild(el);
    });
  }
};

window.UploadModalView = UploadModalView;
