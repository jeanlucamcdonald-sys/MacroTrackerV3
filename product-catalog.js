let rows = [];
let index = [];
let promise;
const text = value => String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export async function loadCatalog() {
    return promise ||= fetch('./data/foods.json').then(async response => {
        if (!response.ok) throw new Error('Built-in food database could not be loaded');
        rows = await response.json();
        index = rows.map(food => ({ food, normalized: text(food.name), category: text(food.category) }));
        return rows;
    });
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
    index.forEach(({ food, normalized: name, category }) => consider(food, name, category));
    saved.forEach(food => consider(food, text(food.name), text(food.category), true));
    return [...scored.values()].sort((a, b) => b.score - a.score || a.food.name.length - b.food.name.length || a.food.name.localeCompare(b.food.name)).slice(0, limit).map(item => item.food);
}
