import { appState, loadLocalState, saveLocalState } from './state.js';
import { searchExternalDatabase } from './usda.js'; 

// 1. Reliable Local Date Helper
function getLocalDateString() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// 2. Initialize App State & Recipes
loadLocalState();

if (!appState.recipes) {
    appState.recipes = [
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
    saveLocalState();
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
const modalUnitDropdown = document.getElementById('modal-unit-dropdown');
const modalUnitDropdownList = document.getElementById('modal-unit-dropdown-list');
const modalUnitScaleValue = document.getElementById('modal-unit-scale-value');
const modalUnitLabelValue = document.getElementById('modal-unit-label-value');

let activeFoodToLog = null; 
let activeDiaryEntryId = null; 
let currentDashboardView = 'rings'; 
let currentDbFilterTab = 'all';

// 4. Fuzzy Search
function fuzzyMatch(foodName, query) {
    const nameLower = foodName.toLowerCase();
    const queryTerms = query.toLowerCase().trim().split(/\s+/);
    return queryTerms.every(term => nameLower.includes(term));
}

// 5. Single Food Logging Modal
function openModal(food, existingEntryId = null) {
    activeFoodToLog = food;
    activeDiaryEntryId = existingEntryId;
    modalName.textContent = food.name;
    const baseUnit = food.unit || 'g';
    modalBase.textContent = `${food.serving}${baseUnit}`;
    
    modalInput.value = 1;
    modalUnitDropdown.classList.add('hidden');

    const unitOptions = [
        { label: `1 serving (${food.serving}${baseUnit})`, scale: 1, unitText: `serving (${food.serving}${baseUnit})` },
        { label: `1 ${baseUnit}`, scale: 1 / food.serving, unitText: baseUnit }
    ];

    if (baseUnit === 'g') {
        unitOptions.push({ label: `1 oz (28.35g)`, scale: 28.35 / food.serving, unitText: 'oz' });
        unitOptions.push({ label: `1 lb (453.6g)`, scale: 453.6 / food.serving, unitText: 'lb' });
        unitOptions.push({ label: `100g standard`, scale: 100 / food.serving, unitText: '100g' });
    } else if (baseUnit === 'oz') {
        unitOptions.push({ label: `1 g`, scale: (1 / 28.35) / food.serving, unitText: 'g' });
        unitOptions.push({ label: `1 lb (16 oz)`, scale: 16 / food.serving, unitText: 'lb' });
    } else if (baseUnit === 'ml') {
        unitOptions.push({ label: `1 cup (240ml)`, scale: 240 / food.serving, unitText: 'cup' });
        unitOptions.push({ label: `1 tbsp (15ml)`, scale: 15 / food.serving, unitText: 'tbsp' });
        unitOptions.push({ label: `1 tsp (5ml)`, scale: 5 / food.serving, unitText: 'tsp' });
        unitOptions.push({ label: `1 fl oz (29.57ml)`, scale: 29.57 / food.serving, unitText: 'fl oz' });
    }

    modalUnitDropdownList.innerHTML = unitOptions.map(opt => `
        <button type="button" data-scale="${opt.scale}" data-label="${opt.label}" data-unit="${opt.unitText}" class="modal-unit-opt w-full text-left px-4 py-2.5 text-xs text-slate-200 hover:bg-slate-700/60 transition border-b border-slate-700/40 last:border-0 font-medium">
            ${opt.label}
        </button>
    `).join('');

    modalUnitScaleValue.value = unitOptions[0].scale;
    modalUnitLabelValue.value = unitOptions[0].unitText;
    modalUnitTriggerLabel.textContent = unitOptions[0].label;

    btnConfirmLog.textContent = existingEntryId ? 'Save Changes' : 'Log to Diary';
    updateModalMacros();
    
    modal.classList.remove('hidden');
    requestAnimationFrame(() => {
        modal.classList.remove('opacity-0', 'pointer-events-none');
        modalContent.classList.remove('translate-y-full');
    });
}

function closeModal() {
    modal.classList.add('opacity-0', 'pointer-events-none');
    modalContent.classList.add('translate-y-full');
    setTimeout(() => {
        modal.classList.add('hidden');
        activeFoodToLog = null;
        activeDiaryEntryId = null;
    }, 300);
}

if (btnModalUnitTrigger) {
    btnModalUnitTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        modalUnitDropdown.classList.toggle('hidden');
    });
}

if (modalUnitDropdownList) {
    modalUnitDropdownList.addEventListener('click', (e) => {
        const btn = e.target.closest('.modal-unit-opt');
        if (!btn) return;
        modalUnitScaleValue.value = btn.getAttribute('data-scale');
        modalUnitLabelValue.value = btn.getAttribute('data-unit');
        modalUnitTriggerLabel.textContent = btn.getAttribute('data-label');
        modalUnitDropdown.classList.add('hidden');
        updateModalMacros();
    });
}

function updateModalMacros() {
    if (!activeFoodToLog) return;
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
    const servings = parseFloat(modalInput.value) || 0;
    const unitScale = parseFloat(modalUnitScaleValue.value) || 0;
    const totalScale = servings * unitScale;
    const selectedUnitText = modalUnitLabelValue.value;

    const today = getLocalDateString();
    const monthKey = today.substring(0, 7);

    if (!appState.logs[monthKey]) appState.logs[monthKey] = {};
    if (!appState.logs[monthKey][today]) {
        appState.logs[monthKey][today] = { date: today, totals: { cal: 0, p: 0, c: 0, f: 0 }, diary: [] };
    }

    const dayLog = appState.logs[monthKey][today];

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

    saveLocalState();
    closeModal();
    renderDailyBrief();
}

