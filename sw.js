// sidduron service worker – loads instantly from the device, updates in the background.
// Bump VERSION when this file changes.
const VERSION = 'v2';
const CACHE = 'sidduron-' + VERSION;
const CORE = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/privacy.html'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('sidduron-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// fetch with a time limit, so a weak signal never blocks anything
function fetchWithTimeout(req, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    fetch(req, { cache: 'no-store' }).then(r => { clearTimeout(t); resolve(r); }, err => { clearTimeout(t); reject(err); });
  });
}

// background refresh of the main page; tells open pages when a new version was saved
async function refreshPage(cache) {
  try {
    const r = await fetchWithTimeout('/', 30000);
    if (!r || !r.ok) return;
    const fresh = await r.clone().text();
    const old = await cache.match('/');
    const oldText = old ? await old.text() : null;
    if (fresh !== oldText) {
      await cache.put('/', r);
      if (oldText !== null) {
        const clients = await self.clients.matchAll({ type: 'window' });
        clients.forEach(c => c.postMessage({ type: 'sidduron-updated' }));
      }
    }
  } catch (e) { /* offline or weak signal – keep the saved copy */ }
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === location.origin;

  // the siddur page: answer from the device immediately, refresh in the background
  if (sameOrigin && (url.pathname === '/' || url.pathname === '/index.html')) {
    e.respondWith(caches.open(CACHE).then(async cache => {
      const hit = await cache.match('/');
      if (hit) { e.waitUntil(refreshPage(cache)); return hit; }
      // first visit (nothing saved yet): use the network, then save
      const r = await fetch(req);
      if (r.ok) cache.put('/', r.clone());
      return r;
    }));
    return;
  }

  // own files (icons, manifest, privacy) and Google Fonts: from the device, refreshed in the background
  if (sameOrigin || url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open(CACHE).then(async cache => {
      const hit = await cache.match(req);
      const net = fetchWithTimeout(req, 15000)
        .then(r => { if (r.ok || r.type === 'opaque') cache.put(req, r.clone()); return r; })
        .catch(() => hit);
      if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
      return net;
    }));
  }
  // everything else (video, Google Sheet, statistics) goes straight to the network
});
