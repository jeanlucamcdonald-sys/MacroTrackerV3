const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const baseURL = process.env.MACROTRACKER_TEST_URL || 'http://127.0.0.1:8000';
const click = (page, selector) => page.locator(selector).dispatchEvent('click');
async function withPage(run) {
    const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    try {
        const page = await browser.newPage({ viewport: { width: 390, height: 740 } });
        await page.addInitScript(() => window.MACROTRACKER_FIREBASE_CONFIG = {});
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        await page.goto(baseURL); await page.waitForSelector('#btn-toggle-view', { state: 'attached' });
        await run(page); assert.deepEqual(errors, []);
    } finally { await browser.close(); }
}
test('guided onboarding generates balanced targets and personalized greeting', async () => {
    await withPage(async page => {
        await click(page, '#btn-start-onboarding');
        await page.locator('#onboarding-form input[name=displayName]').fill('Jean-Luc');
        await click(page, '#onboarding-next');
        await page.locator('#onboarding-form input[name=age]').fill('30');
        await page.locator('#onboarding-form input[name=heightCm]').fill('180');
        await page.locator('#onboarding-form input[name=currentWeight]').fill('80');
        await click(page, '#onboarding-next');
        await click(page, '[data-onboarding-select=activity]');
        await click(page, '.select-menu [data-value=moderate]');
        await click(page, '#onboarding-next');
        assert.match(await page.locator('#onboarding-estimate').textContent(), /Estimated expenditure:.*144g protein/);
        await page.locator('#onboarding-form').dispatchEvent('submit');
        const state = await page.evaluate(async () => (await import('/state.js')).store.get());
        assert.equal(state.settings.onboardingComplete, true);
        assert.equal(state.profile.activity, 'moderate');
        assert.ok(Math.abs(state.targets.cal - (4 * state.targets.p + 4 * state.targets.c + 9 * state.targets.f)) < 1e-5);
        assert.equal(await page.locator('#dashboard-greeting').textContent(), 'Welcome Jean-Luc');
        assert.equal(await page.locator('#onboarding-card').evaluate(el => el.hidden), true);
    });
});
test('target editor caps impossible protein and synchronizes calories in unlocked mode', async () => {
    await withPage(async page => {
        await click(page, '#btn-account'); await click(page, '[data-dialog-tab=settings]');
        await page.locator('#goals-form input[name=p]').fill('1000');
        assert.equal(await page.locator('#goals-form input[name=p]').inputValue(), '500');
        assert.equal(await page.locator('#goals-form input[name=c]').inputValue(), '0');
        assert.equal(await page.locator('#goals-form input[name=f]').inputValue(), '0');
        await page.locator('#goals-form').dispatchEvent('submit');
        await page.locator('#calorie-lock').uncheck();
        await page.locator('#goals-form input[name=p]').fill('600');
        assert.equal(await page.locator('#goals-form input[name=cal]').inputValue(), '2400');
        await page.locator('#goals-form').dispatchEvent('submit');
        const state = await page.evaluate(async () => (await import('/state.js')).store.get());
        assert.equal(state.targets.cal, 2400); assert.equal(state.targets.p, 600);
    });
});
test('quick account overview auto-dismisses; explicit settings stay open and hamburger is clean', async () => {
    await withPage(async page => {
        assert.equal(await page.locator('#drawer-panel #account-panel').count(), 0);
        assert.equal(await page.locator('#drawer-panel [data-nav=view-profile]').count(), 0);
        await page.clock.install();
        await click(page, '#btn-account'); await page.clock.runFor(8100);
        assert.equal(await page.locator('#account-dialog').evaluate(el => el.hidden), true);
        await click(page, '#btn-account'); await click(page, '[data-dialog-tab=settings]');
        await page.clock.runFor(8100);
        assert.equal(await page.locator('#account-dialog').evaluate(el => el.hidden), false);
        await click(page, '#account-dialog-backdrop');
        assert.equal(await page.locator('#account-dialog').evaluate(el => el.hidden), true);
    });
});
test('built-in catalog covers thousands of foods and searches ranked local results offline', async () => {
    await withPage(async page => {
        const result = await page.evaluate(async () => {
            const { allFoods, searchFoods } = await import('/product-catalog.js');
            const foods = allFoods();
            return { size: foods.length, groups: new Set(foods.map(food => food.category)).size, salmon: searchFoods('salmon', [], 5).map(food => food.name) };
        });
        assert.equal(result.size, 6636); assert.equal(result.groups, 25); assert.ok(result.salmon.length > 0);
        await page.context().setOffline(true);
        await page.locator('#food-search-input').fill('salmon');
        assert.ok(await page.locator('#dropdown-results button').count() > 1);
        await click(page, '#dropdown-results button:first-child'); await click(page, '#btn-confirm-log');
        assert.ok(Number(await page.locator('[data-value="total-cal"]').textContent()) > 0);
    });
});
test('time-aware prompts handle morning, afternoon, evening and untrusted profile names', async () => {
    await withPage(async page => {
        const contexts = await page.evaluate(async () => {
            const { dashboardContext } = await import('/dashboard-context.js');
            return [8, 13, 19, 23].map(hour => dashboardContext({ displayName: 'Jean-Luc' }, null, new Date(2026, 9, 11, hour, 0)));
        });
        assert.equal(contexts[0].prompt, "What's for breakfast?");
        assert.equal(contexts[1].prompt, "What's fueling you today?");
        assert.equal(contexts[2].phase, 'evening'); assert.equal(contexts[3].phase, 'late');
        assert.equal(contexts.every(context => context.greeting === 'Welcome Jean-Luc'), true);
    });
});

