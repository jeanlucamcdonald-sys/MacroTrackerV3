/** Goal-based daily adherence. Rule order follows the supplied implementation helper. */
export const COMPLIANCE = {
    met: { status: 'met', tone: 'green', color: '#10b981', label: 'Goal met' },
    warning: { status: 'warning', tone: 'yellow', color: '#f59e0b', label: 'Calorie/protein discrepancy' },
    exceeded: { status: 'exceeded', tone: 'red', color: '#ef4444', label: 'Target exceeded or critical miss' },
    under: { status: 'under', tone: 'blue', color: '#3b82f6', label: 'Under calorie target' },
    missing: { status: 'missing', tone: 'neutral', color: '#64748b', label: 'No entries' }
};
export function complianceGoal(goal = 'maintain') {
    return ['cut', 'lose'].includes(goal) ? 'cut' : ['bulk', 'gain'].includes(goal) ? 'bulk' : 'maintain';
}
export function evaluateDayCompliance(consumed, target, goal = 'cut') {
    const calories = consumed?.calories ?? consumed?.cal;
    const protein = consumed?.protein ?? consumed?.p;
    const targetCalories = target?.calories ?? target?.cal;
    const targetProtein = target?.protein ?? target?.p;
    if (![calories, protein, targetCalories, targetProtein].every(value => Number.isFinite(value) && value >= 0)) throw new TypeError('Compliance requires nonnegative finite calories and protein.');
    const calDelta = calories - targetCalories;
    const protDeficit = targetProtein - protein;
    const absCalDelta = Math.abs(calDelta);
    let status;
    if (absCalDelta <= 150 && protDeficit <= 10) status = 'met';
    else if (calDelta > 150 && protDeficit > 10) status = 'warning';
    else if (calDelta > (complianceGoal(goal) === 'cut' ? 150 : 200) || (absCalDelta > 150 && protDeficit > 20)) status = 'exceeded';
    else if (calDelta < -150) status = 'under';
    else status = 'warning';
    return { ...COMPLIANCE[status], calDelta, protDeficit };
}
export function statusDotMarkup(compliance = COMPLIANCE.missing) {
    // All attributes come from the fixed enum, never user-entered strings.
    return `<span class="status-dot ${compliance.tone}" role="img" aria-label="${compliance.label}" title="${compliance.label}"></span>`;
}
export function createStatusDot(compliance = COMPLIANCE.missing) {
    const dot = document.createElement('span');
    dot.className = `status-dot ${compliance.tone}`;
    dot.setAttribute('role', 'img'); dot.setAttribute('aria-label', compliance.label); dot.title = compliance.label;
    return dot;
}
