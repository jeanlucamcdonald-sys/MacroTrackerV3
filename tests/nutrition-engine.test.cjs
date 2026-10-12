const { test } = require('node:test');
const assert = require('node:assert/strict');
test('fixed calories constrain excess protein and rebalance all macros', async () => {
    const { adjustTargets, macroCalories, validTargets } = await import('../nutrition-engine.js');
    const result = adjustTargets({ cal: 2000, p: 150, c: 200, f: 600 / 9 }, 'p', 1000);
    assert.equal(result.adjusted, true); assert.equal(result.targets.p, 500);
    assert.equal(result.targets.c, 0); assert.equal(result.targets.f, 0);
    assert.equal(macroCalories(result.targets), 2000); assert.equal(validTargets(result.targets), true);
});
test('calories and macro changes stay balanced across zero, unlocked and large inputs', async () => {
    const { adjustTargets, macroCalories, validTargets } = await import('../nutrition-engine.js');
    let state = { cal: 2000, p: 150, c: 200, f: 600 / 9 };
    let seed = 42;
    for (let index = 0; index < 4000; index++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const field = ['cal', 'p', 'c', 'f'][index % 4];
        state = adjustTargets(state, field, seed % (field === 'cal' ? 5000 : 1500)).targets;
        assert.equal(validTargets(state), true);
        assert.ok(Math.abs(state.cal - macroCalories(state)) < 1e-5);
    }
    const unlocked = adjustTargets({ cal: 2000, p: 150, c: 200, f: 600 / 9 }, 'p', 1000, { fixedCalories: false });
    assert.equal(unlocked.targets.cal, 5400);
    assert.deepEqual(adjustTargets(state, 'cal', 0).targets, { cal: 0, p: 0, c: 0, f: 0 });
    assert.throws(() => adjustTargets(state, 'p', NaN)); assert.throws(() => adjustTargets(state, 'cal', -1));
});
test('onboarding expenditure and protein estimates reflect activity, goal and weight units', async () => {
    const { estimateNutrition, validTargets } = await import('../nutrition-engine.js');
    const profile = { age: 30, heightCm: 180, currentWeight: 80, weightUnit: 'kg', sex: 'male', activity: 'moderate', goal: 'maintain' };
    const baseline = estimateNutrition(profile);
    assert.equal(baseline.bmr, 1780); assert.equal(baseline.expenditure, 2759);
    assert.equal(baseline.targets.p, 144); assert.equal(validTargets(baseline.targets), true);
    assert.ok(estimateNutrition({ ...profile, goal: 'lose' }).targets.cal < baseline.targets.cal);
    assert.ok(estimateNutrition({ ...profile, activity: 'active' }).targets.cal > baseline.targets.cal);
    assert.equal(estimateNutrition({ ...profile, currentWeight: 80 / 0.45359237, weightUnit: 'lb' }).expenditure, baseline.expenditure);
    assert.throws(() => estimateNutrition({ ...profile, age: 12 }));
});
