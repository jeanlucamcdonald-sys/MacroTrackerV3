/** IndexedDB device cache, partitioned by account. Cloud copies are authoritative. */
const DATABASE = 'macrotracker-v3';
let dbPromise;
function database() {
    return dbPromise ||= new Promise((resolve, reject) => {
        const request = indexedDB.open(DATABASE, 1);
        request.onupgradeneeded = () => request.result.createObjectStore('accounts');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}
async function readRecord(scope) {
    const db = await database();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction('accounts', 'readonly');
        const request = transaction.objectStore('accounts').get(scope);
        transaction.oncomplete = () => resolve(request.result || null);
        transaction.onerror = () => reject(transaction.error);
    });
}
async function writeRecord(scope, record) {
    const db = await database();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction('accounts', 'readwrite');
        transaction.objectStore('accounts').put(record, scope);
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error || new Error('Device save was aborted'));
    });
}
let scope = 'guest';
let baseline = null;
let latestState;
let queue = Promise.resolve();
let saveError = null;
function enqueue(target, record) {
    queue = queue.catch(() => {}).then(async () => { await writeRecord(target, record); saveError = null; });
    queue.catch(error => {
        saveError = error;
        globalThis.dispatchEvent(new CustomEvent('device-save-error', { detail: error }));
    });
}
export const deviceCache = {
    async read(account = scope) { await queue.catch(() => {}); return readRecord(account); },
    activate(account, base = null) { scope = account; baseline = structuredClone(base); latestState = undefined; },
    save(state) {
        latestState = structuredClone(state);
        enqueue(scope, { state: latestState, baseline: structuredClone(baseline), pending: scope !== 'guest' && JSON.stringify(state) !== JSON.stringify(baseline) });
    },
    markSynced(state) {
        baseline = structuredClone(state);
        this.save(latestState || state);
    },
    async flush() { await queue; if (saveError) throw saveError; },
    get scope() { return scope; }
};
