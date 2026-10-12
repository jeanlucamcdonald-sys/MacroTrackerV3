/** Nutrition is always defined per baseServing/baseUnit; never assume food density. */
export const UNITS = Object.freeze([
    { value: 'g', label: 'Grams (g)', dimension: 'mass', factor: 1 },
    { value: 'kg', label: 'Kilograms (kg)', dimension: 'mass', factor: 1000 },
    { value: 'oz', label: 'Ounces (oz)', dimension: 'mass', factor: 28.349523125 },
    { value: 'lb', label: 'Pounds (lb)', dimension: 'mass', factor: 453.59237 },
    { value: 'ml', label: 'Milliliters (ml)', dimension: 'volume', factor: 1 },
    { value: 'l', label: 'Liters (l)', dimension: 'volume', factor: 1000 },
    { value: 'fl oz', label: 'US fluid ounces (fl oz)', dimension: 'volume', factor: 29.5735295625 },
    { value: 'cup', label: 'US cups', dimension: 'volume', factor: 236.5882365 },
    { value: 'tbsp', label: 'US tablespoons', dimension: 'volume', factor: 14.78676478125 },
    { value: 'tsp', label: 'US teaspoons', dimension: 'volume', factor: 4.92892159375 },
    ...['serving', 'piece', 'slice', 'scoop'].map(value => ({ value, label: value[0].toUpperCase() + value.slice(1), dimension: 'count', factor: 1 }))
]);
export function baseOf(food) {
    return { amount: food.baseServing ?? food.serving ?? 100, unit: food.baseUnit ?? food.unit ?? 'g' };
}
export function servingFactor(food, amount, unit) {
    const base = baseOf(food);
    if (!(base.amount > 0) || !Number.isFinite(amount) || amount < 0) throw new RangeError('Invalid serving amount');
    if (unit === 'portion') return amount;
    if (unit === base.unit) return amount / base.amount;
    const from = UNITS.find(item => item.value === unit);
    const to = UNITS.find(item => item.value === base.unit);
    if (!from || !to || from.dimension !== to.dimension || from.dimension === 'count') throw new RangeError('These units require a food-specific conversion');
    return amount * from.factor / (base.amount * to.factor);
}
export function unitOptions(food) {
    const base = baseOf(food);
    const definition = UNITS.find(unit => unit.value === base.unit);
    const compatible = UNITS.filter(unit => unit.value === base.unit || (definition && definition.dimension !== 'count' && unit.dimension === definition.dimension));
    if (!compatible.some(unit => unit.value === base.unit)) compatible.push({ value: base.unit, label: base.unit });
    return [{ value: 'portion', label: `Serving (${base.amount} ${base.unit})` }, ...compatible];
}
export function convertAmount(food, amount, from, to) {
    return servingFactor(food, amount, from) / servingFactor(food, 1, to);
}
export function ingredientFactor(item) {
    // Older backups used "serving" for one base portion in mass/volume recipes.
    const unit = item.activeUnit ?? item.unit ?? item.baseUnit ?? 'g';
    const legacyUnit = unit === 'serving' && baseOf(item).unit !== 'serving' ? 'portion' : unit;
    return servingFactor(item, item.amount || 0, legacyUnit);
}
