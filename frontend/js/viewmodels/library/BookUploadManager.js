/**
 * BookUploadManager.js
 * Manages drag & drop file uploads and batch processing for the library.
 */
class BookUploadManager {
  constructor(model, onUploadSuccess) {
    this.model = model;
    this.onUploadSuccess = onUploadSuccess;
    this.isUploading = false;
    this.modal = document.getElementById('upload-modal');
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
      fileInput.onchange = (e) => {
        if (e.target.files?.length) {
          this.model.addFilesToUploadQueue(e.target.files);
          e.target.value = '';
          this.renderUploadQueue();
        }
      };
    }

    if (dropzone) {
      ['dragenter', 'dragover'].forEach(name => {
        dropzone.addEventListener(name, (e) => {
          e.preventDefault();
          dropzone.classList.add('drag-active');
        });
      });

      ['dragleave', 'drop'].forEach(name => {
        dropzone.addEventListener(name, (e) => {
          e.preventDefault();
          dropzone.classList.remove('drag-active');
        });
      });

      dropzone.addEventListener('drop', (e) => {
        if (this.isUploading) return;
        if (e.dataTransfer?.files?.length) {
          this.model.addFilesToUploadQueue(e.dataTransfer.files);
          this.renderUploadQueue();
        }
      });
    }

    if (cancelBtn) {
      cancelBtn.onclick = () => this.closeUploadModal();
    }
    if (closeBtn) closeBtn.onclick = () => this.closeUploadModal();
    if (clearAllBtn) {
      clearAllBtn.onclick = () => {
        if (!this.isUploading) {
          this.model.clearUploadQueue();
          this.renderUploadQueue();
        }
      };
    }

    if (sendBtn) {
      sendBtn.onclick = () => this.startUploadBatch();
    }
  }

  openUploadModal() {
    this.model.clearUploadQueue();
    this.renderUploadQueue();
    ModalView.open(this.modal);
  }

  closeUploadModal() {
    if (this.isUploading) return;
    ModalView.close(this.modal);
    this.model.clearUploadQueue();
    this.renderUploadQueue();
  }

  renderUploadQueue() {
    const queueList = document.getElementById('upload-queue-list');
    const queueContainer = document.getElementById('upload-queue-container');
    const queueCount = document.getElementById('upload-queue-count');
    const clearAllBtn = document.getElementById('upload-clear-all-btn');
    const fileInput = document.getElementById('upload-file-input');
    const browseBtn = document.getElementById('upload-browse-btn');
    const cancelBtn = document.getElementById('upload-cancel-btn');
    const closeBtn = document.getElementById('upload-close-x-btn');
    const sendBtn = document.getElementById('upload-send-btn');
    const queue = this.model.uploadQueue;
    if (queueContainer) queueContainer.style.display = queue.length ? 'block' : 'none';
    if (queueCount) queueCount.textContent = `Queued files (${queue.length}):`;
    if (clearAllBtn) clearAllBtn.disabled = this.isUploading;
    if (fileInput) fileInput.disabled = this.isUploading;
    if (browseBtn) browseBtn.disabled = this.isUploading;
    if (cancelBtn) cancelBtn.disabled = this.isUploading;
    if (closeBtn) closeBtn.disabled = this.isUploading;
    UploadModalView.renderQueue(queueList, queue, (id) => {
      if (this.isUploading) return;
      this.model.removeUploadItem(id);
      this.renderUploadQueue();
    });

    if (sendBtn) {
      const remaining = queue.filter(item => item.status !== 'done').length;
      sendBtn.disabled = this.isUploading || remaining === 0;
      sendBtn.textContent = queue.some(item => item.status === 'error')
        ? `Retry (${remaining})`
        : `Upload Books (${remaining})`;
    }
  }

  async startUploadBatch() {
    const items = this.model.uploadQueue.filter(item => item.status !== 'done');
    if (!items.length || this.isUploading) return;

    this.isUploading = true;
    const sendBtn = document.getElementById('upload-send-btn');
    if (sendBtn) {
      sendBtn.disabled = true;
      sendBtn.innerHTML = '<svg class="ui-icon ui-icon-spin" aria-hidden="true" focusable="false"><use href="./icons.svg#loader"></use></svg> Uploading...';
    }

    try {
      for (const item of items) {
        item.status = 'uploading';
        this.renderUploadQueue();
        await api.uploadBook(item.file);
        item.status = 'done';
        this.renderUploadQueue();
      }
      this.isUploading = false;
      alert('All books were uploaded successfully!');
      this.closeUploadModal();
      if (this.onUploadSuccess) await this.onUploadSuccess();
    } catch (err) {
      const failedItem = items.find(item => item.status === 'uploading');
      if (failedItem) {
        failedItem.status = 'error';
        failedItem.error = err.message;
      }
      this.renderUploadQueue();
      alert('Upload error: ' + err.message);
    } finally {
      this.isUploading = false;
      this.renderUploadQueue();
    }
  }
}

window.BookUploadManager = BookUploadManager;
