/** Never log passwords, provider credentials, tokens, emails, or raw Firebase errors. */
export function authDiagnostic(event, { uid = null, code = null, detail = null } = {}, level = 'info') {
    console[level](`[Auth] ${event}`, { uid, code, detail });
}
export async function inspectAuthAction(action, operation) {
    authDiagnostic(`${action}:started`);
    try {
        const result = await operation();
        authDiagnostic(`${action}:completed`, { uid: result?.user?.uid || null });
        return result;
    } catch (error) {
        authDiagnostic(`${action}:failed`, { code: error?.code || 'auth/unknown' }, 'warn');
        throw error;
    }
}
