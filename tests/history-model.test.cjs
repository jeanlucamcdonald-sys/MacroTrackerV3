const { test } = require('node:test');
const assert = require('node:assert/strict');
test('calendar periods cross years, leap days and DST without UTC date drift', async () => {
    const { periodDates, movePeriod, parseDate } = await import('../history-model.js');
    assert.deepEqual(periodDates('2026-01-01', 'week'), ['2025-12-29', '2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04']);
    assert.equal(periodDates('2024-02-15', 'month').length, 29);
    assert.equal(movePeriod('2026-01-31', 'month', 1), '2026-02-28');
    assert.equal(movePeriod('2026-12-31', 'month', 1), '2027-01-31');
    assert.throws(() => parseDate('2026-02-30'));
    const previous = process.env.TZ; process.env.TZ = 'America/Los_Angeles';
    try { assert.deepEqual(periodDates('2026-03-08', 'week'), ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06', '2026-03-07', '2026-03-08']); }
    finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});
test('averages and goal compliance exclude missing days and compare against current targets', async () => {
    const { summarizePeriod } = await import('../history-model.js');
    const state = { targets: { cal: 2000, p: 150, c: 200, f: 65 }, logs: { '2026-10': {
        '2026-10-12': { totals: { cal: 1800, p: 100, c: 200, f: 40 }, diary: [{}] },
        '2026-10-13': { totals: { cal: 2200, p: 200, c: 300, f: 50 }, diary: [{}] },
        '2026-10-14': { totals: { cal: 0, p: 0, c: 0, f: 0 }, diary: [] }
    } } };
    const result = summarizePeriod(state, '2026-10-14', 'week');
    assert.equal(result.loggedDays, 2); assert.equal(result.totals.cal, 4000); assert.equal(result.averages.cal, 2000);
    assert.equal(result.averages.p, 150); assert.equal(result.compliance, 0); assert.equal(result.balance, 0);
    assert.equal(result.days.filter(day => !day.logged).length, 5);
    state.targets.cal = 0;
    assert.equal(summarizePeriod(state, '2026-10-14', 'week').compliance, 0);
});
test('weight trends normalize mixed units without mutating original entries', async () => {
    const { weightIn, weightSummary, setLatestWeight } = await import('../history-model.js');
    const entries = [{ id: 'a', timestamp: '2026-10-01T12:00:00Z', value: 80, unit: 'kg' }, { id: 'b', timestamp: '2026-10-08T12:00:00Z', value: 79 / .45359237, unit: 'lb' }];
    const before = structuredClone(entries);
    const summary = weightSummary(entries, 'kg', '2026-10-08', 'month');
    assert.ok(Math.abs(summary.value - 79) < 1e-8); assert.ok(Math.abs(summary.weeklyChange + 1) < 1e-8);
    assert.ok(Math.abs(weightIn(entries[0], 'lb') - 176.369809748) < 1e-6);
    assert.deepEqual(entries, before);
    const state = { profile: { weightUnit: 'lb' }, weightLog: entries }; setLatestWeight(state);
    assert.equal(state.profile.currentWeight, entries[1].value);
    assert.equal(weightSummary([], 'kg', '2026-10-08').weeklyChange, null);
});
test('greeting boundaries, preferred names, and stable goal-aware prompt selection', async () => {
    const { dashboardContext, PROMPTS } = await import('../dashboard-context.js');
    assert.ok(new Set(Object.values(PROMPTS).flat()).size >= 40);
    const user = { uid: 'test-user', displayName: 'Google Person', email: 'fallback@example.test' };
    for (const [hour, salutation] of [[3, 'evening'], [4, 'morning'], [11, 'morning'], [12, 'afternoon'], [16, 'afternoon'], [17, 'evening'], [18, 'evening'], [23, 'evening']]) {
        const result = dashboardContext({ displayName: 'Preferred Name' }, user, new Date(2026, 9, 12, hour, 15));
        assert.equal(result.greeting, `Good ${salutation}, Preferred Name`);
    }
    const seen = new Set();
    for (const goal of ['lose', 'gain', 'maintain', 'cut', 'bulk']) for (let hour = 0; hour < 24; hour++) {
        const date = new Date(2026, 9, 12, hour, 15);
        const a = dashboardContext({ goal }, user, date), b = dashboardContext({ goal }, user, date);
        assert.deepEqual(a, b); seen.add(a.prompt);
        const allowed = [...PROMPTS[a.phase], ...PROMPTS[a.goal], ...PROMPTS.playful];
        assert.ok(allowed.includes(a.prompt));
        if (['gain', 'bulk', 'maintain'].includes(goal)) assert.ok(!PROMPTS.lose.includes(a.prompt));
    }
    assert.ok(seen.size >= 20);
    assert.equal(dashboardContext({ name: 'Legacy Name' }, user).greeting.endsWith(', Legacy Name'), true);
    assert.equal(dashboardContext({}, { email: 'fallback@example.test' }).greeting.endsWith(', there'), true);
});

test('compliance respects ordered protein rules, strict boundaries and goal aliases', async () => {
    const { evaluateDayCompliance } = await import('../compliance.js');
    const target = { cal: 2000, p: 150 };
    const cases = [
        [2150, 140, 'cut', 'met'], [1850, 140, 'cut', 'met'], [2000, 200, 'cut', 'met'],
        [2151, 139, 'cut', 'warning'], [2250, 120, 'bulk', 'warning'],
        [2151, 150, 'cut', 'exceeded'], [2151, 150, 'lose', 'exceeded'],
        [2200, 150, 'maintain', 'warning'], [2201, 150, 'maintain', 'exceeded'], [2201, 150, 'gain', 'exceeded'],
        [1849, 129, 'bulk', 'exceeded'], [1849, 130, 'bulk', 'under'], [1849, 150, 'cut', 'under'],
        [2000, 139, 'maintain', 'warning']
    ];
    for (const [cal, p, goal, status] of cases) assert.equal(evaluateDayCompliance({ cal, p }, target, goal).status, status, JSON.stringify({ cal, p, goal }));
    assert.equal(evaluateDayCompliance({ calories: 2000, protein: 150 }, { calories: 2000, protein: 150 }).status, 'met');
    assert.throws(() => evaluateDayCompliance({ cal: NaN, p: 150 }, target));
});
test('weight moving average uses available readings within seven calendar days without filling gaps', async () => {
    const { movingAverageWeights } = await import('../history-model.js');
    const entries = [{ timestamp: '2026-10-01T12:00:00Z', value: 80, unit: 'kg' }, { timestamp: '2026-10-02T12:00:00Z', value: 82 / .45359237, unit: 'lb' }, { timestamp: '2026-10-10T12:00:00Z', value: 79, unit: 'kg' }];
    const before = structuredClone(entries), averages = movingAverageWeights(entries, 'kg');
    assert.equal(averages.length, 3); assert.ok(Math.abs(averages[1].value - 81) < 1e-8); assert.equal(averages[2].value, 79); assert.deepEqual(entries, before);
});

test('rolling average and week-over-week change normalize units and distinguish old-reading fallback', async () => {
    const { rollingWeightMetrics } = await import('../history-model.js');
    const entries = [{ timestamp: '2026-10-01T12:00:00Z', value: 80, unit: 'kg' }, { timestamp: '2026-10-08T12:00:00Z', value: 79 / .45359237, unit: 'lb' }, { timestamp: '2026-10-10T12:00:00Z', value: 77, unit: 'kg' }];
    const result = rollingWeightMetrics(entries, 'kg', '2026-10-10');
    assert.ok(Math.abs(result.average - 78) < 1e-8); assert.ok(Math.abs(result.weeklyDelta + 2) < 1e-8); assert.equal(result.fallback, false);
    assert.equal(rollingWeightMetrics(entries, 'kg', '2026-10-25').average, 77);
    assert.equal(rollingWeightMetrics(entries, 'kg', '2026-10-25').fallback, true);
    assert.equal(rollingWeightMetrics([], 'kg', '2026-10-10').average, null);
});
