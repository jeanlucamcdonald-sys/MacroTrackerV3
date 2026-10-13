const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const baseURL = process.env.MACROTRACKER_TEST_URL || 'http://127.0.0.1:8000';
const click = (page, selector) => page.locator(selector).dispatchEvent('click');
async function pageFor(browser) {
    const context = await browser.newContext();
    await context.addInitScript(() => {
        window.MACROTRACKER_FIREBASE_CONFIG = { projectId: 'demo-macrotracker', apiKey: 'demo-key', appId: 'demo-app', authDomain: 'localhost', emulators: { host: '127.0.0.1' } };
    });
    const page = await context.newPage();
    await page.goto(baseURL);
    await page.waitForSelector('#btn-toggle-view', { state: 'attached' });
    return { page, context };
}
async function signIn(page, email, create = false) {
    await click(page, '#btn-account');
    await click(page, '[data-dialog-tab="account"].select-trigger');
    await page.waitForFunction(() => document.querySelector('#account-panel').dataset.authReady === 'true');
    await page.locator('#auth-form input[name=email]').fill(email);
    await page.locator('#auth-form input[name=password]').fill('test-password-123');
    if (create) await click(page, '#btn-sign-up');
    else await page.locator('#auth-form').dispatchEvent('submit');
    await page.waitForFunction(() => document.querySelector('#cloud-status').textContent === 'Backed up to your account.');
    await click(page, '#btn-settings-back');
}
async function logChicken(page) {
    await page.locator('#food-search-input').fill('Chicken');
    await click(page, '#dropdown-results button:first-child');
    await click(page, '#btn-confirm-log');
    await page.waitForFunction(() => document.querySelector('#cloud-status').textContent === 'Backed up to your account.');
}
test('Firebase auth and Firestore restore data after clearing browser storage, with account isolation', { skip: !process.env.MACROTRACKER_EMULATORS }, async () => {
    const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    const email = `first-${Date.now()}@example.test`;
    const otherEmail = `second-${Date.now()}@example.test`;
    try {
        let { page, context } = await pageFor(browser);
        await page.locator('#food-search-input').fill('Chicken');
        await click(page, '#dropdown-results button:first-child');
        await click(page, '#btn-confirm-log');
        await page.evaluate(async () => (await import('/persistence.js')).deviceCache.flush());
        await signIn(page, email, true);
        assert.equal(await page.locator('[data-value="total-cal"]').textContent(), '120');
        await page.evaluate(async () => (await import('/persistence.js')).deviceCache.flush());
        // Closing an isolated context erases all its local storage and IndexedDB.
        await context.close();
        ({ page, context } = await pageFor(browser));
        assert.equal(await page.locator('[data-value="total-cal"]').textContent(), '0');
        await signIn(page, email);
        assert.equal(await page.locator('[data-value="total-cal"]').textContent(), '120');
        await logChicken(page);
        assert.equal(await page.locator('[data-value="total-cal"]').textContent(), '240');
        await click(page, '#btn-account'); await click(page, '[data-dialog-tab="account"].select-trigger'); await click(page, '#btn-sign-out');
        await page.waitForFunction(() => !document.querySelector('#auth-form').hidden);
        await signIn(page, otherEmail, true);
        assert.equal(await page.locator('[data-value="total-cal"]').textContent(), '0');
        await logChicken(page);
        await click(page, '#btn-account'); await click(page, '[data-dialog-tab="account"].select-trigger'); await click(page, '#btn-sign-out');
        await page.waitForFunction(() => !document.querySelector('#auth-form').hidden);
        await signIn(page, email);
        assert.equal(await page.locator('[data-value="total-cal"]').textContent(), '240');
    } finally { await browser.close(); }
});

