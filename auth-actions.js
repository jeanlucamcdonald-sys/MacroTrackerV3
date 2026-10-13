import { authDiagnostic, inspectAuthAction } from './auth-diagnostics.js';

/** Provider credentials stay in memory and link only after successful existing-method auth. */
export function createAuthActions(auth, sdk, googleProvider) {
    let pendingGoogle = null;
    let pendingEmail = null;
    return {
        async signIn(email, password) {
            const result = await inspectAuthAction('email-sign-in', () => sdk.signInWithEmailAndPassword(auth, email, password));
            if (pendingGoogle && pendingEmail?.toLowerCase() === email.toLowerCase()) {
                try { await inspectAuthAction('google-link', () => sdk.linkWithCredential(result.user, pendingGoogle)); }
                catch (error) { if (error.code !== 'auth/provider-already-linked') throw error; }
                pendingGoogle = null; pendingEmail = null;
            }
            return result;
        },
        signUp: (email, password) => inspectAuthAction('sign-up', () => sdk.createUserWithEmailAndPassword(auth, email, password)),
        async google() {
            try { return await inspectAuthAction('google-sign-in', () => sdk.signInWithPopup(auth, googleProvider)); }
            catch (error) {
                if (error.code === 'auth/account-exists-with-different-credential') {
                    pendingGoogle = sdk.credentialFromError(error);
                    pendingEmail = error.customData?.email || null;
                    authDiagnostic('provider-conflict', { code: error.code, detail: 'Sign in with the existing method to link Google. No account was merged.' }, 'warn');
                }
                throw error;
            }
        },
        resetPassword: email => sdk.sendPasswordResetEmail(auth, email),
        signOut() { pendingGoogle = null; pendingEmail = null; return sdk.signOut(auth); }
    };
}
