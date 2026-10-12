# Phase 1: integrated reactive state and event routing

Phase 1 is implemented in the running app. Phase 2's cached dashboard remains in place. Phase 3 is not included.

## State

`state.js` exports `store`, not `appState` or `setAppState`. It restores the existing `macroTrackerPro_State_v2` localStorage data, fills structural defaults, validates it, and creates the store:

```js
import { createStore } from './store.js';
export const store = createStore(loadLocalState(), {
    saveLocalState,
    validate: validateState
});
```

`store.get()` returns a detached snapshot. `store.update(draft => { ... })` clones a draft, rejects async/nested mutations, validates the result, writes it to localStorage, and notifies subscribers. A mutator, validation, or storage error leaves the prior state intact. Each subscriber receives its own snapshot; one subscriber failure does not prevent other notifications. `subscribe(fn)` returns an unsubscribe function. Subscribers should render rather than start nested updates.

Every persistent write in `main.js` uses a transaction: default recipes, food logs and totals, meal groups, diary edits/deletes, scanned foods, custom food/recipe edits, pinning and deletion. Recipe-builder and tuner edits stay in detached modal drafts until committed. Import validates and commits through the store; export reads a snapshot. The existing backup JSON format and storage key are preserved. Imports use `file.text()` and accept an optional AbortSignal.

The app initializes state through its module import:

```js
import { store } from './state.js';
import { createRouter } from './router.js';
import { createDashboard } from './dashboard.js';
```

A store subscription refreshes the pills, cached dashboard/diary and filtered database view. Persistence errors propagate to callers; routed action failures are reported through the router's error handler.

## Routing

`router.js` attaches one click listener to `document.body`. It selects the nearest `data-action`, passes its `data-id`, catches synchronous and asynchronous errors, ignores disabled controls, and provides a lifetime signal and `destroy()` method. Only one router may be attached to a root at a time.

Previously global diary and ingredient handlers are module-local functions routed by named actions. Generated inline `onclick` attributes were removed. For example:

```html
<button data-action="edit-diary-entry" data-id="entry-id">Edit</button>
```

Static controls and existing delegated pickers register through `bindClick()`, which assigns `data-action="ui"` and stores callbacks in a WeakMap. Dynamic search buttons use the same mechanism, so removed buttons do not remain retained in a handler registry. Database buttons retain their named actions. All click execution still flows through the one body listener. Input, change, submit, visibility and lifecycle listeners use an app AbortSignal; these events are not click actions.

The router's `afterDispatch` hook handles outside-click dismissals. It uses the original event path for search results, including clicks whose handler has already replaced a button. Nested edit/delete buttons do not also trigger their meal group's accordion action.

## Async cleanup

- USDA fetches accept a signal. New queries, selecting a result, dismissal, hiding the page and page teardown abort outstanding searches. Late responses are discarded even if a fetch implementation ignores cancellation.
- Barcode requests are aborted on scanner close, restart and page hiding/teardown. Late results cannot write state or open a logging sheet after cancellation.
- Camera start/stop/clear operations are serialized. Closing during the startup delay cancels it; closing during a pending camera permission/start operation releases the stream as soon as startup settles. A pending browser permission prompt itself cannot be cancelled by the scanner library.
- Modal and drawer close timers are cancelled on reopening. Actual teardown removes subscriptions/router/listeners and clears scheduled UI timers. BFCache page hiding pauses requests/camera without destroying the app's handlers.

## Validation

Start the Python server at the repository root, then run:

```sh
npm install --prefix /tmp/macrotracker-validation --cache /tmp/npm-cache playwright
NODE_PATH=/tmp/macrotracker-validation/node_modules node --test tests/phase-1.test.cjs tests/dashboard.test.cjs
```

Six browser tests cover store immutability/rollback/import publication, food and recipe logging/edit/delete, database pinning and custom creation, persistence after reload, stale search cancellation, scanner startup/close races, barcode cancellation, and cached dashboard node identity/progress. Tests isolate browser storage and block external CDNs/APIs. Scanner lifecycle is tested with a mock scanner; physical camera access and real external service responses are not validated by these tests.
