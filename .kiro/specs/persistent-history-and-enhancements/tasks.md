# Implementation Plan: Persistent History & Enhancements

## Overview

This plan implements the three enhancement groups from the design strictly bottom-up and test-first: pure logic (serialize/restore, CSV, alarm decode, detector edge logic, rate limiter, config restore, i18n/theme) lands first with its property test, then the thin I/O / Express / DOM wiring is added and covered by example tests, and finally everything is wired into `index.js` and the lint script.

All code is JavaScript (Node.js + `node:test` + `fast-check` v4), matching the existing codebase. No new runtime dependencies are introduced.

Each of the 18 design correctness properties is realized as exactly one property-based test, in its own file under `test/`, tagged `// Feature: persistent-history-and-enhancements, Property N: ...`. Property and example test sub-tasks are marked optional with `*`.

## Tasks

- [x] 1. Persist history tiers and CSV formatting (`src/history.js`)
  - [x] 1.1 Implement persistence + CSV in `src/history.js`
    - Add `HISTORY_STORE_VERSION = 1` and pure `serialize({ includeRawWindowMs, now })` producing the versioned `History_Store` (`version`, `savedAt`, `hourly`, `daily`, optional `raw`)
    - Add resilient `restore(store, { now })`: version check, prune daily beyond `DAILY_RETENTION_MS` and hourly beyond the combined window, skip malformed entries, de-dupe against open/restored buckets, return `{ ok, restored, skipped }`
    - Add pure `historyToCsv({ hourly, daily })` with the fixed header `tier,startOrDay,n,pvWh,houseWh,importWh,exportWh,battChargeWh,battDischargeWh,peakPv,peakHouse,minSoc,maxSoc` and one row per hourly/daily entry (empty string for absent fields, header always emitted)
    - Add `persistError()` accessor returning the last write error or `null`
    - Export `serialize`, `restore`, `HISTORY_STORE_VERSION`, `historyToCsv`, `persistError` alongside existing exports
    - _Requirements: 1.1, 1.2, 1.6, 1.7, 2.1, 2.2, 2.3, 2.4, 3.1, 3.6, 4.6_
  - [x]* 1.2 Property test: history persistence round-trip
    - File `test/history-roundtrip.prop.test.js`, tag `// Feature: persistent-history-and-enhancements, Property 1: History persistence round-trip`
    - **Property 1** â€” serialize â†’ JSON encode/decode â†’ restore yields equivalent in-window hourly/daily tiers (`{ numRuns: 100 }`)
    - **Validates: Requirements 1.1, 1.6, 2.1**
  - [x]* 1.3 Property test: retention pruning on restore
    - File `test/history-retention.prop.test.js`, tag `// Feature: persistent-history-and-enhancements, Property 2: Retention pruning on restore`
    - **Property 2** â€” restore keeps only in-window daily/hourly entries, discards out-of-window
    - **Validates: Requirements 2.2, 2.3**
  - [x]* 1.4 Property test: bounded store
    - File `test/history-bounded.prop.test.js`, tag `// Feature: persistent-history-and-enhancements, Property 3: Bounded store`
    - **Property 3** â€” restore-then-serialize yields â‰¤96 hourly, â‰¤30 daily, â‰¤`rawWindowMs/pollIntervalMs` raw, even for oversized inputs
    - **Validates: Requirements 3.1**
  - [x]* 1.5 Property test: resilient restore
    - File `test/history-resilient.prop.test.js`, tag `// Feature: persistent-history-and-enhancements, Property 4: Resilient restore`
    - **Property 4** â€” restore never throws on `null`/garbage/wrong-version/mixed-valid inputs; empty tiers when missing/unparseable/unknown-version, otherwise keeps valid in-window entries and skips malformed ones
    - **Validates: Requirements 3.3, 3.4, 3.6**
  - [x]* 1.6 Property test: raw-window selection
    - File `test/history-rawwindow.prop.test.js`, tag `// Feature: persistent-history-and-enhancements, Property 5: Raw-window selection`
    - **Property 5** â€” serialize with `includeRawWindowMs = w` at `now` includes exactly raw samples with `t >= now - w`
    - **Validates: Requirements 1.2**
  - [x]* 1.7 Property test: no duplicate hourly buckets after restore
    - File `test/history-noduplicate.prop.test.js`, tag `// Feature: persistent-history-and-enhancements, Property 6: No duplicate hourly buckets after restore`
    - **Property 6** â€” after restore + ingest of a new snapshot, no two hourly buckets share the same `start`
    - **Validates: Requirements 2.4**
  - [x]* 1.8 Property test: CSV export always has a stable header
    - File `test/history-csv.prop.test.js`, tag `// Feature: persistent-history-and-enhancements, Property 18: CSV export always has a stable header`
    - **Property 18** â€” `historyToCsv` first line is the fixed header and every data row has the same column count, including for empty tiers
    - **Validates: Requirements 4.6**

