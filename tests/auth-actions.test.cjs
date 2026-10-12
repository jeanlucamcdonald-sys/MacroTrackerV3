const { test } = require('node:test');
const assert = require('node:assert/strict');
test('Google provider collision links only after matching account authenticates and keeps its UID', async () => {
    const { createAuthActions } = await import('../auth-actions.js');
    const credential = { testCredential: true };
    const linked = [];
    let allowSignIn = false;
    const sdk = {
        async signInWithPopup() { throw Object.assign(new Error('Provider conflict'), { code: 'auth/account-exists-with-different-credential', customData: { email: 'first@example.test' } }); },
        credentialFromError: () => credential,
        async signInWithEmailAndPassword(auth, email) {
            if (!allowSignIn) throw Object.assign(new Error('Wrong password'), { code: 'auth/invalid-credential' });
            return { user: { uid: email.startsWith('second') ? 'second-uid' : 'original-uid' } };
        },
        async linkWithCredential(user, token) { linked.push({ uid: user.uid, token }); },
        signOut() {}
    };
    const actions = createAuthActions({}, sdk, {});
    await assert.rejects(actions.google(), { code: 'auth/account-exists-with-different-credential' });
    await assert.rejects(actions.signIn('first@example.test', 'wrong'), { code: 'auth/invalid-credential' });
    assert.equal(linked.length, 0);
    allowSignIn = true;
    await actions.signIn('second@example.test', 'test'); assert.equal(linked.length, 0);
    const result = await actions.signIn('FIRST@example.test', 'test');
    assert.equal(result.user.uid, 'original-uid'); assert.deepEqual(linked, [{ uid: 'original-uid', token: credential }]);
    await actions.signIn('first@example.test', 'test'); assert.equal(linked.length, 1);
});
test('sign out removes any pending provider link', async () => {
    const { createAuthActions } = await import('../auth-actions.js');
    let links = 0;
    const actions = createAuthActions({}, {
        async signInWithPopup() { throw Object.assign(new Error(), { code: 'auth/account-exists-with-different-credential', customData: { email: 'first@example.test' } }); },
        credentialFromError: () => ({}), signOut() {},
        async signInWithEmailAndPassword() { return { user: { uid: 'first' } }; },
        async linkWithCredential() { links++; }
    }, {});
    await assert.rejects(actions.google()); await actions.signOut(); await actions.signIn('first@example.test', 'test');
    assert.equal(links, 0);
});
