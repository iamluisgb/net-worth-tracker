const CACHE_NAME = 'purse-v1';
const PRECACHE_URLS = [
    '/',
    '/index.html',
    '/style.css',
    '/app.js',
    '/store.js',
    '/manifest.json',
    '/icon.svg'
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', (e) => {
    if (e.request.method !== 'GET') return;

    e.respondWith(
        caches.match(e.request).then((cached) => {
            if (cached) return cached;

            return fetch(e.request).then((res) => {
                if (!res.ok) return res;

                // Cache CDN resources on first fetch
                const url = e.request.url;
                if (
                    url.includes('cdn.jsdelivr.net') ||
                    url.includes('fonts.googleapis.com') ||
                    url.includes('fonts.gstatic.com')
                ) {
                    const clone = res.clone();
                    caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
                }

                return res;
            }).catch(() => caches.match('/index.html'));
        })
    );
});
