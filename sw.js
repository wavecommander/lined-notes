/* ==========================================================================
   Lined Notes Service Worker
   Offline support, asset caching & PWA installation foundation
   ========================================================================== */

const CACHE_VERSION = 'lined-notes-v49';
const CACHE_NAME = `lined-notes-cache-${CACHE_VERSION}`;

// Core assets required for 100% offline functionality
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './manifest.json',
  './favicon.ico',
  './icons/icon.svg',
  './icons/icon-maskable.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32x32.png',
  './icons/favicon-16x16.png',
  // Modular CSS
  './css/main.css',
  './css/tokens.css',
  './css/base.css',
  './css/header.css',
  './css/player.css',
  './css/timeline.css',
  './css/controls.css',
  './css/notes.css',
  './css/modals.css',
  './css/mobile.css',
  // Modular JS
  './js/app.js',
  './js/config.js',
  './js/state.js',
  './js/utils.js',
  './js/db.js',
  './js/player.js',
  './js/timeline.js',
  './js/notes.js',
  './js/sessions.js',
  './js/export.js',
  './js/import.js',
  './js/waveform-utils.js',
  './js/waveform-worker.js',
  // Web Components
  './js/components/index.js',
  './js/components/modal-dialog.js',
  './js/components/note-card.js',
  './js/components/tag-picker.js',
  './js/components/time-display.js',
  './js/components/toast-notification.js',
  './js/components/mobile-tabs.js'
];

// Install: pre-cache static assets with cache: 'reload' to bypass stale browser HTTP disk cache
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        return Promise.all(
          PRECACHE_ASSETS.map((url) => {
            const req = new Request(url, { cache: 'reload' });
            return fetch(req)
              .then((resp) => {
                if (resp && resp.status === 200) {
                  return cache.put(url, resp);
                }
              })
              .catch((err) => {
                console.warn('[SW] Could not precache:', url, err);
              });
          })
        );
      })
      .then(() => self.skipWaiting())
  );
});

// Activate: clean up outdated caches and take immediate control
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name.startsWith('lined-notes-cache-') && name !== CACHE_NAME)
          .map((name) => {
            console.log('[SW] Removing old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: Strategy depending on request type
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle HTTP/HTTPS GET requests
  if (request.method !== 'GET' || !request.url.startsWith('http')) {
    return;
  }

  // Handle navigation requests (loading pages)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
          }
          return networkResponse;
        })
        .catch(async () => {
          // Offline fallback
          const cachedResponse = await caches.match(request, { ignoreSearch: true });
          if (cachedResponse) return cachedResponse;
          return caches.match('./index.html');
        })
    );
    return;
  }

  // For static assets: Stale-While-Revalidate
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cachedResponse) => {
      const fetchPromise = fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
          }
          return networkResponse;
        })
        .catch(() => {
          // Network failed, cache is our only hope
        });

      return cachedResponse || fetchPromise;
    })
  );
});

// Listen for messages from client
self.addEventListener('message', (event) => {
  if (!event.data) return;

  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
