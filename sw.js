/* Spread Ledger service worker: makes the site installable and lets it open without a connection.
   App files are network-first so a new version on GitHub shows up on the next open.
   Trade data never goes through here; Firebase handles it directly. */
const CACHE = "ledger-v14";
const SHELL = ["./", "./index.html", "./view.html", "./outlook.js", "./firebase.js", "./config.js", "./manifest.webmanifest",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png", "./icons/favicon-32.png"];

self.addEventListener("install", ev => {
  ev.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", ev => {
  ev.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", ev => {
  const req = ev.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Versioned Firebase SDK files never change: serve from cache once fetched.
  if (url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/")){
    ev.respondWith(caches.open(CACHE).then(async c => (await c.match(req)) || fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; })));
    return;
  }
  if (url.origin !== self.location.origin) return;
  ev.respondWith(fetch(req).then(r => {
    if (r.ok) caches.open(CACHE).then(c => c.put(req, r.clone()));
    return r;
  }).catch(() => caches.match(req).then(m => m || caches.match("./index.html"))));
});
