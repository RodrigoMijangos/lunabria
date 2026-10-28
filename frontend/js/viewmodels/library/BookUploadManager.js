/**
 * BookUploadManager.js
 * Manages drag & drop file uploads and background ingestion status.
 */
class BookUploadManager {
  constructor(model, onUploadSuccess) {
    this.model = model;
    this.onUploadSuccess = onUploadSuccess;
    this.isUploading = false;
    this.modal = typeof document !== "undefined" ? document.getElementById("upload-modal") : null;
    this.activeJobs = new Map();
    this.activeUploadXhrs = new Map();
    this.jobPollTimer = null;
    this.maxConcurrentUploads = 2;
    this.jobPollIntervalMs = 2000;
    this.justCompletedTimestamp = null;
    this.transferController =
      typeof BookUploadTransferController !== "undefined" ? new BookUploadTransferController(this) : null;
  }

  init() {
    if (typeof document === "undefined") return;
    this.modal = document.getElementById("upload-modal");
    const dropzone = document.getElementById("upload-dropzone");
    const fileInput = document.getElementById("upload-file-input");
    const browseBtn = document.getElementById("upload-browse-btn");
    const cancelBtn = document.getElementById("upload-cancel-btn");
    const closeBtn = document.getElementById("upload-close-x-btn");
    const clearAllBtn = document.getElementById("upload-clear-all-btn");
    const sendBtn = document.getElementById("upload-send-btn");

    if (browseBtn && fileInput) {
      browseBtn.onclick = () => fileInput.click();
    }

    if (dropzone && fileInput) {
      dropzone.onclick = (event) => {
        if (event.target.closest?.("#upload-browse-btn")) return;
        fileInput.click();
      };
    }

    if (fileInput) {
      fileInput.onchange = (event) => {
        if (event.target.files?.length) {
          const res = this.model.addFilesToUploadQueue(event.target.files);
          this.handleAddedFilesResult(res);
          event.target.value = "";
          this.renderUploadQueue();
        }
      };
    }

    this.bindDropzoneEvents(dropzone);

    if (cancelBtn) cancelBtn.onclick = () => this.closeUploadModal();
    if (closeBtn) closeBtn.onclick = () => this.closeUploadModal();

    this.modal?.addEventListener?.("click", (event) => {
      if (event.target === this.modal) this.closeUploadModal();
    });

    document.addEventListener?.("keydown", (event) => {
      if (event.key === "Escape" && this.modal?.classList?.contains?.("open")) {
        this.closeUploadModal();
      }
    });

    if (typeof window !== "undefined") {
      window.addEventListener?.("beforeunload", (event) => {
        if (this.isUploading) {
          event.preventDefault();
          event.returnValue = "";
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

  bindDropzoneEvents(dropzone) {
    if (!dropzone) return;
    for (const name of ["dragenter", "dragover"]) {
      dropzone.addEventListener(name, (event) => {
        event.preventDefault();
        dropzone.classList.add("drag-active");
      });
    }
    for (const name of ["dragleave", "drop"]) {
      dropzone.addEventListener(name, (event) => {
        event.preventDefault();
        dropzone.classList.remove("drag-active");
      });
    }
    dropzone.addEventListener("drop", (event) => {
      if (event.dataTransfer?.files?.length) {
        const res = this.model.addFilesToUploadQueue(event.dataTransfer.files);
        this.handleAddedFilesResult(res);
        this.renderUploadQueue();
      }
    });
  }

  handleAddedFilesResult(result) {
    const rejected = result?.rejected || [];
    const accepted = result?.accepted || [];
    if (rejected.length === 0) return;
    if (accepted.length === 0) {
      ToastView?.show?.("Solo se admiten libros en formato PDF (.pdf).", "error");
    } else {
      ToastView?.show?.(
        `Se omitieron ${rejected.length} archivo(s) no compatibles: solo se admiten archivos .pdf`,
        "warning",
      );
    }
  }

  cancelAllUploads() {
    this.transferController?.cancelAllUploads();
  }

  hasQueuedJobs() {
    return (this.model?.uploadQueue || []).some((item) =>
      ["uploading", "sent", "queued", "processing"].includes(item.status),
    );
  }

  openUploadModal() {
    if (!this.isUploading && !this.hasQueuedJobs()) this.model.clearUploadQueue();
    this.renderUploadQueue();
    ModalView?.open?.(this.modal);
    this.updateBackgroundIndicator();
  }

  closeUploadModal() {
    ModalView?.close?.(this.modal);
    if (!this.isUploading && !this.hasQueuedJobs()) {
      this.model.clearUploadQueue();
      this.renderUploadQueue();
    }
    this.updateBackgroundIndicator();
  }

  renderUploadQueue() {
    if (typeof document === "undefined") return;
    const queueList = document.getElementById("upload-queue-list");
    const queueContainer = document.getElementById("upload-queue-container");
    const queueCount = document.getElementById("upload-queue-count");
    const clearAllBtn = document.getElementById("upload-clear-all-btn");
    const fileInput = document.getElementById("upload-file-input");
    const browseBtn = document.getElementById("upload-browse-btn");
    const sendBtn = document.getElementById("upload-send-btn");
    const cancelBtn = document.getElementById("upload-cancel-btn");
    const closeBtn = document.getElementById("upload-close-x-btn");
    const bgHint = document.getElementById("upload-bg-hint");
    const queue = this.model?.uploadQueue || [];
    const hasActiveItems = this.hasQueuedJobs();
    const isBusy = this.isUploading || hasActiveItems;

    if (queueContainer) queueContainer.style.display = queue.length ? "block" : "none";
    if (queueCount) queueCount.textContent = `Queued files (${queue.length}):`;
    if (clearAllBtn) {
      clearAllBtn.disabled = this.isUploading ? false : hasActiveItems || queue.length === 0;
      clearAllBtn.textContent = this.isUploading ? "Cancel all" : "Clear list";
      clearAllBtn.title = this.isUploading ? "Cancel active and pending uploads" : "Clear queue list";
    }
    if (fileInput) fileInput.disabled = false;
    if (browseBtn) browseBtn.disabled = false;
    if (cancelBtn) {
      cancelBtn.textContent = isBusy ? "Continue in background" : "Cancel";
      cancelBtn.title = isBusy ? "Close dialog and continue upload in background" : "Cancel";
    }
    if (closeBtn) closeBtn.title = isBusy ? "Continue in background" : "Close";
    if (bgHint) bgHint.style.display = isBusy ? "inline-block" : "none";

    UploadModalView?.renderQueue?.(queueList, queue, (id) => this.handleRemoveQueueItem(id));

    if (sendBtn) {
      const retryable = queue.filter((item) => ["pending", "error"].includes(item.status));
      sendBtn.disabled = this.isUploading || retryable.length === 0;
      sendBtn.textContent = queue.some((item) => item.status === "error")
        ? `Retry (${retryable.length})`
        : `Upload Books (${retryable.length})`;
    }

    this.updateBackgroundIndicator();
  }

  handleRemoveQueueItem(id) {
    const queue = this.model?.uploadQueue || [];
    const item = queue.find((entry) => entry.id === id);
    if (!item) return;

    if (item.status === "uploading" || item.status === "sent") {
      const xhr = this.activeUploadXhrs.get(id);
      if (xhr) {
        try {
          xhr.abort();
        } catch (_) {}
      }
      this.activeUploadXhrs.delete(id);
      item.status = "cancelled";
      this.model.removeUploadItem(id);
      ToastView?.show?.(`Subida cancelada: ${item.name}`, "info");
      this.renderUploadQueue();
      this.updateBackgroundIndicator();
      return;
    }

    if (["pending", "error", "skipped"].includes(item.status)) {
      this.model.removeUploadItem(id);
      this.renderUploadQueue();
      this.updateBackgroundIndicator();
    }
  }

  async startUploadBatch() {
    return this.transferController?.startUploadBatch();
  }

  async restoreActiveJobs() {
    return this.transferController?.restoreActiveJobs();
  }

  scheduleJobPolling() {
    this.transferController?.scheduleJobPolling();
  }

  async pollUploadJobs() {
    return this.transferController?.pollUploadJobs();
  }

  updateBackgroundIndicator() {
    UploadModalView?.updateBackgroundIndicator?.({
      queue: this.model?.uploadQueue || [],
      activeJobsCount: this.activeJobs?.size || 0,
      isModalOpen: Boolean(this.modal?.classList?.contains?.("open")),
      justCompletedTimestamp: this.justCompletedTimestamp,
      onOpenModal: () => this.openUploadModal(),
    });
  }
}

window.BookUploadManager = BookUploadManager;
