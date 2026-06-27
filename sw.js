/* ================================================================
   sw.js  –  Dharamraj Silver Arts Service Worker
   Caches the shell (HTML/CSS/JS/assets) for offline capability.
   Live socket data is never cached.
   ================================================================ */

const CACHE_NAME = 'dharamraj-v3';

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/Media/Dharamraj_Logo-1000x1000.png',
  '/Media/android-chrome-192x192.png',
  '/Media/android-chrome-512x512.png',
  '/Media/apple-touch-icon.png',
  '/Media/favicon.ico',
  '/Media/favicon-32x32.png',
  '/Media/favicon-16x16.png',
  '/Media/site.webmanifest',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap',
];

/* Install: pre-cache shell */
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_ASSETS)).catch(() => { })
  );
});

/* Activate: purge old caches */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

/* Fetch: cache-first for shell, network-only for socket/API */
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  /* Never intercept Socket.IO or API routes */
  if (url.pathname.startsWith('/socket.io') || url.pathname.startsWith('/api')) return;

  /* Network-first for all assets to ensure fresh updates on normal refresh */
  event.respondWith(
    fetch(event.request).then(response => {
      if (response && response.status === 200) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
      }
      return response;
    }).catch(() => {
      // Fallback to cache if network fails (offline)
      if (event.request.mode === 'navigate') {
        return caches.match('/index.html');
      }
      return caches.match(event.request);
    })
  );
});
