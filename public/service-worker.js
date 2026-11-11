const CACHE_NAME = 'digi-laptop-v20';
const APP_FILES = ['/', '/index.html', '/manifest.webmanifest', '/store-logo-transparent.png', '/login-laptops.webp', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;
  if (requestUrl.pathname.startsWith('/rest/') || requestUrl.pathname.startsWith('/auth/') || requestUrl.pathname.startsWith('/storage/')) return;
  if (requestUrl.pathname.startsWith('/src/') || requestUrl.pathname.startsWith('/@vite/') || requestUrl.pathname.startsWith('/node_modules/') || requestUrl.pathname.startsWith('/@id/') || requestUrl.pathname.startsWith('/@fs/')) return;
  event.respondWith(
    caches.match(event.request).then(async (cached) => {
      if (cached) return cached;
      try {
        const response = await fetch(event.request);
        if (response.ok) { const copy = response.clone(); caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)); }
        return response;
      } catch (error) {
        if (event.request.mode === 'navigate') return (await caches.match('/index.html')) || (await caches.match('/'));
        throw error;
      }
    })
  );
});
