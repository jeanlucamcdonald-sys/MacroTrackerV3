const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const baseURL = process.env.MACROTRACKER_TEST_URL || 'http://127.0.0.1:8000';
async function withPage(run) {
    const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    try {
        const context = await browser.newContext({ viewport: { width: 390, height: 740 }, serviceWorkers: 'block' });
        await context.addInitScript(() => window.MACROTRACKER_FIREBASE_CONFIG = {});
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await run(page);
        assert.deepEqual(errors, [], 'No unhandled runtime exceptions');
    } finally { await browser.close(); }
}
test('Account and plan setup work before a slow catalog resolves; typed search refreshes afterward', async () => {
    await withPage(async page => {
        let release;
        const pending = new Promise(resolve => release = resolve);
        await page.route('**/data/foods.json', async route => { await pending; await route.continue(); });
        try {
            await page.goto(baseURL);
            await page.locator('#btn-menu').click(); await page.locator('#btn-account').click();
            assert.equal(await page.locator('#view-settings').isVisible(), true);
            await page.locator('#btn-settings-back').click();
            await page.locator('#btn-start-onboarding').click();
            assert.equal(await page.locator('#account-dialog').evaluate(el => el.hidden), false);
            const panel = await page.locator('#account-dialog-panel').boundingBox();
            assert.ok(Math.abs(panel.x + panel.width / 2 - 195) < 2);
            assert.ok(Math.abs(panel.y + panel.height / 2 - 370) < 2);
            await page.locator('#account-dialog-backdrop').click({ position: { x: 5, y: 5 } });
            assert.equal(await page.locator('#account-dialog').evaluate(el => el.hidden), true);
            await page.locator('#food-search-input').fill('apple');
            release();
            await page.waitForFunction(() => document.documentElement.dataset.catalogStatus === 'ready');
            assert.match(await page.locator('#dropdown-results').textContent(), /apple/i);
        } finally { release(); }
    });
});
test('catalog errors preserve controls, reject incomplete data and allow a successful retry', async () => {
    await withPage(async page => {
        await page.route('**/data/foods.json', route => route.fulfill({ status: 200, contentType: 'application/json', body: '[{"id":"partial","name":"Bad seed"}]' }));
        await page.goto(baseURL);
        await page.waitForFunction(() => document.documentElement.dataset.catalogStatus === 'error');
        assert.equal(await page.evaluate(async () => (await import('/product-catalog.js')).allFoods().length), 0);
        await page.locator('#btn-menu').click(); await page.locator('#btn-account').click(); await page.locator('#btn-settings-back').click();
        await page.locator('#btn-start-onboarding').click(); await page.locator('#btn-close-account').click();
        await page.unroute('**/data/foods.json');
        await page.locator('#btn-retry-catalog').click();
        await page.waitForFunction(() => document.documentElement.dataset.catalogStatus === 'ready');
        assert.equal(await page.evaluate(async () => (await import('/product-catalog.js')).allFoods().length), 6636);
    });
});
test('a dashboard initialization failure cannot disable account or onboarding listeners', async () => {
    await withPage(async page => {
        await page.route('**/dashboard.js', route => route.fulfill({ contentType: 'text/javascript', body: 'export function createDashboard() { throw new Error("Injected dashboard failure"); }' }));
        await page.goto(baseURL);
        await page.locator('#btn-menu').click(); await page.locator('#btn-account').click(); await page.locator('#btn-settings-back').click();
        await page.locator('#btn-start-onboarding').click();
        assert.equal(await page.locator('[data-dialog-view=onboarding]').evaluate(el => el.hidden), false);
    });
});
test('an account initialization rejection leaves the independent onboarding wizard functional', async () => {
    await withPage(async page => {
        await page.route('**/account.js', route => route.fulfill({ contentType: 'text/javascript', body: 'throw new Error("Injected account module evaluation failure"); export async function initializeAccount() {}' }));
        await page.goto(baseURL);
        await page.locator('#btn-start-onboarding').click();
        assert.equal(await page.locator('[data-dialog-view=onboarding]').evaluate(el => el.hidden), false);
        await page.waitForFunction(() => document.querySelector('#cloud-status').textContent.includes('could not initialize'));
    });
});
test('validated catalog cache restores all entries on network failure, and startup console is clean', async () => {
    await withPage(async page => {
        const consoleErrors = [];
        page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
        await page.goto(baseURL);
        await page.waitForFunction(() => document.documentElement.dataset.catalogStatus === 'ready');
        assert.deepEqual(consoleErrors, []);
        await page.waitForFunction(async () => !!(await (await caches.open('macrotracker-food-catalog-usda-6636-v1')).match(new URL('./data/foods.json', location.href))));
        await page.route('**/data/foods.json', route => route.abort());
        await page.reload();
        await page.waitForFunction(() => document.documentElement.dataset.catalogStatus === 'ready');
        const results = await page.evaluate(async () => {
            const { allFoods, searchFoods } = await import('/product-catalog.js');
            return { count: allFoods().length, matches: ['chicken', 'apple'].map(query => searchFoods(query).length) };
        });
        assert.equal(results.count, 6636);
        assert.ok(results.matches.every(count => count > 0));
    });
});

test('an onboarding failure cannot stop Firebase auth initialization', async () => {
    await withPage(async page => {
        await page.addInitScript(() => window.MACROTRACKER_FIREBASE_CONFIG = { apiKey: 'test-key', appId: 'test-app' });
        await page.route('**/onboarding.js', route => route.fulfill({ contentType: 'text/javascript', body: 'throw new Error("Injected onboarding module evaluation failure"); export function initializeNutritionUI() {}' }));
        await page.route('**/dist/firebase-adapter.js', route => route.fulfill({ contentType: 'text/javascript', body: 'export async function createFirebaseAdapter() { return { onAuth(callback) { callback(null); return () => {}; }, destroy() {} }; }' }));
        await page.goto(baseURL);
        await page.waitForFunction(() => document.querySelector('#account-panel').dataset.authReady === 'true');
        await page.locator('#btn-menu').click(); await page.locator('#btn-account').click();
        await page.locator('[data-dialog-tab="account"].select-trigger').click();
        assert.equal(await page.locator('#auth-form button[type=submit]').isEnabled(), true);
    });
});