test('offline app reload preserves pending diary edits and backs them up on reconnection', { skip: !process.env.MACROTRACKER_EMULATORS }, async () => {
    const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    try {
        const { page, context } = await pageFor(browser);
        const email = `offline-${Date.now()}@example.test`;
        await signIn(page, email, true);
        await page.evaluate(async () => {
            await navigator.serviceWorker.ready;
            if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
        });
        await context.setOffline(true);
        await page.locator('#food-search-input').fill('Chicken');
        await click(page, '#dropdown-results button:first-child');
        await click(page, '#btn-confirm-log');
        await page.evaluate(async () => (await import('/persistence.js')).deviceCache.flush());
        assert.equal(await page.locator('[data-value="total-cal"]').textContent(), '120');
        await page.reload(); await page.waitForSelector('#btn-toggle-view', { state: 'attached' });
        await page.waitForFunction(() => document.querySelector('[data-value="total-cal"]').textContent === '120');
        await context.setOffline(false);
        await page.waitForFunction(() => document.querySelector('#cloud-status').textContent === 'Backed up to your account.', null, { timeout: 45000 });
        await context.close();
        const recovered = await pageFor(browser);
        await signIn(recovered.page, email);
        assert.equal(await recovered.page.locator('[data-value="total-cal"]').textContent(), '120');
    } finally { await browser.close(); }
});

test('concurrent edits are rejected instead of overwriting a newer cloud diary', { skip: !process.env.MACROTRACKER_EMULATORS }, async () => {
    const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    try {
        const first = await pageFor(browser);
        const email = `concurrent-${Date.now()}@example.test`;
        await signIn(first.page, email, true);
        const second = await pageFor(browser);
        await signIn(second.page, email);
        await logChicken(first.page);
        await second.page.locator('#food-search-input').fill('Chicken');
        await click(second.page, '#dropdown-results button:first-child');
        await second.page.locator('#modal-qty-input').fill('2');
        await click(second.page, '#btn-confirm-log');
        await second.page.waitForFunction(() => document.querySelector('#cloud-status').textContent.includes('Another device changed'));
        assert.equal(await second.page.locator('[data-value="total-cal"]').textContent(), '240');
        const third = await pageFor(browser);
        await signIn(third.page, email);
        assert.equal(await third.page.locator('[data-value="total-cal"]').textContent(), '120');
    } finally { await browser.close(); }
});

test('a returning account restores legacy balanced targets and recovers a profile-load failure without losing auth', { skip: !process.env.MACROTRACKER_EMULATORS }, async () => {
    const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
    const { doc, setDoc } = require('firebase/firestore');
    const environment = await initializeTestEnvironment({ projectId: 'demo-macrotracker', firestore: { host: '127.0.0.1', port: 8080 } });
    try {
        const first = await pageFor(browser);
        const email = `returning-primary-${Date.now()}@example.test`;
        await signIn(first.page, email, true);
        const uid = await first.page.evaluate(async () => {
            // UID is the device cache scope, not a provider token.
            return (await import('/persistence.js')).deviceCache.scope;
        });
        await environment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), `users/${uid}/profile/current`), {
                version: '2.0', profile: { displayName: 'Returning user' }, settings: { onboardingComplete: true },
                targets: { cal: 2000, p: 150, c: 200, f: 65 }, _revision: 2
            });
        });
        await first.context.close();
        const returning = await pageFor(browser);
        await signIn(returning.page, email);
        const targets = await returning.page.evaluate(async () => (await import('/state.js')).store.get().targets);
        assert.ok(Math.abs(targets.cal - 4 * targets.p - 4 * targets.c - 9 * targets.f) < 1e-5);
        await returning.context.close();
        await environment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), `users/${uid}/catalog/current`), { foodDatabase: 'invalid legacy field', recipes: [], _revision: 2 });
        });
        const broken = await pageFor(browser);
        await click(broken.page, '#btn-account'); await click(broken.page, '[data-dialog-tab="account"].select-trigger');
        await broken.page.waitForFunction(() => document.querySelector('#account-panel').dataset.authReady === 'true');
        await broken.page.locator('#auth-form input[name=email]').fill(email);
        await broken.page.locator('#auth-form input[name=password]').fill('test-password-123');
        await broken.page.locator('#auth-form').dispatchEvent('submit');
        await broken.page.waitForFunction(() => document.querySelector('#cloud-status').textContent.includes('Sign-in succeeded'));
        assert.equal(await broken.page.locator('#auth-form').evaluate(el => el.hidden), true);
        assert.equal(await broken.page.locator('#btn-sign-out').evaluate(el => el.hidden), false);
        await environment.withSecurityRulesDisabled(async context => {
            await setDoc(doc(context.firestore(), `users/${uid}/catalog/current`), { foodDatabase: [], recipes: [], _revision: 3 });
        });
        await click(broken.page, '#btn-sync-retry');
        await broken.page.waitForFunction(() => document.querySelector('#cloud-status').textContent === 'Backed up to your account.');
        assert.equal(await broken.page.evaluate(async () => (await import('/persistence.js')).deviceCache.scope), uid);
    } finally { await environment.cleanup(); await browser.close(); }
});

