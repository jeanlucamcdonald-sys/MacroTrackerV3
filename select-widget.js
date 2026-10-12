/** Shared portal listbox: avoids modal clipping, supports touch and keyboard. */
export function createSelectSystem(bindClick, { signal } = {}) {
    const definitions = new WeakMap();
    const menu = document.createElement('div');
    menu.className = 'select-menu';
    menu.id = 'serving-select-options';
    menu.setAttribute('role', 'listbox');
    menu.hidden = true;
    document.body.append(menu);
    let active;
    let highlighted = 0;
    function close(restoreFocus = false) {
        if (active) {
            active.button.setAttribute('aria-expanded', 'false');
            if (restoreFocus) active.button.focus({ preventScroll: true });
        }
        active = null;
        menu.hidden = true;
        menu.replaceChildren();
    }
    function position() {
        if (!active) return;
        const rect = active.button.getBoundingClientRect();
        const viewport = globalThis.visualViewport;
        const left = viewport?.offsetLeft || 0;
        const top = viewport?.offsetTop || 0;
        const width = viewport?.width || innerWidth;
        const height = viewport?.height || innerHeight;
        const below = top + height - rect.bottom - 12;
        const above = rect.top - top - 12;
        const upwards = above > below;
        const maxHeight = Math.max(0, Math.min(280, height - 24, Math.max(120, upwards ? above : below)));
        menu.style.maxHeight = `${maxHeight}px`;
        menu.style.width = `${Math.min(Math.max(rect.width, 180), width - 24)}px`;
        menu.style.left = `${Math.max(left + 12, Math.min(rect.left, left + width - parseFloat(menu.style.width) - 12))}px`;
        const menuHeight = menu.getBoundingClientRect().height;
        const desiredTop = upwards ? rect.top - menuHeight - 6 : rect.bottom + 6;
        menu.style.top = `${Math.max(top + 12, Math.min(desiredTop, top + height - menuHeight - 12))}px`;
    }
    function highlight(index) {
        const options = [...menu.children];
        highlighted = (index + options.length) % options.length;
        options.forEach((button, i) => button.tabIndex = i === highlighted ? 0 : -1);
        options[highlighted]?.focus({ preventScroll: true });
        options[highlighted]?.scrollIntoView({ block: 'nearest' });
    }
    function choose(index) {
        const { definition } = active;
        const option = definition.options[index];
        close(true);
        definition.onChange(option.value);
    }
    function open(button) {
        if (active?.button === button) return close();
        close();
        const definition = definitions.get(button);
        active = { button, definition };
        button.setAttribute('aria-expanded', 'true');
        for (const [index, option] of definition.options.entries()) {
            const choice = document.createElement('button');
            choice.type = 'button';
            choice.setAttribute('role', 'option');
            choice.setAttribute('aria-selected', String(option.value === definition.getValue()));
            choice.textContent = option.label;
            choice.dataset.value = option.value;
            bindClick(choice, () => choose(index));
            menu.append(choice);
        }
        menu.hidden = false;
        position();
        highlight(Math.max(0, definition.options.findIndex(option => option.value === definition.getValue())));
    }
    function register(button, definition) {
        definitions.set(button, definition);
        button.type = 'button';
        button.setAttribute('aria-haspopup', 'listbox');
        button.setAttribute('aria-controls', menu.id);
        button.setAttribute('aria-expanded', 'false');
        button.setAttribute('aria-label', definition.label || 'Serving unit');
        bindClick(button, event => { event.stopPropagation(); open(button); });
    }
    menu.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); close(true); }
        else if (event.key === 'Tab') close();
        else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            highlight(event.key === 'Home' ? 0 : event.key === 'End' ? menu.children.length - 1 : highlighted + (event.key === 'ArrowDown' ? 1 : -1));
        }
    }, { signal });
    document.addEventListener('pointerdown', event => {
        if (active && !menu.contains(event.target) && !active.button.contains(event.target)) close();
    }, { signal });
    globalThis.addEventListener('resize', position, { signal });
    document.addEventListener('scroll', position, { capture: true, signal });
    globalThis.visualViewport?.addEventListener('resize', position, { signal });
    globalThis.visualViewport?.addEventListener('scroll', position, { signal });
    signal?.addEventListener('abort', () => { close(); menu.remove(); }, { once: true });
    return { register, close };
}
