import { store } from './state.js';
import { estimateNutrition, adjustTargets, macroCalories } from './nutrition-engine.js';

export function initializeNutritionUI(bindClick, signal, selects, dialogs) {
    const wizard = document.getElementById('onboarding-form');
    const sections = [...wizard.querySelectorAll('[data-step]')];
    const progress = document.getElementById('onboarding-progress');
    const result = document.getElementById('onboarding-estimate');
    const message = document.getElementById('nutrition-message');
    const goals = document.getElementById('goals-form');
    const locked = document.getElementById('calorie-lock');
    let step = 0;
    let estimate;
    let draftTargets = store.get().targets;
    const fieldLabels = {
        goal: [{ value: 'lose', label: 'Lose weight' }, { value: 'maintain', label: 'Maintain weight' }, { value: 'gain', label: 'Build weight / muscle' }],
        activity: [{ value: 'sedentary', label: 'Mostly seated' }, { value: 'light', label: 'Lightly active (1–3 days/week)' }, { value: 'moderate', label: 'Moderately active (3–5 days/week)' }, { value: 'active', label: 'Very active (6–7 days/week)' }, { value: 'veryActive', label: 'Physical job + training' }],
        sex: [{ value: 'female', label: 'Female' }, { value: 'male', label: 'Male' }, { value: 'unspecified', label: 'Prefer not to specify (broader estimate)' }],
        weightUnit: [{ value: 'kg', label: 'Kilograms (kg)' }, { value: 'lb', label: 'Pounds (lb)' }]
    };
    for (const [name, options] of Object.entries(fieldLabels)) {
        const button = wizard.querySelector(`[data-onboarding-select="${name}"]`);
        selects.register(button, { options, getValue: () => wizard.elements[name].value, onChange: value => {
            wizard.elements[name].value = value; button.textContent = options.find(option => option.value === value).label;
        }, label: name });
    }
    function showStep() {
        sections.forEach((section, index) => section.hidden = index !== step);
        progress.textContent = `Step ${step + 1} of ${sections.length}`;
        document.getElementById('onboarding-back').hidden = step === 0;
        document.getElementById('onboarding-next').hidden = step === sections.length - 1;
        document.getElementById('onboarding-complete').hidden = step !== sections.length - 1;
    }
    function values() {
        return Object.fromEntries(['age', 'heightCm', 'currentWeight', 'weightUnit', 'sex', 'activity', 'goal'].map(name => [name, wizard.elements[name].value]));
    }
    bindClick(document.getElementById('onboarding-next'), () => {
        const invalid = [...sections[step].querySelectorAll('input')].find(input => !input.checkValidity());
        if (invalid) { invalid.reportValidity(); return; }
        if (step === sections.length - 2) {
            try {
                estimate = estimateNutrition(values());
                result.textContent = `Estimated expenditure: ${estimate.expenditure} kcal/day. Starting target: ${estimate.targets.cal} kcal, ${estimate.targets.p.toFixed(0)}g protein, ${estimate.targets.c.toFixed(1)}g carbs, ${estimate.targets.f.toFixed(1)}g fat. Protein: ${estimate.proteinPerKg}g/kg. ${estimate.method}; adjust as you track your progress.`;
            } catch (error) { message.textContent = error.message; return; }
        }
        step++; showStep(); message.textContent = '';
    });
    bindClick(document.getElementById('onboarding-back'), () => { step = Math.max(0, step - 1); showStep(); });
    wizard.addEventListener('submit', event => {
        event.preventDefault();
        if (step !== sections.length - 1 || !estimate) return;
        const valuesNow = values();
        store.update(state => {
            state.profile = { ...state.profile, ...valuesNow, age: Number(valuesNow.age), heightCm: Number(valuesNow.heightCm), currentWeight: Number(valuesNow.currentWeight), displayName: wizard.elements.displayName.value.trim(), expenditure: estimate.expenditure, bmr: estimate.bmr };
            state.targets = estimate.targets;
            state.settings.onboardingComplete = true;
            state.settings.isCalLocked = true;
        });
        dialogs.open('profile');
    }, { signal });
    function openWizard() {
        const profile = store.get().profile;
        wizard.elements.displayName.value = typeof profile.displayName === 'string' ? profile.displayName : '';
        for (const name of ['age', 'heightCm', 'currentWeight']) wizard.elements[name].value = profile[name] || '';
        for (const [name, options] of Object.entries(fieldLabels)) {
            const selected = options.find(option => option.value === profile[name]) || options.find(option => option.value === wizard.elements[name].value) || options[0];
            wizard.elements[name].value = selected.value;
            wizard.querySelector(`[data-onboarding-select="${name}"]`).textContent = selected.label;
        }
        step = 0; estimate = null; showStep(); dialogs.open('onboarding');
    }
    bindClick(document.getElementById('btn-start-onboarding'), openWizard);
    bindClick(document.getElementById('btn-recalculate-plan'), openWizard);
    function renderTargets() {
        for (const key of ['cal', 'p', 'c', 'f']) goals.elements[key].value = String(Number(draftTargets[key].toFixed(3)));
        document.getElementById('macro-energy-total').textContent = `${macroCalories(draftTargets).toFixed(0)} kcal from macros / ${draftTargets.cal.toFixed(0)} kcal target`;
    }
    goals.addEventListener('input', event => {
        const field = event.target.name;
        if (!['cal', 'p', 'c', 'f'].includes(field) || event.target.value === '') return;
        try {
            const balanced = adjustTargets(draftTargets, field, Number(event.target.value), { fixedCalories: locked.checked });
            draftTargets = balanced.targets;
            renderTargets();
            message.textContent = balanced.message;
        } catch (error) { message.textContent = error.message; }
    }, { signal });
    goals.addEventListener('submit', event => {
        event.preventDefault();
        store.update(state => { state.targets = draftTargets; state.settings.isCalLocked = locked.checked; });
        message.textContent = 'Your balanced daily targets were saved.';
    }, { signal });
    const unsubscribe = store.subscribe(state => { draftTargets = state.targets; locked.checked = state.settings.isCalLocked; renderTargets(); });
    locked.checked = store.get().settings.isCalLocked;
    renderTargets(); showStep();
    signal.addEventListener('abort', unsubscribe, { once: true });
}
