// Run against the local Python server with Playwright available through NODE_PATH.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const baseURL = process.env.MACROTRACKER_TEST_URL || 'http://127.0.0.1:8000';

test('cached dashboard updates values and views without replacing nodes', async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    try {
        const page = await browser.newPage();
        // CDN availability is independent of local dashboard behavior.
        await page.route('https://**/*', route => route.abort());
        await page.goto(baseURL);
        await page.waitForSelector('#btn-toggle-view', { state: 'attached' });
        const result = await page.evaluate(async () => {
            const { createDashboard } = await import('/dashboard.js');
            const root = document.createElement('div');
            document.body.append(root);
            const dashboard = createDashboard(root);
            const nodes = [...root.querySelectorAll('*')];
            const targets = { cal: 2000, p: 100, c: 200, f: 50 };
            const totals = { cal: 500, p: 50, c: 100, f: 25 };
            dashboard.update(totals, targets);
            const initial = {
                total: root.querySelector('[data-value="total-cal"]').textContent,
                ring: Number(root.querySelector('[data-ring="p"]').style.strokeDashoffset),
                transform: root.querySelector('[data-bar="p"]').style.transform,
                remaining: root.querySelector('[data-value="difference"]').textContent
            };
            const observer = new MutationObserver(() => {});
            observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
            dashboard.update(totals, targets);
            const unchangedMutations = observer.takeRecords().length;
            const toggle = root.querySelector('#btn-toggle-view');
            toggle.focus();
            for (const view of ['bars', 'minimal', 'rings']) dashboard.update(totals, targets, view);
            const focusPreserved = document.activeElement === toggle;
            const sameNodes = nodes.every((node, i) => root.querySelectorAll('*')[i] === node);
            dashboard.update({ cal: 2200, p: 200, c: -5, f: 25 }, { ...targets, f: 0 }, 'bars');
            const edge = {
                label: root.querySelector('[data-value="difference-label"]').textContent,
                difference: root.querySelector('[data-value="difference"]').textContent,
                overColor: root.querySelector('[data-value="difference"]').parentElement.classList.contains('text-rose-400'),
                transforms: [...root.querySelectorAll('[data-bar]')].map(n => n.style.transform),
                offsets: [...root.querySelectorAll('[data-ring]')].map(n => Number(n.style.strokeDashoffset)),
                visible: [...root.querySelectorAll('[data-view]')].filter(n => !n.hidden).map(n => n.dataset.view)
            };
            dashboard.update({ cal: 0, p: NaN, c: Infinity, f: 0 }, { cal: 0, p: 0, c: 0, f: 0 });
            return { initial, unchangedMutations, sameNodes, focusPreserved, edge,
                finite: [...root.querySelectorAll('[data-ring]')].every(n => Number.isFinite(Number(n.style.strokeDashoffset))) };
        });
        assert.equal(result.initial.total, '500');
        assert.ok(Math.abs(result.initial.ring - Math.PI * 42) < 0.001);
        assert.equal(result.initial.transform, 'scaleX(0.5)');
        assert.equal(result.initial.remaining, '1500');
        assert.equal(result.unchangedMutations, 0);
        assert.equal(result.sameNodes, true);
        assert.equal(result.focusPreserved, true);
        assert.equal(result.edge.label, 'Over');
        assert.equal(result.edge.difference, '200');
        assert.equal(result.edge.overColor, true);
        assert.deepEqual(result.edge.transforms, ['scaleX(1)', 'scaleX(0)', 'scaleX(0)']);
        assert.equal(result.edge.offsets[0], 0);
        assert.deepEqual(result.edge.visible, ['bars']);
        assert.equal(result.finite, true);
    } finally { await browser.close(); }
});

test('food logging, editing, deleting and view toggles update the cached app dashboard', async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    try {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('https://**/*', route => route.abort());
        await page.goto(baseURL);
        await page.waitForSelector('#btn-toggle-view', { state: 'attached' });
        await page.evaluate(() => {
            window.testNodes = [...document.querySelectorAll('#macro-dashboard *')];
            document.querySelector('#btn-toggle-view').focus();
        });
        await page.locator('#food-search-input').fill('Chicken');
        await page.locator('#dropdown-results button').first().dispatchEvent('click');
        await page.locator('#modal-qty-input').fill('2');
        await page.locator('#btn-confirm-log').dispatchEvent('click');
        assert.equal(await page.locator('[data-value="total-cal"]').textContent(), '240');
        assert.equal(await page.locator('[data-value="total-p"]').first().textContent(), '45');
        await page.locator('#daily-log-container button[title="Edit Amount"]').dispatchEvent('click');
        await page.locator('#modal-qty-input').fill('3');
        await page.locator('#btn-confirm-log').dispatchEvent('click');
        assert.equal(await page.locator('[data-value="total-cal"]').textContent(), '360');
        for (const view of ['bars', 'minimal', 'rings']) {
            await page.locator('#btn-toggle-view').dispatchEvent('click');
            assert.equal(await page.locator(`[data-view="${view}"]`).getAttribute('hidden'), null);
            assert.equal(await page.locator('[data-value="total-cal"]').textContent(), '360');
        }
        await page.locator('#daily-log-container button[title="Delete"]').dispatchEvent('click');
        assert.equal(await page.locator('[data-value="total-cal"]').textContent(), '0');
        assert.equal(await page.evaluate(() => window.testNodes.every((node, i) => document.querySelectorAll('#macro-dashboard *')[i] === node)), true);
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});
