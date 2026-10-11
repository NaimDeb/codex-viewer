// Offline app shell for the Codex PWA (phone). Caches the built UI so the app
// opens with the PC off. Data is NOT cached here — it lives in IndexedDB and
// syncs separately, so /api/* always goes to the network (and fails cleanly
// offline, which the app handles).
const CACHE = "codex-shell-v2";
// The app may live under a sub-path (the offline viewer on GitHub Pages), so
// every path below is relative to this worker's scope, not to the origin root.
const SCOPE = new URL(self.registration.scope).pathname;

self.addEventListener("install", (event) => {
  self.skipWaiting();
  // Viewer build only (vite manifest present): cache the whole app now, so
  // every screen works offline, not just the ones visited while online. The
  // snippet editor (Monaco, several MB) is left out — it is desktop-only.
  event.waitUntil(
    fetch(SCOPE + ".vite/manifest.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => {
        if (!m) return;
        const files = new Set([SCOPE]);
        for (const e of Object.values(m)) {
          if (e.file && !/monaco/i.test(e.file)) files.add(SCOPE + e.file);
          for (const c of e.css || []) files.add(SCOPE + c);
          for (const a of e.assets || []) files.add(SCOPE + a);
        }
        return caches.open(CACHE).then((c) => c.addAll([...files]));
      })
      .catch(() => {}),
  );
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith(SCOPE + "api/")) return; // data & sync are never cached
  if (url.pathname.endsWith("/handoff.html")) return; // the PC's live hand-off page

  // Navigations (index.html): network-first so updates land, cache as fallback.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match(SCOPE))),
    );
    return;
  }

  // Hashed assets: cache-first (immutable), fetch + cache on miss.
  event.respondWith(
    caches.match(req).then(
      (cached) =>
        cached ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
