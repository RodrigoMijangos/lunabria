/**
 * BookUploadTransferController.js
 * Handles concurrent XHR file transfers, duplicate/retry recovery, and background job polling
 * for BookUploadManager.
 */
class BookUploadTransferController {
  constructor(manager) {
    this.manager = manager;
  }

  cancelAllUploads() {
    const m = this.manager;
    for (const [, xhr] of m.activeUploadXhrs.entries()) {
      try {
        xhr.abort();
      } catch (_) {}
    }
    m.activeUploadXhrs.clear();

    const queue = m.model?.uploadQueue || [];
    for (const item of queue) {
      if (["uploading", "sent", "pending"].includes(item.status)) {
        item.status = "cancelled";
      }
    }

    if (m.model) {
      m.model.uploadQueue = queue.filter((item) => ["queued", "processing", "done"].includes(item.status));
    }

    m.isUploading = false;
    ToastView?.show?.("Subidas canceladas", "info");
    m.renderUploadQueue();
    m.updateBackgroundIndicator();
  }

  async startUploadBatch() {
    const m = this.manager;
    const queue = m.model?.uploadQueue || [];
    const items = queue.filter((item) => ["pending", "error"].includes(item.status));
    if (!items.length || m.isUploading) return;

    m.isUploading = true;
    for (const item of items) {
      if (item.status === "error") {
        item.status = "pending";
        item.progress = 0;
        item.error = null;
        item.retried = false;
      }
    }
    m.renderUploadQueue();
    m.updateBackgroundIndicator();
    const autoFetchMetadata = Boolean(document.getElementById("upload-verify-toggle")?.checked);

    let activeTransfers = 0;
    const activeTasks = new Set();

    const pump = () => {
      while (activeTransfers < m.maxConcurrentUploads) {
        const item = (m.model?.uploadQueue || []).find((entry) => entry.status === "pending");
        if (!item) break;

        activeTransfers++;
        item.status = "uploading";
        item.progress = 0;
        item.jobId = null;
        item.error = null;
        m.renderUploadQueue();
        m.updateBackgroundIndicator();

        let transferSlotFreed = false;
        const freeTransferSlot = () => {
          if (!transferSlotFreed) {
            transferSlotFreed = true;
            activeTransfers = Math.max(0, activeTransfers - 1);
            pump();
          }
        };

        const task = this.transferSingleItem(item, autoFetchMetadata, freeTransferSlot, pump);
        activeTasks.add(task);
        task.finally(() => {
          activeTasks.delete(task);
          pump();
        });
      }
    };

    try {
      pump();
      while (activeTasks.size > 0 || (m.model?.uploadQueue || []).some((entry) => entry.status === "pending")) {
        if (activeTasks.size === 0) {
          pump();
          if (activeTasks.size === 0) break;
        }
        await Promise.race(Array.from(activeTasks));
      }

      const acceptedCount = items.filter((item) => ["queued", "processing", "done"].includes(item.status)).length;
      if (acceptedCount) {
        ToastView?.show?.(`${acceptedCount} book${acceptedCount === 1 ? "" : "s"} sent for background processing.`);
      }
    } finally {
      m.activeUploadXhrs.clear();
      m.isUploading = false;
      m.renderUploadQueue();
      m.updateBackgroundIndicator();
    }
  }

  async transferSingleItem(item, autoFetchMetadata, freeTransferSlot, pump) {
    const m = this.manager;
    try {
      const response = await api.uploadBookWithProgress(item.file, {
        autoFetchMetadata,
        allowDuplicate: Boolean(item.allowDuplicate),
        onXhrCreated: (xhr) => {
          m.activeUploadXhrs.set(item.id, xhr);
        },
        onProgress: (progress) => {
          if (item.status === "cancelled") return;
          item.progress = progress;
          if (progress >= 100 && item.status === "uploading") {
            item.status = "sent";
            freeTransferSlot();
          }
          this.refreshItemProgress(item);
        },
        onSent: () => {
          if (item.status === "cancelled") return;
          item.status = "sent";
          item.progress = 100;
          freeTransferSlot();
          this.refreshItemProgress(item);
        },
      });

      m.activeUploadXhrs.delete(item.id);
      freeTransferSlot();

      const job = Array.isArray(response.jobs) ? response.jobs[0] : null;
      const jobId = response.job_id || job?.job_id;
      if (!jobId) throw new Error("Server did not return an upload job ID");

      item.jobId = jobId;
      item.status = job?.status === "processing" ? "processing" : "queued";
      item.progress = 100;
      m.activeJobs.set(jobId, { item, filename: item.name });
      m.scheduleJobPolling();
      m.renderUploadQueue();
      m.updateBackgroundIndicator();
    } catch (error) {
      m.activeUploadXhrs.delete(item.id);
      freeTransferSlot();
      this.handleTransferError(item, error, pump);
    }
  }

  refreshItemProgress(item) {
    const m = this.manager;
    const queueList = document.getElementById("upload-queue-list");
    const updated =
      typeof UploadModalView?.updateItemProgress === "function"
        ? UploadModalView.updateItemProgress(queueList, item)
        : false;
    if (!updated) m.renderUploadQueue();
    m.updateBackgroundIndicator();
  }

