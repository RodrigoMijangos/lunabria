const CACHE_NAME = 'lunabria-v0.12.0';
const STATIC_ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/db.js',
  './js/api.js',
  './js/views/ModalView.js',
  './js/models/ReaderModel.js',
  './js/models/LibraryModel.js',
  './js/views/reader/PDFPageView.js',
  './js/views/reader/TextLayerView.js',
  './js/views/reader/HighlightOverlayView.js',
  './js/views/reader/DrawingCanvasView.js',
  './js/views/reader/ReaderHUDView.js',
  './js/views/reader/ReaderSelectionLoupeView.js',
  './js/views/reader/NotesView.js',
  './js/views/ReaderViews.js',
  './js/views/library/BookCardView.js',
  './js/views/library/RecentReadsView.js',
  './js/views/library/VirtualLibraryView.js',
  './js/views/library/UploadModalView.js',
  './js/views/LibraryViews.js',
  './js/viewmodels/library/BookUploadManager.js',
  './js/viewmodels/library/BookMetadataManager.js',
  './js/viewmodels/library/VirtualLibraryManager.js',
  './js/viewmodels/library/HighlightColorSettingsManager.js',
  './js/viewmodels/library/SyncSettingsManager.js',
  './js/viewmodels/LibraryViewModel.js',
  './js/viewmodels/reader/ReaderNavigationViewModel.js',
  './js/viewmodels/reader/ReaderTextHighlightController.js',
  './js/viewmodels/reader/ReaderNativeSelectionLoupeController.js',
  './js/viewmodels/reader/ReaderDrawingViewModel.js',
  './js/viewmodels/reader/ReaderAnnotationViewModel.js',
  './js/viewmodels/reader/ReaderPageRenderer.js',
  './js/viewmodels/reader/ReaderNotesViewModel.js',
  './js/viewmodels/reader/ReaderToolbarManager.js',
  './js/viewmodels/ReaderViewModel.js',
  './js/reader.js',
  './js/app.js',
  './manifest.json'
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
