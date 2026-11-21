/* VaultBook offline cache. Your books are never stored here: they stay in IndexedDB.
 * - js/app.<hash>.js and css/app.<hash>.css (built by tools/build-site.py) never change once published, so they are
 *   served from the cache straight away and fetched only once.
 * - Everything else (the page itself, icons, lazily loaded helpers) asks the server first, with a cheap check when the
 *   file has not changed, and falls back to the saved copy when offline. A new build therefore shows up on the next
 *   open, and the phone downloads only the bundles whose contents changed. */
const CACHE = 'vaultbook-app-v4';
const SHARED = 'vaultbook-share';   // a bank file shared to VaultBook from another app (Android share sheet)
const HASHED = /\/(?:js|css)\/app\.[0-9a-f]{10}\.(?:js|css)$/;
const CORE = ['./', './index.html', './manifest.webmanifest', './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png'];

async function precache() {
  const cache = await caches.open(CACHE);
  await cache.addAll(CORE.map((u) => new Request(u, { cache: 'no-cache' })));
  const html = await (await cache.match('./index.html')).text();
  const assets = [...html.matchAll(/(?:src|href)="((?:js|css)\/app\.[0-9a-f]{10}\.(?:js|css))"/g)].map((m) => './' + m[1]);
  await cache.addAll(assets);
  // remove bundles from earlier builds
  const keep = new Set(assets.map((a) => new URL(a, self.registration.scope).href));
  for (const req of await cache.keys()) if (HASHED.test(new URL(req.url).pathname) && !keep.has(req.url)) await cache.delete(req);
}
self.addEventListener('install', (e) => { e.waitUntil(precache().then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== SHARED).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method === 'POST' && url.origin === self.location.origin && url.pathname.endsWith('/share-target')) {
    // keep the shared file for the Import screen, then open it (nothing leaves the device)
    e.respondWith((async () => {
      try {
        const form = await req.formData(), f = form.get('file');
        if (f && typeof f !== 'string') {
          const c = await caches.open(SHARED);
          await c.put('shared-file', new Response(f, { headers: { 'Content-Type': f.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(f.name || 'shared-file') } }));
        }
      } catch (err) { /* nothing to keep */ }
      return Response.redirect(new URL('./index.html#/m/feed/import?shared=1', self.registration.scope).href, 303);
    })());
    return;
  }
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (HASHED.test(url.pathname)) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  e.respondWith(fetch(req, { cache: 'no-cache' }).then((res) => {
    if (res && res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()))));
});
