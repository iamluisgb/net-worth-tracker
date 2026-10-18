// Service worker: offline shell for the net worth tracker.
// Relative URLs are resolved against the registration scope, so the app keeps
// working under a GitHub Pages subpath (e.g. /net-worth-tracker/).
const CACHE_PREFIX = 'my-worth';
const CACHE_VERSION = 'v2';
const CACHE_NAME = `${CACHE_PREFIX}-${CACHE_VERSION}`;

const SCOPE = self.registration.scope;
const scoped = (path) => new URL(path, SCOPE).href;

const APP_SHELL = [
    '',
    'index.html',
    'style.css',
    'app.js',
    'store.js',
    'fx.js',
    'drive.js',
    'manifest.json',
    'icon.svg',
].map(scoped);

const OFFLINE_URL = scoped('index.html');

const isCacheableAsset = (url) =>
    url.hostname === 'cdn.jsdelivr.net' ||
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com';

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        // Precache tolerantly: one missing file must not abort the install.
        await Promise.all(APP_SHELL.map((url) =>
            cache.add(url).catch((err) => console.warn('[sw] precache miss', url, err))
        ));
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(
            keys
                // Only touch caches owned by this app: the origin is shared with
                // other GitHub Pages projects.
                .filter((key) => (key.startsWith(CACHE_PREFIX) || key.startsWith('purse-')) && key !== CACHE_NAME)
                .map((key) => caches.delete(key))
        );
        await self.clients.claim();
    })());
});

const putInCache = async (request, response) => {
    if (!response || response.status !== 200 || response.type === 'opaque') return;
    const copy = response.clone();
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, copy);
};

const networkFirst = async (event, fallbackUrl) => {
    const { request } = event;
    try {
        const response = await fetch(request);
        event.waitUntil(putInCache(request, response));
        return response;
    } catch {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (fallbackUrl) {
            const offline = await caches.match(fallbackUrl);
            if (offline) return offline;
        }
        return new Response('Offline', {
            status: 503,
            statusText: 'Offline',
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
    }
};

const cacheFirst = async (event) => {
    const { request } = event;
    const cached = await caches.match(request);
    if (cached) {
        // Refresh the entry in the background for future visits.
        event.waitUntil(
            fetch(request)
                .then((response) => putInCache(request, response))
                .catch(() => {})
        );
        return cached;
    }
    const response = await fetch(request);
    event.waitUntil(putInCache(request, response));
    return response;
};

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    const sameOrigin = url.origin === self.location.origin;

    // Same-origin navigations: always try the network first so a deploy is
    // picked up immediately, falling back to the cached shell when offline.
    if (sameOrigin && request.mode === 'navigate') {
        event.respondWith(networkFirst(event, OFFLINE_URL));
        return;
    }

    // Same-origin assets (app.js, style.css, ...): fresh when online, cached
    // when offline. No build hashes, so cache-first would pin old code.
    if (sameOrigin) {
        event.respondWith(networkFirst(event));
        return;
    }

    // Versioned CDN assets (Chart.js, fonts): immutable, safe to serve cached.
    if (isCacheableAsset(url)) {
        event.respondWith(cacheFirst(event));
        return;
    }

    // Everything else (prices, FX, Google Drive/Identity) goes straight to the
    // network and is never cached here.
});