  handleTransferError(item, error, pump) {
    const m = this.manager;
    if (error?.message === "Upload was cancelled" || item.status === "cancelled") {
      return;
    }

    const detail = error?.detail;
    if (detail && detail.code === "DUPLICATE_ISBN_FORMAT") {
      const confirmMsg = `Ya existe un libro con el mismo ISBN (${detail.isbn}) y formato (${detail.format}):\n«${detail.existing_title}»\n\n¿Deseas añadirlo de todas maneras?`;
      const allow =
        typeof window !== "undefined" && typeof window.confirm === "function" ? window.confirm(confirmMsg) : false;

      if (allow) {
        item.allowDuplicate = true;
        item.status = "pending";
        item.progress = 0;
        item.error = null;
        pump();
      } else {
        item.status = "skipped";
        item.error = "Omitido: ISBN y formato duplicados";
        ToastView?.show?.(`Se omitió ${item.name} por duplicado de ISBN`, "warning");
        m.renderUploadQueue();
        m.updateBackgroundIndicator();
      }
      return;
    }

    const isRetryable = !item.retried && !item.allowDuplicate && error?.status !== 413;
    if (isRetryable) {
      item.retried = true;
      item.status = "pending";
      item.progress = 0;
      item.error = null;
      ToastView?.show?.(`Reintentando "${item.name}" tras fallo de transferencia o proxy...`, "warning");
      m.renderUploadQueue();
      m.updateBackgroundIndicator();
      pump();
      return;
    }

    item.status = "error";
    item.error = error.message || "Upload failed";
    ToastView?.show?.(`Could not upload ${item.name}: ${item.error}`, "error");
    m.renderUploadQueue();
    m.updateBackgroundIndicator();
  }

  async restoreActiveJobs() {
    const m = this.manager;
    try {
      if (typeof api?.getActiveUploadJobs !== "function") return;
      const jobs = await api.getActiveUploadJobs();
      for (const job of jobs) {
        if (!job?.job_id || !["queued", "processing"].includes(job.status)) continue;
        m.activeJobs.set(job.job_id, { item: null, filename: job.filename || "Book" });
      }
      if (m.activeJobs.size) m.scheduleJobPolling();
      m.updateBackgroundIndicator();
    } catch (error) {
      console.warn("[BookUploadManager] Could not restore background upload jobs:", error);
    }
  }

  scheduleJobPolling() {
    const m = this.manager;
    if (m.jobPollTimer !== null || m.activeJobs.size === 0) return;
    m.jobPollTimer = setTimeout(async () => {
      m.jobPollTimer = null;
      try {
        await m.pollUploadJobs();
      } catch (error) {
        console.error("[BookUploadManager] Upload status polling failed:", error);
      } finally {
        m.scheduleJobPolling();
      }
    }, m.jobPollIntervalMs);
  }

  async pollUploadJobs() {
    const m = this.manager;
    const pending = Array.from(m.activeJobs.entries());
    const results = await Promise.allSettled(
      pending.map(async ([jobId, tracked]) => ({
        jobId,
        tracked,
        job: await api.getUploadJob(jobId),
      })),
    );
    let catalogChanged = false;

    for (const [index, result] of results.entries()) {
      if (this.applyPolledJobResult(result, pending[index])) {
        catalogChanged = true;
      }
    }

    if (m.activeJobs.size === 0 && catalogChanged) {
      m.justCompletedTimestamp = Date.now();
      setTimeout(() => {
        m.justCompletedTimestamp = null;
        m.updateBackgroundIndicator();
      }, 5000);
    }

    m.renderUploadQueue();
    m.updateBackgroundIndicator();

    if (catalogChanged && m.onUploadSuccess) {
      try {
        await m.onUploadSuccess();
      } catch (error) {
        console.error("[BookUploadManager] Could not refresh the library after import:", error);
        ToastView?.show?.("A book was imported, but the library could not be refreshed.", "error");
      }
    }
  }

  applyPolledJobResult(result, fallbackEntry) {
    const m = this.manager;
    if (result.status === "rejected") {
      if (/upload job not found/i.test(result.reason?.message || "")) {
        const [jobId, tracked] = fallbackEntry;
        m.activeJobs.delete(jobId);
        ToastView?.show?.(`Could not find the import status for ${tracked.filename}.`, "error");
      } else {
        console.warn("[BookUploadManager] Could not check an upload job:", result.reason);
      }
      return false;
    }

    const { jobId, tracked, job } = result.value;
    if (job.status === "queued" || job.status === "processing") {
      if (tracked.item) tracked.item.status = job.status;
      return false;
    }

    if (job.status === "completed") {
      m.activeJobs.delete(jobId);
      if (tracked.item) tracked.item.status = "done";
      ToastView?.show?.(`${tracked.filename} was added to the library.`);
      return true;
    }

    if (job.status === "failed") {
      m.activeJobs.delete(jobId);
      const message = job.error || "The server could not process this book.";
      if (tracked.item) {
        tracked.item.status = "error";
        tracked.item.error = message;
      }
      ToastView?.show?.(`${tracked.filename} failed to import: ${message}`, "error");
      return false;
    }

    console.error("[BookUploadManager] Received an unknown upload job status:", job.status);
    m.activeJobs.delete(jobId);
    return false;
  }
}

window.BookUploadTransferController = BookUploadTransferController;
