const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const baseURL = process.env.MACROTRACKER_TEST_URL || 'http://127.0.0.1:8000';
const click = (page, selector) => page.locator(selector).dispatchEvent('click');
async function withPage(run) {
    const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    try {
        const page = await browser.newPage({ viewport: { width: 390, height: 740 }, timezoneId: 'America/Los_Angeles' });
        await page.addInitScript(() => window.MACROTRACKER_FIREBASE_CONFIG = {});
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        await page.goto(baseURL); await page.waitForSelector('#quick-weight-form');
        await page.waitForFunction(() => !!document.documentElement.dataset.accountPhase);
        await run(page); assert.deepEqual(errors, []);
    } finally { await browser.close(); }
}
async function completeOnboarding(page) {
    await page.locator('#onboarding-form input[name=displayName]').fill('Jean-Luc'); await click(page, '#onboarding-next');
    await page.locator('#onboarding-form input[name=age]').fill('30'); await page.locator('#onboarding-form input[name=heightCm]').fill('180'); await page.locator('#onboarding-form input[name=currentWeight]').fill('80');
    await click(page, '#onboarding-next'); await click(page, '#onboarding-next');
    await page.locator('#onboarding-form').dispatchEvent('submit');
}
test('onboarding logs its starting weight exactly once and recalculating does not add another', async () => {
    await withPage(async page => {
        await click(page, '#btn-start-onboarding'); await completeOnboarding(page);
        await page.locator('#onboarding-form').dispatchEvent('submit');
        let entries = await page.evaluate(async () => (await import('/state.js')).store.get().weightLog);
        assert.equal(entries.length, 1); assert.equal(entries[0].value, 80); assert.equal(entries[0].unit, 'kg');
        await click(page, '[data-dialog-tab=settings]'); await click(page, '#btn-recalculate-plan'); await completeOnboarding(page);
        entries = await page.evaluate(async () => (await import('/state.js')).store.get().weightLog);
        assert.equal(entries.length, 1);
        await click(page, '#btn-settings-back'); assert.match(await page.locator('#weight-latest').textContent(), /80 kg/);
        assert.equal(await page.locator('#weight-trend svg circle').count(), 1);
    });
});
test('dashboard weight entry, unit conversion, history edit and delete update immediately', async () => {
    await withPage(async page => {
        await page.locator('#quick-weight-form input[name=value]').fill('80'); await page.locator('#quick-weight-form').dispatchEvent('submit');
        await page.locator('#quick-weight-form input[name=value]').fill('79'); await page.locator('#quick-weight-form').dispatchEvent('submit');
        assert.equal(await page.evaluate(async () => (await import('/state.js')).store.get().weightLog.length), 1);
        await click(page, '#btn-account'); await click(page, '[data-dialog-tab=profile]');
        await click(page, '#btn-profile-weight-unit'); await click(page, '.select-menu [data-value=lb]'); await page.locator('#profile-form').dispatchEvent('submit');
        await click(page, '#btn-settings-back'); assert.match(await page.locator('#weight-latest').textContent(), /174\.17 lb/);
        await click(page, '[data-nav=view-weight]'); await click(page, '#weight-history button:first-of-type');
        await page.locator('#quick-weight-form input[name=value]').fill('170'); await page.locator('#quick-weight-form').dispatchEvent('submit');
        const state = await page.evaluate(async () => (await import('/state.js')).store.get());
        assert.equal(state.weightLog[0].unit, 'kg'); assert.ok(Math.abs(state.weightLog[0].value - 170 * .45359237) < 1e-7);
        await click(page, '[data-nav=view-weight]'); await click(page, '#weight-history button:last-of-type');
        assert.equal(await page.evaluate(async () => (await import('/state.js')).store.get().weightLog.length), 0);
        await click(page, '[data-nav=view-home]'); assert.match(await page.locator('#weight-latest').textContent(), /No weight/);
    });
});
test('week/month analytics and calendar agree; editing a historical log changes only its date', async () => {
    await withPage(async page => {
        await page.evaluate(async () => {
            const { store } = await import('/state.js');
            store.update(state => {
                for (const [date, cal] of [['2026-10-05', 100], ['2026-10-06', 300]]) {
                    const entry = { id: 'same-id', foodId: 1, name: 'Historical chicken', amount: 1, unit: 'serving', timestamp: '12:00', cal, p: 20, c: 0, f: 3 };
                    state.logs['2026-10'] ||= {}; state.logs['2026-10'][date] = { date, totals: { cal, p: 20, c: 0, f: 3 }, diary: [entry] };
                }
            });
        });
        await page.locator('#period-date').fill('2026-10-06'); await page.locator('#period-date').dispatchEvent('change'); await click(page, '[data-period=week]');
        assert.match(await page.locator('#period-summary').textContent(), /2 of 7 days with logs/);
        assert.equal(await page.locator('[data-value=total-cal]').textContent(), '200');
        assert.equal(await page.locator('#daily-log-container [data-log-date]').count(), 2);
        await click(page, '[data-log-format=calendar]');
        assert.match(await page.locator('.calendar-day[data-date="2026-10-05"]').textContent(), /100 kcal/);
        await click(page, '.calendar-day[data-date="2026-10-05"]');
        await click(page, '[data-action=edit-diary-entry]'); await page.locator('#modal-qty-input').fill('2'); await click(page, '#btn-confirm-log');
        const logs = await page.evaluate(async () => (await import('/state.js')).store.get().logs['2026-10']);
        assert.equal(logs['2026-10-05'].totals.cal, 240); assert.equal(logs['2026-10-06'].totals.cal, 300);
        await click(page, '[data-period=month]'); assert.equal(await page.locator('[data-value=total-cal]').textContent(), '270');
        await click(page, '[data-action=delete-diary-entry][data-date="2026-10-05"]');
        const after = await page.evaluate(async () => (await import('/state.js')).store.get().logs['2026-10']);
        assert.equal(after['2026-10-05'].diary.length, 0); assert.equal(after['2026-10-06'].diary.length, 1);
    });
});
test('visible backup controls preview, round-trip, deduplicate merge, and reject malformed imports', async () => {
    await withPage(async page => {
        await page.locator('#quick-weight-form input[name=value]').fill('80'); await page.locator('#quick-weight-form').dispatchEvent('submit');
        await click(page, '#btn-account'); await click(page, '[data-dialog-tab=data]');
        const downloadPromise = page.waitForEvent('download'); await click(page, '#btn-export-backup'); const download = await downloadPromise;
        assert.match(download.suggestedFilename(), /^macro-tracker-backup-\d{4}-\d{2}-\d{2}\.json$/);
        const stream = await download.createReadStream(); const chunks = []; for await (const chunk of stream) chunks.push(chunk);
        const text = Buffer.concat(chunks).toString(); const backup = JSON.parse(text);
        assert.equal(backup.backupVersion, 1); assert.equal(backup.state.weightLog.length, 1); assert.ok(backup.state.foodDatabase.length < 6636);
        await page.locator('#backup-import').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(text) });
        await page.waitForFunction(() => !document.querySelector('#backup-preview').hidden);
        await click(page, '#btn-import-merge'); assert.equal(await page.evaluate(async () => (await import('/state.js')).store.get().weightLog.length), 1);
        await page.evaluate(async () => (await import('/state.js')).store.update(state => { state.weightLog = []; }));
        await page.locator('#backup-import').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(text) });
        await page.waitForFunction(() => !document.querySelector('#backup-preview').hidden); await click(page, '#btn-import-replace');
        assert.equal(await page.evaluate(async () => (await import('/state.js')).store.get().weightLog.length), 1);
        const before = await page.evaluate(async () => JSON.stringify((await import('/state.js')).store.get()));
        backup.state.weightLog[0].value = -1;
        await page.locator('#backup-import').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
        await page.waitForFunction(() => document.querySelector('#backup-status').textContent.includes('Import failed'));
        assert.equal(await page.evaluate(async () => JSON.stringify((await import('/state.js')).store.get())), before);
        assert.equal(await page.locator('#backup-preview').evaluate(el => el.hidden), true);
    });
});
test('mobile and desktop glows/fades fit the viewport with accessible menu navigation', async () => {
    await withPage(async page => {
        for (const size of [{ width: 390, height: 740 }, { width: 1440, height: 1080 }]) {
            await page.setViewportSize(size);
            await page.locator('.ring-wrapper').scrollIntoViewIfNeeded();
            const layout = await page.evaluate(() => {
                const fade = document.getElementById('bottom-fade').getBoundingClientRect();
                return { width: document.documentElement.scrollWidth, viewport: innerWidth, fadeBottom: fade.bottom, height: innerHeight, svgOverflow: getComputedStyle(document.querySelector('.macro-rings')).overflow, cardOverflow: getComputedStyle(document.getElementById('macro-dashboard')).overflow, fadeInMain: !!document.querySelector('main #bottom-fade') };
            });
            assert.equal(layout.width, layout.viewport); assert.equal(layout.fadeBottom, layout.height);
            assert.equal(layout.svgOverflow, 'visible'); assert.equal(layout.cardOverflow, 'visible'); assert.equal(layout.fadeInMain, false);
        }
        assert.equal(await page.locator('#drawer-panel').evaluate(el => el.inert), true);
        await page.locator('#btn-menu').click();
        assert.equal(await page.locator('#drawer-panel').evaluate(el => el.inert), false);
        assert.equal(await page.locator('#btn-menu').getAttribute('aria-expanded'), 'true');
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#drawer-panel').evaluate(el => el.inert), true);
        assert.equal(await page.locator('#btn-menu').getAttribute('aria-expanded'), 'false');
        assert.equal(await page.locator('#btn-menu').evaluate(el => document.activeElement === el), true);
    });
});

