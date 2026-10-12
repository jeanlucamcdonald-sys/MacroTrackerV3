/** Centered account controls. Only the quick overview auto-dismisses. */
export function initializeDialogs(bindClick, signal, selects) {
    const root = document.getElementById('account-dialog');
    const panel = document.getElementById('account-dialog-panel');
    const tabs = [...root.querySelectorAll('[data-dialog-view]')];
    let tab = 'overview';
    let timer;
    let frame;
    let opener;
    function close() {
        clearTimeout(timer); cancelAnimationFrame(frame); selects.close();
        root.hidden = true;
        opener?.focus({ preventScroll: true });
    }
    function open(next = 'overview') {
        clearTimeout(timer); cancelAnimationFrame(frame); selects.close();
        opener = root.hidden ? document.activeElement : opener;
        tab = next;
        tabs.forEach(section => section.hidden = section.dataset.dialogView !== tab);
        root.hidden = false;
        panel.classList.remove('dialog-visible');
        frame = requestAnimationFrame(() => {
            frame = requestAnimationFrame(() => {
                if (root.hidden || signal.aborted) return;
                panel.classList.add('dialog-visible');
                panel.focus({ preventScroll: true });
            });
        });
        document.getElementById('account-dialog-title').textContent = {
            overview: 'Welcome!', account: 'Welcome! Continue with Google or create an account',
            profile: 'Your profile', settings: 'Goals & settings', onboarding: 'Build your starting plan'
        }[tab];
        if (tab === 'overview') timer = setTimeout(close, 8000);
    }
    bindClick(document.getElementById('btn-account'), () => open());
    bindClick(document.getElementById('btn-close-account'), close);
    bindClick(document.getElementById('account-dialog-backdrop'), close);
    for (const button of root.querySelectorAll('[data-dialog-tab]')) bindClick(button, () => open(button.dataset.dialogTab));
    root.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); close(); return; }
        if (event.key !== 'Tab') return;
        const focusable = [...panel.querySelectorAll('button,input,a,[tabindex="0"]')].filter(node => !node.disabled && node.type !== 'hidden' && !node.hidden && node.getClientRects().length);
        if (!focusable.length) { event.preventDefault(); panel.focus(); return; }
        if (event.shiftKey && (document.activeElement === focusable[0] || document.activeElement === panel)) { event.preventDefault(); focusable.at(-1).focus(); }
        else if (!event.shiftKey && document.activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0].focus(); }
    }, { signal });
    signal.addEventListener('abort', close, { once: true });
    return { open, close, get tab() { return tab; }, get isOpen() { return !root.hidden; } };
}