- [x] 2. Atomic history store I/O (`src/history-store.js`)
  - [x] 2.1 Create `src/history-store.js`
    - `HISTORY_FILE = path.join(DATA_DIR, "history.json")` where `DATA_DIR = HMIP_DATA_DIR || "/data"`
    - `writeStoreAtomic(store)`: write temp file, `fsync`, `rename` over final; never throws, returns `{ ok, error }`, best-effort unlink of temp on failure, records error for `persistError`
    - `readStore()`: returns parsed object or `null` on missing/corrupt (logged)
    - `persist(history, opts)`: `history.serialize()` â†’ `writeStoreAtomic`
    - `loadInto(history, opts)`: `readStore()` â†’ `history.restore()`
    - `startPeriodicWriter(history, { intervalMs = 5*60*1000, now, setIntervalFn })`: unref'd timer, returns `stop()`
    - _Requirements: 1.3, 1.4, 1.5, 3.2, 3.3, 3.4, 3.5_
  - [x]* 2.2 Example tests for the store I/O
    - File `test/history-store.test.js`
    - Fake clock + spy writer: periodic writer fires exactly once per interval; `writeStoreAtomic` failure is swallowed and logged (returns `{ ok:false }`); `readStore` returns `null` for missing and corrupt files
    - _Requirements: 1.3, 3.2, 3.3, 3.5_

- [x] 3. Alarm registers, decode, and poller wiring (`src/sun2000/registers.js`, `src/sun2000/poller.js`)
  - [x] 3.1 Extend `src/sun2000/registers.js`
    - Add read-only `alarm1` (32008), `alarm2` (32009), `alarm3` (32010) `u16` REG entries and an `alarms` read block (`start: 32008, count: 3`) in `READ_BLOCKS`
    - Add `ALARM_BITS` catalog (register addr â†’ bit index â†’ `{ name, severity }`) and pure `decodeAlarms({ alarm1, alarm2, alarm3 })` returning `Active_Alarm[]` in deterministic order, using the generic `alarm-<addr>-bit<n>` id for unknown bits, `[]` for all-zero/null
    - Export `ALARM_BITS` and `decodeAlarms`
    - _Requirements: 6.1, 6.2, 7.1, 7.2, 7.3, 7.4, 10.1, 10.3_
  - [x]* 3.2 Property test: alarm decode bit-correspondence
    - File `test/registers-decodealarms.prop.test.js`, tag `// Feature: persistent-history-and-enhancements, Property 7: Alarm decode bit-correspondence`
    - **Property 7** â€” one `Active_Alarm` per set bit and none for clear bits; catalog name when defined, generic id otherwise; all-zero â†’ empty list
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4**
  - [x] 3.3 Wire alarms into the poller (`src/sun2000/poller.js`)
    - In `_tick()`, best-effort read the `alarms` block (like meter/battery), retain the raw words in `merged`, set `this.snapshot.alarms = decodeAlarms(merged)`; on block read failure retain the prior value
    - Include any added cheap read register's decoded value in the snapshot
    - _Requirements: 6.3, 7.5, 10.2_
  - [x]* 3.4 Example test for poller alarm wiring
    - File `test/sun2000-poller-alarms.test.js`
    - Fake modbus returning alarm words â†’ `snapshot.alarms` populated via `decodeAlarms`; failed block read retains prior value
    - _Requirements: 6.3, 7.5_

