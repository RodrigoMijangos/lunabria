const SERVER_CONNECTIVITY_EVENT = 'lunabria:server-connectivity-change';

class ServerConnectivityMonitor {
  constructor(options = {}) {
    this.fetchImpl = options.fetchImpl || ((...args) => fetch(...args));
    this.windowRef = options.windowRef || (typeof window !== 'undefined' ? window : null);
    this.documentRef = options.documentRef || (typeof document !== 'undefined' ? document : null);
    this.timeoutMs = options.timeoutMs ?? 4500;
    this.pollIntervalMs = options.pollIntervalMs ?? 10000;
    this.setIntervalImpl = options.setIntervalImpl ||
      (this.windowRef?.setInterval ? this.windowRef.setInterval.bind(this.windowRef) : setInterval);
    this.clearIntervalImpl = options.clearIntervalImpl ||
      (this.windowRef?.clearInterval ? this.windowRef.clearInterval.bind(this.windowRef) : clearInterval);
    this.state = 'unknown';
    this._checkPromise = null;
    this._started = false;
    this._intervalId = null;
    this._refreshHandler = () => this.checkServer();
    this._visibilityHandler = () => {
      if (!this.documentRef || this.documentRef.visibilityState === 'visible') {
        return this.checkServer();
      }
    };
    this._resumeHandler = () => {
      if (!this.documentRef || this.documentRef.visibilityState === 'visible') {
        return this.checkServer();
      }
    };
  }

  get isServerAvailable() {
    return this.state === 'available';
  }

  checkServer() {
    if (this._checkPromise) return this._checkPromise;

    const request = this.fetchServerHealth();
    this._checkPromise = request.finally(() => {
      this._checkPromise = null;
    });
    return this._checkPromise;
  }

  async fetchServerHealth() {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let timeoutId = null;
    if (controller && this.timeoutMs > 0) {
      timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    }

    try {
      const response = await this.fetchImpl('/api/health', {
        method: 'GET',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        ...(controller ? { signal: controller.signal } : {})
      });
      if (!response?.ok) return this.updateAvailability(false);
      if (response.status === 204) return this.updateAvailability(true);

      const health = await response.json();
      return this.updateAvailability(health?.status === 'ok');
    } catch (_) {
      return this.updateAvailability(false);
    } finally {
      if (timeoutId !== null) clearTimeout(timeoutId);
    }
  }

  updateAvailability(available) {
    const nextState = available ? 'available' : 'unavailable';
    if (nextState === this.state) return available;

    const previousState = this.state;
    this.state = nextState;
    const EventConstructor = this.windowRef?.CustomEvent ||
      (typeof CustomEvent !== 'undefined' ? CustomEvent : null);
    if (this.windowRef?.dispatchEvent && EventConstructor) {
      this.windowRef.dispatchEvent(new EventConstructor(SERVER_CONNECTIVITY_EVENT, {
        detail: { available, state: nextState, previousState }
      }));
    }
    return available;
  }

  start() {
    if (this._started) return this.checkServer();
    this._started = true;

    this.windowRef?.addEventListener?.('online', this._refreshHandler);
    this.windowRef?.addEventListener?.('offline', this._refreshHandler);
    this.windowRef?.addEventListener?.('focus', this._refreshHandler);
    this.windowRef?.addEventListener?.('pageshow', this._resumeHandler);
    this.documentRef?.addEventListener?.('visibilitychange', this._visibilityHandler);
    this.documentRef?.addEventListener?.('resume', this._resumeHandler);
    this._intervalId = this.setIntervalImpl(() => {
      if (!this.documentRef || this.documentRef.visibilityState === 'visible') {
        return this.checkServer();
      }
    }, this.pollIntervalMs);

    return this.checkServer();
  }

  stop() {
    if (!this._started) return;
    this._started = false;
    this.windowRef?.removeEventListener?.('online', this._refreshHandler);
    this.windowRef?.removeEventListener?.('offline', this._refreshHandler);
    this.windowRef?.removeEventListener?.('focus', this._refreshHandler);
    this.windowRef?.removeEventListener?.('pageshow', this._resumeHandler);
    this.documentRef?.removeEventListener?.('visibilitychange', this._visibilityHandler);
    this.documentRef?.removeEventListener?.('resume', this._resumeHandler);
    if (this._intervalId !== null) this.clearIntervalImpl(this._intervalId);
    this._intervalId = null;
  }
}

if (typeof window !== 'undefined') {
  window.ServerConnectivityMonitor = ServerConnectivityMonitor;
  window.serverConnectivity = window.serverConnectivity || new ServerConnectivityMonitor();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SERVER_CONNECTIVITY_EVENT, ServerConnectivityMonitor };
}
