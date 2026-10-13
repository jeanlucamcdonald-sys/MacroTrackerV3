import { store } from './state.js';
import { localDateString } from './local-date.js';
import { parseDate, weightIn, weightSummary, setLatestWeight, movingAverageWeights } from './history-model.js';
const fmt = value => Number(value.toFixed(2)).toLocaleString();
const delta = value => value === null ? 'Need an earlier reading' : `${value > 0 ? '+' : ''}${fmt(value)}`;
export function initializeWeights(bindClick, signal, selection = () => ({ anchor: localDateString(), period: 'day' })) {
    const root = document.getElementById('weight-dashboard');
    root.innerHTML = `<h3 class="text-xl font-semibold">Weight & momentum</h3><p id="weight-latest" class="weight-value"></p><div class="weight-metrics"><p><span id="weight-weekly"></span><small>Change over 7 days</small></p><p><span id="weight-starting"></span><small>Since first reading</small></p><p><span id="weight-period"></span><small>Selected-period change</small></p></div><div id="weight-trend"></div><form id="quick-weight-form" class="quick-weight-form"><input name="id" type="hidden"><label>Date<input name="date" type="date" required></label><label>Weight <span data-weight-unit></span><input name="value" type="number" min="0.1" max="1999" step="any" required></label><button type="submit" class="primary-button">Log weight</button><button id="btn-weight-cancel" type="button" class="select-trigger" hidden>Cancel edit</button></form><p class="muted">Logging again replaces that day’s reading. Trend shows the last 30 days through the selected date.</p><p id="weight-feedback" role="status"></p><button id="btn-weight-history" type="button" class="select-trigger mt-3">View & edit weight history</button>`;
    bindClick(document.getElementById('btn-weight-history'), () => globalThis.dispatchEvent(new CustomEvent('navigate-weight')));
    const quick = document.getElementById('quick-weight-form');
    const forms = [quick, document.getElementById('weight-form')];
    const feedback = document.getElementById('weight-feedback');
    const history = document.getElementById('weight-history');
    let key = '';
    function reset() { quick.elements.id.value = ''; quick.elements.value.value = ''; quick.elements.date.value = localDateString(); document.getElementById('btn-weight-cancel').hidden = true; }
    bindClick(document.getElementById('btn-weight-cancel'), reset);
    for (const form of forms) {
        form.elements.date.value = localDateString(); form.elements.date.max = localDateString();
        form.addEventListener('submit', event => {
            event.preventDefault();
            try {
                const date = form.elements.date.value; parseDate(date);
                if (date > localDateString()) throw new Error('Choose today or an earlier date.');
                const value = Number(form.elements.value.value);
                if (!(value > 0 && value < 2000)) throw new Error('Enter a positive weight below 2,000.');
                const id = form.elements.id?.value;
                store.update(state => {
                    const unit = state.profile.weightUnit || 'kg';
                    const existing = id ? state.weightLog.find(entry => entry.id === id) : state.weightLog.find(entry => localDateString(new Date(entry.timestamp)) === date);
                    if (id && !existing) throw new Error('This reading was removed. Cancel and try again.');
                    if (id && state.weightLog.some(entry => entry.id !== id && localDateString(new Date(entry.timestamp)) === date)) throw new Error('Another reading exists on that date. Edit that reading instead.');
                    const timestamp = new Date(`${date}T12:00:00`).toISOString();
                    if (existing) { existing.value = weightIn({ value, unit }, existing.unit); existing.timestamp = timestamp; }
                    else state.weightLog.push({ id: crypto.randomUUID(), timestamp, value, unit });
                    setLatestWeight(state);
                });
                form.elements.value.value = ''; reset(); feedback.textContent = 'Weight saved.';
            } catch (error) { feedback.textContent = error.message; }
        }, { signal });
    }
    function render() {
        const state = store.get(), { anchor, period } = selection();
        const nextKey = JSON.stringify([state.weightLog, state.profile.weightUnit, anchor, period]);
        if (nextKey === key) return; key = nextKey;
        const unit = state.profile.weightUnit || 'kg';
        const summary = weightSummary(state.weightLog, unit, anchor, period);
        root.querySelector('[data-weight-unit]').textContent = `(${unit})`;
        document.getElementById('weight-latest').textContent = summary.latest ? `${fmt(summary.value)} ${unit} · ${localDateString(new Date(summary.latest.timestamp))}` : 'No weight recorded yet';
        for (const [id, value] of [['weight-weekly', summary.weeklyChange], ['weight-starting', summary.startingChange], ['weight-period', summary.periodChange]]) document.getElementById(id).textContent = `${delta(value)}${value === null ? '' : ` ${unit}`}`;
        const chart = document.getElementById('weight-trend'); chart.replaceChildren();
        if (summary.points.length) {
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('viewBox', '0 0 320 100'); svg.setAttribute('role', 'img');
            svg.setAttribute('aria-label', `30-day weight trend in ${unit}, ${summary.points.length} readings`);
            const averages = movingAverageWeights(state.weightLog, unit).filter(entry => summary.points.some(point => point.timestamp === entry.timestamp));
            const values = summary.points.map(entry => weightIn(entry, unit));
            const min = Math.min(...values, ...averages.map(entry => entry.value)), range = Math.max(...values, ...averages.map(entry => entry.value)) - min || 1;
            const time = entry => Date.parse(localDateString(new Date(entry.timestamp)) + 'T12:00:00Z');
            const first = time(summary.points[0]), duration = time(summary.points.at(-1)) - first || 1;
            const coords = summary.points.map((entry, i) => [10 + (time(entry) - first) / duration * 300, 85 - (values[i] - min) / range * 65]);
            const path = document.createElementNS(svg.namespaceURI, 'polyline');
            path.setAttribute('points', coords.map(point => point.join(',')).join(' ')); path.setAttribute('fill', 'none'); path.setAttribute('stroke', '#60a5fa'); path.setAttribute('stroke-width', '3'); svg.append(path);
            coords.forEach(([x, y], i) => {
                const circle = document.createElementNS(svg.namespaceURI, 'circle'); circle.setAttribute('cx', x); circle.setAttribute('cy', y); circle.setAttribute('r', '4'); circle.setAttribute('fill', '#60a5fa');
                const title = document.createElementNS(svg.namespaceURI, 'title'); title.textContent = `${localDateString(new Date(summary.points[i].timestamp))}: ${fmt(values[i])} ${unit}`; circle.append(title); svg.append(circle);
            });
            const average = document.createElementNS(svg.namespaceURI, 'polyline');
            average.dataset.trend = 'moving-average'; average.setAttribute('points', averages.map(entry => `${10 + (time(entry) - first) / duration * 300},${85 - (entry.value - min) / range * 65}`).join(' '));
            average.setAttribute('fill', 'none'); average.setAttribute('stroke', '#a5b4fc'); average.setAttribute('stroke-width', '2'); average.setAttribute('stroke-dasharray', '4 3'); svg.append(average);
            chart.append(svg);
            const legend = document.createElement('p'); legend.className = 'muted'; legend.textContent = 'Blue: recorded weight · Dashed: 7-day average of available readings'; chart.append(legend);
        } else { chart.textContent = 'Log a weight to start your trend.'; }
        history.replaceChildren();
        if (!state.weightLog.length) { const li = document.createElement('li'); li.textContent = 'No weight history yet. Start in onboarding or log your first reading.'; history.append(li); }
        for (const entry of [...state.weightLog].sort((a, b) => b.timestamp.localeCompare(a.timestamp))) {
            const li = document.createElement('li'); li.className = 'weight-history-row';
            const text = document.createElement('span'); text.textContent = `${localDateString(new Date(entry.timestamp))} · ${fmt(weightIn(entry, unit))} ${unit}`;
            const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'select-trigger'; edit.textContent = 'Edit'; edit.setAttribute('aria-label', `Edit weight for ${localDateString(new Date(entry.timestamp))}`);
            bindClick(edit, () => {
                quick.elements.id.value = entry.id; quick.elements.date.value = localDateString(new Date(entry.timestamp)); quick.elements.value.value = Number(weightIn(entry, store.get().profile.weightUnit || 'kg').toFixed(4));
                document.getElementById('btn-weight-cancel').hidden = false;
                globalThis.dispatchEvent(new CustomEvent('navigate-home'));
                quick.scrollIntoView({ block: 'center' }); quick.elements.value.focus();
            });
            const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'select-trigger'; remove.textContent = 'Delete'; remove.setAttribute('aria-label', `Delete weight for ${localDateString(new Date(entry.timestamp))}`);
            bindClick(remove, () => { store.update(draft => { draft.weightLog = draft.weightLog.filter(row => row.id !== entry.id); setLatestWeight(draft); }); if (quick.elements.id.value === entry.id) reset(); });
            li.append(text, edit, remove); history.append(li);
        }
    }
    const unsubscribe = store.subscribe(render); render();
    globalThis.addEventListener('account-changing', () => { reset(); forms.forEach(form => form.elements.value.value = ''); feedback.textContent = ''; }, { signal });
    signal.addEventListener('abort', unsubscribe, { once: true });
    return { render, rollover() { forms.forEach(form => { form.elements.date.max = localDateString(); }); if (!quick.elements.id.value) quick.elements.date.value = localDateString(); render(); } };
}