test('cloud diary without a profile document is restored rather than overwritten as a new account', { skip: !process.env.MACROTRACKER_EMULATORS }, async () => {
    const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
    const { doc, deleteDoc } = require('firebase/firestore');
    const environment = await initializeTestEnvironment({ projectId: 'demo-macrotracker', firestore: { host: '127.0.0.1', port: 8080 } });
    try {
        const first = await pageFor(browser);
        const email = `missing-profile-${Date.now()}@example.test`;
        await signIn(first.page, email, true); await logChicken(first.page);
        const uid = await first.page.evaluate(async () => (await import('/persistence.js')).deviceCache.scope);
        await environment.withSecurityRulesDisabled(async context => {
            await deleteDoc(doc(context.firestore(), `users/${uid}/profile/current`));
            await deleteDoc(doc(context.firestore(), `users/${uid}/catalog/current`));
        });
        await first.context.close();
        const returning = await pageFor(browser); await signIn(returning.page, email);
        assert.equal(await returning.page.locator('[data-value="total-cal"]').textContent(), '120');
    } finally { await environment.cleanup(); await browser.close(); }
});

test('auth restoration uses displayName, canonical profile name, legacy profile name and unnamed fallback', { skip: !process.env.MACROTRACKER_EMULATORS }, async () => {
    const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    const email = `greeting-${Date.now()}@example.test`;
    try {
        const { page, context } = await pageFor(browser);
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        await signIn(page, email, true);
        assert.ok((await page.locator('#dashboard-greeting').textContent()).endsWith(', there'));
        await page.evaluate(async () => {
            const { store } = await import('/state.js');
            store.update(state => { state.profile.name = 'Canonical Person'; });
        });
        await page.waitForFunction(() => document.querySelector('#cloud-status').textContent === 'Backed up to your account.');
        await page.reload();
        await page.waitForFunction(() => document.querySelector('#dashboard-greeting').textContent.endsWith(', Canonical Person'));
        const signedIn = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'test-password-123', returnSecureToken: true })
        }).then(response => response.json());
        assert.ok(signedIn.localId);
        const root = `http://127.0.0.1:8080/v1/projects/demo-macrotracker/databases/(default)/documents/users/${signedIn.localId}`;
        const legacy = await fetch(root, { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { profile: { mapValue: { fields: { name: { stringValue: 'Legacy Person' } } } } } }) });
        assert.equal(legacy.ok, true);
        await page.evaluate(async () => {
            const { store } = await import('/state.js');
            store.update(state => { state.profile.name = ''; state.profile.displayName = ''; });
        });
        await page.waitForFunction(() => document.querySelector('#cloud-status').textContent === 'Backed up to your account.');
        await page.reload();
        await page.waitForFunction(() => document.querySelector('#dashboard-greeting').textContent.endsWith(', Legacy Person'));
        const updated = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:update?key=demo-key', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: signedIn.idToken, displayName: 'Google Person', returnSecureToken: true })
        });
        assert.equal(updated.ok, true);
        await context.close();
        const restored = await pageFor(browser);
        await signIn(restored.page, email);
        assert.ok((await restored.page.locator('#dashboard-greeting').textContent()).endsWith(', Legacy Person'), 'App profile overrides Google name');
        assert.deepEqual(errors, []);
        await restored.context.close();
    } finally { await browser.close(); }
});

