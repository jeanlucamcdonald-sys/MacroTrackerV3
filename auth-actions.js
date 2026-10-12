/** Provider credentials stay in memory and link only after successful existing-method auth. */
export function createAuthActions(auth, sdk, googleProvider) {
    let pendingGoogle = null;
    let pendingEmail = null;
    return {
        async signIn(email, password) {
            const result = await sdk.signInWithEmailAndPassword(auth, email, password);
            if (pendingGoogle && pendingEmail?.toLowerCase() === email.toLowerCase()) {
                try { await sdk.linkWithCredential(result.user, pendingGoogle); }
                catch (error) { if (error.code !== 'auth/provider-already-linked') throw error; }
                pendingGoogle = null; pendingEmail = null;
            }
            return result;
        },
        signUp: (email, password) => sdk.createUserWithEmailAndPassword(auth, email, password),
        async google() {
            try { return await sdk.signInWithPopup(auth, googleProvider); }
            catch (error) {
                if (error.code === 'auth/account-exists-with-different-credential') {
                    pendingGoogle = sdk.credentialFromError(error);
                    pendingEmail = error.customData?.email || null;
                }
                throw error;
            }
        },
        resetPassword: email => sdk.sendPasswordResetEmail(auth, email),
        signOut() { pendingGoogle = null; pendingEmail = null; return sdk.signOut(auth); }
    };
}
