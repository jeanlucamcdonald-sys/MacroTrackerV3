import { searchExternalDatabase } from './usda.js';
const CACHE_LIMIT = 60;
const CACHE_TTL = 15 * 60_000;
const cache = new Map();
const finite = value => Number.isFinite(Number(value)) && Number(value) >= 0;
async function searchOpenFoodFacts(query, signal) {
    const params = new URLSearchParams({ search_terms: query, search_simple: '1', action: 'process', json: '1', page_size: '16', fields: 'code,product_name,brands,nutriments' });
    const response = await fetch(`https://world.openfoodfacts.org/cgi/search.pl?${params}`, { signal });
    if (!response.ok) throw new Error(`Product lookup returned ${response.status}`);
    const data = await response.json();
    return (data.products || []).filter(product => product.product_name && ['energy-kcal_100g', 'proteins_100g', 'carbohydrates_100g', 'fat_100g'].every(key => finite(product.nutriments?.[key]))).map(product => ({
        id: `off_${product.code}`, name: `${product.product_name}${product.brands ? ' — ' + product.brands : ''}`,
        category: 'Branded product', serving: 100, unit: 'g', cal: Number(product.nutriments['energy-kcal_100g']),
        p: Number(product.nutriments.proteins_100g), c: Number(product.nutriments.carbohydrates_100g), f: Number(product.nutriments.fat_100g)
    }));
}
export async function searchProducts(query, { signal } = {}) {
    const key = query.trim().toLowerCase().replace(/\s+/g, ' ');
    signal?.throwIfAborted();
    const hit = cache.get(key);
    if (hit && Date.now() - hit.time < CACHE_TTL) return { foods: structuredClone(hit.foods), unavailable: [] };
    // An API failure never discards successful results from the other provider.
    const results = await Promise.allSettled([searchExternalDatabase(key, { signal }), searchOpenFoodFacts(key, signal)]);
    signal?.throwIfAborted();
    const unavailable = [];
    const foods = new Map();
    results.forEach((result, index) => {
        if (result.status === 'rejected') unavailable.push(index ? 'Open Food Facts' : 'USDA');
        else result.value.forEach(food => foods.set(String(food.id), food));
    });
    const list = [...foods.values()].slice(0, 30);
    if (!unavailable.length) {
        cache.delete(key); cache.set(key, { time: Date.now(), foods: list });
        if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
    }
    return { foods: list, unavailable };
}
