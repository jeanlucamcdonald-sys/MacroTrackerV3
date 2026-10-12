# Onboarding, nutrition targets, lookup, and account recovery

## Calculation engine

`nutrition-engine.js` is the single target-calculation authority. Calorie and macro targets use `4 × protein + 4 × carbohydrates + 9 × fat`. Inputs are non-negative finite numbers. At a fixed 2,000 kcal target, a requested 1,000g protein is capped at 500g; the other macros are rebalanced into the remaining budget. Changes to calories scale the existing macro distribution. With the calorie lock disabled, editing macros updates calories to their energy total. Fractions are retained internally to avoid rounded grams creating inconsistent totals; the UI rounds display values only.

The same invariant is checked by state validation and Firestore profile-write rules. Older target sets are reconciled on loading/import while preserving the calorie target. This restriction applies to **targets**, not calories printed on food labels or actual consumed food totals: label calories can differ from 4/4/9 because of fiber, alcohol, and other labeling methods.

The four-step onboarding flow collects name, goal, adult age, height, current weight/unit, a physiological estimation baseline, and activity. It uses Mifflin–St Jeor with activity factors, a modest goal adjustment, and baseline protein of 1.8g/kg (2g/kg when losing weight). The result is an estimate shown for review before saving. Unspecified physiological baseline uses a broader midpoint estimate. Recalculate from Settings to update the plan after changing your profile; weight-unit changes preserve physical weight. No React framework was introduced.

## Built-in and current product databases

The app bundles **6,636 archived USDA reference foods in 25 categories** in `data/foods.json`. Values are per 100g. Source provenance, pinned GitHub commit, and SHA-256 are in `data/catalog-source.json`. These are historical reference values from the USDA data mirror used by *Python for Data Analysis*, not a claim about current packaged-food formulations. Nutrient facts are USDA government data; the mirror and original dataset are attributed in the provenance record.

```sh
python3 scripts/generate-food-catalog.py
npm run build
```

The generation script downloads only the pinned source and refuses a changed checksum or record count. Normal app setup uses the checked-in catalog and does not download the source. The shared catalog remains outside account Firestore documents, keeping thousands of reference entries out of each user's catalog payload. Existing saved/imported foods and recipes remain intact.

Local search uses a pre-normalized text index and ranks saved foods and exact matches. It renders immediately, with current-product lookup debounced by 400ms when local matches are sparse. Explicit current-product searches and Enter are also supported. USDA and Open Food Facts run independently; one provider failure does not discard the other's results or local foods. Successful normalized queries are cached for 15 minutes with a 60-query bound. Stale requests are aborted and ignored; remote lookup times out after 8 seconds. USDA's DEMO_KEY can be rate limited, so Open Food Facts and the bundled catalog remain available.

The primary ingestion paths are built-in/reference queries, current-product search, and barcode scanning. “Build Meal” opens the recipe builder rather than manual food creation. Legacy food editing/import remains supported. Both meal ingredient pickers search the complete reference catalog and limit rendered results to 30; the database view shows up to 60 rows and prompts users to narrow their search. Searchable pickers do not dismiss while their input is being used. Missing product nutrients are not silently filled with zero. USDA results stay on a 100g basis rather than inventing a grams-to-volume density.

## Settings and personalized dashboard

Account, Profile, and Settings controls are in the hamburger menu and open a dedicated Settings page with profile, goals, account recovery, and visible backup import/export sections. Guided onboarding remains a centered keyboard-accessible dialog. Profile display names take precedence over Google names. Local-time salutations and 59 stable, goal-aware prompts personalize the dashboard.

The dashboard now includes initial onboarding weight capture, quick weight entry, normalized trends/history, calendar-period macro summaries, and Calendar/Timeline food logs. See [dashboard-and-settings.md](dashboard-and-settings.md) for navigation, averaging, target-comparison, weight-edit, and backup merge semantics.

## Startup resilience and catalog hosting

`index.html` loads `main.js` with `type="module"`; its imports (including the nutrition engine) inherit module loading semantics. Account, dialogs, onboarding, and dashboard modules are imported dynamically behind independent rejection handlers so module evaluation or initialization failure cannot disable unrelated controls. The single delegated click listener attaches before component initialization. Onboarding initializes independently of Firebase. Optional profile controls are isolated from authentication setup.

