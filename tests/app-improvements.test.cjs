const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const baseURL = process.env.MACROTRACKER_TEST_URL || 'http://127.0.0.1:8000';
const click = (page, selector) => page.locator(selector).dispatchEvent('click');
async function withPage(run) {
    const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    try {
        const context = await browser.newContext({ viewport: { width: 390, height: 640 } });
        await context.addInitScript(() => window.MACROTRACKER_FIREBASE_CONFIG = {});
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(baseURL);
        await page.waitForSelector('#btn-toggle-view', { state: 'attached' });
        await run(page, context);
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
}
test('mass and volume conversions preserve nutrition and reject assumed density', async () => {
    await withPage(async page => {
        const results = await page.evaluate(async () => {
            const { servingFactor, convertAmount, unitOptions } = await import('/units.js');
            const mass = { baseServing: 100, baseUnit: 'g' };
            const volume = { serving: 1, unit: 'cup' };
            let rejected = false;
            try { servingFactor(mass, 1, 'cup'); } catch { rejected = true; }
            return { oz: servingFactor(mass, 1, 'oz'), kg: servingFactor(mass, 1, 'kg'),
                tsp: servingFactor(volume, 48, 'tsp'), roundTrip: convertAmount(mass, convertAmount(mass, 100, 'g', 'lb'), 'lb', 'g'),
                available: unitOptions(volume).map(option => option.value), rejected };
        });
        assert.ok(Math.abs(results.oz - 0.28349523125) < 1e-10);
        assert.equal(results.kg, 10); assert.ok(Math.abs(results.tsp - 1) < 1e-10);
        assert.ok(Math.abs(results.roundTrip - 100) < 1e-9);
        assert.ok(results.available.includes('fl oz') && results.available.includes('l'));
        assert.equal(results.rejected, true);
    });
});
test('database, meal builder and logging use the shared, viewport-bounded unit widget', async () => {
    await withPage(async page => {
        await click(page, '[data-nav="view-database"]');
        await click(page, '#btn-open-add-food');
        await page.locator('#custom-food-name').fill('Test milk');
        await page.locator('#custom-food-serving').fill('1');
        await page.locator('#custom-food-cal').fill('100');
        await click(page, '#btn-custom-unit-trigger');
        await click(page, '.select-menu [data-value="cup"]');
        await page.locator('#custom-food-form').dispatchEvent('submit');
        await click(page, '#btn-open-add-food'); await click(page, '#tab-mode-recipe');
        await page.locator('#custom-recipe-name').fill('Milk meal');
        await click(page, '#btn-recipe-food-trigger');
        const milkId = await page.evaluate(async () => (await import('/state.js')).store.get().foodDatabase.find(food => food.name === 'Test milk').id);
        await click(page, `.recipe-food-opt[data-id="${milkId}"]`);
        await click(page, '#btn-add-ing-to-recipe');
        await click(page, '[data-builder-unit="0"]'); await click(page, '.select-menu [data-value="tbsp"]');
        assert.equal(await page.locator('.builder-ing-input').inputValue(), '16');
        await click(page, '#btn-save-custom-recipe');
        await click(page, `[data-action="log-food"][data-id="${milkId}"]`);
        await click(page, '#btn-modal-unit-trigger');
        const bounds = await page.locator('.select-menu').evaluate(menu => {
            const rect = menu.getBoundingClientRect();
            return { top: rect.top, bottom: rect.bottom, height: innerHeight, overflow: getComputedStyle(menu).overflowY };
        });
        assert.ok(bounds.top >= 0 && bounds.bottom <= bounds.height, JSON.stringify(bounds));
        assert.equal(bounds.overflow, 'auto');
        await click(page, '.select-menu [data-value="tbsp"]');
        await page.locator('#modal-qty-input').fill('16'); await click(page, '#btn-confirm-log');
        assert.equal(await page.locator('[data-value="total-cal"]').textContent(), '100');
        await click(page, '[data-action="edit-diary-entry"]');
        assert.equal(await page.locator('#modal-unit-label-value').inputValue(), 'tbsp');
        assert.equal(await page.locator('#modal-qty-input').inputValue(), '16');
        assert.equal(await page.locator('select').count(), 0);
    });
});
test('local date watcher clears the active diary after midnight while preserving previous logs', async () => {
    await withPage(async page => {
        const result = await page.evaluate(async () => {
            const { watchLocalDay, localDateString } = await import('/local-date.js');
            let now = new Date(2026, 9, 11, 23, 59, 59);
            let callback, delay, changed;
            const host = { setTimeout(fn, ms) { callback = fn; delay = ms; return 1; }, clearTimeout() {} };
            const stop = watchLocalDay(day => changed = day, { now: () => now, host, document: null });
            const midnightDelay = delay;
            now = new Date(2026, 9, 12, 0, 0, 0); callback(); stop();
            return { changed, midnightDelay, local: localDateString(new Date(2026, 9, 11, 0, 5)) };
        });
        assert.equal(result.changed, '2026-10-12'); assert.equal(result.local, '2026-10-11');
        assert.equal(result.midnightDelay, 1020);
        // Test the actual watcher with the browser's clock across local midnight.
        await page.clock.install({ time: new Date('2026-10-11T23:59:58') });
        await page.reload(); await page.waitForSelector('#btn-toggle-view', { state: 'attached' });
        await page.locator('#food-search-input').fill('Chicken'); await click(page, '#dropdown-results button:first-child');
        await click(page, '#btn-confirm-log');
        assert.equal(await page.locator('[data-value="total-cal"]').textContent(), '120');
        await page.clock.runFor(2100);
        assert.equal(await page.locator('[data-value="total-cal"]').textContent(), '0');
        const history = await page.evaluate(async () => (await import('/state.js')).store.get().logs['2026-10']['2026-10-11'].totals.cal);
        assert.equal(history, 120);
    });
});
test('logging preserves unrelated nodes and overlays transition only transform/opacity', async () => {
    await withPage(async page => {
        await page.evaluate(() => window.pillNodes = [...document.querySelectorAll('#predictive-pills button')]);
        await page.locator('#food-search-input').fill('Chicken'); await click(page, '#dropdown-results button:first-child');
        await click(page, '#btn-confirm-log');
        assert.equal(await page.evaluate(() => window.pillNodes.every((node, i) => node === document.querySelectorAll('#predictive-pills button')[i])), true);
        const properties = await page.evaluate(() => ['modal-content', 'recipe-modal-content', 'drawer-panel', 'logging-modal', 'custom-food-modal'].map(id => getComputedStyle(document.getElementById(id)).transitionProperty));
        assert.deepEqual(properties, ['transform', 'transform', 'transform', 'opacity', 'opacity']);
        await click(page, '#btn-menu'); await click(page, '#btn-close-drawer'); await click(page, '#btn-menu');
        await page.waitForTimeout(250);
        assert.equal(await page.locator('#drawer-container').evaluate(el => el.classList.contains('pointer-events-none')), false);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        assert.equal(await page.locator('#drawer-panel').evaluate(el => getComputedStyle(el).transitionDuration), '1e-05s');
    });
});
