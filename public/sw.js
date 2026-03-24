const CACHE_NAME = "codex-mob-shell-v5";
const SHELL_ASSETS = ["/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(SHELL_ASSETS);
    }),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => {
            return caches.delete(key);
          }),
      ),
    ),
  );
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  const isHttpLike = url.protocol === "http:" || url.protocol === "https:";
  const isSameOrigin = url.origin === self.location.origin;

  if (request.method !== "GET") {
    return;
  }

  // Ignore extension/browser-internal requests (e.g. chrome-extension://)
  if (!isHttpLike || !isSameOrigin) {
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && response.type === "basic") {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone).catch(() => {
                // Ignore unsupported request schemes for Cache API.
              });
            });
          }
          return response;
        })
        .catch(async () => {
          const cachedRequest = await caches.match(request);
          if (cachedRequest) {
            return cachedRequest;
          }
          const fallbackRoot = await caches.match("/");
          if (fallbackRoot) {
            return fallbackRoot;
          }
          return new Response("Offline", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        }),
    );
    return;
  }

  if (url.pathname.startsWith("/_next/")) {
    return;
  }

  if (request.destination === "script" || request.destination === "style") {
    return;
  }

  if (!SHELL_ASSETS.includes(url.pathname)) {
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        return cached;
      }

      return fetch(request)
        .then((response) => {
          if (response.ok && response.type === "basic") {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone).catch(() => {
                // Ignore unsupported request schemes for Cache API.
              });
            });
          }
          return response;
        })
        .catch(() => caches.match("/"));
    }),
  );
});
