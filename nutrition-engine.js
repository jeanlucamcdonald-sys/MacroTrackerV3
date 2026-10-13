/** Target energy uses the conventional 4 kcal/g protein & carbs, 9 kcal/g fat. */
export const ENERGY = Object.freeze({ p: 4, c: 4, f: 9 });
const keys = ['p', 'c', 'f'];
const clean = value => {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0 || number > 100000) throw new RangeError('Enter a non-negative number up to 100,000.');
    return number;
};
export const macroCalories = targets => keys.reduce((sum, key) => sum + targets[key] * ENERGY[key], 0);
export function validTargets(targets) {
    return targets && ['cal', ...keys].every(key => Number.isFinite(targets[key]) && targets[key] >= 0 && targets[key] <= 100000)
        && Math.abs(macroCalories(targets) - targets.cal) < 0.00001;
}
/** Change one field. Fixed calories cap the edited macro; others share remaining energy. */
export function adjustTargets(previous, field, value, { fixedCalories = true } = {}) {
    if (!['cal', ...keys].includes(field)) throw new TypeError('Unknown target field');
    const targets = Object.fromEntries(['cal', ...keys].map(key => [key, clean(previous[key] ?? 0)]));
    const requested = clean(value);
    let adjusted = false;
    if (field === 'cal') {
        targets.cal = requested;
        const oldEnergy = macroCalories(targets);
        const fractions = oldEnergy > 0 ? keys.map(key => targets[key] * ENERGY[key] / oldEnergy) : [0.3, 0.45, 0.25];
        keys.forEach((key, i) => { targets[key] = requested * fractions[i] / ENERGY[key]; });
    } else if (!fixedCalories) {
        targets[field] = requested;
        targets.cal = macroCalories(targets);
        if (targets.cal > 100000) throw new RangeError('The resulting calorie target exceeds 100,000 kcal.');
    } else {
        targets[field] = Math.min(requested, targets.cal / ENERGY[field]);
        adjusted = targets[field] !== requested;
        const remaining = Math.max(0, targets.cal - targets[field] * ENERGY[field]);
        const others = keys.filter(key => key !== field);
        const previousEnergy = others.reduce((sum, key) => sum + targets[key] * ENERGY[key], 0);
        others.forEach(key => { targets[key] = remaining * (previousEnergy ? targets[key] * ENERGY[key] / previousEnergy : 1 / others.length) / ENERGY[key]; });
    }
    // Remove accumulated floating-point drift without rounding grams into an impossible total.
    const remainderKey = field === 'c' && fixedCalories ? 'p' : 'c';
    targets[remainderKey] = Math.max(0, targets[remainderKey] + (targets.cal - macroCalories(targets)) / ENERGY[remainderKey]);
    if (!validTargets(targets)) throw new RangeError('Unable to balance these targets');
    return { targets, adjusted, message: adjusted ? `${field === 'p' ? 'Protein' : field === 'c' ? 'Carbohydrates' : 'Fat'} was limited to fit your calorie target. Other macros were rebalanced.` : 'Targets balanced using 4/4/9 kcal per gram.' };
}
export function normalizeTargets(targets) {
    return adjustTargets(targets, 'cal', targets.cal).targets;
}
export const ACTIVITY = Object.freeze({ sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, veryActive: 1.9 });
export function estimateNutrition({ age, heightCm, currentWeight, weightUnit = 'kg', sex, activity, goal }) {
    age = clean(age); heightCm = clean(heightCm); currentWeight = clean(currentWeight);
    if (age < 18 || age > 100 || heightCm < 100 || heightCm > 250 || currentWeight <= 0 || !['kg', 'lb'].includes(weightUnit)) throw new RangeError('Enter an adult age (18–100), height (100–250 cm), and positive weight.');
    const weightKg = currentWeight * (weightUnit === 'lb' ? 0.45359237 : 1);
    if (weightKg < 25 || weightKg > 400 || !Object.hasOwn(ACTIVITY, activity) || !['lose', 'maintain', 'gain'].includes(goal) || !['female', 'male', 'unspecified'].includes(sex)) throw new RangeError('Check your weight, activity, and goal.');
    const constant = sex === 'male' ? 5 : sex === 'female' ? -161 : -78;
    const bmr = 10 * weightKg + 6.25 * heightCm - 5 * age + constant;
    const expenditure = Math.round(bmr * ACTIVITY[activity]);
    const adjustment = goal === 'lose' ? -Math.min(500, expenditure * 0.15) : goal === 'gain' ? Math.min(300, expenditure * 0.1) : 0;
    const cal = Math.round(Math.max(sex === 'male' ? 1500 : 1200, expenditure + adjustment));
    const proteinPerKg = goal === 'lose' ? 2 : 1.8;
    const p = Math.min(Math.round(weightKg * proteinPerKg), cal * 0.4 / 4);
    const f = cal * 0.25 / 9;
    const c = (cal - p * 4 - f * 9) / 4;
    return { expenditure, bmr: Math.round(bmr), proteinPerKg, targets: { cal, p, c, f }, method: 'Mifflin–St Jeor' };
}

/** Barcode ingestion is separate from target math and loads the catalog only on demand. */
export async function searchFoodByBarcode(code, savedFoods = []) {
    const { findFoodByBarcode, loadCatalog } = await import('./product-catalog.js');
    const savedMatch = findFoodByBarcode(code, savedFoods);
    if (savedMatch) return savedMatch;
    try { await loadCatalog(); } catch { /* Saved/offline products can still be searched. */ }
    return findFoodByBarcode(code, savedFoods) || null;
}
