import { store } from './state.js';
import { createRouter } from './router.js';
import { initializeAccount } from './account.js';
import { createDashboard } from './dashboard.js';
import { UNITS, unitOptions, servingFactor, ingredientFactor, convertAmount } from './units.js';
import { localDateString, watchLocalDay } from './local-date.js';
import { createSelectSystem } from './select-widget.js';
import { searchExternalDatabase } from './usda.js';

const lifetime = new AbortController();
const clickHandlers = new WeakMap();
function bindClick(element, handler) {
    if (!element) return;
    element.dataset.action = 'ui';
    clickHandlers.set(element, handler);
}
function listen(element, type, handler) {
    element.addEventListener(type, handler, { signal: lifetime.signal });
}
const timers = new Set();
function schedule(callback, delay) {
    const timer = setTimeout(() => {
        timers.delete(timer);
        if (!lifetime.signal.aborted) callback();
    }, delay);
    timers.add(timer);
    return timer;
}
const closingTimers = new WeakMap();
function cancelClose(element) {
    const timer = closingTimers.get(element);
    clearTimeout(timer);
    timers.delete(timer);
    closingTimers.delete(element);
}
function finishClose(element, callback) {
    cancelClose(element);
    closingTimers.set(element, schedule(() => {
        closingTimers.delete(element);
        callback();
    }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 190));
}

const openingFrames = new Map();
function cancelOpen(root) {
    for (const frame of openingFrames.get(root) || []) cancelAnimationFrame(frame);
    openingFrames.delete(root);
}
function reveal(root, callback) {
    cancelOpen(root);
    const frames = [];
    openingFrames.set(root, frames);
    frames.push(requestAnimationFrame(() => {
        frames.push(requestAnimationFrame(() => {
            if (openingFrames.get(root) !== frames || lifetime.signal.aborted) return;
            openingFrames.delete(root);
            callback();
        }));
    }));
}

function wait(delay, signal) {
    return new Promise((resolve, reject) => {
        signal.throwIfAborted();
        const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, delay);
        function abort() { clearTimeout(timer); reject(signal.reason); }
        signal.addEventListener('abort', abort, { once: true });
    });
}
let searchRequest = null;
function cancelSearch() { searchRequest?.abort(); searchRequest = null; }

