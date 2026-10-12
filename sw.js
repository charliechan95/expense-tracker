/* Expense Tracker — service worker.
   App shell cached for instant, offline-capable loads.
   Navigations go network-first (so updates reach the user);
   static assets are cache-first. Cross-origin (CDNs, Supabase)
   always hits the network. */
const CACHE = "expense-tracker-v1";
const ASSETS = [
  "./", "./index.html", "./style.css",
  "./db.js", "./categorize.js", "./importers.js",
  "./config.js", "./sb.js", "./sync.js", "./app.js",
  "./manifest.json", "./icon-192.png", "./icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return; // CDN + Supabase: network only
  if (e.request.mode === "navigate") {
    // Network first for the page itself so updates aren't stuck behind cache.
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
          return res;
        })
        .catch(() => caches.match(e.request).then((r) => r || caches.match("./index.html")))
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request))
  );
});
