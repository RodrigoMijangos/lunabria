/**
 * BookUploadManager.js
 * Manages drag & drop file uploads and background ingestion status.
 */
class BookUploadManager {
  constructor(model, onUploadSuccess) {
    this.model = model;
    this.onUploadSuccess = onUploadSuccess;
    this.isUploading = false;
    this.modal = document.getElementById('upload-modal');
    this.activeJobs = new Map();
    this.jobPollTimer = null;
    this.maxConcurrentUploads = 2;
    this.jobPollIntervalMs = 2000;
  }

  init() {
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
  }

  hasQueuedJobs() {
    return this.model.uploadQueue.some(item =>
      ['uploading', 'queued', 'processing'].includes(item.status)
    );
  }

  openUploadModal() {
    if (!this.isUploading) this.model.clearUploadQueue();
    this.renderUploadQueue();
    ModalView.open(this.modal);
  }

  closeUploadModal() {
    ModalView.close(this.modal);
    if (!this.isUploading) {
      this.model.clearUploadQueue();
      this.renderUploadQueue();
    }
  }

  renderUploadQueue() {
    const queueList = document.getElementById('upload-queue-list');
    const queueContainer = document.getElementById('upload-queue-container');
    const queueCount = document.getElementById('upload-queue-count');
    const clearAllBtn = document.getElementById('upload-clear-all-btn');
    const fileInput = document.getElementById('upload-file-input');
    const browseBtn = document.getElementById('upload-browse-btn');
    const sendBtn = document.getElementById('upload-send-btn');
    const cancelBtn = document.getElementById('upload-cancel-btn');
    const queue = this.model.uploadQueue;
    const hasActiveItems = this.hasQueuedJobs();

    if (queueContainer) queueContainer.style.display = queue.length ? 'block' : 'none';
    if (queueCount) queueCount.textContent = `Queued files (${queue.length}):`;
    if (clearAllBtn) clearAllBtn.disabled = this.isUploading || hasActiveItems;
    if (fileInput) fileInput.disabled = this.isUploading;
    if (browseBtn) browseBtn.disabled = this.isUploading;
    if (cancelBtn) cancelBtn.textContent = this.isUploading || hasActiveItems ? 'Close' : 'Cancel';
    UploadModalView.renderQueue(queueList, queue, (id) => {
      if (this.isUploading) return;
      const item = queue.find(entry => entry.id === id);
      if (!item || !['pending', 'error'].includes(item.status)) return;
      this.model.removeUploadItem(id);
      this.renderUploadQueue();
    });

    if (sendBtn) {
      const retryable = queue.filter(item => ['pending', 'error'].includes(item.status));
      sendBtn.disabled = this.isUploading || retryable.length === 0;
      sendBtn.textContent = queue.some(item => item.status === 'error')
        ? `Retry (${retryable.length})`
        : `Upload Books (${retryable.length})`;
    }
  }

  async startUploadBatch() {
    const items = this.model.uploadQueue.filter(item => ['pending', 'error'].includes(item.status));
    if (!items.length || this.isUploading) return;

    this.isUploading = true;
    this.renderUploadQueue();
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

        try {
          const response = await api.uploadBookWithProgress(item.file, {
            autoFetchMetadata,
            onProgress: progress => {
              item.progress = progress;
              this.renderUploadQueue();
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
        } catch (error) {
          item.status = 'error';
          item.error = error.message || 'Upload failed';
          ToastView.show(`Could not upload ${item.name}: ${item.error}`, 'error');
          this.renderUploadQueue();
        }
      }
    };

    try {
      const workerCount = Math.min(this.maxConcurrentUploads, items.length);
      await Promise.all(Array.from({ length: workerCount }, () => uploadNext()));
      const acceptedCount = items.filter(item => ['queued', 'processing', 'done'].includes(item.status)).length;
      if (acceptedCount) {
        ToastView.show(`${acceptedCount} book${acceptedCount === 1 ? '' : 's'} sent for background processing.`);
      }
    } finally {
      this.isUploading = false;
      this.renderUploadQueue();
    }
  }

  async restoreActiveJobs() {
    try {
      const jobs = await api.getActiveUploadJobs();
      for (const job of jobs) {
        if (!job?.job_id || !['queued', 'processing'].includes(job.status)) continue;
        this.activeJobs.set(job.job_id, { item: null, filename: job.filename || 'Book' });
      }
      if (this.activeJobs.size) this.scheduleJobPolling();
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
          ToastView.show(`Could not find the import status for ${tracked.filename}.`, 'error');
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
        ToastView.show(`${tracked.filename} was added to the library.`);
        catalogChanged = true;
      } else if (job.status === 'failed') {
        this.activeJobs.delete(jobId);
        const message = job.error || 'The server could not process this book.';
        if (tracked.item) {
          tracked.item.status = 'error';
          tracked.item.error = message;
        }
        ToastView.show(`${tracked.filename} failed to import: ${message}`, 'error');
      } else {
        console.error('[BookUploadManager] Received an unknown upload job status:', job.status);
        this.activeJobs.delete(jobId);
      }
    }

    this.renderUploadQueue();
    if (catalogChanged && this.onUploadSuccess) {
      try {
        await this.onUploadSuccess();
      } catch (error) {
        console.error('[BookUploadManager] Could not refresh the library after import:', error);
        ToastView.show('A book was imported, but the library could not be refreshed.', 'error');
      }
    }
  }
}

window.BookUploadManager = BookUploadManager;