test('onboarding weight, profile name and dashboard edits restore across fresh authenticated sessions', { skip: !process.env.MACROTRACKER_EMULATORS }, async () => {
    const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    try {
        let { page, context } = await pageFor(browser);
        await page.waitForFunction(() => !document.querySelector('#btn-start-onboarding').disabled);
        await click(page, '#btn-start-onboarding');
        await page.locator('#onboarding-form input[name=displayName]').fill('Preferred Cloud Name'); await click(page, '#onboarding-next');
        await page.locator('#onboarding-form input[name=age]').fill('30'); await page.locator('#onboarding-form input[name=heightCm]').fill('180'); await page.locator('#onboarding-form input[name=currentWeight]').fill('80');
        await click(page, '#onboarding-next'); await click(page, '#onboarding-next'); await page.locator('#onboarding-form').dispatchEvent('submit');
        await page.evaluate(async () => (await import('/persistence.js')).deviceCache.flush());
        const email = `weight-cloud-${Date.now()}@example.test`;
        await signIn(page, email, true);
        await page.waitForFunction(async () => {
            const { deviceCache } = await import('/persistence.js');
            return deviceCache.scope !== 'guest' && !(await deviceCache.read()).pending;
        });
        assert.match(await page.locator('#weight-latest').textContent(), /80 kg/);
        await context.close();
        ({ page, context } = await pageFor(browser)); await signIn(page, email);
        assert.match(await page.locator('#weight-latest').textContent(), /80 kg/);
        assert.ok((await page.locator('#dashboard-greeting').textContent()).endsWith(', Preferred Cloud Name'));
        await page.locator('#quick-weight-form input[name=value]').fill('79'); await page.locator('#quick-weight-form').dispatchEvent('submit');
        assert.match(await page.locator('#weight-latest').textContent(), /79 kg/, await page.locator('#weight-feedback').textContent());
        await page.waitForFunction(() => document.querySelector('#cloud-status').textContent === 'Backed up to your account.');
        await page.waitForFunction(async () => !(await (await import('/persistence.js')).deviceCache.read()).pending);
        await context.close();
        ({ page, context } = await pageFor(browser)); await signIn(page, email);
        assert.match(await page.locator('#weight-latest').textContent(), /79 kg/);
        assert.equal(await page.evaluate(async () => (await import('/state.js')).store.get().weightLog.length), 1);
        await context.close();
    } finally { await browser.close(); }
});

test('returning legacy primary-shaped account restores through repeated authenticated reloads without losing diary', { skip: !process.env.MACROTRACKER_EMULATORS }, async () => {
    const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
    const { doc, setDoc } = require('firebase/firestore');
    const environment = await initializeTestEnvironment({ projectId: 'demo-macrotracker', firestore: { host: '127.0.0.1', port: 8080 } });
    try {
        const { page, context } = await pageFor(browser); const errors = []; page.on('pageerror', error => errors.push(error.message));
        const email = `legacy-primary-${Date.now()}@example.test`; await signIn(page, email, true); await logChicken(page);
        const uid = await page.evaluate(async () => (await import('/persistence.js')).deviceCache.scope);
        await environment.withSecurityRulesDisabled(async admin => {
            await setDoc(doc(admin.firestore(), `users/${uid}/profile/current`), { displayName: 'Preferred legacy primary', goalType: 'cut', targets: { cal: 2200 }, _revision: 2 });
        });
        for (let i = 0; i < 3; i++) {
            await page.reload(); await page.waitForFunction(() => document.querySelector('#cloud-status').textContent === 'Backed up to your account.');
            assert.equal(await page.evaluate(async () => (await import('/persistence.js')).deviceCache.scope), uid);
            assert.equal(await page.locator('#auth-form').evaluate(el => el.hidden), true);
            assert.equal(await page.locator('[data-value=total-cal]').textContent(), '120');
            assert.ok((await page.locator('#dashboard-greeting').textContent()).endsWith(', Preferred legacy primary'));
        }
        assert.deepEqual(errors, []); await context.close();
    } finally { await environment.cleanup(); await browser.close(); }
});