- [x] 4. Inverter-alarm notification category (`src/notifications/detector.js`, `src/config.js`)
  - [x] 4.1 Add edge-triggered `inverter-alarm` emission to `src/notifications/detector.js`
    - Add `"inverter-alarm": { defaultEnabled: true, defaultMinSeverity: "warning" }` to `CATEGORIES`
    - Track `this.prev.activeAlarmCodes` (a `Set`); in `onSnapshot`, emit one `inverter-alarm` per code present now but not before, with severity `critical` if the alarm is classified critical else `warning`; emit nothing for continuously-active codes; re-arm cleared codes; respect the category enable gate
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.7_
  - [x] 4.2 Add `inverter-alarm` default to `src/config.js`
    - Add `"inverter-alarm": { enabled: true, minSeverity: "warning" }` to `DEFAULTS.notifications.categories`
    - _Requirements: 9.6_
  - [x]* 4.3 Property test: alarm notifications are edge-triggered with re-arm
    - File `test/notifications/detector-alarm-edge.prop.test.js`, tag `// Feature: persistent-history-and-enhancements, Property 8: Alarm notifications are edge-triggered with re-arm`
    - **Property 8** â€” exactly one event per newly-active code, none for continuously-active codes, re-emit after clear+reactivate
    - **Validates: Requirements 9.2, 9.3, 9.7**
  - [x]* 4.4 Property test: alarm category enable gate
    - File `test/notifications/detector-alarm-gate.prop.test.js`, tag `// Feature: persistent-history-and-enhancements, Property 9: Alarm category enable gate`
    - **Property 9** â€” disabled category â†’ no `inverter-alarm` events; enabled â†’ edge-trigger rule applies
    - **Validates: Requirements 9.4**
  - [x]* 4.5 Property test: alarm severity mapping
    - File `test/notifications/detector-alarm-severity.prop.test.js`, tag `// Feature: persistent-history-and-enhancements, Property 10: Alarm severity mapping`
    - **Property 10** â€” emitted severity is `critical` for critical-classified alarms, `warning` otherwise
    - **Validates: Requirements 9.5**

- [x] 5. Checkpoint - Groups A core + alarms
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Login rate limiter (`src/dashboard/access.js`, `src/config.js`)
  - [x] 6.1 Implement the per-IP limiter in `src/dashboard/access.js`
    - Module-level `loginAttempts` `Map` keyed by normalized IP (`{ count, resetAt }`)
    - `checkLoginAllowed(ip, { now, windowMs, max })` â†’ `{ allowed, retryAfterMs }`; `recordLoginFailure(ip, { now, windowMs, max })`; `resetLoginAttempts(ip)`
    - Per-IP independence; window expiry re-permits attempts
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_
  - [x] 6.2 Add `security.loginRateLimit` default to `src/config.js`
    - `DEFAULTS.security = { loginRateLimit: { windowSec: 900, maxAttempts: 5 } }`
    - _Requirements: 13.1, 13.2_
  - [x]* 6.3 Property test: login rate-limit threshold and window reset
    - File `test/dashboard/access-ratelimit-threshold.prop.test.js`, tag `// Feature: persistent-history-and-enhancements, Property 13: Login rate-limit threshold and window reset`
    - **Property 13** â€” permitted below max, rejected at max, re-permitted after window (injected clock)
    - **Validates: Requirements 13.1, 13.2, 13.4**
  - [x]* 6.4 Property test: login rate-limit per-IP independence
    - File `test/dashboard/access-ratelimit-perip.prop.test.js`, tag `// Feature: persistent-history-and-enhancements, Property 14: Login rate-limit per-IP independence`
    - **Property 14** â€” exhausting one IP does not block another; success resets only that IP
    - **Validates: Requirements 13.3, 13.5**

