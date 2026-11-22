/* Keeps the app shell on the phone so it opens without signal. Data itself is cached by backend.js. */
const CACHE = "umrah-shell-v1";
const SHELL = ["./", "./index.html", "./config.js", "./backend.js", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => Promise.allSettled(SHELL.map(u => c.add(u)))).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const req = e.request; if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.hostname.endsWith("supabase.co")) return; // live data and photos: always network
  const sameOrigin = url.origin === location.origin;
  if (sameOrigin && (req.mode === "navigate" || /\.(js|webmanifest)$/.test(url.pathname))) {
    // Network first so updates arrive, fall back to the saved copy offline.
    e.respondWith(fetch(req).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return r; }).catch(() => caches.match(req).then(r => r || caches.match("./index.html"))));
    return;
  }
  // Fonts, icons, library: cache first.
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => { if (r.ok || r.type === "opaque") { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return r; })));
});
