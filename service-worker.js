/* IV Clients mobile — fonctionnement SANS internet.
   Les fichiers de l'application sont gardés dans l'appareil. Une nouvelle version
   publiée change CACHE (empreinte posée par fabriquer-mobile.py) : elle est
   téléchargée en arrière-plan, puis la page est rechargée (voir « activate »).
   Seuls les fichiers de l'application passent par ici : les données vivent dans
   IndexedDB, et le site Immigration Voyages ou les taux de change ne sont jamais
   mis en cache. */
'use strict';
const CACHE = 'iv-clients-1.41.0-1854d700c4';
const FICHIERS = ["./", "assets/icon.png", "assets/icone-192.png", "assets/icone-512.png", "assets/logo-full.png", "index.html", "manifest.webmanifest", "mobile.js", "paquet.js", "renderer.js", "styles.css"];

// cache: 'reload' : une nouvelle version prend les fichiers du serveur, jamais
// ceux que le navigateur garde encore (GitHub Pages les garde 10 minutes)
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(FICHIERS.map((f) => new Request(f, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

/* Mise à jour (25/10/2026) : la page déjà ouverte tourne encore avec l'ancienne
   version (jusqu'à la 1.33.0, elle réclamait le paquet du PC) ; on la recharge
   aussitôt, la nouvelle s'affiche dès cette ouverture-ci. Pas au tout premier
   lancement : aucune ancienne version à remplacer.
   Le rechargement part APRÈS l'activation, hors de waitUntil (1.38.2, 26/10/2026) : la page rechargée
   attend que ce service worker soit activé, et l'activation attendrait la page — blocage vu dans
   Chrome 156, la page ne se rechargeait jamais. */
self.addEventListener('activate', (e) => {
  const fait = caches.keys().then(async (cles) => {
    const anciens = cles.filter((k) => k.startsWith('iv-clients-') && k !== CACHE);
    await Promise.all(anciens.map((k) => caches.delete(k)));
    await self.clients.claim();
    return anciens.length > 0;
  });
  e.waitUntil(fait);
  fait.then((maj) => maj && self.clients.matchAll({ type: 'window' }))
    .then((pages) => (pages || []).forEach((p) => p.navigate(p.url).catch(() => {})))
    .catch(() => {});
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((r) => r || fetch(req)));
});
