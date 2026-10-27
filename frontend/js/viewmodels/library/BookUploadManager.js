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
    this.activeUploadXhrs = new Map();
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
        if (event.target.closest && event.target.closest('#upload-browse-btn')) return;
        fileInput.click();
      };
    }

    if (fileInput) {
      fileInput.onchange = event => {
        if (event.target.files?.length) {
          const res = this.model.addFilesToUploadQueue(event.target.files);
          this.handleAddedFilesResult(res);
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
        if (event.dataTransfer?.files?.length) {
          const res = this.model.addFilesToUploadQueue(event.dataTransfer.files);
          this.handleAddedFilesResult(res);
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
        if (this.isUploading) {
          this.cancelAllUploads();
          return;
        }
        if (!this.hasQueuedJobs()) {
          this.model.clearUploadQueue();
          this.renderUploadQueue();
        }
      };
    }
    if (sendBtn) sendBtn.onclick = () => this.startUploadBatch();

    this.restoreActiveJobs();
    this.updateBackgroundIndicator();
  }

  handleAddedFilesResult(result) {
    const rejected = result?.rejected || [];
    const accepted = result?.accepted || [];
    if (rejected.length > 0) {
      if (accepted.length === 0) {
        if (typeof ToastView !== 'undefined' && typeof ToastView.show === 'function') {
          ToastView.show('Solo se admiten libros en formato PDF (.pdf).', 'error');
        }
      } else {
        if (typeof ToastView !== 'undefined' && typeof ToastView.show === 'function') {
          ToastView.show(`Se omitieron ${rejected.length} archivo(s) no compatibles: solo se admiten archivos .pdf`, 'warning');
        }
      }
    }
  }

  cancelAllUploads() {
    for (const [, xhr] of this.activeUploadXhrs.entries()) {
      try {
        xhr.abort();
      } catch (_) {}
    }
    this.activeUploadXhrs.clear();

    const queue = this.model?.uploadQueue || [];
    for (const item of queue) {
      if (['uploading', 'sent', 'pending'].includes(item.status)) {
        item.status = 'cancelled';
      }
    }

    if (this.model) {
      this.model.uploadQueue = queue.filter(item => ['queued', 'processing', 'done'].includes(item.status));
    }

    this.isUploading = false;
    if (typeof ToastView !== 'undefined' && typeof ToastView.show === 'function') {
      ToastView.show('Subidas canceladas', 'info');
    }
    this.renderUploadQueue();
    this.updateBackgroundIndicator();
  }

  hasQueuedJobs() {
    return (this.model?.uploadQueue || []).some(item =>
      ['uploading', 'sent', 'queued', 'processing'].includes(item.status)
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
    if (clearAllBtn) {
      if (this.isUploading) {
        clearAllBtn.disabled = false;
        clearAllBtn.textContent = 'Cancel all';
        clearAllBtn.title = 'Cancel active and pending uploads';
      } else {
        clearAllBtn.disabled = hasActiveItems || queue.length === 0;
        clearAllBtn.textContent = 'Clear list';
        clearAllBtn.title = 'Clear queue list';
      }
    }
    if (fileInput) fileInput.disabled = false;
    if (browseBtn) browseBtn.disabled = false;
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
        const item = queue.find(entry => entry.id === id);
        if (!item) return;

        if (item.status === 'uploading' || item.status === 'sent') {
          const xhr = this.activeUploadXhrs.get(id);
          if (xhr) {
            try {
              xhr.abort();
            } catch (_) {}
          }
          this.activeUploadXhrs.delete(id);
          item.status = 'cancelled';
          this.model.removeUploadItem(id);
          if (typeof ToastView !== 'undefined' && typeof ToastView.show === 'function') {
            ToastView.show(`Subida cancelada: ${item.name}`, 'info');
          }
          this.renderUploadQueue();
          this.updateBackgroundIndicator();
          return;
        }

        if (['pending', 'error', 'skipped'].includes(item.status)) {
          this.model.removeUploadItem(id);
          this.renderUploadQueue();
          this.updateBackgroundIndicator();
        }
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
    for (const item of items) {
      if (item.status === 'error') {
        item.status = 'pending';
        item.progress = 0;
        item.error = null;
        item.retried = false;
      }
    }
    this.renderUploadQueue();
    this.updateBackgroundIndicator();
    const autoFetchMetadata = Boolean(document.getElementById('upload-verify-toggle')?.checked);

    let activeTransfers = 0;
    const activeTasks = new Set();

    const pump = () => {
      while (activeTransfers < this.maxConcurrentUploads) {
        const item = (this.model?.uploadQueue || []).find(entry => entry.status === 'pending');
        if (!item) break;

        activeTransfers++;
        item.status = 'uploading';
        item.progress = 0;
        item.jobId = null;
        item.error = null;
        this.renderUploadQueue();
        this.updateBackgroundIndicator();

        let transferSlotFreed = false;
        const freeTransferSlot = () => {
          if (!transferSlotFreed) {
            transferSlotFreed = true;
            activeTransfers = Math.max(0, activeTransfers - 1);
            pump();
          }
        };

        const task = (async () => {
          try {
            const response = await api.uploadBookWithProgress(item.file, {
              autoFetchMetadata,
              allowDuplicate: Boolean(item.allowDuplicate),
              onXhrCreated: xhr => {
                this.activeUploadXhrs.set(item.id, xhr);
              },
              onProgress: progress => {
                if (item.status === 'cancelled') return;
                item.progress = progress;
                if (progress >= 100 && item.status === 'uploading') {
                  item.status = 'sent';
                  freeTransferSlot();
                }
                const queueList = document.getElementById('upload-queue-list');
                const updated = typeof UploadModalView?.updateItemProgress === 'function'
                  ? UploadModalView.updateItemProgress(queueList, item)
                  : false;
                if (!updated) this.renderUploadQueue();
                this.updateBackgroundIndicator();
              },
              onSent: () => {
                if (item.status === 'cancelled') return;
                item.status = 'sent';
                item.progress = 100;
                freeTransferSlot();
                const queueList = document.getElementById('upload-queue-list');
                const updated = typeof UploadModalView?.updateItemProgress === 'function'
                  ? UploadModalView.updateItemProgress(queueList, item)
                  : false;
                if (!updated) this.renderUploadQueue();
                this.updateBackgroundIndicator();
              }
            });

            this.activeUploadXhrs.delete(item.id);
            freeTransferSlot();

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
            this.activeUploadXhrs.delete(item.id);
            freeTransferSlot();

            if (error?.message === 'Upload was cancelled' || item.status === 'cancelled') {
              return;
            }

            const detail = error?.detail;
            if (detail && detail.code === 'DUPLICATE_ISBN_FORMAT') {
              const confirmMsg = `Ya existe un libro con el mismo ISBN (${detail.isbn}) y formato (${detail.format}):\n«${detail.existing_title}»\n\n¿Deseas añadirlo de todas maneras?`;
              const allow = (typeof window !== 'undefined' && typeof window.confirm === 'function')
                ? window.confirm(confirmMsg)
                : false;

              if (allow) {
                item.allowDuplicate = true;
                item.status = 'pending';
                item.progress = 0;
                item.error = null;
                pump();
                return;
              } else {
                item.status = 'skipped';
                item.error = 'Omitido: ISBN y formato duplicados';
                if (typeof ToastView !== 'undefined' && typeof ToastView.show === 'function') {
                  ToastView.show(`Se omitió ${item.name} por duplicado de ISBN`, 'warning');
                }
                this.renderUploadQueue();
                this.updateBackgroundIndicator();
                return;
              }
            }

            const isRetryable = !item.retried && !item.allowDuplicate && error?.status !== 413;
            if (isRetryable) {
              item.retried = true;
              item.status = 'pending';
              item.progress = 0;
              item.error = null;
              if (typeof ToastView !== 'undefined' && typeof ToastView.show === 'function') {
                ToastView.show(`Reintentando "${item.name}" tras fallo de transferencia o proxy...`, 'warning');
              }
              this.renderUploadQueue();
              this.updateBackgroundIndicator();
              pump();
              return;
            }

            item.status = 'error';
            item.error = error.message || 'Upload failed';
            if (typeof ToastView !== 'undefined' && typeof ToastView.show === 'function') {
              ToastView.show(`Could not upload ${item.name}: ${item.error}`, 'error');
            }
            this.renderUploadQueue();
            this.updateBackgroundIndicator();
          }
        })();

        activeTasks.add(task);
        task.finally(() => {
          activeTasks.delete(task);
          pump();
        });
      }
    };

    try {
      pump();
      while (activeTasks.size > 0 || (this.model?.uploadQueue || []).some(entry => entry.status === 'pending')) {
        if (activeTasks.size === 0) {
          pump();
          if (activeTasks.size === 0) break;
        }
        await Promise.race(Array.from(activeTasks));
      }

      const acceptedCount = items.filter(item => ['queued', 'processing', 'done'].includes(item.status)).length;
      if (acceptedCount) {
        if (typeof ToastView !== 'undefined' && typeof ToastView.show === 'function') {
          ToastView.show(`${acceptedCount} book${acceptedCount === 1 ? '' : 's'} sent for background processing.`);
        }
      }
    } finally {
      this.activeUploadXhrs.clear();
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
      }, 5000);
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
    if (typeof UploadModalView !== 'undefined' && typeof UploadModalView.updateBackgroundIndicator === 'function') {
      UploadModalView.updateBackgroundIndicator({
        queue: this.model?.uploadQueue || [],
        activeJobsCount: this.activeJobs?.size || 0,
        isModalOpen: Boolean(this.modal?.classList?.contains?.('open')),
        justCompletedTimestamp: this.justCompletedTimestamp,
        onOpenModal: () => this.openUploadModal()
      });
    }
  }
}

window.BookUploadManager = BookUploadManager;
