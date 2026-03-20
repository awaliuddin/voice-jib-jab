/**
 * Voice Jib-Jab Service Worker
 *
 * Strategy:
 *  - App shell (HTML, JS, CSS): stale-while-revalidate
 *  - API calls (/health, /metrics, /sessions, etc.): network-only (never cache)
 *  - Offline fallback: /offline.html served when navigation fails
 */

const CACHE_NAME = "vjj-shell-v1";

const SHELL_ASSETS = [
  "/",
  "/offline.html",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

// ── Install: pre-cache app shell ────────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: remove old caches ──────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

// ── Fetch: network-first for API, stale-while-revalidate for shell ──────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never cache API requests — voice data must always be fresh
  if (
    url.pathname.startsWith("/sessions") ||
    url.pathname.startsWith("/admin") ||
    url.pathname.startsWith("/analytics") ||
    url.pathname.startsWith("/metrics") ||
    url.pathname.startsWith("/health") ||
    url.pathname.startsWith("/voice") ||
    url.pathname.startsWith("/tenants") ||
    request.method !== "GET"
  ) {
    // Network-only: let it fail naturally (no offline stub for API)
    return;
  }

  // For navigation requests (HTML pages): network first, offline fallback
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/offline.html"))
    );
    return;
  }

  // For app shell assets: stale-while-revalidate
  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      });
      return cached ?? networkFetch;
    })
  );
});
