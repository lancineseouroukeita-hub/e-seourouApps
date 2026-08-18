// Service worker minimal pour seourouApps.
// Objectif : rendre l'app installable (PWA) et charger l'écran de connexion
// plus vite / hors-ligne. Il ne touche JAMAIS aux appels API (/api/...),
// au socket temps réel (Socket.io) ni aux appels WebRTC : seules les requêtes
// GET vers l'app shell (page, manifest, icônes) passent par le cache.

const CACHE_NAME = 'seourouapps-shell-v1';
const APP_SHELL = ['/', '/manifest.json', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Ne jamais intercepter : API, sockets, ou toute requête qui n'est pas un GET simple.
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/')) return;
  if (url.origin !== self.location.origin) return; // laisse passer les CDN externes (socket.io.min.js, etc.)

  // Stratégie "network first, fallback cache" : on a toujours la version la plus
  // récente quand il y a du réseau, et ça marche encore hors-ligne sinon.
  event.respondWith(
    fetch(req)
      .then((res) => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
        return res;
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match('/')))
  );
});
