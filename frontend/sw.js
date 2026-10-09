const CACHE_NAME = 'lunabria-v1.2.0';
// Match the HTML query strings exactly: CacheStorage keys include search parameters.
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './css/style.css?v=1.0.10-selection-layout',
  './css/mobile/mobile-reader.css?v=1.1.2',
  './js/db.js?v=1.0.6',
  './js/services/books.js?v=1.0.8',
  './js/services/virtual-libraries.js?v=1.0.8',
  './js/services/metadata.js?v=1.0.8',
  './js/services/progress.js?v=1.0.8',
  './js/services/layouts.js?v=1.0.8',
  './js/services/annotations.js?v=1.0.8',
  './js/services/colors.js?v=1.0.8',
  './js/services/drawings.js?v=1.0.8',
  './js/api.js?v=1.0.8',
  './js/models/ReaderModel.js?v=1.0.7',
  './js/models/LibraryModel.js?v=0.8.1',
  './js/views/reader/PDFPageView.js?v=0.6.2',
  './js/views/reader/TextLayerView.js?v=1.0.10-selection-hit-test',
  './js/views/reader/HighlightOverlayView.js?v=0.6.9',
  './js/views/reader/DrawingCanvasView.js?v=0.6.0',
  './js/views/reader/ReaderHUDView.js?v=0.6.21',
  './js/views/reader/ReaderSelectionLoupeView.js?v=0.6.8',
  './js/views/reader/NotesView.js?v=1.0.9',
  './js/views/ReaderViews.js?v=0.6.0',
  './js/views/ModalView.js?v=0.6.2',
  './js/views/library/BookCardView.js?v=1.0.9',
  './js/views/library/RecentReadsView.js?v=0.9.2',
  './js/views/library/VirtualLibraryView.js?v=1.0.9',
  './js/views/library/UploadModalView.js?v=1.0.9',
  './js/views/LibraryViews.js?v=0.6.0',
  './js/views/library/CatalogView.js?v=1.0.8',
  './js/views/library/CatalogPaginationView.js?v=1.0.8',
  './js/views/library/CatalogSelectionView.js?v=1.0.8',
  './js/viewmodels/library/BookUploadManager.js?v=1.0.9',
  './js/viewmodels/library/BookMetadataManager.js?v=1.0.9',
  './js/viewmodels/library/VirtualLibraryManager.js?v=0.8.0',
  './js/viewmodels/library/HighlightColorSettingsManager.js?v=0.6.2',
  './js/viewmodels/library/SyncSettingsManager.js?v=1.0.9',
  './js/viewmodels/library/CatalogSelectionManager.js?v=1.0.8',
  './js/viewmodels/LibraryViewModel.js?v=1.0.8',
  './js/viewmodels/reader/ReaderNavigationViewModel.js?v=1.0.6',
  './js/viewmodels/reader/ReaderTextHighlightController.js?v=1.0.10',
  './js/viewmodels/reader/ReaderNativeSelectionLoupeController.js?v=1.0.10-selection-anchor-v6',
  './js/viewmodels/reader/ReaderDrawingViewModel.js?v=0.6.16',
  './js/services/reader/ReaderSelectionGeometry.js?v=1.0.10-selection-layout',
  './js/viewmodels/reader/ReaderAnnotationViewModel.js?v=1.1.1',
  './js/viewmodels/reader/ReaderPageRenderer.js?v=1.0.7',
  './js/viewmodels/reader/ReaderNotesViewModel.js?v=1.0.9',
  './js/viewmodels/reader/ReaderToolbarManager.js?v=1.0.12',
  './js/services/reader/ReaderOfflineService.js?v=1.0.8',
  './js/viewmodels/reader/ReaderEventBindings.js?v=1.0.8',
  './js/viewmodels/reader/ReaderDocumentLifecycle.js?v=1.1.1',
  './js/mobile/DeviceEnvironment.js?v=1.1.1',
  './js/mobile/MobileHUDView.js?v=1.1.2',
  './js/mobile/MobileDrawingToolbarView.js?v=1.1.2',
  './js/mobile/MobileSelectionController.js?v=1.1.1',
  './js/mobile/MobilePWAInstaller.js?v=1.1.0',
  './js/mobile/MobileReaderController.js?v=1.1.1',
  './js/viewmodels/ReaderViewModel.js?v=1.0.8',
  './js/reader.js?v=0.6.0',
  './js/app.js?v=0.6.0',
  './css/themes.css',
  './css/base-navbar.css',
  './css/library-catalog.css',
  './css/library-cards.css',
  './css/reader-pages.css',
  './css/drawing.css',
  './css/reader-selection-drawer.css',
  './css/modals.css',
  './css/notebook.css',
  './css/responsive.css',
  './css/design.css'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // For API endpoints, prefer network first, fallback to offline if needed
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(JSON.stringify({ offline: true, error: 'No network connection' }), {
          status: 503,
          statusText: 'Service Unavailable',
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }

  // Network-First for HTML, JS and CSS so updates are loaded immediately
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => caches.match(event.request))
  );
});
