/* =====================================================================
   M&T-app service worker — NETWORK-FIRST
   Doel: de nieuwste versie heeft altijd voorrang (geen vastzittende cache
   meer op Android), met een cache-fallback zodat de app ook offline opent.
   - Alleen GET op de eigen origin wordt gecachet.
   - API-calls naar de Cloudflare-Worker / Microsoft Graph / Moneybird gaan
     ALTIJD rechtstreeks (cross-origin → niet aangeraakt, nooit gecachet).
   ===================================================================== */
const CACHE = "mt-app-v2-2026-10-15r";   // v2.14.2: push-handlers erbij; restyling brok 1+2: mt-stijl-nieuw.css en mt-zijbalk.js erbij. Een nieuwe naam ruimt de oude cache op (er is geen precache-lijst: network-first, bestanden komen bij het eerste bezoek in de cache)

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

/* =====================================================================
   Pushmeldingen (L3b). De server stuurt alleen een aantal; de tekst is
   hier vast en algemeen ("M&T: N acties vragen aandacht"), dus ook een
   afwijkend bericht kan nooit klantnaam, bedrag of nummer tonen. De
   details staan pas na inloggen in de app.
   ===================================================================== */
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = {}; }
  const n = Number(d && d.n) > 0 ? Math.min(999, Math.floor(Number(d.n))) : 0;
  const tekst = n ? "M&T: " + n + (n === 1 ? " actie vraagt" : " acties vragen") + " aandacht" : "M&T: er zijn acties die aandacht vragen";
  e.waitUntil(self.registration.showNotification("M&T", {
    body: tekst,
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    tag: "mt-acties",                // een nieuwe melding vervangt de vorige (geen stapel)
    renotify: true,
    data: { url: "./mobiel.html" }
  }));
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const doel = new URL("./mobiel.html", self.location.href).href;
  e.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const open = tabs.find(c => c.url.split("#")[0].split("?")[0] === doel);
    if (open && "focus" in open) return open.focus();
    if (self.clients.openWindow) return self.clients.openWindow(doel);
  })());
});
