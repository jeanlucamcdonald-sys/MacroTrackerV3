import { store } from './state.js';
import { deviceCache } from './persistence.js';
import { firebaseConfig } from './firebase-config.js';
import { createCloudSync } from './cloud-sync.js';
import { dashboardContext } from './dashboard-context.js';

export async function initializeAccount(bindClick, signal, selects, dialogs) {
    const account = document.getElementById('account-panel');
    const status = document.getElementById('cloud-status');
    const statusLabel = document.getElementById('storage-label');
    const authForm = document.getElementById('auth-form');
    const signOut = document.getElementById('btn-sign-out');
    const retry = document.getElementById('btn-sync-retry');
    const reload = document.getElementById('btn-cloud-reload');
    const dataViews = [...document.querySelectorAll('.app-view:not(#view-settings)')];
    const config = globalThis.MACROTRACKER_FIREBASE_CONFIG || firebaseConfig;
    let authPending = !!(config.apiKey && config.appId);
    const authButtons = [...authForm.querySelectorAll('button')];
    authButtons.forEach(button => button.disabled = true);
    let adapter;
    let sync;
    let currentPhase = 'guest';
    let signedInUser = null;
    function renderGreeting() {
        const profile = authPending || ['loading', 'load-error'].includes(currentPhase) ? {} : store.get().profile;
        const context = dashboardContext(profile, signedInUser);
        document.getElementById('dashboard-greeting').textContent = context.greeting;
        document.getElementById('dashboard-prompt').textContent = context.prompt;
        document.getElementById('profile-avatar').textContent = (profile.displayName || profile.name || signedInUser?.displayName || 'M').slice(0, 1).toUpperCase();
    }
    const contextTimer = setInterval(renderGreeting, 60_000);
    signal.addEventListener('abort', () => clearInterval(contextTimer), { once: true });
    document.addEventListener('visibilitychange', renderGreeting, { signal });
    globalThis.addEventListener('profile:updated', renderGreeting, { signal });
    function report({ phase, user, error }) {
        currentPhase = phase;
        signedInUser = user || null;
        renderGreeting();
        const loading = authPending || ['loading', 'load-error'].includes(phase);
        document.documentElement.dataset.accountPhase = loading ? 'loading' : phase;
        dataViews.forEach(view => { view.inert = loading; view.style.visibility = loading ? 'hidden' : ''; });
        document.getElementById('btn-export-backup').disabled = loading;
        document.getElementById('backup-import').disabled = loading;
        for (const section of document.querySelectorAll('[data-settings-section=profile], [data-settings-section=settings], [data-settings-section=data], [data-dialog-view=onboarding]')) section.inert = loading;
        for (const button of document.querySelectorAll('[data-dialog-tab=profile], [data-dialog-tab=settings], #btn-start-onboarding')) button.disabled = loading;
        // Remove any open editor's detached draft when changing accounts.
        if (phase === 'loading') globalThis.dispatchEvent(new Event('account-changing'));
        const messages = {
            guest: 'Device only. Sign in to back up your diary.',
            loading: 'Loading your account…', synced: 'Backed up to your account.',
            saving: 'Backing up changes…', pending: 'Cloud backup pending. Keep this device copy until backup completes.',
            conflict: 'Another device changed this data. Export your device copy before reloading the cloud copy.',
            'load-error': user ? 'You are signed in, but your diary could not be loaded. Retry loading your account or export an existing device backup.' : 'Your sign-in state could not be restored. Sign in again or reload this page.'
        };
        status.textContent = phase === 'pending' && error?.code === 'permission-denied'
            ? 'Cloud backup is not allowed for this account. Changes remain on this device.'
            : phase === 'load-error' && error?.code === 'permission-denied'
                ? 'Sign-in succeeded. This account cannot access its diary yet. Check its Firestore access rules.'
                : phase === 'load-error' && error?.code === 'sync/invalid-data' ? error.message
                : messages[phase] || error?.message || phase;
        statusLabel.textContent = phase === 'synced' ? 'Cloud backed up' : phase === 'guest' ? 'Device only' : 'Backup pending';
        account.querySelector('[data-user-email]').textContent = user?.email || '';
        document.getElementById('auth-providers').textContent = user ? `Signed in with ${(user.providerData || []).map(provider => ({ 'google.com': 'Google', password: 'Email/password' })[provider.providerId] || provider.providerId).join(', ') || 'your account'}` : 'Sign in to keep your diary backed up.';
        document.getElementById('profile-avatar').textContent = (store.get().profile.displayName || user?.displayName || user?.email || 'M').slice(0, 1).toUpperCase();
        authForm.hidden = !!user;
        signOut.hidden = !user;
        retry.hidden = !['pending', 'load-error'].includes(phase);
        reload.hidden = phase !== 'conflict';
        if (phase === 'load-error' && error?.code?.startsWith('auth/')) errorMessage(error);
    }
    function errorMessage(error) {
        const messages = {
            'auth/user-token-expired': 'Your session expired. Sign out and sign in again with the original account method.',
            'auth/invalid-user-token': 'This session could not be restored. Sign out and sign in again.',
            'auth/invalid-id-token': 'The sign-in token could not be verified. Sign out and sign in again.',
            'auth/requires-recent-login': 'Sign in again before changing sensitive account details.',
            'auth/invalid-credential': 'The email or password is incorrect.',
            'auth/email-already-in-use': 'An account with this email already exists. Choose Sign in.',
            'auth/weak-password': 'Use a password with at least six characters.',
            'auth/operation-not-allowed': 'This sign-in method must be enabled in Firebase Authentication.',
            'auth/unauthorized-domain': 'This website must be added to Firebase Authentication authorized domains.',
            'auth/popup-blocked': 'Allow the Google sign-in popup and try again.',
            'auth/account-exists-with-different-credential': 'This email already uses another sign-in method. Sign in with that method to link Google securely.',
            'auth/user-disabled': 'This account has been disabled. Contact the app owner.',
            'auth/too-many-requests': 'Sign-in is temporarily limited. Wait a little and try again.',
            'auth/credential-already-in-use': 'This Google identity belongs to another account. Sign in with that identity; accounts were not merged.',
            'auth/network-request-failed': 'Unable to reach sign-in. Check your connection and try again.'
        };
        status.textContent = messages[error.code] || error.message || 'The action could not be completed.';
    }
    async function authAction(action) {
        if (!adapter) return;
        const email = authForm.elements.email.value.trim();
        const password = authForm.elements.password.value;
        try { await action(email, password); authForm.elements.password.value = ''; }
        catch (error) { errorMessage(error); }
    }
    authForm.addEventListener('submit', event => { event.preventDefault(); void authAction((email, password) => adapter.signIn(email, password)); }, { signal });
    bindClick(document.getElementById('btn-sign-up'), () => {
        if (authForm.reportValidity()) return authAction((email, password) => adapter.signUp(email, password));
    });
    bindClick(document.getElementById('btn-google-sign-in'), () => authAction(() => adapter.google()));
    bindClick(document.getElementById('btn-reset-password'), async () => {
        const email = authForm.elements.email.value.trim();
        if (!email || !authForm.elements.email.checkValidity()) { authForm.elements.email.reportValidity(); return; }
        try { await adapter.resetPassword(email); status.textContent = 'If this email supports password sign-in, reset instructions will arrive in your inbox.'; }
        catch (error) { errorMessage(error); }
    });
    bindClick(signOut, async () => {
        try { await deviceCache.flush(); await adapter.signOut(); }
        catch (error) { errorMessage(error); }
    });
    bindClick(retry, async () => {
        if (currentPhase === 'load-error') { await sync.retryLoad(); return; }
        await sync.flush();
    });
    bindClick(reload, async () => {
        if (confirm('Replace this device’s pending edits with the cloud copy? Export a backup first if you want to keep them.')) {
            try { await sync.reloadCloud(); } catch (error) { errorMessage(error); }
        }
    });
    globalThis.addEventListener('device-save-error', () => {
        status.textContent = 'This device could not save changes. Keep this tab open and export a backup.';
        statusLabel.textContent = 'Device save failed';
    }, { signal });

    let render = () => {};
    try {
        const profileForm = document.getElementById('profile-form');
        const goalForm = document.getElementById('goals-form');
        const weightUnitButton = document.getElementById('btn-profile-weight-unit');
        selects.register(weightUnitButton, {
            options: [{ value: 'kg', label: 'Kilograms (kg)' }, { value: 'lb', label: 'Pounds (lb)' }],
            getValue: () => profileForm.elements.weightUnit.value,
            onChange: value => {
                const previous = profileForm.elements.weightUnit.value;
                const goal = Number(profileForm.elements.goalWeight.value);
                if (goal && previous !== value) profileForm.elements.goalWeight.value = Number((goal * (value === 'lb' ? 1 / 0.45359237 : 0.45359237)).toFixed(2));
                profileForm.elements.weightUnit.value = value;
                weightUnitButton.textContent = value === 'kg' ? 'Kilograms (kg)' : 'Pounds (lb)';
            }, label: 'Weight unit'
        });
        const goalOptions = [{ value: 'lose', label: 'Cut / lose weight' }, { value: 'maintain', label: 'Maintain weight' }, { value: 'gain', label: 'Bulk / build muscle' }];
        const activityOptions = [{ value: 'sedentary', label: 'Mostly seated (×1.2)' }, { value: 'light', label: 'Lightly active (×1.375)' }, { value: 'moderate', label: 'Moderately active (×1.55)' }, { value: 'active', label: 'Very active (×1.725)' }, { value: 'veryActive', label: 'Physical job + training (×1.9)' }];
        for (const [name, options] of [['goal', goalOptions], ['activity', activityOptions]]) {
            const button = document.getElementById(`btn-profile-${name}`);
            selects.register(button, { options, getValue: () => profileForm.elements[name].value, onChange: value => {
                profileForm.elements[name].value = value; button.textContent = options.find(option => option.value === value).label;
            }, label: name });
        }
        let previousProfile = '';
        let previousTargets = '';
        render = function (state) {
            const profileKey = JSON.stringify([state.profile, state.settings]);
            if (profileKey !== previousProfile) {
                profileForm.elements.displayName.value = state.profile?.displayName || state.profile?.name || '';
                profileForm.elements.currentWeight.value = state.profile?.currentWeight ? `${Number(state.profile.currentWeight.toFixed(2))} ${state.profile.weightUnit || 'kg'}` : '';
                for (const [name, options] of [['goal', goalOptions], ['activity', activityOptions]]) {
                    const option = options.find(option => option.value === state.profile[name]) || options.find(option => option.value === (name === 'goal' ? 'maintain' : 'sedentary'));
                    profileForm.elements[name].value = option.value; document.getElementById(`btn-profile-${name}`).textContent = option.label;
                }
                profileForm.elements.heightCm.value = state.profile?.heightCm || '';
                profileForm.elements.goalWeight.value = state.settings.goalWeight || '';
                profileForm.elements.weightUnit.value = state.profile?.weightUnit || 'kg';
                weightUnitButton.textContent = profileForm.elements.weightUnit.value === 'kg' ? 'Kilograms (kg)' : 'Pounds (lb)';
                document.getElementById('onboarding-card').hidden = !!state.settings.onboardingComplete;
                document.getElementById('onboarding-status').textContent = state.settings.onboardingComplete ? 'Profile set up' : 'Set up your profile and daily goals to get started.';
                previousProfile = profileKey;
            }
            const targetKey = JSON.stringify(state.targets);
            if (targetKey !== previousTargets) {
                for (const key of ['cal', 'p', 'c', 'f']) goalForm.elements[key].value = Number(state.targets[key].toFixed(3));
                previousTargets = targetKey;
            }
        };
        profileForm.addEventListener('submit', event => {
            event.preventDefault();
            store.update(draft => {
                const previousUnit = draft.profile?.weightUnit || 'kg';
                const nextUnit = profileForm.elements.weightUnit.value;
                const currentWeight = draft.profile?.currentWeight;
                draft.profile = { ...draft.profile, displayName: profileForm.elements.displayName.value.trim(),
                    heightCm: Number(profileForm.elements.heightCm.value) || null, weightUnit: nextUnit, goal: profileForm.elements.goal.value, activity: profileForm.elements.activity.value };
                if (currentWeight && previousUnit !== nextUnit) draft.profile.currentWeight = currentWeight * (nextUnit === 'lb' ? 1 / 0.45359237 : 0.45359237);
                draft.settings.goalWeight = Number(profileForm.elements.goalWeight.value) || 0;

            });
            globalThis.dispatchEvent(new CustomEvent('profile:updated', { detail: store.get().profile }));
            document.getElementById('profile-feedback').textContent = 'Profile saved. Recalculate your plan to apply activity changes to calorie targets.';
        }, { signal });
        render(store.get());
    } catch (error) {
        render = () => {};
        console.warn('Profile controls initialization failed:', error);
    }
    renderGreeting();
    const unsubscribe = store.subscribe(state => { render(state); renderGreeting(); });
    signal.addEventListener('abort', () => { sync?.destroy(); unsubscribe(); }, { once: true });
    report({ phase: 'guest' });
    if (!config.apiKey || !config.appId) {
        status.textContent = 'Cloud sign-in is not configured. Your diary is saved on this device.';
        authForm.querySelectorAll('button').forEach(button => button.disabled = true);
        return;
    }
    try {
        const { createFirebaseAdapter } = await import('./dist/firebase-adapter.js');
        if (signal.aborted) return;
        adapter = await createFirebaseAdapter(config);
        if (signal.aborted) { await adapter.destroy(); return; }
        authButtons.forEach(button => button.disabled = false);
        account.dataset.authReady = 'true';
        sync = createCloudSync({ ...adapter, onAuth(callback, onError) { return adapter.onAuth(user => { authPending = false; callback(user); }, error => { authPending = false; onError?.(error); }); } }, report);
    } catch (error) { authPending = false; report({ phase: 'guest' }); errorMessage(error); }
}