- [x] 7. Config restore (`src/config.js`)
  - [x] 7.1 Implement `config.restore()` and remaining defaults in `src/config.js`
    - Add `DEFAULTS.history = { persistIntervalSec: 300, rawWindowSec: 0 }`
    - Implement `restore(document)`: validate (reuse `validateNotifications` + basic shape check), `deepMerge(DEFAULTS, document)`, then `save()`; throw on validation failure leaving current config unchanged
    - Export `restore`
    - _Requirements: 15.1, 15.2, 15.3, 15.6, 15.7_
  - [x]* 7.2 Property test: config backup/restore round-trip
    - File `test/config-restore-roundtrip.prop.test.js`, tag `// Feature: persistent-history-and-enhancements, Property 15: Config backup/restore round-trip`
    - **Property 15** â€” exporting a valid config then restoring it yields an equivalent config
    - **Validates: Requirements 15.6**
  - [x]* 7.3 Property test: restore merges over defaults
    - File `test/config-restore-defaults.prop.test.js`, tag `// Feature: persistent-history-and-enhancements, Property 16: Restore merges over defaults`
    - **Property 16** â€” keys absent from a (partial) document equal documented defaults after restore
    - **Validates: Requirements 15.7**
  - [x]* 7.4 Property test: invalid restore leaves configuration unchanged
    - File `test/config-restore-invalid.prop.test.js`, tag `// Feature: persistent-history-and-enhancements, Property 17: Invalid restore leaves configuration unchanged`
    - **Property 17** â€” a document failing validation is rejected and the in-memory config is unchanged
    - **Validates: Requirements 15.2, 15.3**

- [x] 8. i18n parity and initial theme (`src/dashboard/public/app.js`)
  - [x] 8.1 Extend i18n and theme initializer in `src/dashboard/public/app.js`
    - Extend `I18N.de`/`I18N.en` so every key exists in both; add keys for export buttons, alarms card, and backup/restore controls
    - Add pure `i18nKeyParity(table)` â†’ `{ missingInEn, missingInDe }` and pure `initialTheme(stored, prefersLight)` returning stored when present else `light`/`dark`; replace the theme initializer to use `matchMedia("(prefers-color-scheme: light)")`
    - Export `i18nKeyParity` and `initialTheme` under a `module.exports` guard so the browser bundle is unaffected
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 12.1, 12.2, 12.3, 12.4, 12.5_
  - [x]* 8.2 Property test: i18n bidirectional key parity
    - File `test/dashboard/app-i18n-parity.prop.test.js`, tag `// Feature: persistent-history-and-enhancements, Property 11: i18n bidirectional key parity`
    - **Property 11** â€” symmetric difference of the German and English key sets is empty
    - **Validates: Requirements 11.1, 11.2, 11.3**
  - [x]* 8.3 Property test: initial-theme decision
    - File `test/dashboard/app-theme.prop.test.js`, tag `// Feature: persistent-history-and-enhancements, Property 12: Initial-theme decision`
    - **Property 12** â€” stored preference wins; otherwise `light` when UA reports light, else `dark`
    - **Validates: Requirements 12.1, 12.2, 12.3, 12.4**

