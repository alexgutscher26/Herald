/* Herald public PWA shell. Dashboard and API requests are never intercepted. */
const CACHE = "herald-public-v1";
const OFFLINE_URL = "/offline";
const PRECACHE = [
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

const PRIVATE_PATH =
  /^\/(?:app(?:\/|$)|api(?:\/|$)|sign-in|sign-up|auth(?:\/|$)|widget(?:\/|$)|p\/.*\/(?:login|preferences)(?:\/|$))/;
const STATIC_PATH = /^\/(?:icons\/|manifest\.webmanifest$)/;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (PRIVATE_PATH.test(url.pathname)) return;

  // A custom-domain product serves `/help` at its root, so navigation is
  // handled by exclusion (private paths above) rather than by canonical path.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        return (await caches.match(OFFLINE_URL)) ?? Response.error();
      }),
    );
    return;
  }

  if (STATIC_PATH.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => cached ?? fetch(request)),
    );
  }
});
