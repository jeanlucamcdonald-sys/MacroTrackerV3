/* Cache only the public, same-origin app shell. Auth/API requests stay with Firebase. */
importScripts('./dist/build-version.js');
const CACHE = `macrotracker-shell-${self.MACROTRACKER_BUILD}`;
const SHELL = [
    './', './manifest.webmanifest', './icon.svg', './index.html', './main.js', './state.js', './store.js', './router.js', './dashboard.js',
    './usda.js', './units.js', './select-widget.js', './local-date.js', './styles.css',
    './nutrition-engine.js', './onboarding.js', './dialogs.js', './dashboard-context.js', './product-catalog.js', './product-search.js', './data/foods.json', './data/catalog-source.json',
    './persistence.js', './account.js', './cloud-sync.js', './cloud-model.js', './firebase-config.js',
    './dist/firebase-adapter.js', './dist/scanner.js', './dist/tailwind.css'
];
self.addEventListener('install', event => {
    event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
    event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('macrotracker-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
    if (event.request.mode === 'navigate') {
        event.respondWith(fetch(event.request).catch(() => caches.match('./index.html')));
    } else if (SHELL.some(path => new URL(path, self.location).href === url.href)) {
        event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(event.request)) || fetch(event.request)));
    }
});
