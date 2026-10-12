let rows = [];
let index = [];
let promise;
const text = value => String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// Versioned separately from account storage; never copied into a user's Firestore document.
const catalogURL = new URL('./data/foods.json', import.meta.url);
const cacheName = 'macrotracker-food-catalog-usda-6636-v1';
const expectedCount = 6636;
function validateCatalog(data) {
    if (!Array.isArray(data) || data.length !== expectedCount) throw new Error(`Expected ${expectedCount} built-in foods`);
    const ids = new Set();
    for (const food of data) {
        if (!food || typeof food.name !== 'string' || !food.name.trim() || !food.id || ids.has(String(food.id))
            || !['cal', 'p', 'c', 'f', 'serving'].every(key => Number.isFinite(food[key]) && food[key] >= 0)
            || food.serving === 0) throw new Error('Invalid built-in food record');
        ids.add(String(food.id));
    }
    return data;
}
export async function loadCatalog() {
    if (rows.length) return rows;
    if (promise) return promise;
    promise = (async () => {
        let data;
        try {
            const response = await fetch(catalogURL, { signal: AbortSignal.timeout(10000) });
            if (!response.ok) throw new Error(`Built-in food database request failed (${response.status})`);
            data = validateCatalog(await response.json());
            // Cache failures in restricted browsers must not reject a valid catalog.
            if ('caches' in globalThis) void caches.open(cacheName)
                .then(cache => cache.put(catalogURL, new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })))
                .catch(() => {});
        } catch (error) {
            const cached = 'caches' in globalThis ? await caches.open(cacheName).then(cache => cache.match(catalogURL)).catch(() => null) : null;
            if (!cached) throw error;
            data = validateCatalog(await cached.json());
        }
        // Publish only a complete, validated catalog and its search index.
        const nextIndex = data.map(food => ({ food, normalized: text(food.name), category: text(food.category), barcode: text(food.barcode || '') }));
        rows = data;
        index = nextIndex;
        return rows;
    })();
    try { return await promise; }
    finally { promise = undefined; } // A failed request can be retried without reloading the app.
}
export function allFoods(saved = []) {
    const combined = new Map(saved.map(food => [String(food.id), food]));
    rows.forEach(food => { if (!combined.has(String(food.id))) combined.set(String(food.id), food); });
    return [...combined.values()];
}
export function findFood(id, saved = []) {
    return saved.find(food => String(food.id) === String(id)) || rows.find(food => String(food.id) === String(id));
}
export function searchFoods(query, saved = [], limit = 12) {
    const normalized = text(query);
    const words = normalized.split(' ').filter(Boolean);
    const scored = new Map();
    function consider(food, name, category, saved = false) {
        if (words.length && !words.every(word => name.includes(word) || category.includes(word))) return;
        const score = (name === normalized ? 1000 : name.startsWith(normalized) ? 500 : words.filter(word => name.split(' ').includes(word)).length * 30) + (saved ? 200 : 0);
        const old = scored.get(String(food.id));
        if (!old || old.food !== food) scored.set(String(food.id), { food, score });
    }
    index.forEach(({ food, normalized: name, category, barcode }) => consider(food, name, `${category} ${barcode}`));
    saved.forEach(food => consider(food, text(food.name), text(food.category), true));
    return [...scored.values()].sort((a, b) => b.score - a.score || a.food.name.length - b.food.name.length || a.food.name.localeCompare(b.food.name)).slice(0, limit).map(item => item.food);
}
