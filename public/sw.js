// Service worker for the home screen app.
//
// App shell (HTML, CSS, JS, icons): network first, cached copy when offline,
// so a new deploy shows up on the next load.
//
// Photos (Google Drive and any other image host): cache first. A photo is
// downloaded once and then served from the phone, so opening a card again
// does not hit Google. The cache keeps the most recent PHOTO_LIMIT photos.
// If a cached photo turns out to be broken, app.js deletes it from the cache.
//
// Sheet data (api/…) and fixtures are never cached: they always come live.
const SHELL_CACHE = 'flats-shell-v1';
const PHOTO_CACHE = 'flats-photos-v1';
const PHOTO_LIMIT = 300;
const SHELL = ['./', 'styles.css', 'app.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  const keep = [SHELL_CACHE, PHOTO_CACHE];
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !keep.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin !== location.origin) {
    if (req.destination === 'image' && url.protocol === 'https:') event.respondWith(photo(event));
    return;
  }

  const path = url.pathname.slice(new URL(self.registration.scope).pathname.length);
  if (path.startsWith('api/') || path.startsWith('fixtures/')) return;
  event.respondWith(shell(req));
});

async function shell(req) {
  const cache = await caches.open(SHELL_CACHE);
  // Every page URL (any ?query or #route) is the same single page.
  const key = req.mode === 'navigate' ? './' : req;
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(key, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(key, { ignoreSearch: req.mode === 'navigate' });
    if (hit) return hit;
    throw err;
  }
}

async function photo(event) {
  const req = event.request;
  const cache = await caches.open(PHOTO_CACHE);
  const hit = await cache.match(req.url);
  if (hit) return hit;
  const res = await fetch(req);
  // Cross-origin images come back opaque (status 0), so their status cannot
  // be read. Keep those and any 200; skip visible errors.
  if (res.ok || res.type === 'opaque') {
    event.waitUntil(cache.put(req.url, res.clone()).then(() => trim(cache)));
  }
  return res;
}

async function trim(cache) {
  const keys = await cache.keys();
  // Keys come back oldest first.
  await Promise.all(keys.slice(0, Math.max(0, keys.length - PHOTO_LIMIT)).map((k) => cache.delete(k)));
}
