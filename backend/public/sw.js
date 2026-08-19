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

// ---------- Notifications push ----------
// Reçoit une notification envoyée par le serveur (nouveau message ou appel
// entrant) et l'affiche au niveau du système, même si l'application n'est pas
// ouverte à ce moment-là.
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (err) {
    payload = { title: 'seourouApps', body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'seourouApps';
  const options = {
    body: payload.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: payload.tag,
    requireInteraction: Boolean(payload.requireInteraction),
    data: payload.data || {},
  };

  event.waitUntil(
    // Si une fenêtre de l'app est déjà ouverte ET affichée à l'écran (l'utilisateur
    // est déjà en train de discuter), pas besoin d'une notification système en plus :
    // le message/l'appel apparaît déjà en direct dans l'interface (via Socket.io).
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const appVisible = clients.some((c) => c.visibilityState === 'visible' && c.focused);
      if (appVisible) return;
      return self.registration.showNotification(title, options);
    })
  );
});

// Clic sur une notification : ramène au premier plan un onglet déjà ouvert de
// l'app si possible, sinon en ouvre un nouveau.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.focus();
          client.postMessage({ type: 'notification-click', data });
          return;
        }
      }
      const url = data.conversationId ? '/?c=' + encodeURIComponent(data.conversationId) : '/';
      return self.clients.openWindow(url);
    })
  );
});
