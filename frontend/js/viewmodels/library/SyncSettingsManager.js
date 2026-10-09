/**
 * SyncSettingsManager.js
 * Manages progress synchronization preferences and manual synchronization.
 */
class SyncSettingsManager {
  constructor() {
    this.modal = document.getElementById('sync-modal');
  }

  init() {
    document.getElementById('settings-sync-btn')?.addEventListener('click', () => this.open());
    document.getElementById('reader-sync-btn')?.addEventListener('click', () => this.open());
    document.getElementById('sync-cancel-btn')?.addEventListener('click', () => ModalView.close(this.modal));
    document.getElementById('sync-close-x-btn')?.addEventListener('click', () => ModalView.close(this.modal));
    document.getElementById('sync-save-btn')?.addEventListener('click', () => this.save());
    document.getElementById('sync-manual-now-btn')?.addEventListener('click', () => this.syncNow());

    document.querySelectorAll('input[name="sync-mode"]').forEach(input => {
      input.addEventListener('change', () => this.updateIntervalVisibility());
    });
    document.querySelectorAll('.sync-quick-btn').forEach(button => {
      button.addEventListener('click', () => this.selectQuickInterval(button));
    });
  }

  open() {
    if (!this.modal) return;
    const storedMode = api.syncConfig.getMode();
    const mode = ['interval', 'close', 'page'].includes(storedMode) ? storedMode : 'interval';
    const selectedMode = document.querySelector(`input[name="sync-mode"][value="${mode}"]`);
    if (selectedMode) selectedMode.checked = true;

    const minutesInput = document.getElementById('sync-minutes-input');
    if (minutesInput) minutesInput.value = api.syncConfig.getIntervalMinutes();
    this.updateIntervalVisibility();
    ModalView.open(this.modal);
  }

  updateIntervalVisibility() {
    const picker = document.getElementById('sync-interval-picker');
    const selectedMode = document.querySelector('input[name="sync-mode"]:checked')?.value;
    if (picker) picker.style.display = selectedMode === 'interval' ? 'flex' : 'none';
  }

  selectQuickInterval(button) {
    const minutesInput = document.getElementById('sync-minutes-input');
    const intervalMode = document.querySelector('input[name="sync-mode"][value="interval"]');
    if (minutesInput) minutesInput.value = button.dataset.min;
    if (intervalMode) intervalMode.checked = true;
    this.updateIntervalVisibility();
  }

  save() {
    const mode = document.querySelector('input[name="sync-mode"]:checked')?.value;
    if (!['interval', 'close', 'page'].includes(mode)) return;

    api.syncConfig.setMode(mode);
    if (mode === 'interval') {
      const minutes = document.getElementById('sync-minutes-input')?.value;
      api.syncConfig.setIntervalMinutes(minutes);
    }
    api.restartAutoSaveTimer();
    ModalView.close(this.modal);
  }

  async syncNow() {
    const button = document.getElementById('sync-manual-now-btn');
    if (!button || button.disabled) return;
    button.disabled = true;
    button.textContent = '⏳ Syncing…';

    try {
      const result = await api.syncPendingProgress('manual');
      button.textContent = result.success ? '✅ Synced' : '⚠️ Offline';
    } catch (error) {
      button.textContent = '⚠️ Offline';
      console.error('[SyncSettingsManager] Sync error:', error);
    } finally {
      setTimeout(() => {
        button.disabled = false;
        button.textContent = '🔄 Sync Now';
      }, 1500);
    }
  }
}

window.SyncSettingsManager = SyncSettingsManager;