- [x] 9. Checkpoint - Polish logic
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Dashboard endpoints, UI wiring, and manifest
  - [x] 10.1 Add endpoints to `src/dashboard/server.js`
    - `GET /api/history/export.json` and `GET /api/history/export.csv` â€” LAN-gated, no admin, `Content-Disposition: attachment` with ISO filename; CSV via `historyToCsv`
    - `GET /api/config/backup` â€” `requireAdmin` + LAN, unredacted `getConfig()`, attachment
    - `POST /api/config/restore` â€” `requireAdmin` + LAN, `config.restore()`; `400` on validation failure (config unchanged)
    - `/api/admin/login` â€” call `checkLoginAllowed` first; if blocked return `429` + `Retry-After` without evaluating the password; on wrong password `recordLoginFailure`; on success `resetLoginAttempts` then issue token; window/max from `config.security.loginRateLimit`
    - Serve `manifest.webmanifest` via existing `express.static` (inherits no-cache headers)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 13.2, 13.3, 13.6, 14.1, 14.2, 14.3, 14.4, 14.5, 15.1, 15.3, 15.4, 15.5, 16.1, 16.5_
  - [x] 10.2 Create `src/dashboard/public/manifest.webmanifest`
    - Declare `name`, `short_name`, `start_url`, `display`, and at least one icon; no service worker
    - _Requirements: 16.3, 16.4_
  - [x] 10.3 Update `src/dashboard/public/index.html`
    - Add CSV + JSON download controls in the Verlauf (`tab-trend`) section, the Diagnose "Aktive Alarme" card, backup/restore controls, and `<link rel="manifest" href="manifest.webmanifest">`
    - _Requirements: 5.1, 8.1, 8.2, 14.1, 15.1, 16.2_
  - [x] 10.4 Wire controls and alarm rendering in `src/dashboard/public/app.js`
    - Initiate downloads from the CSV/JSON export endpoints; wire backup/restore controls; render `state.snapshot.alarms` in the Diagnose card with a localized "no active alarms" line when empty
    - _Requirements: 5.2, 5.3, 8.1, 8.2_
  - [x]* 10.5 Endpoint integration tests
    - File `test/dashboard/endpoints.test.js`
    - LAN gate â†’ 403; admin gate â†’ 401/200; `Content-Disposition` present on exports/backup; CSV content type; manifest served with `Cache-Control: no-cache, must-revalidate`; rate-limited login â†’ 429 without password evaluation
    - _Requirements: 4.3, 4.4, 14.2, 14.3, 14.4, 15.3, 15.4, 15.5, 16.1, 16.5, 13.6_

- [x] 11. Wire persistence into the process lifecycle (`src/index.js`)
  - [x] 11.1 Restore at startup and persist on shutdown in `src/index.js`
    - Before `poller.start()`: `historyStore.loadInto(history)`
    - After boot: `const stopWriter = historyStore.startPeriodicWriter(history)`
    - In existing SIGTERM and SIGINT handlers, before `process.exit(0)`: `historyStore.persist(history)` then `stopWriter()`
    - _Requirements: 1.3, 1.4, 1.5, 1.6_
  - [x]* 11.2 Example test for startup/shutdown wiring
    - File `test/index-shutdown.test.js`
    - Spy `persist` + stubbed `process.exit`: persist runs before exit on SIGTERM/SIGINT; `loadInto` runs at startup
    - _Requirements: 1.4, 1.5, 1.6_

- [x] 12. Extend the lint script (`package.json`)
  - [x] 12.1 Add new JS files to the `lint` script
    - Add `node --check src/history-store.js` (and any other new `.js` files) to the `lint` chain; `manifest.webmanifest` is not JS and is excluded
    - _Requirements: 3.5_

- [x] 13. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP; core implementation tasks are never optional.
- Each of the 18 correctness properties maps to exactly one property-based test in its own file under `test/`, tagged `// Feature: persistent-history-and-enhancements, Property N: ...`.
- Property tests run with `{ numRuns: 100 }` minimum, per the design testing strategy.
- Shared files (`config.js`, `server.js`, `app.js`, `index.html`, `registers.js`) are edited by sequenced tasks placed in different waves so no two concurrent tasks write the same file.
- Checkpoints ensure incremental validation at group boundaries.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "3.1", "4.1", "4.2", "6.1", "8.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4", "1.5", "1.6", "1.7", "1.8", "2.1", "3.2", "3.3", "4.3", "4.4", "4.5", "6.2", "6.3", "6.4", "8.2", "8.3", "10.2"] },
    { "id": 2, "tasks": ["2.2", "3.4", "7.1", "10.3", "10.4"] },
    { "id": 3, "tasks": ["7.2", "7.3", "7.4", "10.1", "11.1", "12.1"] },
    { "id": 4, "tasks": ["10.5", "11.2"] }
  ]
}
```
