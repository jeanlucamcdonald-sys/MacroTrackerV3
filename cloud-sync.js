import { store, replaceState, DEFAULT_STATE } from './state.js';
import { deviceCache } from './persistence.js';
import { stateDocuments, documentChanges, mergeOfflineState } from './cloud-model.js';

export function createCloudSync(adapter, report) {
    let session = null;
    let generation = 0;
    let timer;
    let disposed = false;
    let hydrating = false;
    function status(phase, extra = {}) { report({ phase, user: session?.user || null, ...extra }); }
    async function flush() {
        const current = session;
        if (!current || hydrating || current.needsRefresh || current.conflict || current.inFlight) return current?.inFlight;
        current.inFlight = Promise.resolve().then(async () => {
            try {
                while (session === current && !disposed) {
                    const snapshot = store.get();
                    const changes = documentChanges(current.newAccount ? new Map() : stateDocuments(current.baseline), stateDocuments(snapshot));
                    if (!changes.length) { status('synced'); break; }
                    status('saving');
                    await adapter.write(current.user.uid, changes, current.revisions);
                    current.baseline = snapshot;
                    current.newAccount = false;
                    if (session !== current) break;
                    deviceCache.markSynced(snapshot);
                    await deviceCache.flush();
                }
            } catch (error) {
                if (session !== current || disposed) return;
                current.conflict = error.code === 'sync/conflict';
                status(current.conflict ? 'conflict' : 'pending', { error });
            } finally { current.inFlight = null; }
        });
        return current.inFlight;
    }
    const unsubscribe = store.subscribe(() => {
        if (!session || hydrating || disposed) return;
        status(session.conflict ? 'conflict' : 'pending');
        clearTimeout(timer);
        timer = setTimeout(() => { void flush(); }, 200);
    });
    async function loadUser(user) {
        const request = ++generation;
        clearTimeout(timer);
        hydrating = true;
        session = null;
        report({ phase: 'loading', user });
        try {
            if (!user) {
                if (deviceCache.scope === 'guest') { status('guest'); return; }
                const guest = await deviceCache.read('guest');
                if (request !== generation || disposed) return;
                deviceCache.activate('guest');
                replaceState(guest?.state || DEFAULT_STATE);
                status('guest');
                return;
            }
            const cached = await deviceCache.read(user.uid);
            let remote;
            try { remote = await adapter.read(user.uid); }
            catch (error) {
                if (!cached) throw error;
                remote = { state: cached.baseline || cached.state, revisions: null, offline: true };
            }
            if (request !== generation || disposed) return;
            // First sign-in imports the guest copy only for a genuinely empty cloud account.
            const guest = !remote.state ? await deviceCache.read('guest') : null;
            if (request !== generation || disposed) return;
            let state = remote.state || guest?.state || structuredClone(DEFAULT_STATE);
            let conflict;
            if (cached?.pending && cached.baseline && remote.state && !remote.offline) {
                try { state = mergeOfflineState(cached.baseline, cached.state, remote.state); }
                catch (error) { state = cached.state; conflict = error; }
            } else if (cached?.pending) state = cached.state;
            const baseline = remote.state || structuredClone(DEFAULT_STATE);
            session = { user, baseline, newAccount: !remote.state, revisions: remote.revisions, conflict: !!conflict, needsRefresh: !!remote.offline, inFlight: null };
            deviceCache.activate(user.uid, baseline);
            replaceState(state);
            if (conflict) status('conflict', { error: conflict });
            else status(remote.offline ? 'pending' : 'synced');
        } catch (error) {
            if (request === generation && !disposed) report({ phase: 'load-error', user, error });
        } finally {
            if (request === generation && !disposed) {
                hydrating = false;
                if (session && !session.conflict && !session.needsRefresh) void flush();
            }
        }
    }
    // Refresh revisions and three-way merge before flushing an account restored offline.
    async function retry() {
        if (session?.needsRefresh) await loadUser(session.user);
        else await flush();
    }
    const stopAuth = adapter.onAuth(user => { void loadUser(user); });
    globalThis.addEventListener('online', retry);
    const retryTimer = setInterval(() => { if (session && !session.conflict) void retry(); }, 15_000);
    return {
        flush: retry,
        async reloadCloud() {
            if (!session) return;
            const remote = await adapter.read(session.user.uid);
            if (!remote.state) throw new Error('No cloud copy is available');
            session.baseline = remote.state;
            session.revisions = remote.revisions;
            session.conflict = false;
            session.needsRefresh = false;
            deviceCache.activate(session.user.uid, remote.state);
            hydrating = true;
            try { replaceState(remote.state); } finally { hydrating = false; }
            status('synced');
        },
        destroy() {
            disposed = true;
            generation++;
            session = null;
            unsubscribe(); stopAuth(); clearTimeout(timer); clearInterval(retryTimer);
            void adapter.destroy?.();
            globalThis.removeEventListener('online', retry);
        }
    };
}
