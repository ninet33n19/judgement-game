// Judgement Card Game — Service Worker
// Caches app shell for fast loading / offline-capable static assets.
// Network-first for API/WebSocket; cache-first for static assets.

const CACHE_NAME = "judgement-v1";
const APP_SHELL = [
    "/",
    "/game",
    "/static/css/style.css",
    "/static/js/app.js",
    "/static/js/game.js",
    "/static/manifest.json",
    "/static/icons/icon-192.png",
    "/static/icons/icon-512.png",
];

// Install: pre-cache app shell
self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
    );
    self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys
                    .filter((key) => key !== CACHE_NAME)
                    .map((key) => caches.delete(key))
            )
        )
    );
    self.clients.claim();
});

// Fetch: network-first for navigation & WS, cache-first for static
self.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url);

    // Skip WebSocket and non-GET requests
    if (
        event.request.method !== "GET" ||
        url.protocol === "ws:" ||
        url.protocol === "wss:"
    ) {
        return;
    }

    // Navigation requests (HTML pages) — network first, fallback to cache
    if (event.request.mode === "navigate") {
        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                    return response;
                })
                .catch(() => caches.match(event.request))
        );
        return;
    }

    // Static assets — cache first, fallback to network
    if (url.pathname.startsWith("/static/")) {
        event.respondWith(
            caches.match(event.request).then(
                (cached) =>
                    cached ||
                    fetch(event.request).then((response) => {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                        return response;
                    })
            )
        );
        return;
    }

    // Everything else — network first
    event.respondWith(
        fetch(event.request).catch(() => caches.match(event.request))
    );
});
