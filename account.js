import { store, exportUserData, importUserData } from './state.js';
import { deviceCache } from './persistence.js';
import { firebaseConfig } from './firebase-config.js';
import { createCloudSync } from './cloud-sync.js';
import { localDateString } from './local-date.js';

export async function initializeAccount(bindClick, signal, selects) {
    const account = document.getElementById('account-panel');
    const status = document.getElementById('cloud-status');
    const statusLabel = document.getElementById('storage-label');
    const authForm = document.getElementById('auth-form');
    const signOut = document.getElementById('btn-sign-out');
    const retry = document.getElementById('btn-sync-retry');
    const reload = document.getElementById('btn-cloud-reload');
    const dataViews = document.querySelector('main');
    const authButtons = [...authForm.querySelectorAll('button')];
    authButtons.forEach(button => button.disabled = true);
    let adapter;
    let sync;
    let currentPhase = 'guest';
    function report({ phase, user, error }) {
        currentPhase = phase;
        const loading = ['loading', 'load-error'].includes(phase);
        dataViews.inert = loading;
        dataViews.style.visibility = loading ? 'hidden' : '';
        document.getElementById('btn-export-backup').disabled = loading;
        document.getElementById('backup-import').disabled = loading;
        // Remove any open editor's detached draft when changing accounts.
        if (phase === 'loading') globalThis.dispatchEvent(new Event('account-changing'));
        const messages = {
            guest: 'Device only. Sign in to back up your diary.',
            loading: 'Loading your account…', synced: 'Backed up to your account.',
            saving: 'Backing up changes…', pending: 'Cloud backup pending. Keep this device copy until backup completes.',
            conflict: 'Another device changed this data. Export your device copy before reloading the cloud copy.',
            'load-error': 'Your account could not be loaded. Retry or sign out to use the device diary.'
        };
        status.textContent = phase === 'pending' && error?.code === 'permission-denied'
            ? 'Cloud backup is not allowed for this account. Changes remain on this device.'
            : messages[phase] || error?.message || phase;
        statusLabel.textContent = phase === 'synced' ? 'Cloud backed up' : phase === 'guest' ? 'Device only' : 'Backup pending';
        account.querySelector('[data-user-email]').textContent = user?.email || '';
        authForm.hidden = !!user;
        signOut.hidden = !user;
        retry.hidden = !['pending', 'load-error'].includes(phase);
        reload.hidden = phase !== 'conflict';
    }
    function errorMessage(error) {
        const messages = {
            'auth/invalid-credential': 'The email or password is incorrect.',
            'auth/email-already-in-use': 'An account with this email already exists. Choose Sign in.',
            'auth/weak-password': 'Use a password with at least six characters.',
            'auth/operation-not-allowed': 'This sign-in method must be enabled in Firebase Authentication.',
            'auth/unauthorized-domain': 'This website must be added to Firebase Authentication authorized domains.',
            'auth/popup-blocked': 'Allow the Google sign-in popup and try again.',
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
    bindClick(signOut, async () => {
        try { await deviceCache.flush(); await adapter.signOut(); }
        catch (error) { errorMessage(error); }
    });
    bindClick(retry, async () => {
        if (currentPhase === 'load-error') { location.reload(); return; }
        await sync.flush();
    });
    bindClick(reload, async () => {
        if (confirm('Replace this device’s pending edits with the cloud copy? Export a backup first if you want to keep them.')) {
            try { await sync.reloadCloud(); } catch (error) { errorMessage(error); }
        }
    });
    bindClick(document.getElementById('btn-export-backup'), exportUserData);
    document.getElementById('backup-import').addEventListener('change', async event => {
        try { await importUserData(event, { signal }); status.textContent = 'Backup imported. Sign in to back it up online.'; }
        catch (error) { errorMessage(error); }
        event.target.value = '';
    }, { signal });
    globalThis.addEventListener('device-save-error', () => {
        status.textContent = 'This device could not save changes. Keep this tab open and export a backup.';
        statusLabel.textContent = 'Device save failed';
    }, { signal });

    const profileForm = document.getElementById('profile-form');
    const goalForm = document.getElementById('goals-form');
    const weightForm = document.getElementById('weight-form');
    const weightList = document.getElementById('weight-history');
    const weightUnitButton = document.getElementById('btn-profile-weight-unit');
    selects.register(weightUnitButton, {
        options: [{ value: 'kg', label: 'Kilograms (kg)' }, { value: 'lb', label: 'Pounds (lb)' }],
        getValue: () => profileForm.elements.weightUnit.value,
        onChange: value => {
            profileForm.elements.weightUnit.value = value;
            weightUnitButton.textContent = value === 'kg' ? 'Kilograms (kg)' : 'Pounds (lb)';
        }, label: 'Weight unit'
    });
    let previousProfile = '';
    let previousTargets = '';
    let previousWeights = '';
    function render(state) {
        const profileKey = JSON.stringify([state.profile, state.settings]);
        if (profileKey !== previousProfile) {
            profileForm.elements.displayName.value = state.profile?.displayName || '';
            profileForm.elements.heightCm.value = state.profile?.heightCm || '';
            profileForm.elements.goalWeight.value = state.settings.goalWeight || '';
            profileForm.elements.weightUnit.value = state.profile?.weightUnit || 'kg';
            weightUnitButton.textContent = profileForm.elements.weightUnit.value === 'kg' ? 'Kilograms (kg)' : 'Pounds (lb)';
            document.getElementById('onboarding-status').textContent = state.settings.onboardingComplete ? 'Profile set up' : 'Set up your profile and daily goals to get started.';
            previousProfile = profileKey;
        }
        const targetKey = JSON.stringify(state.targets);
        if (targetKey !== previousTargets) {
            for (const key of ['cal', 'p', 'c', 'f']) goalForm.elements[key].value = state.targets[key];
            previousTargets = targetKey;
        }
        const weightKey = JSON.stringify(state.weightLog);
        if (weightKey !== previousWeights) {
            weightList.replaceChildren();
            for (const entry of [...state.weightLog].sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))) {
                const item = document.createElement('li');
                item.textContent = `${new Date(entry.timestamp).toLocaleDateString()} — ${entry.value} ${entry.unit}`;
                weightList.append(item);
            }
            previousWeights = weightKey;
        }
    }
    profileForm.addEventListener('submit', event => {
        event.preventDefault();
        store.update(draft => {
            draft.profile = { ...draft.profile, displayName: profileForm.elements.displayName.value.trim(),
                heightCm: Number(profileForm.elements.heightCm.value) || null, weightUnit: profileForm.elements.weightUnit.value };
            draft.settings.goalWeight = Number(profileForm.elements.goalWeight.value) || 0;
            draft.settings.onboardingComplete = true;
        });
    }, { signal });
    goalForm.addEventListener('submit', event => {
        event.preventDefault();
        store.update(draft => { for (const key of ['cal', 'p', 'c', 'f']) draft.targets[key] = Number(goalForm.elements[key].value); });
    }, { signal });
    weightForm.elements.date.value = localDateString();
    weightForm.addEventListener('submit', event => {
        event.preventDefault();
        const timestamp = new Date(`${weightForm.elements.date.value}T12:00:00`).toISOString();
        const value = Number(weightForm.elements.value.value);
        if (!(value > 0 && value < 2000)) return;
        store.update(draft => { draft.weightLog.push({ id: crypto.randomUUID(), timestamp, value, unit: draft.profile?.weightUnit || 'kg' }); });
        weightForm.elements.value.value = '';
    }, { signal });
    render(store.get());
    const unsubscribe = store.subscribe(render);
    signal.addEventListener('abort', () => { sync?.destroy(); unsubscribe(); }, { once: true });
    report({ phase: 'guest' });
    const config = globalThis.MACROTRACKER_FIREBASE_CONFIG || firebaseConfig;
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
        sync = createCloudSync(adapter, report);
    } catch (error) { errorMessage(error); }
}
