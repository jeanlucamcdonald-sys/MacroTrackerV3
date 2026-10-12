export function localDateString(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
/** Recompute the next local midnight (including DST), and recover after sleeping. */
export function watchLocalDay(onChange, { now = () => new Date(), host = globalThis, document: doc = globalThis.document } = {}) {
    let current = localDateString(now());
    let timer;
    function check() {
        const date = now();
        const next = localDateString(date);
        if (next !== current) { current = next; onChange(next); }
        host.clearTimeout(timer);
        const midnight = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
        // A short cap also recovers from clock/timezone changes while the page is open.
        timer = host.setTimeout(check, Math.max(1, Math.min(midnight - date + 20, 60_000)));
    }
    doc?.addEventListener('visibilitychange', check);
    host.addEventListener?.('focus', check);
    host.addEventListener?.('pageshow', check);
    check();
    return () => {
        host.clearTimeout(timer);
        doc?.removeEventListener('visibilitychange', check);
        host.removeEventListener?.('focus', check);
        host.removeEventListener?.('pageshow', check);
    };
}
