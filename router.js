/** One delegated click listener per root; nearest action wins for nested controls. */
const attachedRoots = new WeakMap();
export function createRouter(actions, {
    root = document.body,
    afterDispatch = () => {},
    onError = error => console.error('Action failed:', error)
} = {}) {
    if (!root) throw new Error('Attach the router after document.body exists');
    if (attachedRoots.has(root)) throw new Error('An action router is already attached to this root');
    const handlers = new Map(Object.entries(actions));
    for (const handler of handlers.values()) {
        if (typeof handler !== 'function') throw new TypeError('Action handlers must be functions');
    }
    const controller = new AbortController();
    function report(error) { try { onError(error); } catch { /* Do not create unhandled errors. */ } }
    function dispatch(event) {
        const target = event.target?.nodeType === 1 ? event.target : event.target?.parentElement;
        const element = target?.closest('[data-action]');
        if (!element || !root.contains(element)) return;
        if (element.matches(':disabled, [aria-disabled="true"]')) return;
        const handler = handlers.get(element.dataset.action);
        if (!handler) return;
        event.preventDefault();
        try {
            Promise.resolve(handler({
                event, element, id: element.dataset.id, signal: controller.signal
            })).catch(report);
        } catch (error) { report(error); }
    }
    function route(event) {
        try { dispatch(event); }
        finally {
            try { afterDispatch(event); } catch (error) { report(error); }
        }
    }
    root.addEventListener('click', route, { signal: controller.signal });
    attachedRoots.set(root, controller);
    return Object.freeze({
        destroy() {
            controller.abort();
            if (attachedRoots.get(root) === controller) attachedRoots.delete(root);
        }
    });
}
