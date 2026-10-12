import { exportUserData, parseBackup, applyBackup } from './state.js';
import { deviceCache } from './persistence.js';
export function initializeBackups(bindClick, signal) {
    const fileInput = document.getElementById('backup-import');
    const preview = document.getElementById('backup-preview');
    const status = document.getElementById('backup-status');
    let pending, generation = 0;
    const ready = () => !['loading', 'load-error'].includes(document.documentElement.dataset.accountPhase);
    function clear() { generation++; pending = null; preview.hidden = true; fileInput.value = ''; }
    bindClick(document.getElementById('btn-export-backup'), () => {
        try { exportUserData(); status.textContent = 'Backup downloaded. Keep it somewhere safe.'; }
        catch (error) { status.textContent = error.message; }
    });
    fileInput.addEventListener('change', async event => {
        const file = event.target.files[0];
        if (!file || !ready()) return;
        const request = ++generation, scope = deviceCache.scope;
        pending = null; preview.hidden = true; status.textContent = 'Validating backup…';
        try {
            if (file.size > 32 * 1024 * 1024) throw new Error('Backup exceeds the 32 MB limit.');
            const imported = parseBackup(await file.text());
            if (signal.aborted || request !== generation || scope !== deviceCache.scope || !ready()) return;
            pending = { imported, scope };
            const days = Object.values(imported.logs).flatMap(month => Object.values(month));
            document.getElementById('backup-summary').textContent = `${days.length} diary days, ${days.reduce((sum, day) => sum + day.diary.length, 0)} food entries, ${imported.weightLog.length} weights, ${imported.foodDatabase.length} saved foods, ${(imported.recipes || []).length} meals.`;
            preview.hidden = false; status.textContent = 'Backup validated. Choose merge or replace.';
        } catch (error) { if (request === generation) status.textContent = `Import failed: ${error.message}. Your data was not changed.`; }
    }, { signal });
    for (const mode of ['merge', 'replace']) bindClick(document.getElementById(`btn-import-${mode}`), async () => {
        if (!pending || pending.scope !== deviceCache.scope || !ready()) { clear(); return; }
        try {
            status.textContent = 'Applying backup…';
            const scope = pending.scope;
            applyBackup(pending.imported, mode);
            clear(); const request = generation; await deviceCache.flush();
            if (signal.aborted || request !== generation || scope !== deviceCache.scope) return;
            status.textContent = 'Backup imported on this device. Check account backup status to confirm cloud sync.';
        } catch (error) { status.textContent = `Import failed: ${error.message}`; }
    });
    bindClick(document.getElementById('btn-import-cancel'), () => { clear(); status.textContent = 'Import cancelled. Your data was not changed.'; });
    globalThis.addEventListener('account-changing', () => { clear(); status.textContent = ''; }, { signal });
    signal.addEventListener('abort', clear, { once: true });
}
