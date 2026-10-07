/* =====================================================================
   M&T-app service worker — NETWORK-FIRST
   Doel: de nieuwste versie heeft altijd voorrang (geen vastzittende cache
   meer op Android), met een cache-fallback zodat de app ook offline opent.
   - Alleen GET op de eigen origin wordt gecachet.
   - API-calls naar de Cloudflare-Worker / Microsoft Graph / Moneybird gaan
     ALTIJD rechtstreeks (cross-origin → niet aangeraakt, nooit gecachet).
   ===================================================================== */
const CACHE = "mt-app-v1";

self.addEventListener("install", () => {
  self.skipWaiting();               // nieuwe SW meteen actief maken
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();     // bestaande tabs meteen onder deze SW
  })());
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;                          // alleen GET
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;           // cross-origin (API) ongemoeid

  e.respondWith((async () => {
    try {
      const fresh = await fetch(req);                        // network-first
      if (fresh && fresh.status === 200 && fresh.type === "basic") {
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());                       // verse kopie bewaren voor offline
      }
      return fresh;
    } catch (err) {
      const cached = await caches.match(req);                // offline → laatst bekende
      if (cached) return cached;
      if (req.mode === "navigate") {
        const fallback = await caches.match("./mobiel.html");
        if (fallback) return fallback;
      }
      throw err;
    }
  })());
});
