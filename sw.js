// sidduron service worker – offline support. Bump VERSION when this file changes.
const VERSION = 'v1';
const CACHE = 'sidduron-' + VERSION;
const CORE = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('sidduron-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // pages: network first (updates appear immediately), cache as offline fallback
  if (req.mode === 'navigate' || (url.origin === location.origin && url.pathname === '/')) {
    e.respondWith(fetch(req).then(r => { const cp = r.clone(); caches.open(CACHE).then(c => c.put('/', cp)); return r; })
      .catch(() => caches.match('/').then(r => r || caches.match('/index.html'))));
    return;
  }
  // own static files (icons, manifest) and Google Fonts: cache first, refresh in background
  if (url.origin === location.origin || url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open(CACHE).then(c => c.match(req).then(hit => {
      const net = fetch(req).then(r => { if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    })));
  }
  // everything else (video, Google Sheet, analytics) goes straight to the network
});
