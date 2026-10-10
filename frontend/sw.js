const CACHE_NAME = 'lunabria-v1.7.0';
const COVER_CACHE_NAME = 'lunabria-covers-v1';
const CACHEABLE_EXTERNAL_ORIGINS = new Set([
  'https://cdn.jsdelivr.net',
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com'
]);
// Match the HTML query strings exactly: CacheStorage keys include search parameters.
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons.svg',
  './icons/favicon.svg',
  './icons/icon-192.png',
  './icons/maskable-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './css/style.css?v=1.0.12-async-upload',
  './css/mobile/mobile-reader.css?v=1.1.3',
  './js/services/http.js?v=1.0.0',
  './js/services/connectivity.js?v=1.0.4',
  './js/db.js?v=1.4.5',
  './js/services/books.js?v=1.0.11-async-upload',
  './js/services/virtual-libraries.js?v=1.0.8',
  './js/services/metadata.js?v=1.0.8',
  './js/services/progress.js?v=1.0.8',
  './js/services/layouts.js?v=1.0.8',
  './js/services/annotations.js?v=1.0.9',
  './js/services/colors.js?v=1.0.8',
  './js/services/drawings.js?v=1.0.8',
  './js/api.js?v=1.0.8',
  './js/models/ReaderModel.js?v=1.3.0',
  './js/models/LibraryModel.js?v=0.8.3-async-upload',
  './js/views/reader/PDFPageView.js?v=0.6.2',
  './js/views/reader/TextLayerView.js?v=1.0.10-selection-hit-test',
  './js/views/reader/HighlightOverlayView.js?v=1.3.0',
  './js/views/reader/DrawingCanvasView.js?v=0.6.0',
  './js/views/reader/ReaderHUDView.js?v=0.6.21',
  './js/views/reader/ReaderSelectionLoupeView.js?v=0.6.8',
  './js/views/reader/NotesView.js?v=1.0.9',
  './js/views/ReaderViews.js?v=0.6.0',
  './js/views/ModalView.js?v=0.6.2',
  './js/views/library/BookCardView.js?v=1.4.3',
  './js/views/library/RecentReadsView.js?v=0.9.3',
  './js/views/library/VirtualLibraryView.js?v=1.0.9',
  './js/views/library/UploadModalView.js?v=1.0.10-async-upload',
  './js/views/ui/ToastView.js?v=1.0.0',
  './js/views/LibraryViews.js?v=0.6.0',
  './js/views/library/CatalogView.js?v=1.0.8',
  './js/views/library/CatalogPaginationView.js?v=1.0.8',
  './js/views/library/CatalogSelectionView.js?v=1.0.8',
  './js/viewmodels/library/BookUploadManager.js?v=1.0.10-async-upload',
  './js/viewmodels/library/BookMetadataManager.js?v=1.0.10',
  './js/viewmodels/library/VirtualLibraryManager.js?v=0.8.1',
  './js/viewmodels/library/HighlightColorSettingsManager.js?v=1.4.0',
  './js/viewmodels/library/SyncSettingsManager.js?v=1.4.0',
  './js/viewmodels/library/CatalogSelectionManager.js?v=1.0.8',
  './js/viewmodels/LibraryViewModel.js?v=1.4.12',
  './js/viewmodels/reader/ReaderNavigationViewModel.js?v=1.0.6',
  './js/viewmodels/reader/ReaderTextHighlightController.js?v=1.3.0',
  './js/services/reader/ReaderTextTargetGeometry.js?v=1.0.0',
  './js/viewmodels/reader/ReaderNativeSelectionLoupeController.js?v=1.4.0',
  './js/viewmodels/reader/ReaderDrawingInteractionController.js?v=1.0.0',
  './js/viewmodels/reader/ReaderDrawingPersistenceController.js?v=1.0.0',
  './js/viewmodels/reader/ReaderDrawingToolController.js?v=1.0.0',
  './js/viewmodels/reader/ReaderDrawingViewModel.js?v=1.4.0',
  './js/services/reader/ReaderSelectionGeometry.js?v=1.0.10-selection-layout',
  './js/viewmodels/reader/ReaderAnnotationViewModel.js?v=1.4.2',
  './js/viewmodels/reader/ReaderPageRenderer.js?v=1.4.0',
  './js/viewmodels/reader/ReaderNotesViewModel.js?v=1.0.9',
  './js/viewmodels/reader/ReaderToolbarManager.js?v=1.3.1',
  './js/services/reader/ReaderOfflineService.js?v=1.0.9',
  './js/viewmodels/reader/ReaderEventBindings.js?v=1.4.0',
  './js/viewmodels/reader/ReaderDocumentLifecycle.js?v=1.4.3',
  './js/mobile/DeviceEnvironment.js?v=1.1.1',
  './js/mobile/MobileHUDView.js?v=1.1.2',
  './js/mobile/MobileDrawingToolbarView.js?v=1.3.0',
  './js/mobile/MobileSelectionController.js?v=1.4.1',
  './js/mobile/MobilePWAInstaller.js?v=1.1.0',
  './js/mobile/MobileReaderController.js?v=1.3.0',
  './js/viewmodels/ReaderViewModel.js?v=1.4.2',
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
        keys.filter((key) => key !== CACHE_NAME && key !== COVER_CACHE_NAME)
          .map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.action === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin && !CACHEABLE_EXTERNAL_ORIGINS.has(url.origin)) return;

  // Keep each viewed cover locally across app and service-worker updates.
  if (event.request.method === 'GET' && /^\/api\/books\/\d+\/cover$/.test(url.pathname)) {
    event.respondWith((async () => {
      let coverCache = null;
      try {
        coverCache = await caches.open(COVER_CACHE_NAME);
        const cachedResponse = await coverCache.match(event.request);
        if (cachedResponse) return cachedResponse;
      } catch {}

      let timerId;
      const timeoutPromise = new Promise((_, reject) => {
        timerId = setTimeout(() => reject(new Error('Network timeout')), 10000);
      });
      try {
        const response = await Promise.race([fetch(event.request), timeoutPromise]);
        const contentType = response.headers?.get?.('Content-Type') || '';
        if (coverCache && response.status === 200 && contentType.startsWith('image/')) {
          try {
            await coverCache.put(event.request, response.clone());
          } catch {}
        }
        return response;
      } catch {
        return new Response(JSON.stringify({ offline: true, error: 'No network connection' }), {
          status: 503,
          statusText: 'Service Unavailable',
          headers: { 'Content-Type': 'application/json' }
        });
      } finally {
        if (timerId) clearTimeout(timerId);
      }
    })());
    return;
  }

  // For other API endpoints, verify connectivity with the actual request and fall back to offline 503.
  if (url.pathname.startsWith('/api/')) {
    if (event.request.method === 'POST' && url.pathname === '/api/books/upload') {
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

    // Prune deleted book cover from COVER_CACHE_NAME upon successful DELETE
    if (event.request.method === 'DELETE' && /^\/api\/books\/\d+$/.test(url.pathname)) {
      const match = url.pathname.match(/^\/api\/books\/(\d+)$/);
      if (match) {
        const bookId = match[1];
        caches.open(COVER_CACHE_NAME).then(coverCache => {
          coverCache.delete(`/api/books/${bookId}/cover`);
        }).catch(() => {});
      }
    }

    const isLargeTransfer = url.pathname.endsWith('/pdf') || url.pathname.includes('/upload');
    const apiTimeoutMs = isLargeTransfer ? 60000 : 10000;

    let timerId;
    const timeoutPromise = new Promise((_, reject) => {
      timerId = setTimeout(() => reject(new Error('Network timeout')), apiTimeoutMs);
    });

    event.respondWith(
      Promise.race([fetch(event.request), timeoutPromise])
        .finally(() => {
          if (timerId) clearTimeout(timerId);
        })
        .catch(() => {
          return new Response(JSON.stringify({ offline: true, error: 'No network connection' }), {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'application/json' }
          });
        })
    );
    return;
  }

  // Stale-While-Revalidate / Cache-First for static assets:
  // Serve from cache immediately if available (0ms offline startup),
  // while updating cache in background when connected.
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const networkFetch = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          if (cachedResponse) return cachedResponse;
          if (typeof Response !== 'undefined') {
            return new Response('Asset unavailable offline', {
              status: 404,
              statusText: 'Not Found',
              headers: { 'Content-Type': 'text/plain' }
            });
          }
          return cachedResponse;
        });

      return cachedResponse || networkFetch;
    })
  );
});
