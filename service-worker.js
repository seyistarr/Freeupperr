importScripts('/runtime-config.js');
const CACHE_NAME = 'freeupper-pwa-v4-' + self.FreeUpperConfig.environment;

const URLS_TO_CACHE = [
  './',
  './index.html',
  './create.htm',        // was create.html
  './profile.html',
  './search.html',
  './settings.html',
  './video.html',
  './chat.html',
  './chat.js',
  './global.css',
  './global.js',
  './manifest.webmanifest',
  './icon-192.png',      // generated icons
  './icon-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(URLS_TO_CACHE))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
    ))
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  if (new URL(event.request.url).pathname === '/runtime-config.js') {
    event.respondWith(fetch(event.request, { cache: 'no-store' }));
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;

      return fetch(event.request).then(response => {
        if (
          !response ||
          response.status !== 200 ||
          response.type !== 'basic'
        ) {
          return response;
        }

        const responseClone = response.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, responseClone);
        });

        return response;
      }).catch(async () => {
        // Never return index.html as JavaScript or CSS.
        if (event.request.mode === 'navigate') {
          return (await caches.match('./index.html')) || Response.error();
        }
        return Response.error();
      });
    })
  );
});
