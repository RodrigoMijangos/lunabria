/**
 * BookUploadManager.js
 * Manages drag & drop file uploads and background ingestion status.
 */
class BookUploadManager {
  constructor(model, onUploadSuccess) {
    this.model = model;
    this.onUploadSuccess = onUploadSuccess;
    this.isUploading = false;
    this.modal = typeof document !== 'undefined' ? document.getElementById('upload-modal') : null;
    this.activeJobs = new Map();
    this.jobPollTimer = null;
    this.maxConcurrentUploads = 2;
    this.jobPollIntervalMs = 2000;
    this.justCompletedTimestamp = null;
  }

  init() {
    if (typeof document === 'undefined') return;
    this.modal = document.getElementById('upload-modal');
    const dropzone = document.getElementById('upload-dropzone');
    const fileInput = document.getElementById('upload-file-input');
    const browseBtn = document.getElementById('upload-browse-btn');
    const cancelBtn = document.getElementById('upload-cancel-btn');
    const closeBtn = document.getElementById('upload-close-x-btn');
    const clearAllBtn = document.getElementById('upload-clear-all-btn');
    const sendBtn = document.getElementById('upload-send-btn');

    if (browseBtn && fileInput) {
      browseBtn.onclick = () => fileInput.click();
    }

    if (dropzone && fileInput) {
      dropzone.onclick = event => {
        if (this.isUploading) return;
        if (event.target.closest && event.target.closest('#upload-browse-btn')) return;
        fileInput.click();
      };
    }

    if (fileInput) {
      fileInput.onchange = event => {
        if (event.target.files?.length) {
          this.model.addFilesToUploadQueue(event.target.files);
          event.target.value = '';
          this.renderUploadQueue();
        }
      };
    }

    if (dropzone) {
      ['dragenter', 'dragover'].forEach(name => {
        dropzone.addEventListener(name, event => {
          event.preventDefault();
          dropzone.classList.add('drag-active');
        });
      });

      ['dragleave', 'drop'].forEach(name => {
        dropzone.addEventListener(name, event => {
          event.preventDefault();
          dropzone.classList.remove('drag-active');
        });
      });

      dropzone.addEventListener('drop', event => {
        if (this.isUploading) return;
        if (event.dataTransfer?.files?.length) {
          this.model.addFilesToUploadQueue(event.dataTransfer.files);
          this.renderUploadQueue();
        }
      });
    }

    if (cancelBtn) cancelBtn.onclick = () => this.closeUploadModal();
    if (closeBtn) closeBtn.onclick = () => this.closeUploadModal();

    if (this.modal && typeof this.modal.addEventListener === 'function') {
      this.modal.addEventListener('click', event => {
        if (event.target === this.modal) this.closeUploadModal();
      });
    }

    if (typeof document.addEventListener === 'function') {
      document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && this.modal?.classList?.contains?.('open')) {
          this.closeUploadModal();
        }
      });
    }

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('beforeunload', event => {
        if (this.isUploading) {
          event.preventDefault();
          event.returnValue = '';
        }
      });
    }

    if (clearAllBtn) {
      clearAllBtn.onclick = () => {
        if (!this.isUploading && !this.hasQueuedJobs()) {
          this.model.clearUploadQueue();
          this.renderUploadQueue();
        }
      };
    }
    if (sendBtn) sendBtn.onclick = () => this.startUploadBatch();

    this.restoreActiveJobs();
    this.updateBackgroundIndicator();
  }

  hasQueuedJobs() {
    return (this.model?.uploadQueue || []).some(item =>
      ['uploading', 'queued', 'processing'].includes(item.status)
    );
  }

  openUploadModal() {
    if (!this.isUploading && !this.hasQueuedJobs()) this.model.clearUploadQueue();
    this.renderUploadQueue();
    if (typeof ModalView !== 'undefined' && typeof ModalView.open === 'function') {
      ModalView.open(this.modal);
    }
    this.updateBackgroundIndicator();
  }

  closeUploadModal() {
    if (typeof ModalView !== 'undefined' && typeof ModalView.close === 'function') {
      ModalView.close(this.modal);
    }
    if (!this.isUploading && !this.hasQueuedJobs()) {
      this.model.clearUploadQueue();
      this.renderUploadQueue();
    }
    this.updateBackgroundIndicator();
  }

  renderUploadQueue() {
    if (typeof document === 'undefined') return;
    const queueList = document.getElementById('upload-queue-list');
    const queueContainer = document.getElementById('upload-queue-container');
    const queueCount = document.getElementById('upload-queue-count');
    const clearAllBtn = document.getElementById('upload-clear-all-btn');
    const fileInput = document.getElementById('upload-file-input');
    const browseBtn = document.getElementById('upload-browse-btn');
    const sendBtn = document.getElementById('upload-send-btn');
    const cancelBtn = document.getElementById('upload-cancel-btn');
    const closeBtn = document.getElementById('upload-close-x-btn');
    const bgHint = document.getElementById('upload-bg-hint');
    const queue = this.model?.uploadQueue || [];
    const hasActiveItems = this.hasQueuedJobs();

    if (queueContainer) queueContainer.style.display = queue.length ? 'block' : 'none';
    if (queueCount) queueCount.textContent = `Queued files (${queue.length}):`;
    if (clearAllBtn) clearAllBtn.disabled = this.isUploading || hasActiveItems;
    if (fileInput) fileInput.disabled = this.isUploading;
    if (browseBtn) browseBtn.disabled = this.isUploading;
    if (cancelBtn) {
      cancelBtn.textContent = this.isUploading || hasActiveItems ? 'Continue in background' : 'Cancel';
      cancelBtn.title = this.isUploading || hasActiveItems ? 'Close dialog and continue upload in background' : 'Cancel';
    }
    if (closeBtn) {
      closeBtn.title = this.isUploading || hasActiveItems ? 'Continue in background' : 'Close';
    }
    if (bgHint) {
      bgHint.style.display = this.isUploading || hasActiveItems ? 'inline-block' : 'none';
    }

    if (typeof UploadModalView !== 'undefined' && typeof UploadModalView.renderQueue === 'function') {
      UploadModalView.renderQueue(queueList, queue, (id) => {
        if (this.isUploading) return;
        const item = queue.find(entry => entry.id === id);
        if (!item || !['pending', 'error', 'skipped'].includes(item.status)) return;
        this.model.removeUploadItem(id);
        this.renderUploadQueue();
      });
    }

    if (sendBtn) {
      const retryable = queue.filter(item => ['pending', 'error'].includes(item.status));
      sendBtn.disabled = this.isUploading || retryable.length === 0;
      sendBtn.textContent = queue.some(item => item.status === 'error')
        ? `Retry (${retryable.length})`
        : `Upload Books (${retryable.length})`;
    }

    this.updateBackgroundIndicator();
  }

  async startUploadBatch() {
    const queue = this.model?.uploadQueue || [];
    const items = queue.filter(item => ['pending', 'error'].includes(item.status));
    if (!items.length || this.isUploading) return;

    this.isUploading = true;
    this.renderUploadQueue();
    this.updateBackgroundIndicator();
    const autoFetchMetadata = Boolean(document.getElementById('upload-verify-toggle')?.checked);
    let nextItemIndex = 0;

    const uploadNext = async () => {
      while (nextItemIndex < items.length) {
        const item = items[nextItemIndex++];
        item.status = 'uploading';
        item.progress = 0;
        item.jobId = null;
        item.error = null;
        this.renderUploadQueue();
        this.updateBackgroundIndicator();

        try {
          const response = await api.uploadBookWithProgress(item.file, {
            autoFetchMetadata,
            allowDuplicate: Boolean(item.allowDuplicate),
            onProgress: progress => {
              item.progress = progress;
              const queueList = document.getElementById('upload-queue-list');
              const updated = typeof UploadModalView?.updateItemProgress === 'function'
                ? UploadModalView.updateItemProgress(queueList, item)
                : false;
              if (!updated) this.renderUploadQueue();
              this.updateBackgroundIndicator();
            }
          });
          const job = Array.isArray(response.jobs) ? response.jobs[0] : null;
          const jobId = response.job_id || job?.job_id;
          if (!jobId) throw new Error('Server did not return an upload job ID');

          item.jobId = jobId;
          item.status = job?.status === 'processing' ? 'processing' : 'queued';
          item.progress = 100;
          this.activeJobs.set(jobId, { item, filename: item.name });
          this.scheduleJobPolling();
          this.renderUploadQueue();
          this.updateBackgroundIndicator();
        } catch (error) {
          const detail = error?.detail;
          if (detail && detail.code === 'DUPLICATE_ISBN_FORMAT') {
            const confirmMsg = `Ya existe un libro con el mismo ISBN (${detail.isbn}) y formato (${detail.format}):\n«${detail.existing_title}»\n\n¿Deseas añadirlo de todas maneras?`;
            const allow = (typeof window !== 'undefined' && typeof window.confirm === 'function')
              ? window.confirm(confirmMsg)
              : false;

            if (allow) {
              item.allowDuplicate = true;
              item.status = 'uploading';
              item.progress = 0;
              item.error = null;
              nextItemIndex--;
              continue;
            } else {
              item.status = 'skipped';
              item.error = 'Omitido: ISBN y formato duplicados';
              if (typeof ToastView !== 'undefined' && typeof ToastView.show === 'function') {
                ToastView.show(`Se omitió ${item.name} por duplicado de ISBN`, 'warning');
              }
              this.renderUploadQueue();
              this.updateBackgroundIndicator();
              continue;
            }
          }

          item.status = 'error';
          item.error = error.message || 'Upload failed';
          if (typeof ToastView !== 'undefined' && typeof ToastView.show === 'function') {
            ToastView.show(`Could not upload ${item.name}: ${item.error}`, 'error');
          }
          this.renderUploadQueue();
          this.updateBackgroundIndicator();
        }
      }
    };

    try {
      const workerCount = Math.min(this.maxConcurrentUploads, items.length);
      await Promise.all(Array.from({ length: workerCount }, () => uploadNext()));
      const acceptedCount = items.filter(item => ['queued', 'processing', 'done'].includes(item.status)).length;
      if (acceptedCount) {
        if (typeof ToastView !== 'undefined' && typeof ToastView.show === 'function') {
          ToastView.show(`${acceptedCount} book${acceptedCount === 1 ? '' : 's'} sent for background processing.`);
        }
      }
    } finally {
      this.isUploading = false;
      this.renderUploadQueue();
      this.updateBackgroundIndicator();
    }
  }

  async restoreActiveJobs() {
    try {
      if (typeof api?.getActiveUploadJobs !== 'function') return;
      const jobs = await api.getActiveUploadJobs();
      for (const job of jobs) {
        if (!job?.job_id || !['queued', 'processing'].includes(job.status)) continue;
        this.activeJobs.set(job.job_id, { item: null, filename: job.filename || 'Book' });
      }
      if (this.activeJobs.size) this.scheduleJobPolling();
      this.updateBackgroundIndicator();
    } catch (error) {
      console.warn('[BookUploadManager] Could not restore background upload jobs:', error);
    }
  }

  scheduleJobPolling() {
    if (this.jobPollTimer !== null || this.activeJobs.size === 0) return;
    this.jobPollTimer = setTimeout(async () => {
      this.jobPollTimer = null;
      try {
        await this.pollUploadJobs();
      } catch (error) {
        console.error('[BookUploadManager] Upload status polling failed:', error);
      } finally {
        this.scheduleJobPolling();
      }
    }, this.jobPollIntervalMs);
  }

  async pollUploadJobs() {
    const pending = Array.from(this.activeJobs.entries());
    const results = await Promise.allSettled(
      pending.map(async ([jobId, tracked]) => ({
        jobId,
        tracked,
        job: await api.getUploadJob(jobId)
      }))
    );
    let catalogChanged = false;

    for (const [index, result] of results.entries()) {
      if (result.status === 'rejected') {
        if (/upload job not found/i.test(result.reason?.message || '')) {
          const [jobId, tracked] = pending[index];
          this.activeJobs.delete(jobId);
          if (typeof ToastView !== 'undefined' && typeof ToastView.show === 'function') {
            ToastView.show(`Could not find the import status for ${tracked.filename}.`, 'error');
          }
          continue;
        }
        console.warn('[BookUploadManager] Could not check an upload job:', result.reason);
        continue;
      }

      const { jobId, tracked, job } = result.value;
      if (job.status === 'queued' || job.status === 'processing') {
        if (tracked.item) tracked.item.status = job.status;
        continue;
      }

      if (job.status === 'completed') {
        this.activeJobs.delete(jobId);
        if (tracked.item) tracked.item.status = 'done';
        if (typeof ToastView !== 'undefined' && typeof ToastView.show === 'function') {
          ToastView.show(`${tracked.filename} was added to the library.`);
        }
        catalogChanged = true;
      } else if (job.status === 'failed') {
        this.activeJobs.delete(jobId);
        const message = job.error || 'The server could not process this book.';
        if (tracked.item) {
          tracked.item.status = 'error';
          tracked.item.error = message;
        }
        if (typeof ToastView !== 'undefined' && typeof ToastView.show === 'function') {
          ToastView.show(`${tracked.filename} failed to import: ${message}`, 'error');
        }
      } else {
        console.error('[BookUploadManager] Received an unknown upload job status:', job.status);
        this.activeJobs.delete(jobId);
      }
    }

    if (this.activeJobs.size === 0 && catalogChanged) {
      this.justCompletedTimestamp = Date.now();
      setTimeout(() => {
        this.justCompletedTimestamp = null;
        this.updateBackgroundIndicator();
      }, 3500);
    }

    this.renderUploadQueue();
    this.updateBackgroundIndicator();

    if (catalogChanged && this.onUploadSuccess) {
      try {
        await this.onUploadSuccess();
      } catch (error) {
        console.error('[BookUploadManager] Could not refresh the library after import:', error);
        if (typeof ToastView !== 'undefined' && typeof ToastView.show === 'function') {
          ToastView.show('A book was imported, but the library could not be refreshed.', 'error');
        }
      }
    }
  }

  updateBackgroundIndicator() {
    if (typeof document === 'undefined' || !document?.body || typeof document.createElement !== 'function') {
      return;
    }

    const queue = this.model?.uploadQueue || [];
    const uploadingItems = queue.filter(item => item.status === 'uploading');
    const processingItems = queue.filter(item => ['queued', 'processing'].includes(item.status));
    const isModalOpen = Boolean(this.modal?.classList?.contains?.('open'));
    const hasActiveBackground = uploadingItems.length > 0 || processingItems.length > 0 || this.activeJobs.size > 0;

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
        const activeCount = uploadingItems.length + Math.max(processingItems.length, this.activeJobs.size);
        badge.textContent = `${activeCount}`;
        badge.title = `${activeCount} book${activeCount === 1 ? '' : 's'} in background`;
      } else if (badge && typeof badge.remove === 'function') {
        badge.remove();
      }
    }

    if (isModalOpen || (!hasActiveBackground && !this.justCompletedTimestamp)) {
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
      titleText = uploadingItems.length === 1
        ? `Uploading: ${activeItem.name} (${percent}%)`
        : `Uploading ${uploadingItems.length} books (${percent}%)`;
    } else if (processingItems.length > 0 || this.activeJobs.size > 0) {
      const count = Math.max(processingItems.length, this.activeJobs.size);
      titleText = count === 1
        ? 'Processing metadata with Calibre...'
        : `Processing ${count} books with Calibre...`;
      isProcessing = true;
      percent = 100;
    } else if (this.justCompletedTimestamp) {
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
      this.openUploadModal();
    };
  }
}

window.BookUploadManager = BookUploadManager;
