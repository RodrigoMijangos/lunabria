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

      const statusIcon = item.status === 'done' ? '✅' : item.status === 'uploading' ? '⏳' : item.status === 'error' ? '❌' : '📄';

      el.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          <span>${statusIcon}</span>
          <span style="font-weight: 600; max-width: 280px; overflow: hidden; text-overflow: ellipsis;">${item.name}</span>
          <span style="font-size: 0.76rem; color: var(--text-secondary);">(${LibraryModel.formatFileSize(item.size)})</span>
        </div>
        <button type="button" class="btn btn-icon remove-upload-item-btn" title="Remove from queue" style="padding: 2px 6px; font-size: 0.8rem;">✕</button>
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
