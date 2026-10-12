import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, signOut, connectAuthEmulator, setPersistence, browserLocalPersistence } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, getDocsFromServer, getDocFromServer, doc, runTransaction, connectFirestoreEmulator } from 'firebase/firestore';
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
    await setPersistence(auth, browserLocalPersistence);
    return {
        destroy: () => deleteApp(app),
        onAuth: callback => onAuthStateChanged(auth, callback),
        signIn: (email, password) => signInWithEmailAndPassword(auth, email, password),
        signUp: (email, password) => createUserWithEmailAndPassword(auth, email, password),
        google: () => signInWithPopup(auth, new GoogleAuthProvider()),
        signOut: () => signOut(auth),
        async read(uid) {
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
            return { state: documents.has('profile/current') ? documentsState(documents) : null, revisions };
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
