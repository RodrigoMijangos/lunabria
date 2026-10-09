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
    button.innerHTML = '<svg class="ui-icon ui-icon-spin" aria-hidden="true" focusable="false"><use href="./icons.svg#loader"></use></svg> Syncing…';

    try {
      const [progressResult, outboxResult] = await Promise.all([
        api.syncPendingProgress('manual').catch(() => ({ success: false })),
        (typeof localDB !== 'undefined' && typeof localDB.processOutboxQueue === 'function')
          ? localDB.processOutboxQueue(api).catch(() => ({ pending: 0 }))
          : Promise.resolve({ pending: 0 })
      ]);

      const isFullySynced = progressResult.success && (!outboxResult || outboxResult.pending === 0);
      button.innerHTML = isFullySynced
        ? '<svg class="ui-icon" aria-hidden="true" focusable="false"><use href="./icons.svg#circle-check"></use></svg> Synced'
        : '<svg class="ui-icon" aria-hidden="true" focusable="false"><use href="./icons.svg#warning"></use></svg> Offline';

      const statusTitle = document.getElementById('sync-status-title');
      const statusDetail = document.getElementById('sync-status-detail');
      if (statusTitle && statusDetail) {
        if (isFullySynced) {
          statusTitle.textContent = 'Synced';
          statusDetail.textContent = 'All changes and reading progress are up to date';
        } else {
          statusTitle.textContent = 'Pending Sync';
          const count = (outboxResult?.pending || 0) + (progressResult.success ? 0 : 1);
          statusDetail.textContent = `${count} change(s) waiting to be synced with the server`;
        }
      }
    } catch (error) {
      button.innerHTML = '<svg class="ui-icon" aria-hidden="true" focusable="false"><use href="./icons.svg#warning"></use></svg> Offline';
      console.error('[SyncSettingsManager] Sync error:', error);
    } finally {
      setTimeout(() => {
        button.disabled = false;
        button.innerHTML = '<svg class="ui-icon" aria-hidden="true" focusable="false"><use href="./icons.svg#sync"></use></svg> Sync Now';
      }, 1500);
    }
  }
}

window.SyncSettingsManager = SyncSettingsManager;
