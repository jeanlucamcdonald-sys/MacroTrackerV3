/** Mount once, then update cached nodes without replacing the dashboard subtree. */
export function createDashboard(root) {
    if (!root) throw new Error('Dashboard root is required');
    root.innerHTML = `
        <div class="flex justify-between items-start mb-6">
            <div>
                <div class="text-sm font-bold text-slate-500 uppercase tracking-wider mb-1">Calories</div>
                <div class="text-4xl font-bold text-white tracking-tight tabular-nums"><span data-value="total-cal">0</span> <span class="text-lg text-slate-500 font-normal">/ <span data-value="target-cal">0</span></span></div>
            </div>
            <div class="flex flex-col items-end gap-2">
                <button id="btn-toggle-view" class="p-2 bg-slate-800 rounded-xl text-slate-400 hover:text-white hover:bg-slate-700 transition active:scale-95" title="Toggle Rings / Bars / Hero Minimalist">
                    <svg class="w-4 h-4 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"></path></svg>
                </button>
                <div class="text-right">
                    <div class="text-sm font-bold tabular-nums text-emerald-400"><span data-value="difference">0</span></div>
                    <div class="text-[10px] text-slate-500 uppercase font-bold tracking-wider"><span data-value="difference-label">Remaining</span></div>
                </div>
            </div>
        </div>
    <div data-view="rings">
            <div class="flex flex-col items-center justify-center pt-2 pb-2">
                <div class="relative w-48 h-48 drop-shadow-xl">
                    <svg viewBox="0 0 100 100" class="w-full h-full transform -rotate-90">
                        <circle cx="50" cy="50" r="42" fill="transparent" stroke="#1e293b" stroke-width="7"></circle>
                        <circle cx="50" cy="50" r="32" fill="transparent" stroke="#1e293b" stroke-width="7"></circle>
                        <circle cx="50" cy="50" r="22" fill="transparent" stroke="#1e293b" stroke-width="7"></circle>
                        
                        <circle cx="50" cy="50" r="42" fill="transparent" stroke="#3b82f6" stroke-width="7" stroke-linecap="round" data-ring="p" stroke-dasharray="263.89378290154264" stroke-dashoffset="263.89378290154264" class="dashboard-ring" style="filter: drop-shadow(0 0 4px rgba(59,130,246,0.5));"></circle>
                        <circle cx="50" cy="50" r="32" fill="transparent" stroke="#10b981" stroke-width="7" stroke-linecap="round" data-ring="c" stroke-dasharray="201.06192982974676" stroke-dashoffset="201.06192982974676" class="dashboard-ring" style="filter: drop-shadow(0 0 4px rgba(16,185,129,0.5));"></circle>
                        <circle cx="50" cy="50" r="22" fill="transparent" stroke="#f43f5e" stroke-width="7" stroke-linecap="round" data-ring="f" stroke-dasharray="138.23007675795088" stroke-dashoffset="138.23007675795088" class="dashboard-ring" style="filter: drop-shadow(0 0 4px rgba(244,63,94,0.5));"></circle>
                    </svg>
                </div>
                <div class="flex justify-center gap-6 w-full border-t border-slate-800/50 pt-5 mt-6">
                    <div class="text-center">
                        <div class="text-[10px] font-bold text-slate-500 mb-1 uppercase tracking-widest flex items-center justify-center gap-1.5"><span class="w-2 h-2 rounded-full bg-blue-500"></span> Pro</div>
                        <div class="text-base font-bold text-slate-200 tabular-nums"><span data-value="total-p">0</span>g <span class="text-xs text-slate-600 font-normal">/ <span data-value="target-p">0</span></span></div>
                    </div>
                    <div class="text-center">
                        <div class="text-[10px] font-bold text-slate-500 mb-1 uppercase tracking-widest flex items-center justify-center gap-1.5"><span class="w-2 h-2 rounded-full bg-emerald-500"></span> Carb</div>
                        <div class="text-base font-bold text-slate-200 tabular-nums"><span data-value="total-c">0</span>g <span class="text-xs text-slate-600 font-normal">/ <span data-value="target-c">0</span></span></div>
                    </div>
                    <div class="text-center">
                        <div class="text-[10px] font-bold text-slate-500 mb-1 uppercase tracking-widest flex items-center justify-center gap-1.5"><span class="w-2 h-2 rounded-full bg-rose-500"></span> Fat</div>
                        <div class="text-base font-bold text-slate-200 tabular-nums"><span data-value="total-f">0</span>g <span class="text-xs text-slate-600 font-normal">/ <span data-value="target-f">0</span></span></div>
                    </div>
                </div>
            </div>
        </div><div data-view="bars" hidden>
            <div class="space-y-4">
                <div>
                    <div class="flex justify-between text-xs font-bold mb-1"><span class="text-blue-400">Protein</span><span class="text-slate-300 tabular-nums"><span data-value="total-p">0</span>g / <span data-value="target-p">0</span>g</span></div>
                    <div class="w-full bg-slate-800 rounded-full h-2 overflow-hidden"><div class="bg-blue-500 h-2 rounded-full origin-left transition-transform duration-300 ease-out" data-bar="p" style="width: 100%; transform: scaleX(0)"></div></div>
                </div>
                <div>
                    <div class="flex justify-between text-xs font-bold mb-1"><span class="text-emerald-400">Carbs</span><span class="text-slate-300 tabular-nums"><span data-value="total-c">0</span>g / <span data-value="target-c">0</span>g</span></div>
                    <div class="w-full bg-slate-800 rounded-full h-2 overflow-hidden"><div class="bg-emerald-500 h-2 rounded-full origin-left transition-transform duration-300 ease-out" data-bar="c" style="width: 100%; transform: scaleX(0)"></div></div>
                </div>
                <div>
                    <div class="flex justify-between text-xs font-bold mb-1"><span class="text-rose-400">Fat</span><span class="text-slate-300 tabular-nums"><span data-value="total-f">0</span>g / <span data-value="target-f">0</span>g</span></div>
                    <div class="w-full bg-slate-800 rounded-full h-2 overflow-hidden"><div class="bg-rose-500 h-2 rounded-full origin-left transition-transform duration-300 ease-out" data-bar="f" style="width: 100%; transform: scaleX(0)"></div></div>
                </div>
            </div>
        </div><div data-view="minimal" hidden>
            <div class="py-2">
                <div class="grid grid-cols-3 gap-3">
                    <div class="bg-slate-950/70 border border-white/[0.05] rounded-2xl p-4 text-center shadow-inner">
                        <div class="text-[10px] font-bold uppercase tracking-widest text-blue-400 mb-1.5 flex items-center justify-center gap-1.5">
                            <span class="w-2 h-2 rounded-full bg-blue-500"></span> Pro
                        </div>
                        <div class="text-2xl font-extrabold text-white tracking-tight tabular-nums"><span data-value="total-p">0</span></div>
                        <div class="text-xs font-semibold text-slate-500 mt-0.5 tabular-nums">/ <span data-value="target-p">0</span>g</div>
                    </div>
                    <div class="bg-slate-950/70 border border-white/[0.05] rounded-2xl p-4 text-center shadow-inner">
                        <div class="text-[10px] font-bold uppercase tracking-widest text-emerald-400 mb-1.5 flex items-center justify-center gap-1.5">
                            <span class="w-2 h-2 rounded-full bg-emerald-500"></span> Carb
                        </div>
                        <div class="text-2xl font-extrabold text-white tracking-tight tabular-nums"><span data-value="total-c">0</span></div>
                        <div class="text-xs font-semibold text-slate-500 mt-0.5 tabular-nums">/ <span data-value="target-c">0</span>g</div>
                    </div>
                    <div class="bg-slate-950/70 border border-white/[0.05] rounded-2xl p-4 text-center shadow-inner">
                        <div class="text-[10px] font-bold uppercase tracking-widest text-rose-400 mb-1.5 flex items-center justify-center gap-1.5">
                            <span class="w-2 h-2 rounded-full bg-rose-500"></span> Fat
                        </div>
                        <div class="text-2xl font-extrabold text-white tracking-tight tabular-nums"><span data-value="total-f">0</span></div>
                        <div class="text-xs font-semibold text-slate-500 mt-0.5 tabular-nums">/ <span data-value="target-f">0</span>g</div>
                    </div>
                </div>
            </div>
        </div>`;
    const values = new Map();
    for (const node of root.querySelectorAll('[data-value]')) {
        const key = node.dataset.value;
        if (!values.has(key)) values.set(key, []);
        values.get(key).push(node);
    }
    const rings = [...root.querySelectorAll('[data-ring]')].map(node => ({
        node, key: node.dataset.ring, circumference: 2 * Math.PI * Number(node.getAttribute('r'))
    }));
    const bars = [...root.querySelectorAll('[data-bar]')];
    const views = [...root.querySelectorAll('[data-view]')];
    const difference = values.get('difference')[0].parentElement;
    const toggle = root.querySelector('#btn-toggle-view');
    let currentView;
    function text(key, value) {
        const next = String(value);
        for (const node of values.get(key)) {
            if (node.textContent !== next) node.textContent = next;
        }
    }
    function number(value) { return Number.isFinite(value) ? value : 0; }
    function progress(total, target) {
        // A zero target cannot define a meaningful ratio.
        return target > 0 ? Math.max(0, Math.min(total / target, 1)) : 0;
    }
    return Object.freeze({
        update(totals, targets, view = 'rings') {
            if (!['rings', 'bars', 'minimal'].includes(view)) throw new RangeError('Unknown dashboard view');
            for (const key of ['cal', 'p', 'c', 'f']) {
                text(`total-${key}`, number(totals[key]));
                text(`target-${key}`, Number(number(targets[key]).toFixed(1)));
            }
            const remaining = number(targets.cal) - number(totals.cal);
            text('difference', Math.abs(remaining));
            text('difference-label', remaining >= 0 ? 'Remaining' : 'Over');
            difference.classList.toggle('text-emerald-400', remaining >= 0);
            difference.classList.toggle('text-rose-400', remaining < 0);
            for (const { node, key, circumference } of rings) {
                const offset = String(circumference * (1 - progress(number(totals[key]), number(targets[key]))));
                if (node.style.strokeDashoffset !== offset) node.style.strokeDashoffset = offset;
            }
            for (const node of bars) {
                const key = node.dataset.bar;
                const transform = `scaleX(${progress(number(totals[key]), number(targets[key]))})`;
                if (node.style.transform !== transform) node.style.transform = transform;
            }
            if (view !== currentView) {
                for (const node of views) node.hidden = node.dataset.view !== view;
                toggle.setAttribute('aria-label', `Dashboard: ${view}. Switch view`);
                currentView = view;
            }
        }
    });
}
