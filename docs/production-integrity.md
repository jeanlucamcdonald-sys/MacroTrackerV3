# Production integrity and account recovery

The deployment workflow now builds assets, deploys `firestore.rules`, then releases Hosting to `cal-tracker-70796`. It supports manual dispatch as well as pushes to main. Both operations use the existing `FIREBASE_SERVICE_ACCOUNT` GitHub repository secret. The rules step creates a mode-0600 credentials file in the runner's temporary directory and deletes it in an `always()` cleanup step. No credentials enter the public hosting directory or logs. The service identity needs permission to deploy Firebase Rules as well as Hosting. A rules deployment failure stops the release rather than silently shipping the client against stale rules.

Direct rules and hosting deployment in this cloud session failed Firebase CLI authentication. The network proxy also returned Forbidden for GitHub Actions API access and for connecting to `cal-tracker-70796.web.app`. Those observations do not establish whether the existing GitHub runner deployed successfully or whether the production rules are correct. Verify the new workflow run in GitHub Actions and its `firestore: released rules` output before calling production verified. Runtime credentials and allowed network destinations must be configured through the supported environment/repository settings, never sent in chat.

## Authentication

`auth-diagnostics.js` records lifecycle transitions, UID, and error code; it deliberately omits emails, passwords, tokens, provider credentials, and raw error objects. Firebase auth callbacks have an error handler, and hydration is bounded by a 15-second deadline. Cached accounts can recover from network/deadline failures through the existing offline merge; permission/schema failures remain explicit errors and are never classified as empty cloud accounts. The account UI preserves the signed-in identity and offers retry/recovery rather than replacing protected diary records with a baseline.

Legacy flat profile fields and partial nested settings/targets merge into defaults in `cloud-model.js`. Known flat name, goal, and calorie/protein/carbohydrate/fat fields migrate into the existing canonical model. Target normalization keeps 4/4/9 energy integrity. Invalid diary/catalog records are still rejected to avoid silently discarding user history. Optional legacy name/root-profile reads remain owner-only. Canonical profile writes stay at `users/{uid}/profile/current`; duplicating writes to the legacy root document would violate the current schema and read-only migration rules.

The profile form saves through the transactional store/device cache and normal Firestore sync, then dispatches `profile:updated`. The greeting subscribes to the event and store updates and reads the authoritative current profile. Provider conflicts offer explicit original-method sign-in and secure linking; no email-specific account overrides, token dumps, or automatic account merges were added.

Tests exercise returning legacy-shaped accounts through three authenticated reloads, preserving UID and diary, but they do not authenticate the real `jeanlucamcdonald@gmail.com` account. Its live provider/permission state remains unverified until production access and an actual account session are available.

## Portable data and weight analytics

Exports retain the versioned native state envelope and additionally expose `version`, `profile`, `targets`, `weights`, and dated `meals`. Native-envelope imports use `state` as the canonical payload. Standalone `version: "1.0"` backups with profile/weights/meals are also accepted; portable meals are daily records with date/totals/diary. Stable IDs, date structure, nutrients, weights, and targets are validated before preview/merge/replace. Imports are account-scoped and never choose a Firebase UID from backup contents.

The weight widget shows the numeric seven-day average and the difference between current and previous seven-day means. Missing weeks do not become zero-weight data. If no recent readings exist, the latest earlier reading is labeled as a fallback. Mixed kg/lb records are converted for comparisons without changing the original records. Initial onboarding weight continues to save once in the same store transaction as the profile and targets, using the stable `onboarding-start` record ID.

## Barcode ingestion

The centered scanner attempts native `BarcodeDetector` for supported UPC/EAN formats, then falls back to the existing html5-qrcode library. Camera streams, detection timers, and product fetches stop on close, Escape, navigation teardown, or an abandoned start. Scanner content and decoded text are not interpolated into HTML.

`searchFoodByBarcode` checks saved products and the loaded catalog first, including zero-padded UPC/EAN equivalence and old `off_<barcode>` saved IDs. Open Food Facts handles unknown products with a bounded request; successful scans save the barcode so later lookups work offline. Product searches also retain returned barcode metadata.

The bundled 6,636 archived USDA reference records have no UPC/EAN mappings. No fabricated mappings were added: scanning arbitrary packaged food offline requires a previously saved/cached product or a genuine barcode-bearing dataset. Tests cover a simulated native camera stream and actual EAN-13 image decoding through the fallback library. They cannot substitute for a physical camera test on the user's device.
