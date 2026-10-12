import { localDateString } from './local-date.js';
import { MACROS, emptyMacros, parseDate, movePeriod, summarizePeriod, periodDates } from './history-model.js';
const labels = { cal: 'Calories', p: 'Protein', c: 'Carbs', f: 'Fat' };
const fmt = value => Number(value.toFixed(1)).toLocaleString();
export function initializeHistory(bindClick, signal, onChange) {
    const controls = document.getElementById('history-controls');
    controls.innerHTML = `<div class="segmented" role="group" aria-label="Macro period"><button type="button" data-period="day">Day</button><button type="button" data-period="week">Week</button><button type="button" data-period="month">Month</button></div><div class="period-navigation"><button id="period-prev" type="button" class="select-trigger" aria-label="Previous period">←</button><label class="date-picker">Selected date<input id="period-date" type="date" aria-label="Selected date"></label><button id="period-next" type="button" class="select-trigger" aria-label="Next period">→</button><button id="period-today" type="button" class="select-trigger">Today</button></div><p id="period-label" class="muted"></p>`;
    document.getElementById('log-format-controls').innerHTML = '<div class="segmented" role="group" aria-label="Log presentation"><button type="button" data-log-format="timeline">Timeline</button><button type="button" data-log-format="calendar">Calendar</button></div>';
    let anchor = localDateString(), period = 'day', format = 'timeline', followToday = true;
    function change() { document.getElementById('period-date').value = anchor; onChange(); }
    controls.querySelectorAll('[data-period]').forEach(button => bindClick(button, () => { period = button.dataset.period; change(); }));
    document.querySelectorAll('[data-log-format]').forEach(button => bindClick(button, () => { format = button.dataset.logFormat; change(); }));
    for (const [id, direction] of [['period-prev', -1], ['period-next', 1]]) bindClick(document.getElementById(id), () => { anchor = movePeriod(anchor, period, direction); followToday = false; change(); });
    bindClick(document.getElementById('period-today'), () => { anchor = localDateString(); followToday = true; change(); });
    document.getElementById('period-date').addEventListener('change', event => { try { parseDate(event.target.value); anchor = event.target.value; followToday = anchor === localDateString(); change(); } catch { event.target.value = anchor; } }, { signal });
    document.getElementById('period-date').value = anchor;
    function render(state) {
        const summary = summarizePeriod(state, anchor, period);
        controls.querySelectorAll('[data-period]').forEach(button => button.setAttribute('aria-pressed', button.dataset.period === period));
        document.querySelectorAll('[data-log-format]').forEach(button => button.setAttribute('aria-pressed', button.dataset.logFormat === format));
        document.getElementById('brief-title').textContent = `${({ day: 'Daily', week: 'Weekly', month: 'Monthly' })[period]} Brief`;
        document.getElementById('period-label').textContent = `${summary.days[0].date}${period === 'day' ? '' : ` — ${summary.days.at(-1).date}`} · ${period === 'day' ? 'Daily totals' : 'Rings show average per logged day'} · Compared with current daily targets`;
        const overview = document.getElementById('period-summary'); overview.hidden = period === 'day'; overview.replaceChildren();
        if (period !== 'day') {
            const title = document.createElement('h3'); title.textContent = `${summary.loggedDays} of ${summary.days.length} days with logs`;
            const table = document.createElement('table'); table.className = 'macro-summary';
            table.innerHTML = '<thead><tr><th>Macro</th><th>Logged total</th><th>Average / logged day</th></tr></thead>';
            const tbody = document.createElement('tbody');
            MACROS.forEach(key => { const row = document.createElement('tr'); [labels[key], `${fmt(summary.totals[key])}${key === 'cal' ? ' kcal' : 'g'}`, `${fmt(summary.averages[key])}${key === 'cal' ? ' kcal' : 'g'}`].forEach(value => { const cell = document.createElement('td'); cell.textContent = value; row.append(cell); }); tbody.append(row); });
            table.append(tbody); const note = document.createElement('p'); note.className = 'muted';
            note.textContent = `${summary.compliance === null ? 'No target compliance data' : `${fmt(summary.compliance)}% of logged days within ±10% of current calorie target`}. Calorie balance on logged days: ${summary.balance > 0 ? '+' : ''}${fmt(summary.balance)} kcal. Days without entries are missing data.`;
            overview.append(title, table, note);
        }
        const trend = document.getElementById('macro-trends'); trend.hidden = period === 'day'; trend.replaceChildren();
        if (period !== 'day') {
            const title = document.createElement('h3'); title.textContent = 'Daily macros vs. current targets'; trend.append(title);
            for (const day of summary.days) {
                const row = document.createElement('div'); row.className = 'macro-trend-row'; row.dataset.date = day.date;
                const date = document.createElement('span'); date.textContent = day.date.slice(5); row.append(date);
                if (!day.logged) { const missing = document.createElement('span'); missing.className = 'muted'; missing.textContent = 'No entries'; row.append(missing); }
                else MACROS.forEach(key => {
                    const block = document.createElement('div'); block.className = `trend-macro trend-${key}`;
                    const text = document.createElement('span'); text.textContent = `${labels[key]} ${fmt(day.totals[key])}${key === 'cal' ? ' kcal' : 'g'}`;
                    const track = document.createElement('div'); track.className = 'trend-track'; const bar = document.createElement('div'); bar.className = 'trend-fill'; bar.style.transform = `scaleX(${state.targets[key] > 0 ? Math.min(day.totals[key] / state.targets[key], 1) : 0})`; track.append(bar); block.append(text, track); row.append(block);
                });
                trend.append(row);
            }
        }
        const calendar = document.getElementById('log-calendar'); calendar.hidden = format !== 'calendar'; calendar.replaceChildren();
        document.getElementById('daily-log-container').hidden = format === 'calendar';
        if (format === 'calendar') {
            const heading = document.createElement('h3'); heading.textContent = parseDate(anchor).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
            const note = document.createElement('p'); note.className = 'muted'; note.textContent = 'On target: within ±10% of your current calorie target. Select a date to open its log.';
            const grid = document.createElement('div'); grid.className = 'calendar-grid';
            ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach(name => { const label = document.createElement('span'); label.textContent = name; grid.append(label); });
            const monthDates = periodDates(anchor, 'month');
            const offset = (parseDate(monthDates[0]).getDay() + 6) % 7;
            for (let i = 0; i < offset; i++) grid.append(document.createElement('span'));
            for (const date of monthDates) {
                const log = state.logs[date.slice(0, 7)]?.[date], logged = !!log?.diary?.length;
                const button = document.createElement('button'); button.type = 'button'; button.className = 'calendar-day'; button.dataset.date = date;
                const inPeriod = summary.days.some(day => day.date === date); button.classList.toggle('in-period', inPeriod);
                const totals = log?.totals || emptyMacros(); const onTarget = logged && state.targets.cal > 0 && Math.abs(totals.cal / state.targets.cal - 1) <= .10000001;
                button.dataset.status = !logged ? 'missing' : onTarget ? 'target' : 'variance';
                const name = document.createElement('strong'); name.textContent = Number(date.slice(-2));
                const calories = document.createElement('small'); calories.textContent = logged ? `${fmt(totals.cal)} kcal` : 'No entries';
                const badge = document.createElement('small'); badge.textContent = logged ? onTarget ? 'On target' : totals.cal > state.targets.cal ? 'Above target' : 'Below target' : '';
                button.setAttribute('aria-label', `${date}: ${logged ? `${fmt(totals.cal)} calories, protein ${fmt(totals.p)}g, carbs ${fmt(totals.c)}g, fat ${fmt(totals.f)}g, ${badge.textContent}` : 'no entries'}`);
                button.title = logged ? `${totals.p}g protein · ${totals.c}g carbs · ${totals.f}g fat` : 'No logged entries';
                const macros = document.createElement('small'); macros.className = 'calendar-macros';
                macros.textContent = logged ? `P ${fmt(totals.p)}g · C ${fmt(totals.c)}g · F ${fmt(totals.f)}g` : '';
                button.append(name, calories, macros, badge);
                bindClick(button, () => { anchor = date; period = 'day'; format = 'timeline'; followToday = date === localDateString(); change(); }); grid.append(button);
            }
            calendar.append(heading, note, grid);
        }
        return summary;
    }
    return { render, selection: () => ({ anchor, period, format }), rollover(date) { if (followToday) { anchor = date; document.getElementById('period-date').value = anchor; } } };
}
