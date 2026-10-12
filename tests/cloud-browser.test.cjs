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
    await page.waitForFunction(() => document.querySelector('#account-panel').dataset.authReady === 'true');
    await page.locator('#auth-form input[name=email]').fill(email);
    await page.locator('#auth-form input[name=password]').fill('test-password-123');
    if (create) await click(page, '#btn-sign-up');
    else await page.locator('#auth-form').dispatchEvent('submit');
    await page.waitForFunction(() => document.querySelector('#cloud-status').textContent === 'Backed up to your account.');
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
        await click(page, '#btn-sign-out');
        await page.waitForFunction(() => !document.querySelector('#auth-form').hidden);
        await signIn(page, otherEmail, true);
        assert.equal(await page.locator('[data-value="total-cal"]').textContent(), '0');
        await logChicken(page);
        await click(page, '#btn-sign-out');
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
