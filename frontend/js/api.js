/**
 * API Client for Lunabria Backend.
 * Load the domain scripts in js/services before this classic-script facade.
 */
const api = (() => {
  const layouts = createLayoutsApiService();

  // Copy methods without binding: internal calls and mutable state still use
  // the caller's receiver, including overrides made directly on api.
  return {
    ...createBooksApiService(),
    ...createVirtualLibrariesApiService(),
    ...createMetadataApiService(),
    _layoutBatches: layouts._layoutBatches,
    ...createProgressApiService(),
    getPageLayout: layouts.getPageLayout,
    prefetchLayouts: layouts.prefetchLayouts,
    ...createAnnotationsApiService(),
    ...createColorsApiService(),
    ...createDrawingsApiService()
  };
})();

if (typeof window !== 'undefined') {
  const flushBeacon = () => {
    if (api && typeof api.flushPendingProgressBeacon === 'function') {
      api.flushPendingProgressBeacon();
    }
  };
  window.addEventListener('beforeunload', flushBeacon);
  window.addEventListener('pagehide', flushBeacon);
}

window.api = api;