test('remote product search caches normalized queries and preserves one provider when the other fails', async () => {
    await withPage(async page => {
        const result = await page.evaluate(async () => {
            const native = fetch;
            let requests = 0;
            let offlineProvider = false;
            globalThis.fetch = async url => {
                requests++;
                if (String(url).includes('api.nal.usda.gov')) return {
                    ok: true, json: async () => ({ foods: [{ fdcId: 42, description: 'Test product', foodNutrients: [
                        { nutrientId: 1008, value: 200 }, { nutrientId: 1003, value: 10 }, { nutrientId: 1005, value: 20 }, { nutrientId: 1004, value: 8 }
                    ] }] })
                };
                if (offlineProvider) throw Error('Provider unavailable');
                return { ok: true, json: async () => ({ products: [] }) };
            };
            try {
                const { searchProducts } = await import('/product-search.js');
                const first = await searchProducts(' Test  Product ');
                const second = await searchProducts('test product');
                const cachedRequests = requests;
                offlineProvider = true;
                const partial = await searchProducts('different product');
                return { first: first.foods.length, second: second.foods.length, cachedRequests, partial: partial.foods.length, unavailable: partial.unavailable };
            } finally { globalThis.fetch = native; }
        });
        assert.deepEqual(result, { first: 1, second: 1, cachedRequests: 2, partial: 1, unavailable: ['Open Food Facts'] });
    });
});

test('meal ingredient catalog searches stay open while typing and select archived foods', async () => {
    await withPage(async page => {
        await click(page, '[data-nav=view-database]'); await click(page, '#btn-open-add-food');
        await page.locator('#custom-recipe-name').fill('Salmon meal');
        await click(page, '#btn-recipe-food-trigger');
        await page.locator('#recipe-food-search').click();
        await page.locator('#recipe-food-search').fill('salmon');
        assert.equal(await page.locator('#recipe-food-dropdown').evaluate(el => el.classList.contains('hidden')), false);
        await page.locator('.recipe-food-opt').first().dispatchEvent('click');
        await click(page, '#btn-add-ing-to-recipe'); await click(page, '#btn-save-custom-recipe');
        const recipe = await page.evaluate(async () => (await import('/state.js')).store.get().recipes.find(item => item.name === 'Salmon meal'));
        assert.equal(recipe.ingredients.length, 1); assert.match(recipe.ingredients[0].name.toLowerCase(), /salmon/);
    });
});

test('late initial guest auth callback does not dismiss an active logging sheet', async () => {
    await withPage(async page => {
        await page.locator('#food-search-input').fill('Chicken'); await click(page, '#dropdown-results button:first-child');
        const phases = await page.evaluate(async () => {
            const { createCloudSync } = await import('/cloud-sync.js');
            const phases = [];
            let callback;
            const sync = createCloudSync({ onAuth(fn) { callback = fn; return () => {}; } }, event => {
                phases.push(event.phase);
                if (event.phase === 'loading') globalThis.dispatchEvent(new Event('account-changing'));
            });
            callback(null);
            sync.destroy();
            return phases;
        });
        assert.deepEqual(phases, ['guest']);
        await click(page, '#btn-confirm-log');
        assert.equal(await page.locator('[data-value="total-cal"]').textContent(), '120');
    });
});
