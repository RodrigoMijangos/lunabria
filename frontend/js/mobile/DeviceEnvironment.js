/**
 * DeviceEnvironment.js
 * Single source of truth for device, touch, and viewport environment detection.
 * Reactive: listens to viewport resizing and media query changes.
 */
class DeviceEnvironment {
  constructor() {
    this.listeners = new Set();
    this.isMobile = this.checkIsMobile();
    this.isTouch = this.checkIsTouch();
    this.bindEvents();
  }

  checkIsMobile() {
    if (typeof window === 'undefined') return false;
    const width = window.innerWidth || document.documentElement?.clientWidth || 0;
    const nav = typeof navigator !== 'undefined' ? navigator : (typeof window !== 'undefined' ? window.navigator : null);
    const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(nav?.userAgent || '');
    const matchesCoarse = window.matchMedia ? (window.matchMedia('(pointer: coarse)').matches || window.matchMedia('(any-pointer: coarse)').matches) : false;
    return width <= 850 || isMobileUA || (matchesCoarse && width <= 1024);
  }

  checkIsTouch() {
    if (typeof window === 'undefined') return false;
    const nav = typeof navigator !== 'undefined' ? navigator : (typeof window !== 'undefined' ? window.navigator : null);
    return ('ontouchstart' in window) ||
      ((nav?.maxTouchPoints || 0) > 0) ||
      (window.matchMedia ? (window.matchMedia('(pointer: coarse)').matches || window.matchMedia('(any-pointer: coarse)').matches) : false);
  }

  checkIsPWA() {
    if (typeof window === 'undefined') return false;
    const nav = typeof navigator !== 'undefined' ? navigator : (typeof window !== 'undefined' ? window.navigator : null);
    return (window.matchMedia ? window.matchMedia('(display-mode: standalone)').matches : false) ||
      nav?.standalone === true ||
      window.navigator?.standalone === true;
  }

  isMobileReaderActive() {
    return this.checkIsMobile() || (this.checkIsTouch() && (window.innerWidth <= 1024));
  }

  bindEvents() {
    if (typeof window === 'undefined') return;

    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const nextMobile = this.checkIsMobile();
        const nextTouch = this.checkIsTouch();
        if (nextMobile !== this.isMobile || nextTouch !== this.isTouch) {
          this.isMobile = nextMobile;
          this.isTouch = nextTouch;
          this.notify();
        }
      }, 100);
    });

    if (window.matchMedia) {
      const mediaQuery = window.matchMedia('(max-width: 768px)');
      const mediaHandler = (e) => {
        this.isMobile = this.checkIsMobile();
        this.notify();
      };
      if (mediaQuery.addEventListener) {
        mediaQuery.addEventListener('change', mediaHandler);
      } else if (mediaQuery.addListener) {
        mediaQuery.addListener(mediaHandler);
      }
    }
  }

  onChange(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  notify() {
    for (const listener of this.listeners) {
      try {
        listener(this.isMobile, this);
      } catch (err) {
        console.error('[DeviceEnvironment] Listener error:', err);
      }
    }
  }
}

window.DeviceEnvironment = DeviceEnvironment;
