/** A synchronous, transactional store. Persistence must throw on failure. */
export function createStore(initialState, {
    saveLocalState = () => {},
    validate = () => true,
    onSubscriberError = error => console.error('Store subscriber failed:', error)
} = {}) {
    function cloneValid(value) {
        const copy = structuredClone(value);
        if (validate(copy) === false) throw new TypeError('Invalid state');
        return copy;
    }
    let state = cloneValid(initialState);
    let updating = false;
    const subscribers = new Set();
    return Object.freeze({
        get() { return structuredClone(state); },
        update(mutatorFn) {
            if (typeof mutatorFn !== 'function') throw new TypeError('Expected a mutator function');
            if (updating) throw new Error('Nested store updates are not supported');
            updating = true;
            try {
                const draft = structuredClone(state);
                const result = mutatorFn(draft);
                if (result && typeof result.then === 'function') {
                    // Prevent an accidentally async mutator from creating an unhandled rejection.
                    Promise.resolve(result).catch(() => {});
                    throw new TypeError('Store mutators must be synchronous');
                }
                if (result !== undefined) throw new TypeError('Mutate the draft; do not return a value');
                const next = cloneValid(draft);
                // Persist before publishing so a storage failure leaves state unchanged.
                saveLocalState(structuredClone(next));
                state = next;
                for (const subscriber of [...subscribers]) {
                    if (!subscribers.has(subscriber)) continue;
                    try { subscriber(structuredClone(state)); }
                    catch (error) {
                        try { onSubscriberError(error); } catch { /* Keep notifying other subscribers. */ }
                    }
                }
                return structuredClone(state);
            } finally { updating = false; }
        },
        subscribe(fn) {
            if (typeof fn !== 'function') throw new TypeError('Expected a subscriber function');
            subscribers.add(fn);
            return () => subscribers.delete(fn);
        }
    });
}
