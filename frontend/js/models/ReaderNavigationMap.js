class ReaderNavigationMap {
  constructor() {
    this.reset();
  }

  reset() {
    this.toc = [];
    this.destinations = new Map();
    this.jumpHistory = [];
  }

  setTableOfContents(toc, destinations = new Map()) {
    this.toc = Array.isArray(toc) ? toc : [];
    this.destinations = new Map();

    if (destinations instanceof Map) {
      for (const [destination, page] of destinations) {
        this.setDestination(destination, page);
      }
    }
  }

  setDestination(destination, page) {
    if (typeof destination !== 'string' || !destination || !Number.isInteger(page) || page < 1) {
      return false;
    }

    this.destinations.set(destination, page);
    return true;
  }

  resolveDestination(destination) {
    if (typeof destination === 'string' && this.destinations.has(destination)) {
      return this.destinations.get(destination);
    }

    const page = typeof destination === 'number'
      ? destination
      : (typeof destination === 'string' && /^\d+$/.test(destination) ? Number(destination) : null);
    return Number.isInteger(page) && page > 0 ? page : null;
  }

  pushJump(originPage) {
    if (!Number.isInteger(originPage) || originPage < 1) return false;
    this.jumpHistory.push(originPage);
    return true;
  }

  popJump() {
    return this.jumpHistory.pop() ?? null;
  }

  peekJumpOrigin() {
    return this.jumpHistory[this.jumpHistory.length - 1] ?? null;
  }

  hasJumpHistory() {
    return this.jumpHistory.length > 0;
  }
}

window.ReaderNavigationMap = ReaderNavigationMap;
