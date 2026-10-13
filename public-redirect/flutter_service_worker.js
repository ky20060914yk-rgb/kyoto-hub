// Kill switch for the retired Flutter app's service worker (registered at this
// path on kyodai-info.web.app). Browsers re-fetch this file to check for an
// update; this version wipes the old caches, unregisters itself and moves open
// tabs to the Next.js site. Without it, in-app browsers that kept the old worker
// (Instagram, LINE) spin on the cached Flutter loader forever.
// firebase.cutover.json must keep serving this file instead of redirecting it.
const NEXT = 'https://kyodai-info--kyodai-sns.asia-east1.hosted.app';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) await caches.delete(key);
    await self.registration.unregister();
    for (const client of await self.clients.matchAll({ type: 'window' })) {
      const u = new URL(client.url);
      client.navigate(NEXT + u.pathname + u.search);
    }
  })());
});