test('backup merge preserves local conflicts, recomputes diary totals and cancels previews on account change', async () => {
    await withPage(async page => {
        const result = await page.evaluate(async () => {
            const { store, mergeBackup, backupDocument } = await import('/state.js');
            const current = store.get(); current.profile.displayName = 'Keep me';
            const entry = { id: 'a', name: 'Local', timestamp: '12:00', cal: 100, p: 10, c: 5, f: 2 };
            current.logs = { '2026-10': { '2026-10-05': { date: '2026-10-05', totals: { cal: 100, p: 10, c: 5, f: 2 }, diary: [entry] } } };
            const incoming = structuredClone(current); incoming.profile.displayName = 'Imported';
            incoming.logs['2026-10']['2026-10-05'].diary = [{ ...entry, name: 'Incoming conflict', cal: 500 }, { ...entry, id: 'b', name: 'Additional', cal: 200 }];
            const merged = mergeBackup(current, incoming), again = mergeBackup(merged, incoming);
            return { name: merged.profile.displayName, names: merged.logs['2026-10']['2026-10-05'].diary.map(entry => entry.name), calories: merged.logs['2026-10']['2026-10-05'].totals.cal, stable: JSON.stringify(merged) === JSON.stringify(again), backup: JSON.stringify(backupDocument(incoming)) };
        });
        assert.equal(result.name, 'Keep me'); assert.deepEqual(result.names, ['Local', 'Additional']); assert.equal(result.calories, 300); assert.equal(result.stable, true);
        await click(page, '#btn-account'); await click(page, '[data-dialog-tab=data]');
        const before = await page.evaluate(async () => JSON.stringify((await import('/state.js')).store.get()));
        await page.locator('#backup-import').setInputFiles({ name: 'pending.json', mimeType: 'application/json', buffer: Buffer.from(result.backup) });
        await page.waitForFunction(() => !document.querySelector('#backup-preview').hidden);
        await page.evaluate(() => dispatchEvent(new Event('account-changing')));
        assert.equal(await page.locator('#backup-preview').evaluate(el => el.hidden), true);
        await click(page, '#btn-import-merge');
        assert.equal(await page.evaluate(async () => JSON.stringify((await import('/state.js')).store.get())), before);
    });
});