modalInput.addEventListener('input', updateModalMacros);
btnCancelLog.addEventListener('click', closeModal);
btnConfirmLog.addEventListener('click', logFoodToState);
document.getElementById('modal-backdrop').addEventListener('click', closeModal);

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
    
    btn.addEventListener('click', () => {
        openModal(food);
        searchInput.value = ''; 
        dropdown.classList.add('hidden');
        predictivePills.classList.remove('opacity-20');
        searchInput.blur(); 
    });

    return btn;
}

searchInput.addEventListener('input', async (e) => {
    const query = e.target.value;
    if (query.length === 0) {
        dropdown.classList.add('hidden');
        predictivePills.classList.remove('opacity-20');
        return;
    }

    predictivePills.classList.add('opacity-20');
    dropdown.classList.remove('hidden');

    const localMatches = appState.foodDatabase.filter(food => fuzzyMatch(food.name, query));
    resultsContainer.innerHTML = '';
    
    localMatches.slice(0, 3).forEach(food => {
        resultsContainer.appendChild(createFoodButton(food, false));
    });

    if (query.length >= 3) {
        const searchWebBtn = document.createElement('button');
        searchWebBtn.className = "w-full text-center px-5 py-4 text-sm font-bold text-blue-400 hover:text-blue-300 hover:bg-slate-700/30 transition";
        searchWebBtn.innerHTML = `Search global database for "${query}"...`;
        
        searchWebBtn.addEventListener('mousedown', async (ev) => {
            ev.preventDefault(); 
            // Skeleton Loader State
            resultsContainer.innerHTML = `
                <div class="p-4 space-y-3">
                    <div class="h-12 bg-slate-800/60 rounded-xl animate-pulse"></div>
                    <div class="h-12 bg-slate-800/60 rounded-xl animate-pulse"></div>
                </div>`;
            const externalResults = await searchExternalDatabase(query);
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

searchInput.addEventListener('focus', () => {
    if (searchInput.value.trim().length > 0 && resultsContainer.innerHTML !== '') {
        dropdown.classList.remove('hidden');
        predictivePills.classList.add('opacity-20');
    }
});

document.addEventListener('click', (e) => {
    if (!searchInput.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.classList.add('hidden');
        predictivePills.classList.remove('opacity-20');
    }
});

// 7. Pinned Recipe Pills (Quick Add)
function renderPredictivePills() {
    if (!predictivePills) return;
    const recipes = appState.recipes || [];
    const pinned = recipes.filter(r => r.pinned !== false);
    const displayList = pinned.length > 0 ? pinned : recipes.slice(0, 2);

    predictivePills.innerHTML = displayList.map(r => `
        <button data-recipe-id="${r.id}" class="px-5 py-2.5 rounded-2xl bg-slate-900 border border-white/[0.05] text-sm font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition shadow-sm flex items-center gap-1.5 active:scale-[0.97]">
            <span>+ ${r.name}</span>
        </button>
    `).join('');
}

if (predictivePills) {
    predictivePills.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-recipe-id]');
        if (!btn) return;
        const recId = btn.getAttribute('data-recipe-id');
        const rec = appState.recipes.find(r => r.id === recId);
        if (rec) openRecipeModal(rec);
    });
}

// 8. Render Dashboard & Chronological Log
function renderDailyBrief() {
    const today = getLocalDateString();
    const monthKey = today.substring(0, 7);
    const dayLog = appState.logs[monthKey]?.[today] || { totals: { cal: 0, p: 0, c: 0, f: 0 }, diary: [] };
    const targets = appState.targets;
    
    const dashboard = document.getElementById('macro-dashboard');
    const calDiff = targets.cal - dayLog.totals.cal;
    
    const pPct = Math.min((dayLog.totals.p / targets.p) * 100, 100) || 0;
    const cPct = Math.min((dayLog.totals.c / targets.c) * 100, 100) || 0;
    const fPct = Math.min((dayLog.totals.f / targets.f) * 100, 100) || 0;

    const headerHTML = `
        <div class="flex justify-between items-start mb-6">
            <div>
                <div class="text-sm font-bold text-slate-500 uppercase tracking-wider mb-1">Calories</div>
                <div class="text-4xl font-bold text-white tracking-tight tabular-nums">${dayLog.totals.cal} <span class="text-lg text-slate-500 font-normal">/ ${targets.cal}</span></div>
            </div>
            <div class="flex flex-col items-end gap-2">
                <button id="btn-toggle-view" class="p-2 bg-slate-800 rounded-xl text-slate-400 hover:text-white hover:bg-slate-700 transition active:scale-95" title="Toggle Rings / Bars / Hero Minimalist">
                    <svg class="w-4 h-4 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"></path></svg>
                </button>
                <div class="text-right">
                    <div class="text-sm font-bold tabular-nums ${calDiff >= 0 ? 'text-emerald-400' : 'text-rose-400'}">${Math.abs(calDiff)}</div>
                    <div class="text-[10px] text-slate-500 uppercase font-bold tracking-wider">${calDiff >= 0 ? 'Remaining' : 'Over'}</div>
                </div>
            </div>
        </div>
    `;

    let visualsHTML = '';

    if (currentDashboardView === 'rings') {
        const pCirc = 2 * Math.PI * 42; 
        const cCirc = 2 * Math.PI * 32;
        const fCirc = 2 * Math.PI * 22;

        visualsHTML = `
            <div class="flex flex-col items-center justify-center pt-2 pb-2">
                <div class="relative w-48 h-48 drop-shadow-xl">
                    <svg viewBox="0 0 100 100" class="w-full h-full transform -rotate-90">
                        <circle cx="50" cy="50" r="42" fill="transparent" stroke="#1e293b" stroke-width="7"></circle>
                        <circle cx="50" cy="50" r="32" fill="transparent" stroke="#1e293b" stroke-width="7"></circle>
                        <circle cx="50" cy="50" r="22" fill="transparent" stroke="#1e293b" stroke-width="7"></circle>
                        
                        <circle cx="50" cy="50" r="42" fill="transparent" stroke="#3b82f6" stroke-width="7" stroke-linecap="round" stroke-dasharray="${pCirc}" stroke-dashoffset="${pCirc - (pPct/100 * pCirc)}" class="transition-all duration-1000 ease-out" style="filter: drop-shadow(0 0 4px rgba(59,130,246,0.5));"></circle>
                        <circle cx="50" cy="50" r="32" fill="transparent" stroke="#10b981" stroke-width="7" stroke-linecap="round" stroke-dasharray="${cCirc}" stroke-dashoffset="${cCirc - (cPct/100 * cCirc)}" class="transition-all duration-1000 ease-out" style="filter: drop-shadow(0 0 4px rgba(16,185,129,0.5));"></circle>
                        <circle cx="50" cy="50" r="22" fill="transparent" stroke="#f43f5e" stroke-width="7" stroke-linecap="round" stroke-dasharray="${fCirc}" stroke-dashoffset="${fCirc - (fPct/100 * fCirc)}" class="transition-all duration-1000 ease-out" style="filter: drop-shadow(0 0 4px rgba(244,63,94,0.5));"></circle>
                    </svg>
                </div>
                <div class="flex justify-center gap-6 w-full border-t border-slate-800/50 pt-5 mt-6">
                    <div class="text-center">
                        <div class="text-[10px] font-bold text-slate-500 mb-1 uppercase tracking-widest flex items-center justify-center gap-1.5"><span class="w-2 h-2 rounded-full bg-blue-500"></span> Pro</div>
                        <div class="text-base font-bold text-slate-200 tabular-nums">${dayLog.totals.p}g <span class="text-xs text-slate-600 font-normal">/ ${targets.p}</span></div>
                    </div>
                    <div class="text-center">
                        <div class="text-[10px] font-bold text-slate-500 mb-1 uppercase tracking-widest flex items-center justify-center gap-1.5"><span class="w-2 h-2 rounded-full bg-emerald-500"></span> Carb</div>
                        <div class="text-base font-bold text-slate-200 tabular-nums">${dayLog.totals.c}g <span class="text-xs text-slate-600 font-normal">/ ${targets.c}</span></div>
                    </div>
                    <div class="text-center">
                        <div class="text-[10px] font-bold text-slate-500 mb-1 uppercase tracking-widest flex items-center justify-center gap-1.5"><span class="w-2 h-2 rounded-full bg-rose-500"></span> Fat</div>
                        <div class="text-base font-bold text-slate-200 tabular-nums">${dayLog.totals.f}g <span class="text-xs text-slate-600 font-normal">/ ${targets.f}</span></div>
                    </div>
                </div>
            </div>
        `;
    } else if (currentDashboardView === 'bars') {
        visualsHTML = `
            <div class="space-y-4">
                <div>
                    <div class="flex justify-between text-xs font-bold mb-1"><span class="text-blue-400">Protein</span><span class="text-slate-300 tabular-nums">${dayLog.totals.p}g / ${targets.p}g</span></div>
                    <div class="w-full bg-slate-800 rounded-full h-2 overflow-hidden"><div class="bg-blue-500 h-2 rounded-full transition-all duration-500 ease-out" style="width: ${pPct}%"></div></div>
                </div>
                <div>
                    <div class="flex justify-between text-xs font-bold mb-1"><span class="text-emerald-400">Carbs</span><span class="text-slate-300 tabular-nums">${dayLog.totals.c}g / ${targets.c}g</span></div>
                    <div class="w-full bg-slate-800 rounded-full h-2 overflow-hidden"><div class="bg-emerald-500 h-2 rounded-full transition-all duration-500 ease-out" style="width: ${cPct}%"></div></div>
                </div>
                <div>
                    <div class="flex justify-between text-xs font-bold mb-1"><span class="text-rose-400">Fat</span><span class="text-slate-300 tabular-nums">${dayLog.totals.f}g / ${targets.f}g</span></div>
                    <div class="w-full bg-slate-800 rounded-full h-2 overflow-hidden"><div class="bg-rose-500 h-2 rounded-full transition-all duration-500 ease-out" style="width: ${fPct}%"></div></div>
                </div>
            </div>
        `;
    } else {
        // HERO MINIMALIST VIEW: Sized up with prominent ratios
        visualsHTML = `
            <div class="py-2">
                <div class="grid grid-cols-3 gap-3">
                    <div class="bg-slate-950/70 border border-white/[0.05] rounded-2xl p-4 text-center shadow-inner">
                        <div class="text-[10px] font-bold uppercase tracking-widest text-blue-400 mb-1.5 flex items-center justify-center gap-1.5">
                            <span class="w-2 h-2 rounded-full bg-blue-500"></span> Pro
                        </div>
                        <div class="text-2xl font-extrabold text-white tracking-tight tabular-nums">${dayLog.totals.p}</div>
                        <div class="text-xs font-semibold text-slate-500 mt-0.5 tabular-nums">/ ${targets.p}g</div>
                    </div>
                    <div class="bg-slate-950/70 border border-white/[0.05] rounded-2xl p-4 text-center shadow-inner">
                        <div class="text-[10px] font-bold uppercase tracking-widest text-emerald-400 mb-1.5 flex items-center justify-center gap-1.5">
                            <span class="w-2 h-2 rounded-full bg-emerald-500"></span> Carb
                        </div>
                        <div class="text-2xl font-extrabold text-white tracking-tight tabular-nums">${dayLog.totals.c}</div>
                        <div class="text-xs font-semibold text-slate-500 mt-0.5 tabular-nums">/ ${targets.c}g</div>
                    </div>
                    <div class="bg-slate-950/70 border border-white/[0.05] rounded-2xl p-4 text-center shadow-inner">
                        <div class="text-[10px] font-bold uppercase tracking-widest text-rose-400 mb-1.5 flex items-center justify-center gap-1.5">
                            <span class="w-2 h-2 rounded-full bg-rose-500"></span> Fat
                        </div>
                        <div class="text-2xl font-extrabold text-white tracking-tight tabular-nums">${dayLog.totals.f}</div>
                        <div class="text-xs font-semibold text-slate-500 mt-0.5 tabular-nums">/ ${targets.f}g</div>
                    </div>
                </div>
            </div>
        `;
    }

    dashboard.innerHTML = headerHTML + visualsHTML;

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
                    <div class="p-4 flex items-center justify-between cursor-pointer select-none" onclick="toggleGroupAccordion('${entry.id}')">
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
                            <button onclick="event.stopPropagation(); editDiaryEntry('${entry.id}')" class="p-2 text-slate-500 hover:text-white hover:bg-slate-800 rounded-xl transition active:scale-95" title="Edit Meal">
                                <svg class="w-3.5 h-3.5 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                            </button>
                            <button onclick="event.stopPropagation(); deleteDiaryEntry('${entry.id}')" class="p-2 text-slate-500 hover:text-rose-400 hover:bg-slate-800 rounded-xl transition active:scale-95" title="Delete">
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
                    <button onclick="editDiaryEntry('${entry.id}')" class="p-2 text-slate-500 hover:text-white hover:bg-slate-800 rounded-xl transition active:scale-95" title="Edit Amount">
                        <svg class="w-3.5 h-3.5 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                    </button>
                    <button onclick="deleteDiaryEntry('${entry.id}')" class="p-2 text-slate-500 hover:text-rose-400 hover:bg-slate-800 rounded-xl transition active:scale-95" title="Delete">
                        <svg class="w-3.5 h-3.5 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

window.toggleGroupAccordion = function(id) {
    const drawer = document.getElementById(`drawer-${id}`);
    const chevron = document.getElementById(`chevron-${id}`);
    if (drawer) {
        drawer.classList.toggle('hidden');
        chevron.classList.toggle('rotate-90');
    }
};

window.deleteDiaryEntry = function(entryId) {
    const today = getLocalDateString();
    const monthKey = today.substring(0, 7);
    const dayLog = appState.logs[monthKey]?.[today];
    if (!dayLog) return;

    const idx = dayLog.diary.findIndex(e => String(e.id) === String(entryId));
    if (idx === -1) return;

    const item = dayLog.diary[idx];
    dayLog.totals.cal = Math.max(0, dayLog.totals.cal - item.cal);
    dayLog.totals.p = Math.max(0, dayLog.totals.p - item.p);
    dayLog.totals.c = Math.max(0, dayLog.totals.c - item.c);
    dayLog.totals.f = Math.max(0, dayLog.totals.f - item.f);
    
    dayLog.diary.splice(idx, 1);
    saveLocalState();
    renderDailyBrief();
};

window.editDiaryEntry = function(entryId) {
    const today = getLocalDateString();
    const monthKey = today.substring(0, 7);
    const dayLog = appState.logs[monthKey]?.[today];
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
                unit: it.unit,
                cal: it.cal,
                p: it.p,
                c: it.c,
                f: it.f,
                baseServing: it.amount,
                baseUnit: it.unit
            }))
        }, entry.id);
    } else {
        const food = appState.foodDatabase.find(f => String(f.id) === String(entry.foodId)) || {
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

document.getElementById('macro-dashboard').addEventListener('click', (e) => {
    if (e.target.closest('#btn-toggle-view')) {
        currentDashboardView = currentDashboardView === 'rings' ? 'bars' : currentDashboardView === 'bars' ? 'minimal' : 'rings';
        renderDailyBrief();
    }
});

document.addEventListener('visibilitychange', () => {
    if (!document.hidden) renderDailyBrief();
});

// 9. Barcode Scanner Engine
const btnScanBarcode = document.getElementById('btn-scan-barcode');
const scannerModal = document.getElementById('scanner-modal');
const btnCloseScanner = document.getElementById('btn-close-scanner');
const scannerStatus = document.getElementById('scanner-status');
let html5QrCode = null;
let isProcessingScan = false;

if (btnScanBarcode) {
    btnScanBarcode.addEventListener('click', (e) => {
        e.preventDefault(); 
        scannerModal.classList.remove('hidden');
        scannerStatus.innerHTML = "Requesting camera access...";
        isProcessingScan = false;
        
        setTimeout(async () => {
            try {
                if (!html5QrCode) {
                    const formats = window.Html5QrcodeSupportedFormats ? [ 
                        window.Html5QrcodeSupportedFormats.UPC_A,
                        window.Html5QrcodeSupportedFormats.UPC_E,
                        window.Html5QrcodeSupportedFormats.EAN_13,
                        window.Html5QrcodeSupportedFormats.EAN_8
                    ] : undefined;

                    html5QrCode = new Html5Qrcode("reader", formats ? { formatsToSupport: formats } : undefined);
                }
                
                if (html5QrCode.isScanning) {
                    await html5QrCode.stop();
                }

                await html5QrCode.start(
                    { facingMode: "environment" },
                    { fps: 15, qrbox: { width: 250, height: 150 } },
                    onScanSuccess,
                    (errorMessage) => { }
                );
                scannerStatus.innerHTML = "Position barcode in the center frame.";
            } catch (err) {
                scannerStatus.innerHTML = `<span class="text-rose-400">Camera access denied. Please allow permissions.</span>`;
                console.error(err);
            }
        }, 350);
    });
}

if (btnCloseScanner) btnCloseScanner.addEventListener('click', stopScanner);

async function stopScanner() {
    if (html5QrCode) {
        try { await html5QrCode.stop(); } catch (e) {}
    }
    scannerModal.classList.add('hidden');
    isProcessingScan = false;
}

async function onScanSuccess(decodedText) {
    if (isProcessingScan) return;
    isProcessingScan = true; 
    
    scannerStatus.innerHTML = `<span class="text-blue-400 font-bold animate-pulse">Found ${decodedText}... fetching nutrition!</span>`;
    
    try {
        let paddedText = decodedText.length === 12 ? '0' + decodedText : decodedText;

        let response = await fetch(`https://world.openfoodfacts.org/api/v0/product/${decodedText}.json`);
        let data = await response.json();
        
        if (data.status !== 1 && decodedText.length === 12) {
            response = await fetch(`https://world.openfoodfacts.org/api/v0/product/${paddedText}.json`);
            data = await response.json();
        }
        
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

        if (!appState.foodDatabase.some(f => f.id === scannedFood.id)) {
            appState.foodDatabase.push(scannedFood);
            saveLocalState();
        }

        await stopScanner();
        openModal(scannedFood);
        
    } catch (error) {
        console.error(error);
        scannerStatus.innerHTML = `<span class="text-rose-400 font-bold">Item not found in global database.</span>`;
        setTimeout(() => {
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
    drawerContainer.classList.remove('pointer-events-none');
    drawerBackdrop.classList.remove('opacity-0', 'pointer-events-none');
    drawerPanel.classList.remove('translate-x-full');
    drawerPanel.classList.add('translate-x-0');
}

function closeDrawer() {
    drawerBackdrop.classList.add('opacity-0', 'pointer-events-none');
    drawerPanel.classList.remove('translate-x-0');
    drawerPanel.classList.add('translate-x-full');
    setTimeout(() => drawerContainer.classList.add('pointer-events-none'), 300);
}

btnMenu.addEventListener('click', (e) => { e.stopPropagation(); openDrawer(); });
btnCloseDrawer.addEventListener('click', (e) => { e.stopPropagation(); closeDrawer(); });
drawerBackdrop.addEventListener('click', closeDrawer);

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
    item.addEventListener('click', () => {
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

if (tabModeFood) tabModeFood.addEventListener('click', () => setCustomModalMode('food'));
if (tabModeRecipe) tabModeRecipe.addEventListener('click', () => setCustomModalMode('recipe'));

function openCustomFoodModal(itemToEdit = null, isRecipe = false) {
    customFoodForm.reset();
    document.getElementById('custom-type-tabs').classList.remove('hidden');
    
    if (customUnitDropdown) customUnitDropdown.classList.add('hidden');
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
    requestAnimationFrame(() => {
        customFoodModal.classList.remove('opacity-0', 'pointer-events-none');
    });
}

function closeCustomFoodModal() {
    customFoodModal.classList.add('opacity-0', 'pointer-events-none');
    setTimeout(() => {
        customFoodModal.classList.add('hidden');
    }, 300);
}

if (btnOpenAddFood) btnOpenAddFood.addEventListener('click', () => openCustomFoodModal());
if (btnCloseCustomModal) btnCloseCustomModal.addEventListener('click', closeCustomFoodModal);
if (btnCancelCustomFood) btnCancelCustomFood.addEventListener('click', closeCustomFoodModal);
if (btnCancelCustomRecipe) btnCancelCustomRecipe.addEventListener('click', closeCustomFoodModal);
if (customFoodBackdrop) customFoodBackdrop.addEventListener('click', closeCustomFoodModal);

// Save Single Food
customFoodForm.addEventListener('submit', (e) => {
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

    if (foodId) {
        const index = appState.foodDatabase.findIndex(f => String(f.id) === String(foodId));
        if (index !== -1) appState.foodDatabase[index] = foodPayload;
    } else {
        appState.foodDatabase.unshift(foodPayload);
    }

    saveLocalState();
    closeCustomFoodModal();
    renderDatabaseView(document.getElementById('db-filter-input')?.value || '');
});

// Custom Dropdowns Engine for Food Units
const btnUnitTrigger = document.getElementById('btn-custom-unit-trigger');
const customUnitDropdown = document.getElementById('custom-unit-dropdown');
const customFoodUnitHidden = document.getElementById('custom-food-unit');
const selectedUnitLabel = document.getElementById('selected-unit-label');

if (btnUnitTrigger) {
    btnUnitTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        customUnitDropdown.classList.toggle('hidden');
    });

    customUnitDropdown.addEventListener('click', (e) => {
        const opt = e.target.closest('.unit-opt');
        if (!opt) return;
        customFoodUnitHidden.value = opt.getAttribute('data-val');
        selectedUnitLabel.textContent = opt.getAttribute('data-label');
        customUnitDropdown.classList.add('hidden');
    });
}

// Recipe Builder Dropdown
const btnRecipeFoodTrigger = document.getElementById('btn-recipe-food-trigger');
const recipeFoodDropdown = document.getElementById('recipe-food-dropdown');
const recipeFoodDropdownList = document.getElementById('recipe-food-dropdown-list');
const recipeSelectedFoodId = document.getElementById('recipe-selected-food-id');
const selectedRecipeFoodLabel = document.getElementById('selected-recipe-food-label');

function populateIngredientPicker() {
    if (!recipeFoodDropdownList) return;
    const db = appState.foodDatabase || [];
    
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
    btnRecipeFoodTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        populateIngredientPicker();
        recipeFoodDropdown.classList.toggle('hidden');
    });

    recipeFoodDropdown.addEventListener('click', (e) => {
        const opt = e.target.closest('.recipe-food-opt');
        if (!opt) return;
        recipeSelectedFoodId.value = opt.getAttribute('data-id');
        selectedRecipeFoodLabel.textContent = opt.getAttribute('data-name');
        selectedRecipeFoodLabel.classList.remove('text-slate-400');
        selectedRecipeFoodLabel.classList.add('text-white');
        recipeFoodDropdown.classList.add('hidden');
    });
}

document.addEventListener('click', () => {
    if (customUnitDropdown) customUnitDropdown.classList.add('hidden');
    if (recipeFoodDropdown) recipeFoodDropdown.classList.add('hidden');
    if (modalUnitDropdown) modalUnitDropdown.classList.add('hidden');
    const tunerDrop = document.getElementById('tuner-food-dropdown');
    if (tunerDrop) tunerDrop.classList.add('hidden');
});

// Recipe Builder Logic
const btnAddIngToRecipe = document.getElementById('btn-add-ing-to-recipe');
if (btnAddIngToRecipe) {
    btnAddIngToRecipe.addEventListener('click', () => {
        const selectedId = recipeSelectedFoodId.value;
        const food = appState.foodDatabase.find(f => String(f.id) === String(selectedId));
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

function calculateBuilderTotals() {
    let tCal = 0, tP = 0, tC = 0, tF = 0;
    recipeBuilderIngredients.forEach(item => {
        const ratio = (item.amount || 0) / (item.baseServing || 100);
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
                <span class="text-slate-400 w-5">${item.unit}</span>
                <button type="button" onclick="removeBuilderIng(${idx})" class="text-slate-500 hover:text-rose-400 p-1">✕</button>
            </div>
        </div>
    `).join('');

    calculateBuilderTotals();
}

const recipeBuilderIngredientsContainer = document.getElementById('recipe-builder-ingredients');
if (recipeBuilderIngredientsContainer) {
    recipeBuilderIngredientsContainer.addEventListener('input', (e) => {
        const input = e.target.closest('.builder-ing-input');
        if (!input) return;
        const idx = parseInt(input.getAttribute('data-builder-idx'), 10);
        if (recipeBuilderIngredients[idx]) {
            recipeBuilderIngredients[idx].amount = parseFloat(input.value) || 0;
            calculateBuilderTotals();
        }
    });
}

window.removeBuilderIng = function(idx) {
    recipeBuilderIngredients.splice(idx, 1);
    renderRecipeBuilderList();
};

const btnSaveCustomRecipe = document.getElementById('btn-save-custom-recipe');
if (btnSaveCustomRecipe) {
    btnSaveCustomRecipe.addEventListener('click', () => {
        const name = document.getElementById('custom-recipe-name').value.trim();
        const editId = document.getElementById('custom-recipe-id').value;
        if (!name) return alert("Please enter a recipe name.");
        if (recipeBuilderIngredients.length === 0) return alert("Please add at least one ingredient.");

        if (editId) {
            const idx = appState.recipes.findIndex(r => String(r.id) === String(editId));
            if (idx !== -1) {
                appState.recipes[idx].name = name;
                appState.recipes[idx].ingredients = [...recipeBuilderIngredients];
            }
        } else {
            const recipePayload = {
                id: `rec_${Date.now()}`,
                name: name,
                pinned: true,
                ingredients: [...recipeBuilderIngredients]
            };
            appState.recipes.push(recipePayload);
        }

        saveLocalState();
        closeCustomFoodModal();
        renderPredictivePills();
        renderDatabaseView();
    });
}

// 12. Database List View
const dbListContainer = document.getElementById('database-list-container');
const dbFilterInput = document.getElementById('db-filter-input');
const dbCategoryTabs = document.getElementById('db-category-tabs');

if (dbCategoryTabs) {
    dbCategoryTabs.addEventListener('click', (e) => {
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
    const foods = (appState.foodDatabase || []).map(f => ({ ...f, type: 'food' }));
    const recipes = (appState.recipes || []).map(r => ({ ...r, type: 'recipe' }));

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
                const ratio = (ing.amount || 0) / (ing.baseServing || 100);
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

if (dbListContainer) {
    dbListContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        const action = btn.getAttribute('data-action');
        const id = btn.getAttribute('data-id');

        if (action === 'edit-food') {
            const food = appState.foodDatabase.find(f => String(f.id) === String(id));
            if (food) openCustomFoodModal(food, false);
        } else if (action === 'delete-food') {
            const food = appState.foodDatabase.find(f => String(f.id) === String(id));
            if (food && confirm(`Delete "${food.name}" from your database?`)) {
                appState.foodDatabase = appState.foodDatabase.filter(f => String(f.id) !== String(id));
                saveLocalState();
                renderDatabaseView(dbFilterInput?.value || '');
            }
        } else if (action === 'log-food') {
            const food = appState.foodDatabase.find(f => String(f.id) === String(id));
            if (food) {
                switchView('view-home');
                openModal(food);
            }
        } else if (action === 'pin') {
            const rec = appState.recipes.find(r => String(r.id) === String(id));
            if (rec) {
                rec.pinned = rec.pinned === false ? true : false;
                saveLocalState();
                renderPredictivePills();
                renderDatabaseView(dbFilterInput?.value || '');
            }
        } else if (action === 'edit-recipe') {
            const rec = appState.recipes.find(r => String(r.id) === String(id));
            if (rec) openCustomFoodModal(rec, true);
        } else if (action === 'delete-recipe') {
            const rec = appState.recipes.find(r => String(r.id) === String(id));
            if (rec && confirm(`Delete recipe "${rec.name}"?`)) {
                appState.recipes = appState.recipes.filter(r => String(r.id) !== String(id));
                saveLocalState();
                renderPredictivePills();
                renderDatabaseView(dbFilterInput?.value || '');
            }
        } else if (action === 'log-recipe') {
            const rec = appState.recipes.find(r => String(r.id) === String(id));
            if (rec) openRecipeModal(rec);
        }
    });
}

if (dbFilterInput) {
    dbFilterInput.addEventListener('input', (e) => renderDatabaseView(e.target.value));
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
    activeRecipe = JSON.parse(JSON.stringify(recipe));
    activeRecipeLogEntryId = existingLogEntryId;
    recipeModalName.textContent = activeRecipe.name;
    btnConfirmRecipe.textContent = existingLogEntryId ? 'Update Meal Log' : 'Log Meal Group';
    if (tunerFoodDropdown) tunerFoodDropdown.classList.add('hidden');
    
    renderRecipeIngredients();
    
    recipeModal.classList.remove('hidden');
    requestAnimationFrame(() => {
        recipeModal.classList.remove('opacity-0', 'pointer-events-none');
        if (recipeModalContent) recipeModalContent.classList.remove('translate-y-full');
    });
}

function closeRecipeModal() {
    recipeModal.classList.add('opacity-0', 'pointer-events-none');
    if (recipeModalContent) recipeModalContent.classList.add('translate-y-full');
    setTimeout(() => {
        recipeModal.classList.add('hidden');
        activeRecipe = null;
        activeRecipeLogEntryId = null;
    }, 300);
}

function updateRecipeTotals() {
    if (!activeRecipe) return;
    let tCal = 0, tP = 0, tC = 0, tF = 0;

    activeRecipe.ingredients.forEach(item => {
        const unit = item.activeUnit || item.baseUnit || item.unit || 'g';
        let ratio = 1;

        if (unit === 'g') {
            ratio = (item.amount || 0) / (item.baseServing || 100);
        } else if (unit === 'oz') {
            ratio = ((item.amount || 0) * 28.35) / (item.baseServing || 100);
        } else if (unit === 'serving') {
            ratio = (item.amount || 0);
        } else {
            ratio = (item.amount || 0) / (item.baseServing || 1);
        }

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
        const isGram = baseUnit === 'g';
        const isOz = baseUnit === 'oz';
        const currentUnit = item.activeUnit || baseUnit;

        let unitOptions = `<option value="${baseUnit}" selected>${baseUnit}</option>`;
        if (isGram) {
            unitOptions = `
                <option value="g" ${currentUnit === 'g' ? 'selected' : ''}>g</option>
                <option value="oz" ${currentUnit === 'oz' ? 'selected' : ''}>oz</option>
                <option value="serving" ${currentUnit === 'serving' ? 'selected' : ''}>serv</option>
            `;
        } else if (isOz) {
            unitOptions = `
                <option value="oz" ${currentUnit === 'oz' ? 'selected' : ''}>oz</option>
                <option value="g" ${currentUnit === 'g' ? 'selected' : ''}>g</option>
                <option value="serving" ${currentUnit === 'serving' ? 'selected' : ''}>serv</option>
            `;
        } else {
            unitOptions = `
                <option value="${baseUnit}" selected>${baseUnit}</option>
                <option value="serving" ${currentUnit === 'serving' ? 'selected' : ''}>serv</option>
            `;
        }

        return `
            <div class="bg-slate-950/80 p-3 rounded-2xl border border-white/[0.05] flex items-center justify-between gap-3">
                <div class="flex-1 min-w-0">
                    <div class="font-bold text-white text-sm truncate">${item.name}</div>
                    <div class="text-[11px] text-slate-500 tabular-nums">${item.cal} kcal / ${item.baseServing}${baseUnit}</div>
                </div>
                <div class="flex items-center gap-2">
                    <input type="number" step="any" value="${item.amount}" data-tuner-idx="${idx}" class="recipe-tuner-input w-20 bg-slate-900 border border-slate-700 rounded-xl py-1.5 text-center text-sm font-bold text-white tabular-nums focus:outline-none focus:border-blue-500">
                    
                    <div class="relative">
                        <select data-ingredient-idx="${idx}" class="recipe-ing-unit bg-slate-900 border border-slate-700 text-xs text-slate-300 font-semibold rounded-xl py-1.5 pl-2 pr-6 appearance-none focus:outline-none focus:border-blue-500 cursor-pointer">
                            ${unitOptions}
                        </select>
                        <div class="absolute right-2 top-2 pointer-events-none text-slate-500">
                            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                        </div>
                    </div>

                    <button type="button" onclick="removeTunerIngredient(${idx})" class="p-1 text-slate-500 hover:text-rose-400 transition" title="Remove from this meal">
                        ✕
                    </button>
                </div>
            </div>
        `;
    }).join('');

    updateRecipeTotals();
}

// Focus-preserving input listener for Recipe Tuner
if (recipeIngredientsList) {
    recipeIngredientsList.addEventListener('input', (e) => {
        const input = e.target.closest('.recipe-tuner-input');
        if (!input || !activeRecipe) return;
        const idx = parseInt(input.getAttribute('data-tuner-idx'), 10);
        if (activeRecipe.ingredients[idx]) {
            activeRecipe.ingredients[idx].amount = parseFloat(input.value) || 0;
            updateRecipeTotals(); // Live update text without rebuilding DOM elements!
        }
    });

    recipeIngredientsList.addEventListener('change', (e) => {
        const select = e.target.closest('.recipe-ing-unit');
        if (!select || !activeRecipe) return;
        const idx = parseInt(select.getAttribute('data-ingredient-idx'), 10);
        const item = activeRecipe.ingredients[idx];
        if (!item) return;

        const prevUnit = item.activeUnit || item.baseUnit || item.unit || 'g';
        const newUnit = select.value;
        item.activeUnit = newUnit;

        if (prevUnit === 'g' && newUnit === 'oz') {
            item.amount = Math.round((item.amount / 28.35) * 10) / 10;
        } else if (prevUnit === 'oz' && newUnit === 'g') {
            item.amount = Math.round(item.amount * 28.35);
        } else if (newUnit === 'serving') {
            item.amount = 1;
        } else if (prevUnit === 'serving' && newUnit === 'g') {
            item.amount = item.baseServing || 100;
        }

        renderRecipeIngredients();
    });
}

window.removeTunerIngredient = function(idx) {
    if (!activeRecipe || !activeRecipe.ingredients[idx]) return;
    activeRecipe.ingredients.splice(idx, 1);
    renderRecipeIngredients();
};

if (btnTunerAddTrigger) {
    btnTunerAddTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const db = appState.foodDatabase || [];
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
    tunerFoodDropdownList.addEventListener('click', (e) => {
        const btn = e.target.closest('.tuner-add-food-opt');
        if (!btn || !activeRecipe) return;
        const id = btn.getAttribute('data-id');
        const food = appState.foodDatabase.find(f => String(f.id) === String(id));
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

if (btnCancelRecipe) btnCancelRecipe.addEventListener('click', closeRecipeModal);
if (recipeBackdrop) recipeBackdrop.addEventListener('click', closeRecipeModal);

if (btnConfirmRecipe) {
    btnConfirmRecipe.addEventListener('click', () => {
        if (!activeRecipe) return;
        const today = getLocalDateString();
        const monthKey = today.substring(0, 7);
        const timeNow = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

        if (!appState.logs[monthKey]) appState.logs[monthKey] = {};
        if (!appState.logs[monthKey][today]) {
            appState.logs[monthKey][today] = { date: today, totals: { cal: 0, p: 0, c: 0, f: 0 }, diary: [] };
        }

        const dayLog = appState.logs[monthKey][today];
        let totalCal = 0, totalP = 0, totalC = 0, totalF = 0;
        const nestedItems = [];

        activeRecipe.ingredients.forEach(item => {
            if (item.amount <= 0) return;
            const unit = item.activeUnit || item.baseUnit || item.unit || 'g';
            let ratio = 1;

            if (unit === 'g') {
                ratio = item.amount / (item.baseServing || 100);
            } else if (unit === 'oz') {
                ratio = (item.amount * 28.35) / (item.baseServing || 100);
            } else if (unit === 'serving') {
                ratio = item.amount;
            } else {
                ratio = item.amount / (item.baseServing || 1);
            }

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
                unit: unit,
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

        saveLocalState();
        closeRecipeModal();
        renderDailyBrief();
    });
}

// 14. Initial App Boot
renderPredictivePills();
renderDailyBrief();