import { localDateString } from './local-date.js';
import { evaluateDayCompliance, COMPLIANCE } from './compliance.js';
export const MACROS = ['cal', 'p', 'c', 'f'];
export const emptyMacros = () => ({ cal: 0, p: 0, c: 0, f: 0 });
export function parseDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new TypeError('Use a valid local calendar date');
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(year, month - 1, day, 12);
    if (localDateString(date) !== value) throw new TypeError('Use a valid local calendar date');
    return date;
}
export function addDays(value, count) {
    const date = parseDate(value); date.setDate(date.getDate() + count); return localDateString(date);
}
export function periodDates(anchor, period = 'day') {
    const date = parseDate(anchor);
    let start = anchor, end = anchor;
    if (period === 'week') { start = addDays(anchor, -((date.getDay() + 6) % 7)); end = addDays(start, 6); }
    else if (period === 'month') { start = localDateString(new Date(date.getFullYear(), date.getMonth(), 1)); end = localDateString(new Date(date.getFullYear(), date.getMonth() + 1, 0)); }
    else if (period !== 'day') throw new RangeError('Unknown period');
    const dates = [];
    for (let day = start; day <= end; day = addDays(day, 1)) dates.push(day);
    return dates;
}
export function movePeriod(anchor, period, direction) {
    if (period !== 'month') return addDays(anchor, direction * (period === 'week' ? 7 : 1));
    const date = parseDate(anchor);
    const month = new Date(date.getFullYear(), date.getMonth() + direction, 1, 12);
    const last = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    month.setDate(Math.min(date.getDate(), last)); return localDateString(month);
}
export function summarizePeriod(state, anchor, period) {
    const days = periodDates(anchor, period).map(date => {
        const log = state.logs[date.slice(0, 7)]?.[date];
        const logged = !!log?.diary?.length;
        const totals = log?.totals || emptyMacros();
        const adherence = logged ? evaluateDayCompliance(totals, state.targets, state.profile?.goal || 'maintain') : { ...COMPLIANCE.missing };
        return { date, log, logged, totals, adherence, onTarget: adherence.status === 'met' };
    });
    const logged = days.filter(day => day.logged);
    const totals = emptyMacros();
    logged.forEach(day => MACROS.forEach(key => totals[key] += day.totals[key]));
    const averages = Object.fromEntries(MACROS.map(key => [key, logged.length ? totals[key] / logged.length : 0]));
    return { days, totals, averages, loggedDays: logged.length, compliance: logged.length ? logged.filter(day => day.onTarget).length / logged.length * 100 : null, balance: totals.cal - state.targets.cal * logged.length };
}
export function weightIn(entry, unit) {
    return entry.value * (entry.unit === unit ? 1 : unit === 'kg' ? .45359237 : 1 / .45359237);
}
export function weightSummary(entries, unit, anchor, period = 'month') {
    const sorted = entries.filter(entry => localDateString(new Date(entry.timestamp)) <= anchor).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const latest = sorted.at(-1);
    const baseline = sorted.filter(entry => localDateString(new Date(entry.timestamp)) <= addDays(anchor, -7)).at(-1);
    const start = periodDates(anchor, period)[0];
    const periodBaseline = sorted.filter(entry => localDateString(new Date(entry.timestamp)) <= start).at(-1);
    const points = sorted.filter(entry => localDateString(new Date(entry.timestamp)) >= addDays(anchor, -29));
    const delta = entry => latest && entry ? weightIn(latest, unit) - weightIn(entry, unit) : null;
    return { latest, value: latest ? weightIn(latest, unit) : null, weeklyChange: delta(baseline), startingChange: delta(sorted[0]), periodChange: delta(periodBaseline), points };
}
/** Trailing seven-calendar-day mean of available readings, including today's point. */
export function movingAverageWeights(entries, unit) {
    const sorted = [...entries].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return sorted.map(entry => {
        const date = localDateString(new Date(entry.timestamp));
        const start = addDays(date, -6);
        const window = sorted.filter(row => row.timestamp <= entry.timestamp && localDateString(new Date(row.timestamp)) >= start);
        return { timestamp: entry.timestamp, value: window.reduce((sum, row) => sum + weightIn(row, unit), 0) / window.length, unit };
    });
}
export function setLatestWeight(state) {
    const latest = [...state.weightLog].sort((a, b) => a.timestamp.localeCompare(b.timestamp)).at(-1);
    state.profile.currentWeight = latest ? weightIn(latest, state.profile.weightUnit || 'kg') : null;
}

export function rollingWeightMetrics(entries, unit, anchor) {
    const eligible = entries.filter(entry => localDateString(new Date(entry.timestamp)) <= anchor).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    if (!eligible.length) return { average: null, weeklyDelta: null, fallback: false };
    const recent = eligible.filter(entry => localDateString(new Date(entry.timestamp)) >= addDays(anchor, -6));
    const previous = eligible.filter(entry => {
        const date = localDateString(new Date(entry.timestamp));
        return date >= addDays(anchor, -13) && date <= addDays(anchor, -7);
    });
    const mean = rows => rows.reduce((sum, entry) => sum + weightIn(entry, unit), 0) / rows.length;
    return { average: recent.length ? mean(recent) : weightIn(eligible.at(-1), unit), weeklyDelta: recent.length && previous.length ? mean(recent) - mean(previous) : null, fallback: !recent.length };
}
