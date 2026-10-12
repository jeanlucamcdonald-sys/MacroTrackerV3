const { test, before, after, beforeEach } = require('node:test');
const { readFileSync } = require('node:fs');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, setDoc, getDoc, deleteDoc, collection, getDocs } = require('firebase/firestore');
let environment;
before(async () => {
    environment = await initializeTestEnvironment({ projectId: 'demo-macrotracker', firestore: {
        host: '127.0.0.1', port: 8080, rules: readFileSync('firestore.rules', 'utf8')
    } });
});
beforeEach(() => environment.clearFirestore());
after(() => environment.cleanup());
const totals = { cal: 2000, p: 150, c: 200, f: 65 };
const records = {
    'profile/current': { version: '3.0', profile: { displayName: 'Alice' }, settings: {}, targets: { cal: 2000, p: 150, c: 200, f: 600 / 9 }, _revision: 1 },
    'catalog/current': { foodDatabase: [], recipes: [], _revision: 1 },
    'logs/2026-10-12': { date: '2026-10-12', totals, diary: [], _revision: 1 },
    'weightLogs/w1': { id: 'w1', timestamp: '2026-10-12T12:00:00.000Z', value: 75, unit: 'kg', _revision: 1 }
};
test('owners can create, read, update and delete each supported model', async () => {
    const db = environment.authenticatedContext('alice').firestore();
    for (const [path, data] of Object.entries(records)) {
        const ref = doc(db, `users/alice/${path}`);
        await assertSucceeds(setDoc(ref, data));
        await assertSucceeds(getDoc(ref));
        await assertSucceeds(setDoc(ref, { ...data, _revision: 2 }));
        await assertSucceeds(deleteDoc(ref));
    }
});
test('anonymous and other accounts cannot read, write or delete another user data', async () => {
    await environment.withSecurityRulesDisabled(async context => {
        for (const [path, data] of Object.entries(records)) await setDoc(doc(context.firestore(), `users/alice/${path}`), data);
    });
    for (const context of [environment.unauthenticatedContext(), environment.authenticatedContext('bob')]) {
        for (const [path, data] of Object.entries(records)) {
            const ref = doc(context.firestore(), `users/alice/${path}`);
            await assertFails(getDoc(ref)); await assertFails(setDoc(ref, data)); await assertFails(deleteDoc(ref));
        }
        await assertFails(getDocs(collection(context.firestore(), 'users/alice/logs')));
    }
});
test('malformed dates, negative goals and invalid weight values are denied', async () => {
    const db = environment.authenticatedContext('alice').firestore();
    await assertFails(setDoc(doc(db, 'users/alice/logs/2026-10-13'), records['logs/2026-10-12']));
    await assertFails(setDoc(doc(db, 'users/alice/profile/current'), { ...records['profile/current'], targets: { ...totals, cal: -1 } }));
    await assertFails(setDoc(doc(db, 'users/alice/profile/current'), { ...records['profile/current'], targets: { cal: 2000, p: 1000, c: 0, f: 0 } }));
    await assertFails(setDoc(doc(db, 'users/alice/weightLogs/w1'), { ...records['weightLogs/w1'], value: -3 }));
    await assertFails(setDoc(doc(db, 'users/alice/catalog/current'), { ...records['catalog/current'], admin: true }));
    await assertFails(setDoc(doc(db, 'users/alice/private/anything'), { value: 1 }));
});
