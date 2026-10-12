# Cloud-backed MacroTracker

The app remains vanilla JavaScript ES modules. Firebase Authentication supports Email/Password and Google; Firestore stores account data. The public client configuration for `cal-tracker-70796` is in `firebase-config.js`. A Firebase API key is not a service-account credential; authorization is enforced by `firestore.rules`.

## Development

```sh
npm ci --cache /tmp/npm-cache
npm run build
python3 -m http.server 8001 --bind 127.0.0.1
```

Build generates the Firebase SDK, lazy barcode scanner, Tailwind CSS, and service-worker cache version under ignored `dist/`. Rebuild after changing source or configuration. Dependencies and browser-time Tailwind compilation are removed from the normal page-loading path. A local HTTP server works for development; production must use HTTPS for authentication, cameras, service workers, and device caching.

```sh
MACROTRACKER_TEST_URL=http://127.0.0.1:8001 npm run test:browser
```

## Firebase activation

1. Enable Email/Password and Google in Firebase Console → Authentication → Sign-in method.
2. Create the Firestore database in Native mode. Deploy the rules below before letting people use cloud data. Do not leave the database in open test mode.
3. Add your actual hosting domain to Authentication → Settings → Authorized domains. `localhost` must be added explicitly for local Google sign-in when required by the project's settings.
4. From an authenticated Firebase CLI on your machine, run:

```sh
firebase login
firebase deploy --only firestore:rules --project cal-tracker-70796
# If you want to publish the static app through Firebase Hosting:
npm run build
firebase deploy --only hosting --project cal-tracker-70796
```

Production deployment was not performed here: the running cloud environment denies the Firebase domains, and `firebase projects:list` could not establish management authentication. The necessary network-domain additions were saved to the cloud environment draft, preserving existing domains. Apply those changes in environment settings before retrying live Firebase access. Do not send admin credentials in chat. Email and Firestore workflows were exercised against real local emulators; the Google popup requires an enabled provider and authorized browser domain and remains unverified against production.

## Data and recovery

The old `macroTrackerPro_State_v2` localStorage JSON is migrated once into IndexedDB. Its old copy is removed only after the IndexedDB transaction completes. Guest data and each UID have separate device-cache records. A successful first sign-in imports the guest diary only if the cloud account has no profile; an existing account loads its cloud data. JSON import/export remains available in the account panel.

Firestore document paths:

| Path | Contents |
| --- | --- |
| `users/{uid}/profile/current` | Profile, onboarding/settings, calorie/macronutrient goals, schema version |
| `users/{uid}/catalog/current` | Food database and saved meal groups |
| `users/{uid}/logs/{YYYY-MM-DD}` | Date, daily totals, diary entries |
| `users/{uid}/weightLogs/{id}` | Timestamp, value, explicit kg/lb unit |

Firestore's persistent local cache is enabled; the app's IndexedDB cache additionally records pending snapshots and the last synchronized baseline. The service worker caches only the public app shell, never Firebase auth/API responses. Signed-in data that was confirmed as backed up can be restored after clearing browser storage by signing in again. Clearing storage before pending edits reach the server still loses those unsynchronized edits. Guest data is device-only; the UI makes that distinction explicit.

Changed documents are sent in revision-checked Firestore transactions, up to 450 documents per chunk. A save is marked backed up only after every chunk succeeds. Offline changes survive reload and are retried after reconnecting. On reconnect, edits to distinct documents can merge; competing changes to the same day/profile/catalog produce a conflict. The device copy is preserved for export, and the user explicitly chooses whether to reload the cloud copy. An existing signed-in account can continue offline; a first sign-in without any account cache requires a successful server read.

Limits: the catalog is one document and each day's diary is one document, subject to Firestore's 1 MiB limit. Rules limit a diary to 1,000 entries. This scaffold does not implement background push synchronization or automatic real-time merging across devices; the app restores account state at sign-in and detects revision conflicts on writes. Split catalogs/large diaries into per-item documents before scaling beyond these limits.

## Unit and animation behavior

One shared unit registry and conversion function serves database creation, meal building, tuning, and logging. It includes g/kg/oz/lb, ml/l/US fl oz/cup/tbsp/tsp, and serving/piece/slice/scoop bases. Logging offers a base portion plus compatible units. Mass and volume cannot be converted without a food-specific density; count units cannot be interchanged without an equivalence. The UI does not invent those relationships. Unit changes preserve the ingredient's nutrition and logs retain their original nutrition basis for editing.

All serving pickers use a keyboard-accessible, portal listbox with bounded height and scrolling. It can open above the trigger and responds to viewport/keyboard changes. Native recipe selects were removed.

Modal and drawer transitions use transform/opacity, with no moving backdrop blur or layout-dimension animation. Dashboard bars use scaleX instead of width animation. The store refreshes only affected views; logging does not replace pinned pills or the food database. Timers and animation frames are cancelled when a sheet reopens or the app is destroyed. Reduced-motion preferences are honored. The local-date watcher schedules local midnight, handles DST, and rechecks on visibility, focus and resume; yesterday's edit sheets cannot accidentally update today's diary.

## Emulator verification

Java 21 and Node.js are available in the prepared cloud environment. Standard local commands:

```sh
# Terminal 1
firebase emulators:start --project demo-macrotracker --only auth,firestore
# Terminal 2, while the HTTP server is running
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node --test tests/firestore-rules.test.cjs
MACROTRACKER_EMULATORS=1 MACROTRACKER_TEST_URL=http://127.0.0.1:8001 node --test tests/cloud-browser.test.cjs
```

When the standard emulator download from storage.googleapis.com is blocked, the tested fallback downloads the official Google Cloud SDK component and verifies the archive against Google's SHA-256 manifest:

```sh
python3 scripts/setup-firestore-emulator.py
/tmp/macrotracker-firestore-official/platform/cloud-firestore-emulator/cloud_firestore_emulator \
  --host 127.0.0.1 --port 8080 --project_id demo-macrotracker --rules firestore.rules
# In another terminal, start the bundled Node.js Auth emulator:
XDG_CONFIG_HOME=/tmp/macrotracker-config firebase emulators:start --project demo-macrotracker --only auth
```

Tests cover owner-only security rules, malformed write denial, email signup/sign-in, guest migration, cloud restoration after clearing all browser storage, account isolation, offline reload/reconnect, and concurrent-edit conflicts. The browser suite also exercises serving conversions, viewport bounds, midnight rollover, stable DOM nodes, reduced motion, and existing logging/scanner cleanup. Physical-camera and mobile-device frame rates need hardware validation.
