/* Expense Tracker — service worker.
   App shell cached for offline-capable loads.
   Everything same-origin goes network-first (so updates always
   reach the user); the cache is only an offline fallback.
   Cross-origin (CDNs, Supabase) always hits the network. */
const CACHE = "expense-tracker-v8";
const ASSETS = [
  "./", "./index.html", "./style.css",
  "./i18n.js", "./db.js", "./categorize.js", "./importers.js",
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
  // Static assets: network-first too. Cache-first here previously pinned
  // users to the first build they ever loaded — fixes deployed to the
  // server never reached their screens.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
