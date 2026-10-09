/** Progress API domain. Compose on the facade to preserve dynamic this. */
const createProgressApiService = () => ({
  // Reader Progress & Sync Configuration
  syncConfig: {
    getMode() {
      // 'interval' (periodic autosave) | 'close' (on book close only) | 'page' (after each page)
      return localStorage.getItem('moon_sync_mode') || 'interval';
    },
    setMode(mode) {
      localStorage.setItem('moon_sync_mode', mode);
    },
    getIntervalMinutes() {
      const val = parseInt(localStorage.getItem('moon_sync_interval') || '5', 10);
      return (isNaN(val) || val < 1) ? 5 : val;
    },
    setIntervalMinutes(min) {
      const safe = Math.max(1, Math.min(120, parseInt(min, 10) || 5));
      localStorage.setItem('moon_sync_interval', safe.toString());
    }
  },

  _pendingProgress: null,
  _autoSaveTimer: null,
  _lastSyncTime: null,

  async getProgress(bookId) {
    const local = await localDB.getLocalProgress(bookId);
    try {
      const res = await fetch(`/api/books/${bookId}/progress`);
      if (res.ok) {
        const serverData = await res.json();
        if (serverData && serverData.current_page) {
          this._lastSyncTime = new Date();
          // If local progress is ahead of server (pending sync was not delivered), preserve local and sync forward
          if (local && local.current_page && local.current_page > serverData.current_page) {
            await this.saveProgress(bookId, local);
            await this.syncPendingProgress('reconcile ahead local');
            return local;
          }
          await localDB.saveLocalProgress(bookId, serverData);
          return serverData;
        }
      }
    } catch (e) {
      console.warn('Network offline or progress fetch failed, checking local storage:', e);
    }
    return local;
  },

  async markBookOpened(bookId, progressData) {
    const res = await fetch(`/api/books/${bookId}/opened`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(progressData)
    });
    if (!res.ok) throw new Error('Could not record book opening');
    return res.json();
  },

  async saveProgress(bookId, progressData) {
    // 1. Instantly save in local storage (IndexedDB + localStorage)
    // Zero latency and full offline protection against network failures.
    await localDB.saveLocalProgress(bookId, progressData);

    this._pendingProgress = {
      bookId,
      data: progressData,
      timestamp: Date.now()
    };

    const mode = this.syncConfig.getMode();

    if (mode === 'page') {
      // Option to send data after each page
      await this.syncPendingProgress('after each page');
    } else {
      console.log(`[Lunabria] 📖 Progress saved locally: Page ${progressData.current_page}/${progressData.total_pages} (${progressData.percentage}%) [Pending sync to server per mode '${mode}']`);
      if (mode === 'interval') {
        this.ensureAutoSaveTimer();
      }
    }
  },

  ensureAutoSaveTimer() {
    if (this._autoSaveTimer) return;
    const minutes = this.syncConfig.getIntervalMinutes();
    const ms = minutes * 60 * 1000;
    this._autoSaveTimer = setInterval(async () => {
      if (this._pendingProgress) {
        console.log(`[Lunabria] ⏱️ Running periodic autosave (${minutes} min)...`);
        await this.syncPendingProgress(`autosave every ${minutes} min`);
      }
    }, ms);
  },

  stopAutoSaveTimer() {
    if (this._autoSaveTimer) {
      clearInterval(this._autoSaveTimer);
      this._autoSaveTimer = null;
    }
  },

  restartAutoSaveTimer() {
    this.stopAutoSaveTimer();
    if (this.syncConfig.getMode() === 'interval') {
      this.ensureAutoSaveTimer();
    }
  },

  async syncPendingProgress(reason = 'manual') {
    if (!this._pendingProgress) {
      return { success: true, alreadySynced: true };
    }
    const { bookId, data } = this._pendingProgress;
    try {
      const res = await fetch(`/api/books/${bookId}/progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (res.ok) {
        this._lastSyncTime = new Date();
        this._pendingProgress = null;
        console.log(`[Lunabria] ☁️ Synced with server (${reason}): Book ${bookId}, Page ${data.current_page}/${data.total_pages} (${data.percentage}%)`);
        return { success: true, data };
      }
    } catch (e) {
      console.warn(`[Lunabria] ⚠️ Error syncing with server (${reason}):`, e);
    }
    return { success: false };
  },

  flushPendingProgressBeacon() {
    if (!this._pendingProgress) return;
    const { bookId, data } = this._pendingProgress;
    const url = `/api/books/${bookId}/progress`;
    const payload = JSON.stringify(data);
    try {
      if (navigator.sendBeacon) {
        const blob = new Blob([payload], { type: 'application/json' });
        navigator.sendBeacon(url, blob);
      } else {
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: true
        });
      }
      console.log(`[Lunabria] 📕 Progress synced on window/tab close: Page ${data.current_page}`);
      this._pendingProgress = null;
    } catch (e) {
      console.warn('Beacon sync failed:', e);
    }
  },
});