test('every drawer destination responds to real hover/click and closes without pointer trapping', async () => {
    await withPage(async page => {
        for (const [selector, view] of [['#nav-weight-log', '#view-weight'], ['#nav-account-profile', '#view-settings'], ['#nav-settings', '#view-settings'], ['#btn-account', '#view-settings']]) {
            await page.locator('#btn-menu').click();
            await page.locator(selector).hover();
            assert.equal(await page.locator(selector).evaluate(el => getComputedStyle(el).cursor), 'pointer');
            await page.locator(selector).click();
            assert.equal(await page.locator(view).isVisible(), true);
            assert.equal(await page.locator('#drawer-panel').evaluate(el => el.inert), true);
            assert.equal(await page.locator('#btn-menu').getAttribute('aria-expanded'), 'false');
        }
        await page.locator('#btn-settings-back').click();
        await page.locator('#btn-menu').click(); await page.locator('#drawer-backdrop').click({ position: { x: 5, y: 5 } });
        await page.locator('#btn-menu').click(); await page.keyboard.press('Escape');
    });
});
test('calendar, timeline and summary share protein-based compliance and update on goal changes', async () => {
    await withPage(async page => {
        await page.evaluate(async () => {
            const { store } = await import('/state.js');
            store.update(state => {
                state.profile.goal = 'cut'; state.targets = { cal: 2000, p: 150, c: 200, f: 600 / 9 };
                for (const [date, cal, p] of [['2026-10-05', 2100, 150], ['2026-10-06', 2250, 120], ['2026-10-07', 2175, 150], ['2026-10-08', 1800, 150]]) {
                    const totals = { cal, p, c: 100, f: 40 };
                    state.logs['2026-10'] ||= {}; state.logs['2026-10'][date] = { date, totals, diary: [{ id: date, name: 'Test meal', timestamp: '12:00', ...totals }] };
                }
            });
        });
        await page.locator('#period-date').fill('2026-10-06'); await page.locator('#period-date').dispatchEvent('change'); await click(page, '[data-period=week]');
        assert.match(await page.locator('#period-summary').textContent(), /25% of logged days met/);
        for (const [date, tone] of [['05', 'green'], ['06', 'yellow'], ['07', 'red'], ['08', 'blue']]) assert.equal(await page.locator(`[data-log-date="2026-10-${date}"] .timeline-date .status-dot.${tone}`).count(), 1);
        await click(page, '[data-log-format=calendar]'); assert.equal(await page.locator('.calendar-day').count(), 7);
        for (const [date, tone] of [['05', 'green'], ['06', 'yellow'], ['07', 'red'], ['08', 'blue']]) {
            const dot = page.locator(`.calendar-day[data-date="2026-10-${date}"] > .status-dot.${tone}`);
            assert.equal(await dot.count(), 1); const rect = await dot.boundingBox(); assert.equal(rect.width, 8); assert.equal(rect.height, 8);
        }
        await page.evaluate(async () => (await import('/state.js')).store.update(state => { state.profile.goal = 'maintain'; }));
        assert.equal(await page.locator('.calendar-day[data-date="2026-10-07"] > .status-dot.yellow').count(), 1);
        await click(page, '.calendar-day[data-date="2026-10-07"]'); assert.equal(await page.locator('#daily-log-container .timeline-date .status-dot.yellow').count(), 1);
        assert.match(await page.locator('#daily-log-container').textContent(), /2175 \/ 2000 kcal/);
    });
});

