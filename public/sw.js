const CACHE = "sticky-shell-public-v3";
// The root contains authenticated SSR data. Cache API ignores HTTP no-store,
// so only explicitly public install assets may enter this cache.
const SHELL = ["/manifest.webmanifest", "/brand/sticky-192.png", "/brand/sticky-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).catch(() => undefined));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((key) => key.startsWith("sticky-shell-") && key !== CACHE).map((key) => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => new Response(
      '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sticky is offline</title><body><h1>Sticky is offline</h1><p>Reconnect to load your workspace, then refresh this page.</p></body></html>',
      { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
    )));
  } else if (!url.search && SHELL.includes(url.pathname)) {
    event.respondWith(fetch(event.request).catch(async (error) => {
      const response = await (await caches.open(CACHE)).match(event.request);
      if (response) return response;
      throw error;
    }));
  }
});
