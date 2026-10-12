/** Only plan setup is modal. Account/profile/goals live in the Settings page. */
export function initializeDialogs(bindClick, signal, selects) {
    const root = document.getElementById('account-dialog');
    const panel = document.getElementById('account-dialog-panel');
    let frame, opener;
    function close() {
        cancelAnimationFrame(frame); selects.close(); root.hidden = true;
        if (opener?.getClientRects().length) opener.focus({ preventScroll: true });
    }
    function open(tab = 'account') {
        if (tab !== 'onboarding') {
            close();
            globalThis.dispatchEvent(new CustomEvent('navigate-settings', { detail: { section: tab === 'overview' ? 'account' : tab } }));
            return;
        }
        cancelAnimationFrame(frame); selects.close();
        opener = root.hidden ? document.activeElement : opener;
        root.hidden = false; panel.classList.remove('dialog-visible');
        frame = requestAnimationFrame(() => {
            frame = requestAnimationFrame(() => {
                if (root.hidden || signal.aborted) return;
                panel.classList.add('dialog-visible'); panel.focus({ preventScroll: true });
            });
        });
    }
    bindClick(document.getElementById('btn-close-account'), close);
    bindClick(document.getElementById('account-dialog-backdrop'), close);
    for (const button of document.querySelectorAll('[data-dialog-tab]')) bindClick(button, () => open(button.dataset.dialogTab));
    root.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); close(); return; }
        if (event.key !== 'Tab') return;
        const focusable = [...panel.querySelectorAll('button,input,a,[tabindex="0"]')].filter(node => !node.disabled && node.type !== 'hidden' && !node.hidden && node.getClientRects().length);
        if (!focusable.length) { event.preventDefault(); panel.focus(); return; }
        if (event.shiftKey && (document.activeElement === focusable[0] || document.activeElement === panel)) { event.preventDefault(); focusable.at(-1).focus(); }
        else if (!event.shiftKey && document.activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0].focus(); }
    }, { signal });
    signal.addEventListener('abort', close, { once: true });
    return { open, close, get isOpen() { return !root.hidden; } };
}