test('legacy flat and partial profiles merge defaults while preserving diary documents', async () => {
    await withPage(async page => {
        const result = await page.evaluate(async () => {
            const { documentsState } = await import('/cloud-model.js');
            const totals = { cal: 100, p: 10, c: 5, f: 2 };
            const docs = new Map([['profile/current', { displayName: 'Legacy Primary', currentWeight: '80', calorieGoal: 2100, proteinGoal: 160, goalType: 'cut' }], ['logs/2026-10-05', { date: '2026-10-05', totals, diary: [{ id: 'keep', name: 'Keep diary', timestamp: '12:00', ...totals }] }]]);
            const flat = documentsState(docs);
            docs.set('profile/current', { profile: { displayName: 'Partial profile' }, targets: { cal: 2200 }, settings: { onboardingComplete: true } });
            const partial = documentsState(docs);
            return { name: flat.profile.displayName, goal: flat.profile.goal, calories: flat.targets.cal, preserved: flat.logs['2026-10']['2026-10-05'].diary[0].id, currentWeight: flat.profile.currentWeight, partial: partial.targets, complete: partial.settings.onboardingComplete };
        });
        assert.equal(result.name, 'Legacy Primary'); assert.equal(result.goal, 'lose'); assert.equal(result.calories, 2100); assert.equal(result.preserved, 'keep'); assert.equal(result.currentWeight, 80);
        assert.equal(result.complete, true); assert.equal(result.partial.cal, 2200); assert.ok(Math.abs(result.partial.cal - (4 * result.partial.p + 4 * result.partial.c + 9 * result.partial.f)) < 1e-5);
    });
});
test('saving profile emits profile:updated and updates the greeting immediately', async () => {
    await withPage(async page => {
        await page.evaluate(() => addEventListener('profile:updated', event => window.lastUpdatedName = event.detail.displayName));
        await click(page, '#btn-account'); await click(page, '[data-dialog-tab=profile]');
        await page.locator('#profile-form input[name=displayName]').fill('Instant preferred name'); await page.locator('#profile-form').dispatchEvent('submit');
        assert.equal(await page.evaluate(() => window.lastUpdatedName), 'Instant preferred name');
        assert.ok((await page.locator('#dashboard-greeting').textContent()).endsWith(', Instant preferred name'));
    });
});
test('portable JSON profile/weights/meals backup restores a deleted diary entry', async () => {
    await withPage(async page => {
        const result = await page.evaluate(async () => {
            const { store, backupDocument, parseBackup, applyBackup } = await import('/state.js');
            const totals = { cal: 100, p: 10, c: 5, f: 2 };
            store.update(state => { state.logs['2026-10'] = { '2026-10-05': { date: '2026-10-05', totals, diary: [{ id: 'restore', name: 'Restore meal', timestamp: '12:00', ...totals }] } }; state.weightLog = [{ id: 'w', timestamp: '2026-10-05T12:00:00Z', value: 80, unit: 'kg' }]; });
            const full = backupDocument();
            const portable = { version: full.version, exportedAt: full.exportedAt, profile: full.profile, targets: full.targets, weights: full.weights, meals: full.meals };
            store.update(state => { state.logs = {}; state.weightLog = []; });
            applyBackup(parseBackup(JSON.stringify(portable)));
            return { entry: store.get().logs['2026-10']['2026-10-05'].diary[0].id, weight: store.get().weightLog[0].value };
        });
        assert.deepEqual(result, { entry: 'restore', weight: 80 });
    });
});
test('barcode lookup finds saved UPC/EAN aliases offline without inventing codes for reference foods', async () => {
    await withPage(async page => {
        const result = await page.evaluate(async () => {
            const { searchFoodByBarcode } = await import('/nutrition-engine.js');
            const { allFoods } = await import('/product-catalog.js');
            const food = { id: 'off_123456789012', barcode: '123456789012', name: 'Saved scanned product', serving: 100, unit: 'g', cal: 100, p: 10, c: 5, f: 2 };
            const found = await searchFoodByBarcode('0123456789012', [food]);
            const legacy = await searchFoodByBarcode('123456789012', [{ ...food, barcode: undefined }]);
            return { found: found.id, legacy: legacy.id, datasetHasBarcodes: allFoods().some(item => !!item.barcode) };
        });
        assert.equal(result.found, 'off_123456789012'); assert.equal(result.legacy, result.found); assert.equal(result.datasetHasBarcodes, false);
    });
});
test('auth listener failure leaves a retryable error instead of indefinite loading', async () => {
    await withPage(async page => {
        const phases = await page.evaluate(async () => {
            const { createCloudSync } = await import('/cloud-sync.js'); let fail; const phases = [];
            const sync = createCloudSync({ onAuth(callback, onError) { fail = onError; return () => {}; }, currentUser: () => ({ uid: 'test-user' }) }, event => phases.push(event.phase));
            fail({ code: 'auth/network-request-failed' }); sync.destroy(); return phases;
        });
        assert.deepEqual(phases, ['load-error']);
    });
});

