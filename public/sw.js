const CACHE = 'gardencare-shell-v2';
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const response = await fetch('/', { cache: 'reload' });
    if (!response.ok) throw new Error('App shell unavailable');
    const html = await response.clone().text();
    // Scripts/CSS may load before a new worker takes control. Precache the
    // build's referenced assets so the first offline reopening can hydrate.
    const assets = [...new Set([...html.matchAll(/["'](\/_next\/static\/[^"']+)["']/g)].map(match => match[1].replaceAll('&amp;', '&')))];
    await cache.addAll(['/icon.svg', '/manifest.webmanifest', ...assets]);
    await cache.put('/', response);
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).then(response => { if (response.ok && url.pathname === '/') { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then(cache => cache.put('/', copy))); } return response; }).catch(() => caches.match('/')));
  } else if (url.pathname.startsWith('/_next/static/') || url.pathname === '/icon.svg') {
    event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => { const copy = response.clone(); if (response.ok) event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, copy))); return response; })));
  }
});
