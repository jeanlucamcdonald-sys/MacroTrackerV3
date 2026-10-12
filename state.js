import { createStore } from './store.js';
import { normalizeTargets, validTargets } from './nutrition-engine.js';
import { deviceCache } from './persistence.js';
import { localDateString } from './local-date.js';
import { parseDate, MACROS } from './history-model.js';

// state.js

export const STORAGE_KEY = 'macroTrackerPro_State_v2';

// 1. Define safe structural defaults
export const DEFAULT_STATE = {
    version: "3.0",
    profile: { displayName: '', weightUnit: 'kg', heightCm: null },
    settings: {
        onboardingComplete: false,
        goalWeight: 0,
        rate: "-1",
        isCalLocked: true
    },
    targets: {
        cal: 2000,
        p: 150,
        c: 200,
        f: 600 / 9
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
    if (!isRecord(state) || !isRecord(state.profile) || !isRecord(state.settings) || !validTargets(state.targets)
        || !Array.isArray(state.foodDatabase) || !Array.isArray(state.weightLog)
        || !isRecord(state.logs) || (state.recipes !== undefined && !Array.isArray(state.recipes))) return false;
    if (!state.foodDatabase.every(food => finiteMacros(food) && typeof food.name === 'string' && Number.isFinite(food.serving) && food.serving > 0)) return false;
    if (state.recipes && !state.recipes.every(recipe => isRecord(recipe) && typeof recipe.name === 'string' && Array.isArray(recipe.ingredients))) return false;
    if (!state.weightLog.every(entry => isRecord(entry) && Number.isFinite(entry.value) && entry.value > 0 && entry.value < 2000
        && ['kg', 'lb'].includes(entry.unit) && typeof entry.timestamp === 'string' && Number.isFinite(Date.parse(entry.timestamp))
        && typeof entry.id === 'string' && !!entry.id && !entry.id.includes('/'))) return false;
    for (const [monthKey, month] of Object.entries(state.logs)) {
        if (!isRecord(month)) return false;
        for (const [date, day] of Object.entries(month)) {
            try { parseDate(date); } catch { return false; }
            if (monthKey !== date.slice(0, 7) || day?.date !== date) return false;
            if (!isRecord(day) || !finiteMacros(day.totals) || !Array.isArray(day.diary)
                || !day.diary.every(entry => finiteMacros(entry) && typeof entry.name === 'string' && typeof entry.timestamp === 'string')) return false;
        }
    }
    return true;
}
export function normalizeState(parsed) {
    if (!isRecord(parsed) || !isRecord(parsed.targets) || !isRecord(parsed.logs)) throw new TypeError('Invalid backup file structure');
    const state = {
        ...structuredClone(DEFAULT_STATE), ...parsed,
        settings: { ...DEFAULT_STATE.settings, ...parsed.settings },
        targets: { ...DEFAULT_STATE.targets, ...parsed.targets }
    };
    state.targets = normalizeTargets(state.targets);
    state.profile = { ...DEFAULT_STATE.profile, ...state.profile };
    if (Array.isArray(state.weightLog)) state.weightLog = state.weightLog.map(entry => ({ ...entry, id: entry.id ?? entry.timestamp }));
    if (!validateState(state)) throw new TypeError('Invalid state');
    return state;
}
export function saveLocalState(state) {
    deviceCache.save(state);
}
async function loadDeviceState() {
    try {
        const cached = await deviceCache.read('guest');
        if (cached) return normalizeState(cached.state);
        // One-time migration; do not delete the legacy backup until the IDB commit succeeds.
        const raw = localStorage.getItem(STORAGE_KEY);
        const state = raw ? normalizeState(JSON.parse(raw)) : structuredClone(DEFAULT_STATE);
        deviceCache.save(state);
        await deviceCache.flush();
        if (raw) localStorage.removeItem(STORAGE_KEY);
        return state;
    } catch (error) {
        console.error('Device cache unavailable:', error);
        let state = structuredClone(DEFAULT_STATE);
        try { const raw = localStorage.getItem(STORAGE_KEY); if (raw) state = normalizeState(JSON.parse(raw)); } catch {}
        return state;
    }
}
export const store = createStore(await loadDeviceState(), { saveLocalState, validate: validateState });
export function replaceState(state) {
    const normalized = normalizeState(state);
    store.update(draft => {
        for (const key of Object.keys(draft)) delete draft[key];
        Object.assign(draft, normalized);
    });
}

export function backupDocument(state = store.get()) {
    return { backupFormat: 'macrotracker', backupVersion: 1, exportedAt: new Date().toISOString(), state };
}
export function parseBackup(text) {
    const parsed = JSON.parse(text);
    if (parsed?.backupFormat !== undefined && (parsed.backupFormat !== 'macrotracker' || parsed.backupVersion !== 1)) throw new TypeError('Unsupported backup format');
    const state = normalizeState(parsed?.backupFormat !== undefined ? parsed.state : parsed);
    // Stable IDs make merge behavior predictable; duplicate IDs on different dates are fine.
    const identified = rows => {
        const ids = new Set();
        for (const row of rows) {
            if (!['string', 'number'].includes(typeof row.id) || !String(row.id) || ids.has(String(row.id))) throw new TypeError('Backup contains missing or duplicate record IDs');
            ids.add(String(row.id));
        }
    };
    identified(state.foodDatabase); identified(state.recipes || []); identified(state.weightLog);
    Object.values(state.logs).forEach(month => Object.values(month).forEach(day => identified(day.diary)));
    return state;
}
export function mergeBackup(current, incoming) {
    const merged = structuredClone(current);
    const unique = (existing, additional) => {
        const rows = new Map(existing.map(row => [String(row.id), row]));
        additional.forEach(row => { if (!rows.has(String(row.id))) rows.set(String(row.id), row); });
        return [...rows.values()];
    };
    merged.foodDatabase = unique(merged.foodDatabase, incoming.foodDatabase);
    merged.recipes = unique(merged.recipes || [], incoming.recipes || []);
    merged.weightLog = unique(merged.weightLog, incoming.weightLog);
    for (const [month, days] of Object.entries(incoming.logs)) {
        merged.logs[month] ||= {};
        for (const [date, log] of Object.entries(days)) {
            const diary = unique(merged.logs[month][date]?.diary || [], log.diary);
            const totals = Object.fromEntries(MACROS.map(key => [key, diary.reduce((sum, entry) => sum + entry[key], 0)]));
            merged.logs[month][date] = { date, diary, totals };
        }
    }
    return normalizeState(merged);
}
export function applyBackup(imported, mode = 'replace') {
    if (!['replace', 'merge'].includes(mode)) throw new TypeError('Choose merge or replace');
    const next = mode === 'merge' ? mergeBackup(store.get(), imported) : normalizeState(imported);
    replaceState(next);
}
export function exportUserData() {
    const anchor = document.createElement('a');
    const url = URL.createObjectURL(new Blob([JSON.stringify(backupDocument(), null, 2)], { type: 'application/json' }));
    anchor.href = url;
    anchor.download = `macro-tracker-backup-${localDateString()}.json`;
    document.body.append(anchor);
    try { anchor.click(); } finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
export async function importUserData(fileEvent, { signal, mode = 'replace' } = {}) {
    const file = fileEvent.target.files[0];
    if (!file) throw new Error('No file selected');
    signal?.throwIfAborted();
    const text = await file.text();
    signal?.throwIfAborted();
    applyBackup(parseBackup(text), mode);
    return true;
}
