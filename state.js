import { createStore } from './store.js';

// state.js

export const STORAGE_KEY = 'macroTrackerPro_State_v2';

// 1. Define safe structural defaults
const DEFAULT_STATE = {
    version: "2.0",
    settings: {
        onboardingComplete: false,
        goalWeight: 0,
        rate: "-1",
        isCalLocked: false
    },
    targets: {
        cal: 2000,
        p: 150,
        c: 200,
        f: 65
    },
    foodDatabase: [
        { id: 1, name: "Chicken Breast (Raw)", category: "Proteins", serving: 100, unit: "g", cal: 120, p: 22.5, c: 0, f: 2.6 },
        { id: 2, name: "Jasmine Rice (Dry)", category: "Carbs", serving: 45, unit: "g", cal: 160, p: 3, c: 36, f: 0 }
    ],
    weightLog: [],
    logs: {} // Sharded by YYYY-MM
};

// Persistence and validation stay here; store.js has no browser dependency.
function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function finiteMacros(value) {
    return isRecord(value) && ['cal', 'p', 'c', 'f'].every(key => Number.isFinite(value[key]) && value[key] >= 0);
}
export function validateState(state) {
    if (!isRecord(state) || !isRecord(state.settings) || !finiteMacros(state.targets)
        || !Array.isArray(state.foodDatabase) || !Array.isArray(state.weightLog)
        || !isRecord(state.logs) || (state.recipes !== undefined && !Array.isArray(state.recipes))) return false;
    if (!state.foodDatabase.every(food => finiteMacros(food) && typeof food.name === 'string' && Number.isFinite(food.serving) && food.serving > 0)) return false;
    if (state.recipes && !state.recipes.every(recipe => isRecord(recipe) && typeof recipe.name === 'string' && Array.isArray(recipe.ingredients))) return false;
    for (const month of Object.values(state.logs)) {
        if (!isRecord(month)) return false;
        for (const day of Object.values(month)) {
            if (!isRecord(day) || !finiteMacros(day.totals) || !Array.isArray(day.diary)
                || !day.diary.every(entry => finiteMacros(entry) && typeof entry.name === 'string' && typeof entry.timestamp === 'string')) return false;
        }
    }
    return true;
}
function normalizeState(parsed) {
    if (!isRecord(parsed) || !isRecord(parsed.targets) || !isRecord(parsed.logs)) throw new TypeError('Invalid backup file structure');
    const state = {
        ...structuredClone(DEFAULT_STATE), ...parsed,
        settings: { ...DEFAULT_STATE.settings, ...parsed.settings },
        targets: { ...DEFAULT_STATE.targets, ...parsed.targets }
    };
    if (!validateState(state)) throw new TypeError('Invalid state');
    return state;
}
export function saveLocalState(state) {
    // Throw on failure so the store does not publish a state that wasn't saved.
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
function loadLocalState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? normalizeState(JSON.parse(raw)) : structuredClone(DEFAULT_STATE);
    } catch (error) {
        console.error('Could not restore local state; using defaults:', error);
        return structuredClone(DEFAULT_STATE);
    }
}
export const store = createStore(loadLocalState(), { saveLocalState, validate: validateState });

export function exportUserData() {
    const data = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(store.get(), null, 2));
    const anchor = document.createElement('a');
    anchor.href = data;
    anchor.download = `macro_tracker_backup_${new Date().toISOString().split('T')[0]}.json`;
    document.body.append(anchor);
    try { anchor.click(); } finally { anchor.remove(); }
}
export async function importUserData(fileEvent, { signal } = {}) {
    const file = fileEvent.target.files[0];
    if (!file) throw new Error('No file selected');
    signal?.throwIfAborted();
    const text = await file.text();
    signal?.throwIfAborted();
    const imported = normalizeState(JSON.parse(text));
    store.update(draft => {
        for (const key of Object.keys(draft)) delete draft[key];
        Object.assign(draft, imported);
    });
    return true;
}