Catalog loading runs in the background, with a 10-second request timeout. Both HTTP failure and malformed/incomplete JSON are handled without stopping startup. Validation checks the full **6,636** entries, unique IDs, names, serving sizes, and finite nonnegative nutrients before publishing the search index. Failed loads expose a retry button; a successful late load refreshes the active query and ingredient pickers. The catalog URL is resolved relative to its module. A separately versioned Cache Storage copy provides offline recovery even if the service worker has not taken control; restricted-browser cache failures do not prevent loading fresh data. Search uses a pre-normalized in-memory name/category/barcode index. This historical dataset contains reference foods, not packaged-product barcode coverage; current barcode lookups continue through the product providers.

Firebase Hosting serves the repository root (`public: "."`). Neither its ignore rules nor `.gitignore` exclude `data/`, so `data/foods.json` is deployed directly. The build creates local Firebase/scanner/CSS assets and updates the service-worker cache version; copying the catalog into `dist/` is unnecessary for this hosting layout. The shipped catalog and provenance are already included in the service-worker shell.

Startup browser regressions hold the catalog request open while clicking Account and plan setup, reject a partial catalog and retry, inject dashboard initialization and account/onboarding module evaluation failures, check a clean normal-startup console, and restore all records from the standalone cache after a network failure.

## Authentication investigation and recovery

No account-specific email exceptions or automatic account merges were added. The app preserves Firebase UIDs and owner-only Firestore access.

Fixed paths:

- The initial guest authentication callback no longer emits an account-changing event that dismisses active editors.
- Durable authentication storage falls back to session storage or memory when a browser rejects local persistence.
- Google sign-in explicitly offers account selection rather than reusing an unintended cached Google account.
- Provider collisions retain the pending credential only in memory. Google links only after the matching existing account authenticates successfully; another account's sign-in cannot attach that credential. Sign-out clears pending links.
- Password reset and clearer invalid-credential, provider-conflict, disabled-account, and rate-limit messages are available.
- A successful sign-in followed by a Firestore permission/schema failure is reported as **a diary loading failure**, not bad credentials. Retry reloads the current signed-in account without a full page reload.
- Permission/schema errors are not silently treated as offline mode. Existing cloud diary/catalog records without a profile are restored rather than classified as a new account and overwritten.
- Profile/settings edits are disabled during account hydration or a load failure so edits cannot land in the previous account's device scope.

Production records for `jeanlucamcdonald@gmail.com` and `jeanlucbmcdonald@gmail.com` could not be inspected: the existing Firebase management authentication check failed. The user-reported primary-account failure is therefore not confirmed resolved in production. The exact provider/error message is needed to determine whether a remaining issue is a disabled identity, provider conflict, wrong method, invalid credentials, permission rules, or legacy data shape. Passwords and provider tokens should never be sent through chat.

Emulator tests cover a returning account with legacy targets, a schema-invalid cloud catalog after successful auth, correction plus retry while preserving the UID, clearing browser storage, offline reload, and conflict recovery. Isolated unit tests cover secure provider linking. A real Google popup remains dependent on enabled Google auth and an authorized hosting domain.

## Build, tests, deployment

```sh
npm run build
npm run test:engine
node --test tests/auth-actions.test.cjs
MACROTRACKER_TEST_URL=http://127.0.0.1:8001 npm run test:browser
# With demo Auth/Firestore emulators running, sequentially:
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node --test tests/firestore-rules.test.cjs
MACROTRACKER_EMULATORS=1 MACROTRACKER_TEST_URL=http://127.0.0.1:8001 node --test tests/cloud-browser.test.cjs
```

Rules tests clear the demo Firestore database, so do not run them concurrently with cloud-browser tests using the same project. Updated rules require redeployment to enforce balanced targets and allow owner-only legacy profile-name reads on the production server. Until those legacy-read rules are deployed, a denied optional lookup falls back to the authenticated email prefix without blocking the canonical diary. See [firebase-migration.md](firebase-migration.md) for authenticated Firebase deployment and environment access requirements. New modules and the bundled reference catalog are included in the offline service-worker shell cache; rebuild to update its content version.
