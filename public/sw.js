// Orbit Meeting — Service Worker
// Cache strategy: Network-first for API/navigation, Cache-first for static assets.
// Always serve the latest for meeting sessions; offline fallback for static assets.

const CACHE_NAME = "orbit-v1";
const STATIC_CACHE = "orbit-static-v1";
const ASSET_EXTENSIONS = /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|webp|avif)$/;

// Installed on first load — precache the app shell
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(["/", "/manifest.json", "/icon.svg"]);
    })
  );
});

// Take control immediately
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== STATIC_CACHE && k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    )
  );
  return self.clients.claim();
});

// ── Message handler (reminders from client) ──────────────────────────────
self.addEventListener("message", (event) => {
  if (!event.data || event.data.type !== "orbit-show-notification") return;
  const { title, body, link, tag } = event.data.payload || {};
  if (!title || !body || !link) return;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag: tag || "orbit-reminder",
      icon: "/icon.svg",
      badge: "/icon.svg",
      data: { link },
      requireInteraction: true, // stay visible until user clicks
      vibrate: [200, 100, 200],
    }),
  );
});

// ── Notification click handler ────────────────────────────────────────────
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = event.notification.data?.link;
  if (!link) return;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        // Focus an existing tab if possible
        for (const client of clients) {
          if (client.url === link && "focus" in client) {
            return client.focus();
          }
        }
        // Open new tab
        if (self.clients.openWindow) {
          return self.clients.openWindow(link);
        }
      }),
  );
});

// Fetch handler: network-first for all requests, fallback to cache
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and non-http(s)
  if (request.method !== "GET" || !url.protocol.startsWith("http")) return;

  // Static assets: cache-first (fastest load)
  if (ASSET_EXTENSIONS.test(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // API routes and navigation: network-first (always fresh)
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/session/") ||
    url.pathname.startsWith("/auth/") ||
    url.pathname === "/" ||
    url.pathname === ""
  ) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Everything else: network-first
  event.respondWith(networkFirst(request));
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response("Offline", { status: 503 });
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    // For navigation requests, serve the app shell
    if (request.mode === "navigate") {
      const shell = await caches.match("/");
      if (shell) return shell;
    }
    return new Response("Offline", { status: 503 });
  }
}