test('native camera detection opens a saved barcode food offline and stops its stream', async () => {
    await withPage(async page => {
        await page.evaluate(async () => {
            const { store } = await import('/state.js');
            store.update(state => { state.foodDatabase.push({ id: 'barcode-native', barcode: '0123456789012', name: 'Native saved food', serving: 100, unit: 'g', cal: 120, p: 10, c: 10, f: 4 }); });
            await import('/native-scanner.js');
            window.BarcodeDetector = class {
                static async getSupportedFormats() { return ['ean_13']; }
                async detect() { return [{ rawValue: '0123456789012' }]; }
            };
            const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
            const stream = canvas.captureStream(); window.stoppedTracks = 0;
            for (const track of stream.getTracks()) { const stop = track.stop.bind(track); track.stop = () => { window.stoppedTracks++; stop(); }; }
            Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => stream } });
            HTMLMediaElement.prototype.play = async () => {};
        });
        await page.context().setOffline(true); await click(page, '#btn-scan-barcode');
        await page.waitForFunction(() => document.querySelector('#modal-food-name').textContent === 'Native saved food');
        assert.equal(await page.evaluate(() => window.stoppedTracks), 1);
        assert.equal(await page.locator('#scanner-modal').isVisible(), false);
    });
});
test('a stalled profile read times out while retaining the authenticated identity', async () => {
    await withPage(async page => {
        await page.clock.install();
        await page.evaluate(async () => {
            const { createCloudSync } = await import('/cloud-sync.js');
            window.hydrationPhases = [];
            window.hydrationSync = createCloudSync({ currentUser: () => ({ uid: 'timeout-user' }), onAuth(callback) { callback({ uid: 'timeout-user' }); return () => {}; }, read: () => { window.hydrationReadRequested = true; return new Promise(() => {}); } }, event => window.hydrationPhases.push({ phase: event.phase, uid: event.user?.uid, code: event.error?.code }));
        });
        await page.waitForFunction(() => window.hydrationReadRequested);
        await page.clock.runFor(15100);
        const phases = await page.evaluate(() => { window.hydrationSync.destroy(); return window.hydrationPhases; });
        assert.equal(phases.at(-1).phase, 'load-error'); assert.equal(phases.at(-1).uid, 'timeout-user'); assert.equal(phases.at(-1).code, 'deadline-exceeded');
    });
});

test('fallback scanner decodes a real EAN-13 fixture and finds the matching saved product', async () => {
    const encoded = require('node:fs').readFileSync('tests/fixtures/ean13-4006381333931.png').toString('base64');
    await withPage(async page => {
        const result = await page.evaluate(async encoded => {
            const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('/dist/scanner.js');
            const { searchFoodByBarcode } = await import('/nutrition-engine.js');
            const holder = document.createElement('div'); holder.id = 'fixture-reader'; document.body.append(holder);
            const scanner = new Html5Qrcode(holder.id, { formatsToSupport: [Html5QrcodeSupportedFormats.EAN_13] });
            try {
                const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
                const code = await scanner.scanFile(new File([bytes], 'ean13.png', { type: 'image/png' }), false);
                const food = await searchFoodByBarcode(code, [{ id: 'fixture-product', barcode: '4006381333931', name: 'Barcode fixture product' }]);
                return { code, id: food.id };
            } finally { scanner.clear(); holder.remove(); }
        }, encoded);
        assert.deepEqual(result, { code: '4006381333931', id: 'fixture-product' });
    });
});