function escapeAttribute(value) {
    return String(value).replace(/[&"'<>]/g, char => ({ '&': '&amp;', '"': '&quot;', "'": '&#39;', '<': '&lt;', '>': '&gt;' }[char]));
}

// 1. Reliable Local Date Helper
const selects = createSelectSystem(bindClick, { signal: lifetime.signal });
const getLocalDateString = localDateString;

// 2. Initialize App State & Recipes

if (!store.get().recipes) {
    store.update(draft => {
        draft.recipes = [
            {
                id: 'rec_chicken_rice',
                name: 'Chicken Kebab & Rice',
                pinned: true,
                ingredients: [
                    { id: '1', name: 'Chicken Breast (Raw)', amount: 200, unit: 'g', cal: 120, p: 22.5, c: 0, f: 2.6, baseServing: 100, baseUnit: 'g' },
                    { id: '2', name: 'Jasmine Rice (Dry)', amount: 75, unit: 'g', cal: 360, p: 7, c: 80, f: 0.5, baseServing: 100, baseUnit: 'g' }
                ]
            },
            {
                id: 'rec_yogurt_berries',
                name: 'Greek Yogurt & Berries',
                pinned: true,
                ingredients: [
                    { id: '3', name: 'Nonfat Greek Yogurt', amount: 227, unit: 'g', cal: 130, p: 23, c: 8, f: 0, baseServing: 227, baseUnit: 'g' },
                    { id: '4', name: 'Mixed Berries (Frozen)', amount: 100, unit: 'g', cal: 65, p: 1, c: 14, f: 0.5, baseServing: 100, baseUnit: 'g' }
                ]
            }
        ];
    });

}

// 3. Element References
const searchInput = document.getElementById('food-search-input');
const dropdown = document.getElementById('search-dropdown');
const resultsContainer = document.getElementById('dropdown-results');
const predictivePills = document.getElementById('predictive-pills');

const modal = document.getElementById('logging-modal');
const modalContent = document.getElementById('modal-content');
const modalName = document.getElementById('modal-food-name');
const modalBase = document.getElementById('modal-food-base');
const modalCal = document.getElementById('modal-cal');
const modalP = document.getElementById('modal-p');
const modalC = document.getElementById('modal-c');
const modalF = document.getElementById('modal-f');
const modalInput = document.getElementById('modal-qty-input');
const btnCancelLog = document.getElementById('btn-cancel-log');
const btnConfirmLog = document.getElementById('btn-confirm-log');

const btnModalUnitTrigger = document.getElementById('btn-modal-unit-trigger');
const modalUnitTriggerLabel = document.getElementById('modal-unit-trigger-label');
const modalUnitScaleValue = document.getElementById('modal-unit-scale-value');
const modalUnitLabelValue = document.getElementById('modal-unit-label-value');

let activeFoodToLog = null;
let activeDiaryEntryId = null;
let activeDiaryDate = null;
let activeRecipeDate = null;
let currentDashboardView = 'rings';
const dashboard = createDashboard(document.getElementById('macro-dashboard'));
let currentDbFilterTab = 'all';

// 4. Fuzzy Search
function fuzzyMatch(foodName, query) {
    const nameLower = foodName.toLowerCase();
    const queryTerms = query.toLowerCase().trim().split(/\s+/);
    return queryTerms.every(term => nameLower.includes(term));
}

// 5. Single Food Logging Modal
function openModal(food, existingEntryId = null) {
    cancelClose(modal);
    activeFoodToLog = food;
    activeDiaryEntryId = existingEntryId;
    activeDiaryDate = getLocalDateString();
    modalName.textContent = food.name;
    const baseUnit = food.unit || 'g';
    modalBase.textContent = `${food.serving}${baseUnit}`;

    modalInput.value = 1;

    const options = unitOptions(food);
    let selectedUnit = 'portion';
    function selectUnit(value) {
        selectedUnit = value;
        modalUnitScaleValue.value = servingFactor(food, 1, value);
        modalUnitLabelValue.value = value;
        modalUnitTriggerLabel.textContent = options.find(option => option.value === value).label;
        updateModalMacros();
    }
    selects.register(btnModalUnitTrigger, {
        options, getValue: () => selectedUnit, onChange: selectUnit, label: 'Food logging unit'
    });
    selectUnit('portion');
    const existing = store.get().logs[getLocalDateString().slice(0, 7)]?.[getLocalDateString()]?.diary.find(entry => entry.id === existingEntryId);
    if (existing) {
        const key = existing.unitKey || (existing.unit.startsWith('serving') ? 'portion' : existing.unit);
        if (options.some(option => option.value === key)) selectUnit(key);
        modalInput.value = existing.amount;
    }

    btnConfirmLog.textContent = existingEntryId ? 'Save Changes' : 'Log to Diary';
    updateModalMacros();

    modal.classList.remove('hidden');
    reveal(modal, () => {
        modal.classList.remove('opacity-0', 'pointer-events-none');
        modalContent.classList.remove('translate-y-full');
    });
}

function closeModal() {
    cancelOpen(modal);
    selects.close();
    modal.classList.add('opacity-0', 'pointer-events-none');
    modalContent.classList.add('translate-y-full');
    activeFoodToLog = null;
    activeDiaryEntryId = null;
    finishClose(modal, () => modal.classList.add('hidden'));
}

function updateModalMacros() {
    if (!activeFoodToLog) return;
    if (activeDiaryEntryId && activeDiaryDate !== getLocalDateString()) { closeModal(); renderDailyBrief(); return; }
    const servings = parseFloat(modalInput.value) || 0;
    const unitScale = parseFloat(modalUnitScaleValue.value) || 0;
    const totalScale = servings * unitScale;

    modalCal.textContent = Math.round(activeFoodToLog.cal * totalScale);
    modalP.textContent = Math.round(activeFoodToLog.p * totalScale) + 'g';
    modalC.textContent = Math.round(activeFoodToLog.c * totalScale) + 'g';
    modalF.textContent = Math.round(activeFoodToLog.f * totalScale) + 'g';
}

function logFoodToState() {
    if (!activeFoodToLog) return;
    if (activeDiaryEntryId && activeDiaryDate !== getLocalDateString()) { closeModal(); renderDailyBrief(); return; }
    const servings = parseFloat(modalInput.value) || 0;
    const unitScale = parseFloat(modalUnitScaleValue.value) || 0;
    const totalScale = servings * unitScale;
    const selectedUnitKey = modalUnitLabelValue.value;
    const selectedUnitText = selectedUnitKey === 'portion' ? 'serving' : selectedUnitKey;

    const today = getLocalDateString();
    const monthKey = today.substring(0, 7);

    store.update(draft => {
        if (!draft.logs[monthKey]) draft.logs[monthKey] = {};
        if (!draft.logs[monthKey][today]) {
            draft.logs[monthKey][today] = { date: today, totals: { cal: 0, p: 0, c: 0, f: 0 }, diary: [] };
        }

        const dayLog = draft.logs[monthKey][today];

        if (activeDiaryEntryId) {
            const idx = dayLog.diary.findIndex(e => String(e.id) === String(activeDiaryEntryId));
            if (idx !== -1) {
                const old = dayLog.diary[idx];
                dayLog.totals.cal -= old.cal;
                dayLog.totals.p -= old.p;
                dayLog.totals.c -= old.c;
                dayLog.totals.f -= old.f;

                old.amount = servings;
                old.unit = selectedUnitText;
                old.unitKey = selectedUnitKey;
                old.nutrition = structuredClone(activeFoodToLog);
                old.cal = Math.round(activeFoodToLog.cal * totalScale);
                old.p = Math.round(activeFoodToLog.p * totalScale);
                old.c = Math.round(activeFoodToLog.c * totalScale);
                old.f = Math.round(activeFoodToLog.f * totalScale);

                dayLog.totals.cal += old.cal;
                dayLog.totals.p += old.p;
                dayLog.totals.c += old.c;
                dayLog.totals.f += old.f;
            }
        } else {
            const entry = {
                id: Date.now().toString(),
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
                foodId: activeFoodToLog.id,
                name: activeFoodToLog.name,
                amount: servings,
                unit: selectedUnitText,
                unitKey: selectedUnitKey,
                nutrition: structuredClone(activeFoodToLog),
                cal: Math.round(activeFoodToLog.cal * totalScale),
                p: Math.round(activeFoodToLog.p * totalScale),
                c: Math.round(activeFoodToLog.c * totalScale),
                f: Math.round(activeFoodToLog.f * totalScale)
            };
            dayLog.diary.push(entry);
            dayLog.totals.cal += entry.cal;
            dayLog.totals.p += entry.p;
            dayLog.totals.c += entry.c;
            dayLog.totals.f += entry.f;
        }
    });

    closeModal();
}

listen(modalInput, 'input', updateModalMacros);
bindClick(btnCancelLog, closeModal);
bindClick(btnConfirmLog, logFoodToState);
bindClick(document.getElementById('modal-backdrop'), closeModal);

// 6. Search Dropdown & Skeleton Loader
function createFoodButton(food, isExternal = false) {
    const btn = document.createElement('button');
    btn.className = "w-full text-left px-5 py-3 hover:bg-slate-700/50 transition border-b border-slate-700/50 last:border-0 focus:bg-slate-700/50 focus:outline-none flex justify-between items-center";
    const sourceTag = isExternal ? `<span class="text-[9px] font-bold tracking-widest text-blue-400 uppercase bg-blue-900/30 px-2 py-1 rounded">Global DB</span>` : ``;

    btn.innerHTML = `
        <div>
            <div class="font-bold text-slate-200 text-sm">${food.name}</div>
            <div class="text-xs text-slate-400 mt-0.5">${food.cal} kcal • ${food.p}P / ${food.c}C / ${food.f}F <span class="text-slate-600 ml-1">(per ${food.serving}${food.unit || 'g'})</span></div>
        </div>
        ${sourceTag}
    `;

    bindClick(btn, () => {
        cancelSearch();
        openModal(food);
        searchInput.value = '';
        dropdown.classList.add('hidden');
        predictivePills.classList.remove('opacity-20');
        searchInput.blur();
    });

    return btn;
}

listen(searchInput, 'input', async (e) => {
    cancelSearch();
    const query = e.target.value;
    if (query.length === 0) {
        dropdown.classList.add('hidden');
        predictivePills.classList.remove('opacity-20');
        return;
    }

    predictivePills.classList.add('opacity-20');
    dropdown.classList.remove('hidden');

    const localMatches = store.get().foodDatabase.filter(food => fuzzyMatch(food.name, query));
    resultsContainer.innerHTML = '';

    localMatches.slice(0, 3).forEach(food => {
        resultsContainer.appendChild(createFoodButton(food, false));
    });

    if (query.length >= 3) {
        const searchWebBtn = document.createElement('button');
        searchWebBtn.className = "w-full text-center px-5 py-4 text-sm font-bold text-blue-400 hover:text-blue-300 hover:bg-slate-700/30 transition";
        searchWebBtn.innerHTML = `Search global database for "${query}"...`;

        bindClick(searchWebBtn, async (ev) => {
            ev.preventDefault();
            // Skeleton Loader State
            resultsContainer.innerHTML = `
                <div class="p-4 space-y-3">
                    <div class="h-12 bg-slate-800/60 rounded-xl animate-pulse"></div>
                    <div class="h-12 bg-slate-800/60 rounded-xl animate-pulse"></div>
                </div>`;
            cancelSearch();
            const request = new AbortController();
            searchRequest = request;
            let externalResults;
            try {
                externalResults = await searchExternalDatabase(query, { signal: request.signal });
            } catch (error) {
                if (request.signal.aborted) return;
                throw error;
            }
            if (request.signal.aborted || searchRequest !== request || searchInput.value !== query) return;
            searchRequest = null;
            resultsContainer.innerHTML = '';

            if (externalResults.length === 0) {
                resultsContainer.innerHTML = `<div class="px-5 py-4 text-sm text-slate-400 italic text-center">No results found in global database.</div>`;
            } else {
                externalResults.forEach(food => {
                    resultsContainer.appendChild(createFoodButton(food, true));
                });
            }
        });

        resultsContainer.appendChild(searchWebBtn);
    }
});

listen(searchInput, 'focus', () => {
    if (searchInput.value.trim().length > 0 && resultsContainer.innerHTML !== '') {
        dropdown.classList.remove('hidden');
        predictivePills.classList.add('opacity-20');
    }
});

function dismissSearch(e) {
    const path = e.composedPath();
    if (!path.includes(searchInput) && !path.includes(dropdown)) {
        cancelSearch();
        dropdown.classList.add('hidden');
        predictivePills.classList.remove('opacity-20');
    }
}

// 7. Pinned Recipe Pills (Quick Add)
function renderPredictivePills() {
    if (!predictivePills) return;
    const recipes = store.get().recipes || [];
    const pinned = recipes.filter(r => r.pinned !== false);
    const displayList = pinned.length > 0 ? pinned : recipes.slice(0, 2);

    predictivePills.innerHTML = displayList.map(r => `
        <button data-recipe-id="${r.id}" class="px-5 py-2.5 rounded-2xl bg-slate-900 border border-white/[0.05] text-sm font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition shadow-sm flex items-center gap-1.5 active:scale-[0.97]">
            <span>+ ${r.name}</span>
        </button>
    `).join('');
}

if (predictivePills) {
    bindClick(predictivePills, (e) => {
        const btn = e.target.closest('button[data-recipe-id]');
        if (!btn) return;
        const recId = btn.getAttribute('data-recipe-id');
        const rec = store.get().recipes.find(r => r.id === recId);
        if (rec) openRecipeModal(rec);
    });
}

// 8. Render Dashboard & Chronological Log
function renderDailyBrief() {
    const today = getLocalDateString();
    const monthKey = today.substring(0, 7);
    const state = store.get();
    const dayLog = state.logs[monthKey]?.[today] || { totals: { cal: 0, p: 0, c: 0, f: 0 }, diary: [] };
    const targets = state.targets;

    dashboard.update(dayLog.totals, targets, currentDashboardView);

    // Render Diary Log (Elevated Empty State)
    const logContainer = document.getElementById('daily-log-container');
    if (dayLog.diary.length === 0) {
        logContainer.innerHTML = `
            <div class="bg-slate-900/50 p-8 rounded-3xl border border-dashed border-slate-800 flex flex-col items-center justify-center gap-3">
                <svg class="w-10 h-10 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                <span class="text-slate-500 text-sm font-medium">Your daily log is empty</span>
                <span class="text-slate-600 text-xs">Search, scan, or pick a meal pill above</span>
            </div>`;
        return;
    }

    const sortedDiary = [...dayLog.diary].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    logContainer.innerHTML = sortedDiary.map(entry => {
        if (entry.isGroup && entry.items) {
            const nestedItemsHTML = entry.items.map(sub => `
                <div class="flex justify-between items-center py-1.5 px-3 bg-slate-950/40 rounded-xl text-xs">
                    <span class="text-slate-300 font-medium">${sub.name} <span class="text-slate-500 text-[11px]">(${sub.amount}${sub.unit})</span></span>
                    <span class="text-slate-400 font-semibold tabular-nums">${sub.cal} kcal • <span class="text-blue-400">${sub.p}P</span> <span class="text-emerald-400">${sub.c}C</span> <span class="text-rose-400">${sub.f}F</span></span>
                </div>
            `).join('');

            return `
                <div class="bg-slate-900 rounded-2xl border border-white/[0.05] overflow-hidden transition group hover:border-slate-700">
                    <div class="p-4 flex items-center justify-between cursor-pointer select-none" data-action="toggle-group" data-id="${escapeAttribute(entry.id)}">
                        <div class="flex items-center gap-3">
                            <span id="chevron-${entry.id}" class="text-slate-500 transition-transform duration-200">
                                <svg class="w-4 h-4 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
                            </span>
                            <div class="text-xs font-bold text-slate-500 w-10 text-center">${entry.timestamp}</div>
                            <div>
                                <div class="font-bold text-slate-100 text-sm flex items-center gap-2">
                                    ${entry.name}
                                    <span class="text-[9px] uppercase tracking-wider bg-emerald-950/60 text-emerald-400 border border-emerald-800/40 px-2 py-0.5 rounded-full font-bold">Meal Group</span>
                                </div>
                                <div class="text-xs text-slate-400 mt-0.5">${entry.items.length} items • ${entry.cal} kcal</div>
                            </div>
                        </div>
                        <div class="flex items-center gap-2">
                            <div class="text-right text-xs font-bold tabular-nums flex flex-col gap-0.5 mr-2">
                                <span class="text-blue-400">${entry.p} P</span>
                                <span class="text-emerald-400">${entry.c} C</span>
                                <span class="text-rose-400">${entry.f} F</span>
                            </div>
                            <button data-action="edit-diary-entry" data-id="${escapeAttribute(entry.id)}" class="p-2 text-slate-500 hover:text-white hover:bg-slate-800 rounded-xl transition active:scale-95" title="Edit Meal">
                                <svg class="w-3.5 h-3.5 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                            </button>
                            <button data-action="delete-diary-entry" data-id="${escapeAttribute(entry.id)}" class="p-2 text-slate-500 hover:text-rose-400 hover:bg-slate-800 rounded-xl transition active:scale-95" title="Delete">
                                <svg class="w-3.5 h-3.5 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                            </button>
                        </div>
                    </div>
                    <div id="drawer-${entry.id}" class="hidden px-4 pb-4 pt-1 space-y-1.5 border-t border-slate-800/50">
                        ${nestedItemsHTML}
                    </div>
                </div>
            `;
        }

        return `
            <div class="bg-slate-900 p-4 rounded-2xl border border-white/[0.05] flex items-center justify-between group transition hover:border-slate-700">
                <div class="flex items-center gap-4">
                    <div class="text-xs font-bold text-slate-500 w-10 text-center">${entry.timestamp}</div>
                    <div>
                        <div class="font-bold text-slate-200 text-sm leading-tight">${entry.name}</div>
                        <div class="text-xs text-slate-400 mt-1 tabular-nums">${entry.amount} ${entry.unit} • ${entry.cal} kcal</div>
                    </div>
                </div>
                <div class="flex items-center gap-2">
                    <div class="text-right text-xs font-bold tabular-nums flex flex-col gap-0.5 mr-2">
                        <span class="text-blue-400">${entry.p} P</span>
                        <span class="text-emerald-400">${entry.c} C</span>
                        <span class="text-rose-400">${entry.f} F</span>
                    </div>
                    <button data-action="edit-diary-entry" data-id="${escapeAttribute(entry.id)}" class="p-2 text-slate-500 hover:text-white hover:bg-slate-800 rounded-xl transition active:scale-95" title="Edit Amount">
                        <svg class="w-3.5 h-3.5 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                    </button>
                    <button data-action="delete-diary-entry" data-id="${escapeAttribute(entry.id)}" class="p-2 text-slate-500 hover:text-rose-400 hover:bg-slate-800 rounded-xl transition active:scale-95" title="Delete">
                        <svg class="w-3.5 h-3.5 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

function toggleGroupAccordion(id) {
    const drawer = document.getElementById(`drawer-${id}`);
    const chevron = document.getElementById(`chevron-${id}`);
    if (drawer) {
        drawer.classList.toggle('hidden');
        chevron.classList.toggle('rotate-90');
    }
};

function deleteDiaryEntry(entryId) {
    const today = getLocalDateString();
    const monthKey = today.substring(0, 7);
    store.update(draft => {
        const dayLog = draft.logs[monthKey]?.[today];
        if (!dayLog) return;

        const idx = dayLog.diary.findIndex(e => String(e.id) === String(entryId));
        if (idx === -1) return;

        const item = dayLog.diary[idx];
        dayLog.totals.cal = Math.max(0, dayLog.totals.cal - item.cal);
        dayLog.totals.p = Math.max(0, dayLog.totals.p - item.p);
        dayLog.totals.c = Math.max(0, dayLog.totals.c - item.c);
        dayLog.totals.f = Math.max(0, dayLog.totals.f - item.f);

        dayLog.diary.splice(idx, 1);
    });

};

function editDiaryEntry(entryId) {
    const today = getLocalDateString();
    const monthKey = today.substring(0, 7);
    const dayLog = store.get().logs[monthKey]?.[today];
    if (!dayLog) return;

    const entry = dayLog.diary.find(e => String(e.id) === String(entryId));
    if (!entry) return;

    if (entry.isGroup) {
        openRecipeModal({
            id: entry.id,
            name: entry.name,
            ingredients: entry.items.map(it => ({
                id: it.id || it.foodId || Math.random(),
                name: it.name,
                amount: it.amount,
                unit: it.unit === 'portion' ? 'serving' : it.unit,
                cal: it.cal,
                p: it.p,
                c: it.c,
                f: it.f,
                baseServing: it.amount,
                baseUnit: it.unit === 'portion' ? 'serving' : it.unit
            }))
        }, entry.id);
    } else {
        const food = entry.nutrition || store.get().foodDatabase.find(f => String(f.id) === String(entry.foodId)) || {
            id: entry.foodId,
            name: entry.name,
            serving: 1,
            unit: 'serving',
            cal: entry.cal,
            p: entry.p,
            c: entry.c,
            f: entry.f
        };
        openModal(food, entry.id);
        modalInput.value = entry.amount;
        updateModalMacros();
    }
};

bindClick(document.getElementById('macro-dashboard'), (e) => {
    if (e.target.closest('#btn-toggle-view')) {
        currentDashboardView = currentDashboardView === 'rings' ? 'bars' : currentDashboardView === 'bars' ? 'minimal' : 'rings';
        renderDailyBrief();
    }
});

listen(document, 'visibilitychange', () => {
    if (!document.hidden) renderDailyBrief();
    else { cancelSearch(); void stopScanner().catch(error => console.error('Scanner cleanup failed:', error)); }
});

// 9. Barcode Scanner Engine
const btnScanBarcode = document.getElementById('btn-scan-barcode');
const scannerModal = document.getElementById('scanner-modal');
const btnCloseScanner = document.getElementById('btn-close-scanner');
const scannerStatus = document.getElementById('scanner-status');
let html5QrCode = null;
let isProcessingScan = false;
let scannerSession = null;
let scannerQueue = Promise.resolve();
let barcodeRequest = null;

async function clearScanner() {
    const scanner = html5QrCode;
    if (!scanner) return;
    if (scanner.isScanning) await scanner.stop();
    await scanner.clear();
    if (html5QrCode === scanner) html5QrCode = null;
}
function startScanner() {
    cancelSearch();
    scannerSession?.abort();
    barcodeRequest?.abort();
    const session = new AbortController();
    scannerSession = session;
    scannerModal.classList.remove('hidden');
    scannerStatus.textContent = 'Requesting camera access...';
    isProcessingScan = false;
    scannerQueue = scannerQueue.catch(error => console.error('Scanner cleanup failed:', error)).then(async () => {
        try {
            await clearScanner();
            await wait(350, session.signal);
            const library = globalThis.Html5Qrcode ? globalThis : await import('./dist/scanner.js');
            session.signal.throwIfAborted();
            const formats = library.Html5QrcodeSupportedFormats;
            html5QrCode = new library.Html5Qrcode('reader', formats ? { formatsToSupport: [formats.UPC_A, formats.UPC_E, formats.EAN_13, formats.EAN_8] } : undefined);
            await html5QrCode.start(
                { facingMode: 'environment' },
                { fps: 15, qrbox: { width: 250, height: 150 } },
                text => { if (!session.signal.aborted) void onScanSuccess(text); },
                () => {}
            );
            if (session.signal.aborted) await clearScanner();
            else scannerStatus.textContent = 'Position barcode in the center frame.';
        } catch (error) {
            await clearScanner();
            if (!session.signal.aborted) {
                scannerStatus.textContent = 'Camera unavailable. Check camera permissions and scanner library access.';
                console.error(error);
            }
        }
    });
    return scannerQueue;
}
if (btnScanBarcode) bindClick(btnScanBarcode, startScanner);
if (btnCloseScanner) bindClick(btnCloseScanner, stopScanner);
function stopScanner() {
    scannerSession?.abort();
    scannerSession = null;
    barcodeRequest?.abort();
    barcodeRequest = null;
    scannerModal.classList.add('hidden');
    isProcessingScan = false;
    // A pending start must settle before stop/clear can release its camera stream.
    scannerQueue = scannerQueue.catch(error => console.error('Scanner startup failed:', error)).then(clearScanner);
    return scannerQueue;
}

async function onScanSuccess(decodedText) {
    if (isProcessingScan || !scannerSession || scannerSession.signal.aborted) return;
    isProcessingScan = true;
    const session = scannerSession;
    const request = new AbortController();
    barcodeRequest?.abort();
    barcodeRequest = request;

    scannerStatus.innerHTML = `<span class="text-blue-400 font-bold animate-pulse">Found ${decodedText}... fetching nutrition!</span>`;

    try {
        let paddedText = decodedText.length === 12 ? '0' + decodedText : decodedText;

        let response = await fetch(`https://world.openfoodfacts.org/api/v0/product/${encodeURIComponent(decodedText)}.json`, { signal: request.signal });
        let data = await response.json();

        if (data.status !== 1 && decodedText.length === 12) {
            response = await fetch(`https://world.openfoodfacts.org/api/v0/product/${encodeURIComponent(paddedText)}.json`, { signal: request.signal });
            data = await response.json();
        }

        if (request.signal.aborted || session !== scannerSession) return;
        if (data.status !== 1) throw new Error("Not Found in Global DB");

        const product = data.product;
        const nutriments = product.nutriments || {};

        const scannedFood = {
            id: `off_${decodedText}`,
            name: product.product_name || "Unknown Product",
            category: "Scanned",
            serving: 100,
            unit: "g",
            cal: Math.round(nutriments['energy-kcal_100g'] || 0),
            p: Math.round(nutriments['proteins_100g'] || 0),
            c: Math.round(nutriments['carbohydrates_100g'] || 0),
            f: Math.round(nutriments['fat_100g'] || 0)
        };

        if (!store.get().foodDatabase.some(f => f.id === scannedFood.id)) {
            store.update(draft => {
                draft.foodDatabase.push(scannedFood);
            });

        }

        await stopScanner();
        if (!lifetime.signal.aborted && scannerSession === null) openModal(scannedFood);

    } catch (error) {
        if (request.signal.aborted || session !== scannerSession) return;
        console.error(error);
        scannerStatus.innerHTML = `<span class="text-rose-400 font-bold">Item not found in global database.</span>`;
        schedule(() => {
            if (session !== scannerSession || session.signal.aborted) return;
            isProcessingScan = false;
            scannerStatus.innerHTML = "Position barcode in the center frame.";
        }, 2500);
    }
}

// 10. Drawer Routing
const drawerContainer = document.getElementById('drawer-container');
const drawerBackdrop = document.getElementById('drawer-backdrop');
const drawerPanel = document.getElementById('drawer-panel');
const btnMenu = document.getElementById('btn-menu');
const btnCloseDrawer = document.getElementById('btn-close-drawer');

function openDrawer() {
    cancelClose(drawerContainer);
    drawerContainer.classList.remove('pointer-events-none');
    drawerBackdrop.classList.remove('opacity-0', 'pointer-events-none');
    drawerPanel.classList.remove('translate-x-full');
    drawerPanel.classList.add('translate-x-0');
}

function closeDrawer() {
    selects.close();
    drawerBackdrop.classList.add('opacity-0', 'pointer-events-none');
    drawerPanel.classList.remove('translate-x-0');
    drawerPanel.classList.add('translate-x-full');
    finishClose(drawerContainer, () => drawerContainer.classList.add('pointer-events-none'));
}

bindClick(btnMenu, (e) => { e.stopPropagation(); openDrawer(); });
bindClick(btnCloseDrawer, (e) => { e.stopPropagation(); closeDrawer(); });
bindClick(drawerBackdrop, closeDrawer);

function switchView(targetViewId) {
    document.querySelectorAll('.app-view').forEach(view => view.classList.add('hidden'));
    const target = document.getElementById(targetViewId);
    if (target) target.classList.remove('hidden');

    if (targetViewId === 'view-database') {
        renderDatabaseView();
    }

    document.querySelectorAll('.drawer-nav-item').forEach(btn => {
        const isActive = btn.getAttribute('data-nav') === targetViewId;
        btn.className = isActive
            ? 'drawer-nav-item w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-semibold text-white bg-slate-800/70 hover:bg-slate-800 transition'
            : 'drawer-nav-item w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-semibold text-slate-300 hover:text-white hover:bg-slate-800/50 transition';
    });
    closeDrawer();
}

document.querySelectorAll('.drawer-nav-item').forEach(item => {
    bindClick(item, () => {
        const viewId = item.getAttribute('data-nav');
        if (viewId) switchView(viewId);
    });
});

// 11. Custom Food & Recipe Builder Engine
const customFoodModal = document.getElementById('custom-food-modal');
const customFoodBackdrop = document.getElementById('custom-food-backdrop');
const customFoodForm = document.getElementById('custom-food-form');
const customRecipeContainer = document.getElementById('custom-recipe-form-container');
const tabModeFood = document.getElementById('tab-mode-food');
const tabModeRecipe = document.getElementById('tab-mode-recipe');
const btnOpenAddFood = document.getElementById('btn-open-add-food');
const btnCloseCustomModal = document.getElementById('btn-close-custom-modal');
const btnCancelCustomFood = document.getElementById('btn-cancel-custom-food');
const btnCancelCustomRecipe = document.getElementById('btn-cancel-custom-recipe');
const customModalTitle = document.getElementById('custom-modal-title');

let recipeBuilderIngredients = [];

function setCustomModalMode(mode) {
    if (mode === 'food') {
        tabModeFood.className = "flex-1 py-2 text-xs font-bold rounded-xl bg-blue-600 text-white transition";
        tabModeRecipe.className = "flex-1 py-2 text-xs font-bold rounded-xl text-slate-400 hover:text-white transition";
        customFoodForm.classList.remove('hidden');
        customRecipeContainer.classList.add('hidden');
        customModalTitle.textContent = "Add Custom Food";
    } else {
        tabModeRecipe.className = "flex-1 py-2 text-xs font-bold rounded-xl bg-emerald-600 text-white transition";
        tabModeFood.className = "flex-1 py-2 text-xs font-bold rounded-xl text-slate-400 hover:text-white transition";
        customFoodForm.classList.add('hidden');
        customRecipeContainer.classList.remove('hidden');
        customModalTitle.textContent = "Create Recipe Group";
        populateIngredientPicker();
        renderRecipeBuilderList();
    }
}

if (tabModeFood) bindClick(tabModeFood, () => setCustomModalMode('food'));
if (tabModeRecipe) bindClick(tabModeRecipe, () => setCustomModalMode('recipe'));

function openCustomFoodModal(itemToEdit = null, isRecipe = false) {
    cancelClose(customFoodModal);
    customFoodForm.reset();
    document.getElementById('custom-type-tabs').classList.remove('hidden');

    if (recipeFoodDropdown) recipeFoodDropdown.classList.add('hidden');

    if (itemToEdit && isRecipe) {
        setCustomModalMode('recipe');
        document.getElementById('custom-type-tabs').classList.add('hidden');
        customModalTitle.textContent = 'Edit Recipe Group';
        document.getElementById('custom-recipe-id').value = itemToEdit.id;
        document.getElementById('custom-recipe-name').value = itemToEdit.name;
        recipeBuilderIngredients = JSON.parse(JSON.stringify(itemToEdit.ingredients || []));
        renderRecipeBuilderList();
    } else if (itemToEdit && !isRecipe) {
        setCustomModalMode('food');
        document.getElementById('custom-type-tabs').classList.add('hidden');
        customModalTitle.textContent = 'Edit Food';
        document.getElementById('custom-food-id').value = itemToEdit.id;
        document.getElementById('custom-food-name').value = itemToEdit.name;
        document.getElementById('custom-food-serving').value = itemToEdit.serving;
        document.getElementById('custom-food-unit').value = itemToEdit.unit || 'g';
        document.getElementById('selected-unit-label').textContent = itemToEdit.unit ? `${itemToEdit.unit}` : 'grams (g)';
        document.getElementById('custom-food-cal').value = itemToEdit.cal;
        document.getElementById('custom-food-p').value = itemToEdit.p;
        document.getElementById('custom-food-c').value = itemToEdit.c;
        document.getElementById('custom-food-f').value = itemToEdit.f;
    } else {
        setCustomModalMode('food');
        document.getElementById('custom-food-id').value = '';
        document.getElementById('custom-food-serving').value = 100;
        document.getElementById('custom-food-unit').value = 'g';
        document.getElementById('selected-unit-label').textContent = 'grams (g)';
        document.getElementById('custom-food-cal').value = 0;
        document.getElementById('custom-food-p').value = 0;
        document.getElementById('custom-food-c').value = 0;
        document.getElementById('custom-food-f').value = 0;
        recipeBuilderIngredients = [];
        document.getElementById('custom-recipe-name').value = '';
        document.getElementById('custom-recipe-id').value = '';
        document.getElementById('selected-recipe-food-label').textContent = 'Choose ingredient...';
        document.getElementById('selected-recipe-food-label').classList.add('text-slate-400');
        document.getElementById('selected-recipe-food-label').classList.remove('text-white');
    }

    customFoodModal.classList.remove('hidden');
    reveal(customFoodModal, () => {
        customFoodModal.classList.remove('opacity-0', 'pointer-events-none');
    });
}

function closeCustomFoodModal() {
    cancelOpen(customFoodModal);
    selects.close();
    customFoodModal.classList.add('opacity-0', 'pointer-events-none');
    finishClose(customFoodModal, () => customFoodModal.classList.add('hidden'));
}

if (btnOpenAddFood) bindClick(btnOpenAddFood, () => openCustomFoodModal());
if (btnCloseCustomModal) bindClick(btnCloseCustomModal, closeCustomFoodModal);
if (btnCancelCustomFood) bindClick(btnCancelCustomFood, closeCustomFoodModal);
if (btnCancelCustomRecipe) bindClick(btnCancelCustomRecipe, closeCustomFoodModal);
if (customFoodBackdrop) bindClick(customFoodBackdrop, closeCustomFoodModal);

// Save Single Food
listen(customFoodForm, 'submit', (e) => {
    e.preventDefault();
    const foodId = document.getElementById('custom-food-id').value;
    const foodPayload = {
        id: foodId ? foodId : `custom_${Date.now()}`,
        name: document.getElementById('custom-food-name').value.trim(),
        serving: parseFloat(document.getElementById('custom-food-serving').value) || 100,
        unit: document.getElementById('custom-food-unit').value,
        cal: Math.round(parseFloat(document.getElementById('custom-food-cal').value) || 0),
        p: Math.round(parseFloat(document.getElementById('custom-food-p').value) || 0),
        c: Math.round(parseFloat(document.getElementById('custom-food-c').value) || 0),
        f: Math.round(parseFloat(document.getElementById('custom-food-f').value) || 0)
    };

    store.update(draft => {
        if (foodId) {
            const index = draft.foodDatabase.findIndex(f => String(f.id) === String(foodId));
            if (index !== -1) draft.foodDatabase[index] = foodPayload;
        } else {
            draft.foodDatabase.unshift(foodPayload);
        }
    });

    closeCustomFoodModal();
});

// Custom Dropdowns Engine for Food Units
const btnUnitTrigger = document.getElementById('btn-custom-unit-trigger');
const customFoodUnitHidden = document.getElementById('custom-food-unit');
const selectedUnitLabel = document.getElementById('selected-unit-label');

selects.register(btnUnitTrigger, {
    options: UNITS, getValue: () => customFoodUnitHidden.value,
    onChange: value => {
        customFoodUnitHidden.value = value;
        selectedUnitLabel.textContent = UNITS.find(unit => unit.value === value).label;
    }, label: 'Database serving unit'
});

// Recipe Builder Dropdown
const btnRecipeFoodTrigger = document.getElementById('btn-recipe-food-trigger');
const recipeFoodDropdown = document.getElementById('recipe-food-dropdown');
const recipeFoodDropdownList = document.getElementById('recipe-food-dropdown-list');
const recipeSelectedFoodId = document.getElementById('recipe-selected-food-id');
const selectedRecipeFoodLabel = document.getElementById('selected-recipe-food-label');

function populateIngredientPicker() {
    if (!recipeFoodDropdownList) return;
    const db = store.get().foodDatabase || [];

    if (db.length === 0) {
        recipeFoodDropdownList.innerHTML = `<div class="p-3 text-xs text-slate-500 italic text-center">No foods in database.</div>`;
        return;
    }

    recipeFoodDropdownList.innerHTML = db.map(f => `
        <button type="button" data-id="${f.id}" data-name="${f.name}" class="recipe-food-opt w-full text-left px-4 py-2 hover:bg-slate-700/60 transition border-b border-slate-700/40 last:border-0 flex justify-between items-center">
            <span class="text-xs font-bold text-slate-200 truncate">${f.name}</span>
            <span class="text-[11px] text-slate-400 ml-2 whitespace-nowrap">${f.cal} kcal (${f.serving}${f.unit || 'g'})</span>
        </button>
    `).join('');
}

if (btnRecipeFoodTrigger) {
    bindClick(btnRecipeFoodTrigger, (e) => {
        e.stopPropagation();
        populateIngredientPicker();
        recipeFoodDropdown.classList.toggle('hidden');
    });

    bindClick(recipeFoodDropdown, (e) => {
        const opt = e.target.closest('.recipe-food-opt');
        if (!opt) return;
        recipeSelectedFoodId.value = opt.getAttribute('data-id');
        selectedRecipeFoodLabel.textContent = opt.getAttribute('data-name');
        selectedRecipeFoodLabel.classList.remove('text-slate-400');
        selectedRecipeFoodLabel.classList.add('text-white');
        recipeFoodDropdown.classList.add('hidden');
    });
}

function dismissDropdowns(e) {
    if (e.cancelBubble) return;
    if (recipeFoodDropdown) recipeFoodDropdown.classList.add('hidden');
    const tunerDrop = document.getElementById('tuner-food-dropdown');
    if (tunerDrop) tunerDrop.classList.add('hidden');
}

// Recipe Builder Logic
const btnAddIngToRecipe = document.getElementById('btn-add-ing-to-recipe');
if (btnAddIngToRecipe) {
    bindClick(btnAddIngToRecipe, () => {
        const selectedId = recipeSelectedFoodId.value;
        const food = store.get().foodDatabase.find(f => String(f.id) === String(selectedId));
        if (!food) return;

        recipeBuilderIngredients.push({
            id: food.id,
            name: food.name,
            amount: food.serving,
            unit: food.unit || 'g',
            cal: food.cal,
            p: food.p,
            c: food.c,
            f: food.f,
            baseServing: food.serving,
            baseUnit: food.unit || 'g'
        });
        renderRecipeBuilderList();
    });
}

function registerIngredientUnits(root, ingredients, attribute, refresh) {
    for (const button of root.querySelectorAll(`[${attribute}]`)) {
        const item = ingredients[Number(button.getAttribute(attribute))];
        selects.register(button, {
            options: unitOptions(item),
            getValue: () => item.activeUnit || item.unit || item.baseUnit || 'g',
            onChange: value => {
                const previous = item.activeUnit || item.unit || item.baseUnit || 'g';
                item.amount = convertAmount(item, item.amount, previous === 'serving' && item.baseUnit !== 'serving' ? 'portion' : previous, value);
                item.unit = value;
                item.activeUnit = value;
                button.textContent = value === 'portion' ? 'serving' : value;
                button.closest('.flex')?.querySelector('input')?.setAttribute('value', item.amount);
                const input = button.parentElement.querySelector('input');
                if (input) input.value = Number(item.amount.toFixed(4));
                refresh();
            }, label: 'Meal ingredient unit'
        });
    }
}

function calculateBuilderTotals() {
    let tCal = 0, tP = 0, tC = 0, tF = 0;
    recipeBuilderIngredients.forEach(item => {
        const ratio = ingredientFactor(item);
        tCal += item.cal * ratio;
        tP += item.p * ratio;
        tC += item.c * ratio;
        tF += item.f * ratio;
    });
    const totalDisplay = document.getElementById('recipe-builder-total-display');
    if (totalDisplay) {
        totalDisplay.textContent = `${Math.round(tCal)} kcal • ${Math.round(tP)}P ${Math.round(tC)}C ${Math.round(tF)}F`;
    }
}

function renderRecipeBuilderList() {
    const list = document.getElementById('recipe-builder-ingredients');
    if (!list) return;

    if (recipeBuilderIngredients.length === 0) {
        list.innerHTML = `<div class="text-xs text-slate-500 italic p-3 text-center bg-slate-950 rounded-xl">No ingredients added yet.</div>`;
        calculateBuilderTotals();
        return;
    }

    list.innerHTML = recipeBuilderIngredients.map((item, idx) => `
        <div class="flex items-center justify-between p-2.5 bg-slate-950 rounded-xl border border-slate-800 text-xs">
            <span class="font-bold text-slate-200 truncate flex-1">${item.name}</span>
            <div class="flex items-center gap-2">
                <input type="number" step="any" value="${item.amount}" data-builder-idx="${idx}" class="builder-ing-input w-16 bg-slate-900 border border-slate-700 rounded-lg py-1 text-center font-bold text-white focus:outline-none">
                <button type="button" class="builder-unit select-trigger" data-builder-unit="${idx}">${escapeAttribute(item.unit === 'portion' ? 'serving' : item.unit)}</button>
                <button type="button" data-action="remove-builder-ingredient" data-id="${idx}" class="text-slate-500 hover:text-rose-400 p-1">✕</button>
            </div>
        </div>
    `).join('');

    registerIngredientUnits(list, recipeBuilderIngredients, 'data-builder-unit', calculateBuilderTotals);
    calculateBuilderTotals();
}

const recipeBuilderIngredientsContainer = document.getElementById('recipe-builder-ingredients');
if (recipeBuilderIngredientsContainer) {
    listen(recipeBuilderIngredientsContainer, 'input', (e) => {
        const input = e.target.closest('.builder-ing-input');
        if (!input) return;
        const idx = parseInt(input.getAttribute('data-builder-idx'), 10);
        if (recipeBuilderIngredients[idx]) {
            recipeBuilderIngredients[idx].amount = parseFloat(input.value) || 0;
            calculateBuilderTotals();
        }
    });
}

function removeBuilderIng(idx) {
    recipeBuilderIngredients.splice(idx, 1);
    renderRecipeBuilderList();
};

const btnSaveCustomRecipe = document.getElementById('btn-save-custom-recipe');
if (btnSaveCustomRecipe) {
    bindClick(btnSaveCustomRecipe, () => {
        const name = document.getElementById('custom-recipe-name').value.trim();
        const editId = document.getElementById('custom-recipe-id').value;
        if (!name) return alert("Please enter a recipe name.");
        if (recipeBuilderIngredients.length === 0) return alert("Please add at least one ingredient.");

        store.update(draft => {
            if (editId) {
                const idx = draft.recipes.findIndex(r => String(r.id) === String(editId));
                if (idx !== -1) {
                    draft.recipes[idx].name = name;
                    draft.recipes[idx].ingredients = [...recipeBuilderIngredients];
                }
            } else {
                const recipePayload = {
                    id: `rec_${Date.now()}`,
                    name: name,
                    pinned: true,
                    ingredients: [...recipeBuilderIngredients]
                };
                draft.recipes.push(recipePayload);
            }
        });

        closeCustomFoodModal();
    });
}

// 12. Database List View
const dbListContainer = document.getElementById('database-list-container');
const dbFilterInput = document.getElementById('db-filter-input');
const dbCategoryTabs = document.getElementById('db-category-tabs');

if (dbCategoryTabs) {
    bindClick(dbCategoryTabs, (e) => {
        const btn = e.target.closest('.db-tab-btn');
        if (!btn) return;
        currentDbFilterTab = btn.getAttribute('data-filter');
        document.querySelectorAll('.db-tab-btn').forEach(b => {
            b.className = b === btn
                ? 'db-tab-btn flex-1 py-2 text-xs font-bold rounded-xl bg-slate-800 text-white transition'
                : 'db-tab-btn flex-1 py-2 text-xs font-bold rounded-xl text-slate-400 hover:text-white transition';
        });
        renderDatabaseView(dbFilterInput?.value || '');
    });
}

function renderDatabaseView(filterQuery = '') {
    if (!dbListContainer) return;
    const q = filterQuery.toLowerCase().trim();
    const state = store.get();
    const foods = (state.foodDatabase || []).map(f => ({ ...f, type: 'food' }));
    const recipes = (state.recipes || []).map(r => ({ ...r, type: 'recipe' }));

    let combined = [];
    if (currentDbFilterTab === 'all') combined = [...recipes, ...foods];
    else if (currentDbFilterTab === 'foods') combined = foods;
    else if (currentDbFilterTab === 'recipes') combined = recipes;

    const filtered = combined.filter(item => item.name.toLowerCase().includes(q));

    if (filtered.length === 0) {
        dbListContainer.innerHTML = `<div class="bg-slate-900 p-6 rounded-2xl border border-slate-800 text-center text-slate-500 text-sm italic">No matching items found.</div>`;
        return;
    }

    dbListContainer.innerHTML = filtered.map(item => {
        if (item.type === 'recipe') {
            let rCal = 0, rP = 0, rC = 0, rF = 0;
            (item.ingredients || []).forEach(ing => {
                const ratio = ingredientFactor(ing);
                rCal += ing.cal * ratio;
                rP += ing.p * ratio;
                rC += ing.c * ratio;
                rF += ing.f * ratio;
            });
            const isPinned = item.pinned !== false;

            return `
                <div class="bg-slate-900 p-4 rounded-2xl border border-white/[0.05] flex items-center justify-between transition hover:border-slate-700">
                    <div>
                        <div class="font-bold text-slate-100 text-sm flex items-center gap-2">
                            ${item.name}
                            <span class="text-[9px] uppercase tracking-wider bg-emerald-950/60 text-emerald-400 border border-emerald-800/40 px-2 py-0.5 rounded-full font-bold">Meal</span>
                        </div>
                        <div class="text-xs text-slate-400 mt-0.5 tabular-nums">${item.ingredients.length} items • ${Math.round(rCal)} kcal • ${Math.round(rP)}P / ${Math.round(rC)}C / ${Math.round(rF)}F</div>
                    </div>
                    <div class="flex items-center gap-2">
                        <button data-action="pin" data-id="${item.id}" class="p-2 ${isPinned ? 'bg-amber-950/60 text-amber-400 border border-amber-800/40' : 'bg-slate-800 text-slate-500 hover:text-white'} text-xs rounded-xl transition active:scale-95" title="${isPinned ? 'Pinned to Pills' : 'Pin to Pills'}">
                            📌
                        </button>
                        <button data-action="edit-recipe" data-id="${item.id}" class="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs rounded-xl transition active:scale-95" title="Edit Recipe">
                            <svg class="w-3.5 h-3.5 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                        </button>
                        <button data-action="delete-recipe" data-id="${item.id}" class="p-2 bg-slate-800 hover:bg-rose-950/60 text-slate-400 hover:text-rose-400 text-xs rounded-xl transition active:scale-95" title="Delete">
                            <svg class="w-3.5 h-3.5 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                        </button>
                        <button data-action="log-recipe" data-id="${item.id}" class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl transition active:scale-[0.97]">
                            Tune & Log
                        </button>
                    </div>
                </div>
            `;
        }

        return `
            <div class="bg-slate-900 p-4 rounded-2xl border border-white/[0.05] flex items-center justify-between transition hover:border-slate-700">
                <div>
                    <div class="font-bold text-slate-200 text-sm">${item.name}</div>
                    <div class="text-xs text-slate-400 mt-0.5 tabular-nums">${item.cal} kcal • ${item.p}P / ${item.c}C / ${item.f}F <span class="text-slate-600 ml-1">(per ${item.serving}${item.unit || 'g'})</span></div>
                </div>
                <div class="flex items-center gap-2">
                    <button data-action="edit-food" data-id="${item.id}" class="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs rounded-xl transition active:scale-95" title="Edit">
                        <svg class="w-3.5 h-3.5 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                    </button>
                    <button data-action="delete-food" data-id="${item.id}" class="p-2 bg-slate-800 hover:bg-rose-950/60 text-slate-400 hover:text-rose-400 text-xs rounded-xl transition active:scale-95" title="Delete">
                        <svg class="w-3.5 h-3.5 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                    </button>
                    <button data-action="log-food" data-id="${item.id}" class="px-3 py-1.5 bg-slate-800 hover:bg-blue-600 text-slate-300 hover:text-white text-xs font-bold rounded-xl transition active:scale-[0.97]">
                        Log
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

function databaseAction(e) {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        const action = btn.getAttribute('data-action');
        const id = btn.getAttribute('data-id');

        if (action === 'edit-food') {
            const food = store.get().foodDatabase.find(f => String(f.id) === String(id));
            if (food) openCustomFoodModal(food, false);
        } else if (action === 'delete-food') {
            const food = store.get().foodDatabase.find(f => String(f.id) === String(id));
            if (food && confirm(`Delete "${food.name}" from your database?`)) {
                store.update(draft => { draft.foodDatabase = draft.foodDatabase.filter(f => String(f.id) !== String(id)); });

            }
        } else if (action === 'log-food') {
            const food = store.get().foodDatabase.find(f => String(f.id) === String(id));
            if (food) {
                switchView('view-home');
                openModal(food);
            }
        } else if (action === 'pin') {
            const rec = store.get().recipes.find(r => String(r.id) === String(id));
            if (rec) {
                store.update(draft => {
                    const recipe = draft.recipes.find(r => String(r.id) === String(id));
                    recipe.pinned = recipe.pinned === false;
                });

            }
        } else if (action === 'edit-recipe') {
            const rec = store.get().recipes.find(r => String(r.id) === String(id));
            if (rec) openCustomFoodModal(rec, true);
        } else if (action === 'delete-recipe') {
            const rec = store.get().recipes.find(r => String(r.id) === String(id));
            if (rec && confirm(`Delete recipe "${rec.name}"?`)) {
                store.update(draft => { draft.recipes = draft.recipes.filter(r => String(r.id) !== String(id)); });

            }
        } else if (action === 'log-recipe') {
            const rec = store.get().recipes.find(r => String(r.id) === String(id));
            if (rec) openRecipeModal(rec);
        }
}

if (dbFilterInput) {
    listen(dbFilterInput, 'input', (e) => renderDatabaseView(e.target.value));
}

// 13. Tunable Meal Group / Recipe Sheet Engine
let activeRecipe = null;
let activeRecipeLogEntryId = null;
const recipeModal = document.getElementById('recipe-modal');
const recipeModalContent = document.getElementById('recipe-modal-content');
const recipeIngredientsList = document.getElementById('recipe-ingredients-list');
const recipeModalName = document.getElementById('recipe-modal-name');
const recipeTotalCal = document.getElementById('recipe-total-cal');
const recipeTotalMacros = document.getElementById('recipe-total-macros');
const btnCancelRecipe = document.getElementById('btn-cancel-recipe');
const btnConfirmRecipe = document.getElementById('btn-confirm-recipe');
const recipeBackdrop = document.getElementById('recipe-backdrop');

const btnTunerAddTrigger = document.getElementById('btn-tuner-add-trigger');
const tunerFoodDropdown = document.getElementById('tuner-food-dropdown');
const tunerFoodDropdownList = document.getElementById('tuner-food-dropdown-list');

function openRecipeModal(recipe, existingLogEntryId = null) {
    cancelClose(recipeModal);
    activeRecipe = JSON.parse(JSON.stringify(recipe));
    activeRecipeLogEntryId = existingLogEntryId;
    activeRecipeDate = getLocalDateString();
    recipeModalName.textContent = activeRecipe.name;
    btnConfirmRecipe.textContent = existingLogEntryId ? 'Update Meal Log' : 'Log Meal Group';
    if (tunerFoodDropdown) tunerFoodDropdown.classList.add('hidden');

    renderRecipeIngredients();

    recipeModal.classList.remove('hidden');
    reveal(recipeModal, () => {
        recipeModal.classList.remove('opacity-0', 'pointer-events-none');
        if (recipeModalContent) recipeModalContent.classList.remove('translate-y-full');
    });
}

function closeRecipeModal() {
    cancelOpen(recipeModal);
    selects.close();
    recipeModal.classList.add('opacity-0', 'pointer-events-none');
    if (recipeModalContent) recipeModalContent.classList.add('translate-y-full');
    activeRecipe = null;
    activeRecipeLogEntryId = null;
    finishClose(recipeModal, () => recipeModal.classList.add('hidden'));
}

function updateRecipeTotals() {
    if (!activeRecipe) return;
    let tCal = 0, tP = 0, tC = 0, tF = 0;

    activeRecipe.ingredients.forEach(item => {
        const unit = item.activeUnit || item.baseUnit || item.unit || 'g';
        const ratio = ingredientFactor(item);

        tCal += item.cal * ratio;
        tP += item.p * ratio;
        tC += item.c * ratio;
        tF += item.f * ratio;
    });

    recipeTotalCal.textContent = `${Math.round(tCal)} kcal`;
    recipeTotalMacros.textContent = `${Math.round(tP)}P • ${Math.round(tC)}C • ${Math.round(tF)}F`;
}

function renderRecipeIngredients() {
    recipeIngredientsList.innerHTML = activeRecipe.ingredients.map((item, idx) => {
        const baseUnit = item.baseUnit || item.unit || 'g';
        const currentUnit = item.activeUnit || item.unit || baseUnit;

        return `
            <div class="bg-slate-950/80 p-3 rounded-2xl border border-white/[0.05] flex items-center justify-between gap-3">
                <div class="flex-1 min-w-0">
                    <div class="font-bold text-white text-sm truncate">${item.name}</div>
                    <div class="text-[11px] text-slate-500 tabular-nums">${item.cal} kcal / ${item.baseServing}${baseUnit}</div>
                </div>
                <div class="flex items-center gap-2">
                    <input type="number" step="any" value="${item.amount}" data-tuner-idx="${idx}" class="recipe-tuner-input w-20 bg-slate-900 border border-slate-700 rounded-xl py-1.5 text-center text-sm font-bold text-white tabular-nums focus:outline-none focus:border-blue-500">

                    <button type="button" data-ingredient-idx="${idx}" class="recipe-ing-unit select-trigger">${escapeAttribute(currentUnit === 'portion' ? 'serving' : currentUnit)}</button>

                    <button type="button" data-action="remove-tuner-ingredient" data-id="${idx}" class="p-1 text-slate-500 hover:text-rose-400 transition" title="Remove from this meal">
                        ✕
                    </button>
                </div>
            </div>
        `;
    }).join('');

    registerIngredientUnits(recipeIngredientsList, activeRecipe.ingredients, 'data-ingredient-idx', updateRecipeTotals);
    updateRecipeTotals();
}

// Focus-preserving input listener for Recipe Tuner
if (recipeIngredientsList) {
    listen(recipeIngredientsList, 'input', (e) => {
        const input = e.target.closest('.recipe-tuner-input');
        if (!input || !activeRecipe) return;
        const idx = parseInt(input.getAttribute('data-tuner-idx'), 10);
        if (activeRecipe.ingredients[idx]) {
            activeRecipe.ingredients[idx].amount = parseFloat(input.value) || 0;
            updateRecipeTotals(); // Live update text without rebuilding DOM elements!
        }
    });

}

function removeTunerIngredient(idx) {
    if (!activeRecipe || !activeRecipe.ingredients[idx]) return;
    activeRecipe.ingredients.splice(idx, 1);
    renderRecipeIngredients();
};

if (btnTunerAddTrigger) {
    bindClick(btnTunerAddTrigger, (e) => {
        e.stopPropagation();
        const db = store.get().foodDatabase || [];
        if (!tunerFoodDropdownList) return;

        if (db.length === 0) {
            tunerFoodDropdownList.innerHTML = `<div class="p-3 text-xs text-slate-500 italic text-center">No foods in database.</div>`;
        } else {
            tunerFoodDropdownList.innerHTML = db.map(f => `
                <button type="button" data-id="${f.id}" class="tuner-add-food-opt w-full text-left px-4 py-2 hover:bg-slate-700/60 transition border-b border-slate-700/40 last:border-0 flex justify-between items-center text-xs">
                    <span class="font-bold text-slate-200 truncate">${f.name}</span>
                    <span class="text-slate-400 ml-2 whitespace-nowrap">${f.cal} kcal (${f.serving}${f.unit || 'g'})</span>
                </button>
            `).join('');
        }
        tunerFoodDropdown.classList.toggle('hidden');
    });
}

if (tunerFoodDropdownList) {
    bindClick(tunerFoodDropdownList, (e) => {
        const btn = e.target.closest('.tuner-add-food-opt');
        if (!btn || !activeRecipe) return;
        const id = btn.getAttribute('data-id');
        const food = store.get().foodDatabase.find(f => String(f.id) === String(id));
        if (food) {
            activeRecipe.ingredients.push({
                id: food.id,
                name: food.name,
                amount: food.serving,
                unit: food.unit || 'g',
                cal: food.cal,
                p: food.p,
                c: food.c,
                f: food.f,
                baseServing: food.serving,
                baseUnit: food.unit || 'g'
            });
            renderRecipeIngredients();
        }
        tunerFoodDropdown.classList.add('hidden');
    });
}

if (btnCancelRecipe) bindClick(btnCancelRecipe, closeRecipeModal);
if (recipeBackdrop) bindClick(recipeBackdrop, closeRecipeModal);

if (btnConfirmRecipe) {
    bindClick(btnConfirmRecipe, () => {
        if (!activeRecipe) return;
        if (activeRecipeLogEntryId && activeRecipeDate !== getLocalDateString()) { closeRecipeModal(); renderDailyBrief(); return; }
        const today = getLocalDateString();
        const monthKey = today.substring(0, 7);
        const timeNow = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

        store.update(draft => {
            if (!draft.logs[monthKey]) draft.logs[monthKey] = {};
            if (!draft.logs[monthKey][today]) {
                draft.logs[monthKey][today] = { date: today, totals: { cal: 0, p: 0, c: 0, f: 0 }, diary: [] };
            }

            const dayLog = draft.logs[monthKey][today];
            let totalCal = 0, totalP = 0, totalC = 0, totalF = 0;
            const nestedItems = [];

            activeRecipe.ingredients.forEach(item => {
                if (item.amount <= 0) return;
                const unit = item.activeUnit || item.baseUnit || item.unit || 'g';
                const ratio = ingredientFactor(item);

                const cal = Math.round(item.cal * ratio);
                const p = Math.round(item.p * ratio);
                const c = Math.round(item.c * ratio);
                const f = Math.round(item.f * ratio);

                totalCal += cal;
                totalP += p;
                totalC += c;
                totalF += f;

                nestedItems.push({
                    id: item.id,
                    name: item.name,
                    amount: item.amount,
                    unit: unit === 'portion' ? 'serving' : unit,
                    cal, p, c, f
                });
            });

            if (activeRecipeLogEntryId) {
                const idx = dayLog.diary.findIndex(e => String(e.id) === String(activeRecipeLogEntryId));
                if (idx !== -1) {
                    const old = dayLog.diary[idx];
                    dayLog.totals.cal -= old.cal;
                    dayLog.totals.p -= old.p;
                    dayLog.totals.c -= old.c;
                    dayLog.totals.f -= old.f;

                    old.items = nestedItems;
                    old.cal = totalCal;
                    old.p = totalP;
                    old.c = totalC;
                    old.f = totalF;

                    dayLog.totals.cal += totalCal;
                    dayLog.totals.p += totalP;
                    dayLog.totals.c += totalC;
                    dayLog.totals.f += totalF;
                }
            } else {
                const groupEntry = {
                    id: `grp_${Date.now()}`,
                    timestamp: timeNow,
                    name: activeRecipe.name,
                    isGroup: true,
                    items: nestedItems,
                    cal: totalCal,
                    p: totalP,
                    c: totalC,
                    f: totalF
                };
                dayLog.diary.push(groupEntry);
                dayLog.totals.cal += totalCal;
                dayLog.totals.p += totalP;
                dayLog.totals.c += totalC;
                dayLog.totals.f += totalF;
            }
        });

        closeRecipeModal();
    });
}

const router = createRouter({
    ui: ({ event, element }) => clickHandlers.get(element)?.(event),
    'toggle-group': ({ id }) => toggleGroupAccordion(id),
    'edit-diary-entry': ({ id }) => editDiaryEntry(id),
    'delete-diary-entry': ({ id }) => deleteDiaryEntry(id),
    'remove-builder-ingredient': ({ id }) => removeBuilderIng(Number(id)),
    'remove-tuner-ingredient': ({ id }) => removeTunerIngredient(Number(id)),
    ...Object.fromEntries(['edit-food', 'delete-food', 'log-food', 'pin', 'edit-recipe', 'delete-recipe', 'log-recipe']
        .map(action => [action, ({ event }) => databaseAction(event)]))
}, { afterDispatch: event => { dismissSearch(event); dismissDropdowns(event); } });

let lastRenderedState = store.get();
const unsubscribe = store.subscribe(state => {
    const recipesChanged = JSON.stringify(state.recipes) !== JSON.stringify(lastRenderedState.recipes);
    const foodsChanged = JSON.stringify(state.foodDatabase) !== JSON.stringify(lastRenderedState.foodDatabase);
    const day = getLocalDateString();
    const previousDay = lastRenderedState.logs[day.slice(0, 7)]?.[day];
    const nextDay = state.logs[day.slice(0, 7)]?.[day];
    if (recipesChanged) renderPredictivePills();
    if (JSON.stringify(previousDay) !== JSON.stringify(nextDay) || JSON.stringify(state.targets) !== JSON.stringify(lastRenderedState.targets)) renderDailyBrief();
    if ((recipesChanged || foodsChanged) && !document.getElementById('view-database').classList.contains('hidden')) renderDatabaseView(dbFilterInput?.value || '');
    lastRenderedState = state;
});

const stopDayWatcher = watchLocalDay(() => {
    // An edit opened yesterday must never silently target today's diary.
    if (activeDiaryEntryId) closeModal();
    if (activeRecipeLogEntryId) closeRecipeModal();
    renderDailyBrief();
});

listen(globalThis, 'account-changing', () => {
    cancelSearch(); selects.close(); closeModal(); closeRecipeModal(); closeCustomFoodModal();
    void stopScanner().catch(error => console.error(error));
});
void initializeAccount(bindClick, lifetime.signal, selects);

// 14. Initial App Boot
renderPredictivePills();
renderDailyBrief();
listen(globalThis, 'pagehide', event => {
    cancelSearch();
    void stopScanner().catch(error => console.error('Scanner teardown failed:', error));
    if (!event.persisted) {
        stopDayWatcher();
        selects.close();
        unsubscribe();
        router.destroy();
        lifetime.abort();
        for (const timer of timers) clearTimeout(timer);
        timers.clear();
        for (const root of openingFrames.keys()) cancelOpen(root);
    }
});

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js', { updateViaCache: 'none' })
        .catch(error => console.error('Offline app shell unavailable:', error));
}
