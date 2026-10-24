/* IV Clients mobile — fonctionnement SANS internet.
   Les fichiers de l'application sont gardés dans l'appareil. Une nouvelle version
   publiée change CACHE (empreinte posée par fabriquer-mobile.py) : elle est
   téléchargée en arrière-plan et prend effet à l'ouverture suivante.
   Seuls les fichiers de l'application passent par ici : les données vivent dans
   IndexedDB, et le site Immigration Voyages ou les taux de change ne sont jamais
   mis en cache. */
'use strict';
const CACHE = 'iv-clients-1.37.0-e03a4831ba';
const FICHIERS = ["./", "assets/icon.png", "assets/icone-192.png", "assets/icone-512.png", "assets/logo-full.png", "index.html", "manifest.webmanifest", "mobile.js", "paquet.js", "renderer.js", "styles.css"];

// cache: 'reload' : une nouvelle version prend les fichiers du serveur, jamais
// ceux que le navigateur garde encore (GitHub Pages les garde 10 minutes)
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(FICHIERS.map((f) => new Request(f, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((cles) => Promise.all(cles.filter((k) => k.startsWith('iv-clients-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((r) => r || fetch(req)));
});
