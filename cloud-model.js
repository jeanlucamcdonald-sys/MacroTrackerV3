import { DEFAULT_STATE, normalizeState } from './state.js';
function identifier(value) {
    const id = String(value);
    if (!id || id.includes('/') || id === '.' || id === '..') throw new TypeError('Invalid cloud document identifier');
    return id;
}
export function stateDocuments(state) {
    const documents = new Map([
        ['profile/current', { version: state.version, profile: state.profile || DEFAULT_STATE.profile, settings: state.settings, targets: state.targets }],
        ['catalog/current', { foodDatabase: state.foodDatabase, recipes: state.recipes || [] }]
    ]);
    for (const month of Object.values(state.logs)) {
        for (const [date, log] of Object.entries(month)) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new TypeError('Invalid diary date');
            documents.set(`logs/${date}`, log);
        }
    }
    for (const entry of state.weightLog) documents.set(`weightLogs/${identifier(entry.id ?? entry.timestamp)}`, entry);
    return documents;
}
export function documentsState(documents) {
    const state = structuredClone(DEFAULT_STATE);
    Object.assign(state, documents.get('profile/current') || {});
    Object.assign(state, documents.get('catalog/current') || {});
    state.logs = {};
    state.weightLog = [];
    for (const [path, data] of documents) {
        if (path.startsWith('logs/')) {
            const date = path.slice(5);
            state.logs[date.slice(0, 7)] ||= {};
            state.logs[date.slice(0, 7)][date] = data;
        } else if (path.startsWith('weightLogs/')) state.weightLog.push(data);
    }
    state.weightLog.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
    return normalizeState(state);
}
const stableJSON = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const equal = (a, b) => stableJSON(a) === stableJSON(b);
export function documentChanges(previous, next) {
    return [...new Set([...previous.keys(), ...next.keys()])].filter(path => !equal(previous.get(path), next.get(path)))
        .map(path => ({ path, data: next.get(path) ?? null }));
}
/** Merge changes to distinct documents; reject competing edits to the same diary. */
export function mergeOfflineState(base, local, remote) {
    const previous = stateDocuments(base);
    const offline = stateDocuments(local);
    const current = stateDocuments(remote);
    for (const { path, data } of documentChanges(previous, offline)) {
        if (!equal(current.get(path), previous.get(path)) && !equal(current.get(path), data ?? undefined)) {
            const error = new Error('Another device changed the same data. Export your device copy before reloading the cloud copy.');
            error.code = 'sync/conflict';
            throw error;
        }
        if (data === null) current.delete(path); else current.set(path, data);
    }
    return documentsState(current);
}
