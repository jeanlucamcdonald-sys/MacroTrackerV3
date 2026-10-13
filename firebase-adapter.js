import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, signOut, connectAuthEmulator, setPersistence, browserLocalPersistence, browserSessionPersistence, inMemoryPersistence, sendPasswordResetEmail, linkWithCredential } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, getDocsFromServer, getDocFromServer, doc, runTransaction, connectFirestoreEmulator } from 'firebase/firestore';
import { createAuthActions } from './auth-actions.js';
import { authDiagnostic } from './auth-diagnostics.js';
import { documentsState } from './cloud-model.js';

export async function createFirebaseAdapter(config) {
    const app = initializeApp(config);
    const auth = getAuth(app);
    const db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
    if (config.emulators) {
        const host = config.emulators.host || '127.0.0.1';
        if (!['127.0.0.1', 'localhost'].includes(location.hostname)) throw new Error('Emulators are only allowed on localhost');
        connectAuthEmulator(auth, `http://${host}:${config.emulators.authPort || 9099}`, { disableWarnings: true });
        connectFirestoreEmulator(db, host, config.emulators.firestorePort || 8080);
    }
    // Restricted browsers can reject durable auth persistence without invalid credentials.
    try { await setPersistence(auth, browserLocalPersistence); }
    catch {
        authDiagnostic('persistence-fallback', { detail: 'Session storage' }, 'warn');
        try { await setPersistence(auth, browserSessionPersistence); }
        catch { await setPersistence(auth, inMemoryPersistence); }
    }
    const googleProvider = new GoogleAuthProvider();
    googleProvider.setCustomParameters({ prompt: 'select_account' });
    return {
        destroy: () => deleteApp(app),
        currentUser: () => auth.currentUser,
        onAuth: (callback, onError = () => {}) => onAuthStateChanged(auth, user => {
            authDiagnostic('state-transition', { uid: user?.uid || null });
            try { Promise.resolve(callback(user)).catch(error => { authDiagnostic('state-handler-failed', { uid: user?.uid || null, code: error?.code }, 'warn'); onError(error); }); }
            catch (error) { authDiagnostic('state-handler-failed', { uid: user?.uid || null, code: error?.code }, 'warn'); onError(error); }
        }, error => { authDiagnostic('state-listener-failed', { code: error?.code }, 'warn'); onError(error); }),
        ...createAuthActions(auth, {
            signInWithEmailAndPassword, createUserWithEmailAndPassword, signInWithPopup,
            linkWithCredential, signOut, sendPasswordResetEmail,
            credentialFromError: error => GoogleAuthProvider.credentialFromError(error)
        }, googleProvider),
        async read(uid) {
            authDiagnostic('profile-load-started', { uid });
            const documents = new Map();
            const revisions = new Map();
            function add(path, entry) {
                if (!entry.exists()) return;
                const { _revision = 0, ...data } = entry.data();
                documents.set(path, data);
                revisions.set(path, _revision);
            }
            await Promise.all([
                ...['profile/current', 'catalog/current'].map(async path => add(path, await getDocFromServer(doc(db, 'users', uid, ...path.split('/'))))),
                ...['logs', 'weightLogs'].map(async group => {
                    const snapshot = await getDocsFromServer(collection(db, 'users', uid, group));
                    for (const entry of snapshot.docs) add(`${group}/${entry.id}`, entry);
                })
            ]);
            // Older profiles may store their name on users/{uid}. Keep canonical diary
            // documents authoritative, and read only this account's optional legacy name.
            const canonical = documents.get('profile/current');
            if (!canonical?.profile?.displayName && !canonical?.profile?.name && !canonical?.displayName && !canonical?.name) {
                try {
                    const legacy = await getDocFromServer(doc(db, 'users', uid));
                    const data = legacy.exists() ? legacy.data() : {};
                    const profile = data.profile || data;
                    const name = [profile.displayName, profile.name].find(value => typeof value === 'string' && value.trim());
                    if (!canonical && legacy.exists() && ['profile', 'displayName', 'name', 'targets', 'calorieGoal'].some(key => data[key] !== undefined)) documents.set('profile/current', data);
                    else if (name) documents.set('profile/current', { ...canonical, profile: { ...canonical?.profile, displayName: name.trim() } });
                } catch (error) {
                    // Previously deployed rules may not permit this optional legacy read.
                    // Core account reads above must still succeed before loading a diary.
                    if (error.code !== 'permission-denied') throw error;
                }
            }
            try {
                const state = documents.size ? documentsState(documents) : null;
                authDiagnostic('profile-load-completed', { uid, detail: state ? 'Existing account restored' : 'Empty account' });
                return { state, revisions };
            } catch (cause) {
                const error = new Error('Sign-in succeeded, but this account contains an incompatible diary format. Its cloud records have not been overwritten.');
                error.code = 'sync/invalid-data';
                error.cause = cause;
                throw error;
            }
        },
        async write(uid, changes, revisions) {
            // Chunk large imports while checking every document revision atomically.
            for (let offset = 0; offset < changes.length; offset += 450) {
                const chunk = changes.slice(offset, offset + 450);
                await runTransaction(db, async transaction => {
                    const refs = chunk.map(change => doc(db, 'users', uid, ...change.path.split('/')));
                    const snapshots = await Promise.all(refs.map(ref => transaction.get(ref)));
                    snapshots.forEach((snapshot, index) => {
                        const actual = snapshot.exists() ? snapshot.data()._revision || 0 : 0;
                        if (actual !== (revisions.get(chunk[index].path) || 0)) {
                            const error = new Error('Another device changed this data. Export your device copy before reloading the cloud copy.');
                            error.code = 'sync/conflict';
                            throw error;
                        }
                    });
                    chunk.forEach((change, index) => {
                        if (change.data === null) transaction.delete(refs[index]);
                        else transaction.set(refs[index], { ...change.data, _revision: (revisions.get(change.path) || 0) + 1 });
                    });
                }, { maxAttempts: 1 });
                chunk.forEach(change => {
                    if (change.data === null) revisions.delete(change.path);
                    else revisions.set(change.path, (revisions.get(change.path) || 0) + 1);
                });
            }
        }
    };
}
