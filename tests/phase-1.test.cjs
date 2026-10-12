const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const baseURL = process.env.MACROTRACKER_TEST_URL || 'http://127.0.0.1:8000';
async function withPage(run, setup) {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    try {
        const page = await browser.newPage();
        await page.route('https://**/*', route => route.abort());
        if (setup) await page.addInitScript(setup);
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.goto(baseURL);
        await page.waitForSelector('#btn-toggle-view', { state: 'attached' });
        await run(page);
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
}
const click = (page, selector) => page.locator(selector).dispatchEvent('click');

test('store isolates drafts, validates, rolls back persistence failures and publishes imports', async () => {
    await withPage(async page => {
        const results = await page.evaluate(async () => {
            const { createStore } = await import('/store.js');
            const { store, importUserData, STORAGE_KEY } = await import('/state.js');
            let writes = 0, notifications = 0, errors = 0, retained;
            const testStore = createStore({ count: 0 }, { saveLocalState: () => writes++, validate: s => s.count >= 0, onSubscriberError: () => errors++ });
            testStore.subscribe(s => { s.count = 99; notifications++; });
            const off = testStore.subscribe(() => { throw Error('subscriber'); });
            testStore.update(draft => { draft.count++; retained = draft; });
            retained.count = 500;
            testStore.get().count = 800;
            off();
            let rejected = 0;
            for (const update of [d => { d.count = -1; }, async () => {}, () => testStore.update(() => {})]) {
                try { testStore.update(update); } catch { rejected++; }
            }
            const quota = createStore({ count: 0 }, { saveLocalState: () => { throw Error('quota'); } });
            try { quota.update(d => { d.count++; }); } catch {}
            const before = store.get();
            const imported = { ...before, targets: { ...before.targets, cal: 2300 } };
            await importUserData({ target: { files: [new File([JSON.stringify(imported)], 'backup.json')] } });
            const published = document.querySelector('[data-value="target-cal"]').textContent;
            let invalidRejected = false;
            try { await importUserData({ target: { files: [new File(['{"targets":{},"logs":null}'], 'bad.json')] } }); }
            catch { invalidRejected = true; }
            const controller = new AbortController(); controller.abort();
            let cancelled = false;
            try { await importUserData({ target: { files: [new File([JSON.stringify(before)], 'backup.json')] } }, { signal: controller.signal }); }
            catch { cancelled = true; }
            return { count: testStore.get().count, writes, notifications, errors, rejected, quota: quota.get().count,
                published, invalidRejected, cancelled, saved: (await (await import('/persistence.js')).deviceCache.read('guest')).state.targets.cal, current: store.get().targets.cal };
        });
        assert.deepEqual(results, { count: 1, writes: 1, notifications: 1, errors: 1, rejected: 3, quota: 0,
            published: '2300', invalidRejected: true, cancelled: true, saved: 2300, current: 2300 });
    });
});

test('delegated recipe, database and custom food actions persist without globals or inline handlers', async () => {
    await withPage(async page => {
        await click(page, '#predictive-pills button:first-child');
        await click(page, '[data-action="remove-tuner-ingredient"][data-id="1"]');
        await click(page, '#btn-confirm-recipe');
        assert.equal(await page.locator('[data-value="total-cal"]').textContent(), '240');
        await click(page, '[data-action="toggle-group"]');
        const drawer = page.locator('#daily-log-container [id^="drawer-"]');
        assert.equal(await drawer.evaluate(el => el.classList.contains('hidden')), false);
        await click(page, '[data-action="edit-diary-entry"]');
        // Editing the nested button must not dispatch its parent's toggle action.
        assert.equal(await drawer.evaluate(el => el.classList.contains('hidden')), false);
        await page.locator('.recipe-tuner-input').first().fill('100');
        await click(page, '#btn-confirm-recipe');
        assert.equal(await page.locator('[data-value="total-cal"]').textContent(), '120');
        await click(page, '[data-action="delete-diary-entry"]');
        assert.equal(await page.locator('[data-value="total-cal"]').textContent(), '0');
        await click(page, '[data-nav="view-database"]');
        await click(page, '[data-action="pin"][data-id="rec_chicken_rice"]');
        assert.equal(await page.locator('#predictive-pills button').count(), 1);
        await click(page, '#btn-open-add-food');
        await page.locator('#custom-food-name').fill('Test oats');
        await page.locator('#custom-food-cal').fill('150');
        await page.locator('#custom-food-form').dispatchEvent('submit');
        assert.equal(await page.locator('#database-list-container').getByText('Test oats', { exact: true }).count(), 1);
        await click(page, '#btn-open-add-food');
        await click(page, '#tab-mode-recipe');
        await page.locator('#custom-recipe-name').fill('Test meal');
        await click(page, '#btn-recipe-food-trigger');
        await click(page, '.recipe-food-opt[data-id="1"]');
        await click(page, '#btn-add-ing-to-recipe');
        await click(page, '#btn-save-custom-recipe');
        assert.equal(await page.locator('#database-list-container').getByText('Test meal', { exact: false }).count(), 1);
        await page.reload();
        const state = await page.evaluate(async () => (await import('/state.js')).store.get());
        assert.equal(state.recipes.find(r => r.id === 'rec_chicken_rice').pinned, false);
        assert.equal(state.recipes.some(r => r.name === 'Test meal'), true);
        assert.equal(state.foodDatabase.some(f => f.name === 'Test oats'), true);
        assert.equal(await page.locator('[onclick]').count(), 0);
        assert.equal(await page.evaluate(() => ['editDiaryEntry', 'deleteDiaryEntry', 'toggleGroupAccordion', 'removeBuilderIng', 'removeTunerIngredient'].some(k => k in window)), false);
    });
});

test('USDA search cancels stale requests and ignores late responses', async () => {
    await withPage(async page => {
        await page.locator('#food-search-input').fill('eggs');
        await click(page, '#dropdown-results button');
        await page.waitForFunction(() => window.searchPending);
        await page.locator('#food-search-input').fill('Chicken');
        assert.equal(await page.evaluate(() => window.searchPending.signal.aborted), true);
        await page.evaluate(() => window.searchPending.resolve({ ok: true, json: async () => ({ foods: [{ fdcId: 999, description: 'Stale eggs', foodNutrients: [] }] }) }));
        await page.waitForTimeout(30);
        assert.equal(await page.locator('#dropdown-results').getByText('Stale eggs', { exact: true }).count(), 0);
        assert.equal(await page.locator('#dropdown-results').getByText('Chicken Breast (Raw)', { exact: true }).count(), 1);
    }, () => {
        const native = window.fetch;
        window.fetch = (url, options) => String(url).includes('api.nal.usda.gov')
            ? new Promise(resolve => { window.searchPending = { resolve, signal: options.signal }; })
            : native(url, options);
    });
});

test('scanner close releases a late camera start and aborts barcode requests', async () => {
    await withPage(async page => {
        await click(page, '#btn-scan-barcode');
        await click(page, '#btn-close-scanner');
        await page.waitForTimeout(400);
        assert.equal(await page.evaluate(() => window.scannerHarness.instances), 0);
        await click(page, '#btn-scan-barcode');
        await page.waitForFunction(() => window.scannerHarness.resolveStart);
        await click(page, '#btn-close-scanner');
        await page.evaluate(() => window.scannerHarness.resolveStart());
        await page.waitForFunction(() => window.scannerHarness.stops === 1 && window.scannerHarness.clears === 1);
        await click(page, '#btn-scan-barcode');
        await page.waitForFunction(() => window.scannerHarness.instances === 2 && window.scannerHarness.resolveStart);
        await page.evaluate(() => window.scannerHarness.resolveStart());
        await page.evaluate(() => window.scannerHarness.callback('123456789012'));
        await page.waitForFunction(() => window.barcodePending);
        await click(page, '#btn-close-scanner');
        await page.waitForFunction(() => window.scannerHarness.stops === 2 && window.scannerHarness.clears === 2);
        assert.equal(await page.evaluate(() => window.barcodePending.aborted), true);
        assert.equal(await page.evaluate(async () => (await import('/state.js')).store.get().foodDatabase.some(f => String(f.id).startsWith('off_'))), false);
    }, () => {
        window.scannerHarness = { instances: 0, stops: 0, clears: 0 };
        window.Html5Qrcode = class {
            constructor() { window.scannerHarness.instances++; }
            start(camera, config, callback) {
                window.scannerHarness.callback = callback;
                return new Promise(resolve => {
                    window.scannerHarness.resolveStart = () => { this.isScanning = true; window.scannerHarness.resolveStart = null; resolve(); };
                });
            }
            async stop() { this.isScanning = false; window.scannerHarness.stops++; }
            clear() { window.scannerHarness.clears++; }
        };
        const native = window.fetch;
        window.fetch = (url, options) => {
            if (!String(url).includes('world.openfoodfacts.org')) return native(url, options);
            window.barcodePending = options.signal;
            return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true }));
        };
    });
});
