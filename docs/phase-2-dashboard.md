# Phase 2: cached dashboard

`dashboard.js` mounts the existing header and rings, bars, and minimal views once. It caches all numeric text nodes, progress circles, bars, and view wrappers. `update(totals, targets, view)` only writes changed text/styles and toggles view visibility. It does not query the DOM again, measure layout, or replace the dashboard subtree. The toggle button retains its identity and keyboard focus.

`main.js` initializes the dashboard beside the view state and calls `dashboard.update()` from `renderDailyBrief()`. Existing logging, editing, deletion, visibility refreshes, and view toggles use that path. Diary rendering remains separate and unchanged. Phase 1 is now integrated: store subscriptions refresh this dashboard, and the centralized router handles view toggles. Phase 3 is not included.

Ratios clamp to 0–100%; zero/negative targets show zero progress. Non-finite totals/targets normalize to zero. Calorie differences retain the existing Remaining/Over display and colors.

## Browser regression checks

With Python 3, Node.js, Chromium, and Playwright installed:

```sh
# Terminal 1, repository root
python3 -m http.server 8000 --bind 127.0.0.1

# Terminal 2, repository root; test tooling stays outside the checkout
npm install --prefix /tmp/macrotracker-validation --cache /tmp/npm-cache playwright
NODE_PATH=/tmp/macrotracker-validation/node_modules node --test tests/dashboard.test.cjs
```

Optional overrides: `MACROTRACKER_TEST_URL` for the server URL and `CHROMIUM_PATH` for the browser executable. Tests use isolated browser contexts and block external CDN/API requests, so they validate local dashboard behavior rather than external services. They cover exact totals and ring/bar progress, zero/exceeded targets, view visibility, node identity, focus, zero DOM mutations on unchanged refresh, and real food logging/editing/deleting through the app.
