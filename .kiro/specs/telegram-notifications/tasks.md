# Implementation Plan: Telegram Notifications

## Overview

This plan builds the notification subsystem as a self-contained, additive set of modules
under `src/notifications/`, wired into the existing plugin without disturbing the poller,
HCU, history, or dashboard flows. It follows a strict test-driven, bottom-up order:

1. Pure logic layer first (config schema + validation + round-trip, store, format, grouping,
   dispatcher filters/quiet-hours/rate-limit, detector edge logic) with `node:test` +
   `fast-check` property tests.
2. The Telegram `https` transport with a mock-server integration test.
3. The dashboard server API endpoints with auth tests and the SSE unread-count piggyback.
4. The frontend notifications tab/badge and Config-tab fields.
5. Final integration into `index.js` (passive subscriptions to the poller/HCU).

Each of the 20 correctness properties from the design is covered by exactly one
property-based test, tagged `// Feature: telegram-notifications, Property N: ...`. Property
tests live one-per-file under `test/notifications/` so they stay isolated and can run in
parallel. Time-dependent logic uses an injected clock / fake timers for deterministic runs
of 100+ iterations. The subsystem preserves existing behavior (passive subscriptions only)
and the existing security model (LAN gate + `requireAdmin`) and secret redaction.

## Tasks

- [x] 1. Project setup and dependencies
  - [x] 1.1 Add fast-check as a dev dependency
    - Add `fast-check` to `devDependencies` in `package.json` and install it; confirm the
      existing `node --test` runner picks up tests under `test/`
    - Create the `test/notifications/` directory for the new property and unit tests
    - Do not change the existing `test` script (stays `node --test`)
    - _Requirements: 9.6 (testing infrastructure for round-trip and logic properties)_

- [x] 2. Notification config schema, defaults deep-merge, and validation
  - [x] 2.1 Extend `config.js` DEFAULTS with the `notifications` block and deep-merge on load
    - Add the `notifications` object (categories, thresholds, groupingWindowSec, quietHours,
      rateLimit, telegram) to `DEFAULTS` exactly as specified in the design Config schema
    - Extend `load()` so the shallow `{ ...DEFAULTS, ...parsed }` merge deep-merges the
      nested `notifications` sub-object, so any absent nested key falls back to its default
    - Elevate an unparseable persisted `notifications` block to a fatal startup error that
      logs the reason (fail-fast), distinct from absent values which fall back to defaults
    - _Requirements: 1.1, 1.2, 1.5, 1.7, 9.1, 9.2, 9.3, 9.4_

  - [x]* 2.2 Write property test for absent-config defaulting
    - **Property 3: Absent configuration values fall back to documented defaults**
    - **Validates: Requirements 1.7, 9.4**
    - File: `test/notifications/config-defaults.prop3.test.js`

  - [x] 2.3 Add threshold-range validation to `config.js` save path
    - Validate `lowSocPct`/`fullSocPct` (0..100), `milestoneKwh` (> 0), `peakPowerW` (>= 0),
      `groupingWindowSec` (> 0), and rate-limit fields on save; reject out-of-range updates
      with a descriptive error and leave the previously stored configuration unchanged
    - Surface the rejection through the existing error paths (`POST /api/config`
      `res.status(500).json({ error })` and HCU `configUpdateResponse(..., "FAILED", ...)`)
    - _Requirements: 2.1, 2.2, 2.5, 2.7_

  - [x]* 2.4 Write property test for threshold validation
    - **Property 6: Threshold validation rejects out-of-range updates**
    - **Validates: Requirements 2.7**
    - File: `test/notifications/config-validation.prop6.test.js`

  - [x]* 2.5 Write property test for notification config serialization round-trip
    - **Property 20: Notification configuration serialization round-trip**
    - **Validates: Requirements 9.6**
    - File: `test/notifications/config-roundtrip.prop20.test.js`

- [x] 3. Notification store
  - [x] 3.1 Implement `src/notifications/store.js` bounded ring buffer
    - Implement `append(event)`, `listUnread()`, `listGrouped()`, `markRead(id)`,
      `markAllRead()`, and `unreadCount()` over a ring buffer capped at `MAX_NOTIFICATIONS`
      (500), discarding the oldest first, mirroring the `logger.js`/`hcuLog.js` retention style
    - Maintain `unreadCount` incrementally on append/markRead/markAllRead so it is cheap to
      read on every SSE tick; `markAllRead` sets all read atomically and returns count newly read
    - _Requirements: 5.1, 5.3, 5.4, 5.5, 5.6, 5.10, 6.4_

  - [x]* 3.2 Write property test for store bounds and newest-retention
    - **Property 12: Notification store is bounded and retains the newest events**
    - **Validates: Requirements 5.10**
    - File: `test/notifications/store-bounded.prop12.test.js`

  - [x]* 3.3 Write property test for unread-count correctness
    - **Property 11: Unread count tracks reality across all operations**
    - **Validates: Requirements 5.4, 5.5, 5.6, 5.7, 5.8**
    - File: `test/notifications/store-unread-count.prop11.test.js`

  - [x]* 3.4 Write property test for grouped-unread partitioning
    - **Property 10: Unread events partition exactly by category**
    - **Validates: Requirements 5.3**
    - File: `test/notifications/store-grouping.prop10.test.js`

  - [x]* 3.5 Write property test for store independence from delivery outcome
    - **Property 14: Store contents are independent of Telegram delivery outcome**
    - **Validates: Requirements 6.4, 6.5**
    - File: `test/notifications/store-delivery-independence.prop14.test.js`

- [x] 4. Digest formatting
  - [x] 4.1 Implement `src/notifications/format.js`
    - Pure function that renders a `Digest_Message` into Telegram-ready text, truncating to
      the 4096 UTF-16 code-unit limit; no I/O, no token handling
    - _Requirements: 4.2, 3.4, 3.5_

  - [x]* 4.2 Write unit tests for digest formatting
    - Test single-event vs multi-event digests, non-ASCII content, and truncation at the
      4096-char boundary
    - _Requirements: 4.2_

- [x] 5. Grouping engine
  - [x] 5.1 Implement `src/notifications/grouping.js`
    - `GroupingEngine` with one open window at a time: `add(event)` opens a window (timer of
      `groupingWindowSec`) when none is open and appends otherwise; `flush()` emits a
      `"digest"` containing every collected event and clears the window
    - A `critical` event flushes immediately together with all previously collected events
      and cancels the pending timer; use an injected clock / timer for deterministic tests
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

  - [x]* 5.2 Write property test for digest completeness
    - **Property 7: Digest completeness**
    - **Validates: Requirements 3.2, 3.3, 3.4, 3.5, 3.6**
    - File: `test/notifications/grouping-completeness.prop7.test.js`

  - [x]* 5.3 Write property test for immediate critical flush
    - **Property 8: Critical events flush immediately while preserving completeness**
    - **Validates: Requirements 3.7**
    - File: `test/notifications/grouping-critical.prop8.test.js`

- [x] 6. Checkpoint - config, store, format, grouping
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Dispatcher
  - [x] 7.1 Implement `src/notifications/dispatcher.js` severity filtering and channel routing
    - Implement `dispatch(digest)` with the severity filter (drop events below their
      category's `minSeverity`; do not deliver an emptied digest) and channel routing that
      attempts Telegram only when `telegram.enabled` and both `botToken` and `chatId` are
      present, otherwise reports configuration-incomplete and skips delivery
    - Accept the Telegram channel via a `{ telegram }` dependency so it can be mocked
    - _Requirements: 1.6, 4.3, 4.4_

  - [x]* 7.2 Write property test for severity filtering
    - **Property 2: Severity filtering excludes low-severity events from delivery**
    - **Validates: Requirements 1.6**
    - File: `test/notifications/dispatcher-severity.prop2.test.js`

  - [x]* 7.3 Write property test for Telegram channel eligibility
    - **Property 9: Telegram channel eligibility**
    - **Validates: Requirements 4.3, 4.4**
    - File: `test/notifications/dispatcher-eligibility.prop9.test.js`

  - [x] 7.4 Add quiet-hours deferral to the dispatcher
    - Defer digests whose highest severity is below `critical` while `now` is within
      `[quietStart, quietEnd)`; pass `critical` digests through immediately; flush the
      deferred queue when quiet hours end (checked lazily on dispatch and via a low-frequency
      timer); use an injected clock for tests
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [x]* 7.5 Write property test for quiet-hours routing
    - **Property 15: Quiet-hours routing by severity**
    - **Validates: Requirements 7.2, 7.4**
    - File: `test/notifications/dispatcher-quiet-routing.prop15.test.js`

  - [x]* 7.6 Write property test for deferred delivery after quiet hours
    - **Property 16: Deferred digests are delivered after quiet hours end**
    - **Validates: Requirements 7.3**
    - File: `test/notifications/dispatcher-deferred.prop16.test.js`

  - [x] 7.7 Add rate-limit coalescing to the dispatcher
    - Maintain a sliding counter over `rateLimit.intervalSec`; once `maxPerInterval` is
      reached, merge further digests into a single pending coalesced digest that is delivered
      (never suppressed) when capacity returns
    - _Requirements: 7.5, 7.6_

  - [x]* 7.8 Write property test for rate-limit coalescing
    - **Property 17: Rate-limit coalescing delivers without dropping events**
    - **Validates: Requirements 7.6**
    - File: `test/notifications/dispatcher-ratelimit.prop17.test.js`

- [x] 8. Event detector
  - [x] 8.1 Implement `src/notifications/detector.js` and the category catalog
    - Define the `Notification_Category` catalog (keys, default enabled, default minSeverity)
      and implement `EventDetector` (`onSnapshot`, `onHcuState`) holding previous-state for
      edge detection of connection/standby transitions, modbus-error/lockdown, HCU lifecycle,
      battery SOC low/full crossings, energy milestones, power peaks, and device-status changes
    - Read all enable flags, min severities, and thresholds live from `getConfig().notifications`;
      short-circuit disabled categories before constructing an event; treat missing/`null`
      snapshot fields as "no reading" (no spurious edges); emit `"event"` for produced events
    - _Requirements: 1.1, 1.3, 1.4, 2.3, 2.4, 2.6, 9.5_

  - [x]* 8.2 Write property test for category enable/disable governing production
    - **Property 1: Category enable/disable governs event production**
    - **Validates: Requirements 1.3, 1.4**
    - File: `test/notifications/detector-enable.prop1.test.js`

  - [x]* 8.3 Write property test for SOC threshold edge-triggering
    - **Property 4: Battery SOC threshold crossings are edge-triggered**
    - **Validates: Requirements 2.3, 2.4**
    - File: `test/notifications/detector-soc.prop4.test.js`

  - [x]* 8.4 Write property test for daily energy milestone crossings
    - **Property 5: Daily energy milestone crossings produce events on multiple increase**
    - **Validates: Requirements 2.6**
    - File: `test/notifications/detector-milestone.prop5.test.js`

  - [x]* 8.5 Write unit test for the category catalog contents
    - Assert the catalog lists every required category with its documented default enabled
      flag and default minSeverity
    - _Requirements: 1.1, 1.5, 1.7_

- [x] 9. Checkpoint - dispatcher and detector
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Telegram channel (HTTPS transport)
  - [x] 10.1 Implement `src/notifications/telegram.js`
    - Implement `TelegramChannel` with `isConfigured()`, `async send(digest)`, and
      `async sendTest()`; format via `format.js`; POST to
      `https://api.telegram.org/bot<token>/sendMessage` using Node's built-in `https` module
      via a thin `httpPost` helper (no `fetch` dependency, no Python)
    - Bounded retry/backoff up to `MAX_ATTEMPTS` total with non-decreasing exponential delay,
      honoring a `retry_after` hint on HTTP 429 and stopping early on permanent 4xx; record
      delivered on success and failed on exhaustion; never throw into the dispatcher; log
      failures by reason/status only, never including the token
    - _Requirements: 4.2, 6.1, 6.2, 6.3, 6.5, 8.5_

  - [x]* 10.2 Write property test for bounded retries with non-decreasing backoff
    - **Property 13: Delivery retries are bounded with non-decreasing backoff**
    - **Validates: Requirements 6.1, 6.2, 6.3**
    - File: `test/notifications/telegram-retry.prop13.test.js`

  - [x]* 10.3 Write property test for token never appearing in log output
    - **Property 19: Bot token never appears in log output**
    - **Validates: Requirements 8.5**
    - File: `test/notifications/telegram-logsecret.prop19.test.js`

  - [x]* 10.4 Write integration test for the Telegram HTTPS transport against a mock server
    - Stand up a local mock HTTP server (no real network, no Python), point the channel at it,
      and assert the request shape (`chat_id`, `text`, `parse_mode`) and that a `{ ok: true }`
      response records delivered
    - _Requirements: 4.2, 6.1_

- [x] 11. Subsystem facade
  - [x] 11.1 Implement `src/notifications/index.js`
    - Construct store, grouping, dispatcher, telegram, and detector; expose `init(getConfig)`
      and `attach({ poller, hcu })` (passive subscriptions only) plus the dashboard-facing API
      (`listUnread`, `listGrouped`, `markRead`, `markAllRead`, `unreadCount`, `sendTest`)
    - Wire detector `"event"` â†’ store.append AND grouping.add; grouping `"digest"` â†’
      dispatcher.dispatch; keep store-fill and delivery as independent paths
    - _Requirements: 5.1, 5.2, 5.6, 6.4, 6.5_

- [x] 12. Dashboard server API, redaction, and SSE unread count
  - [x] 12.1 Extend secret redaction and placeholder-drop for the Bot_Token
    - Extend `redactConfig()` in `dashboard/server.js` to replace
      `notifications.telegram.botToken` with `"â€¢â€¢â€¢"` when set; extend the `saveConfig`
      placeholder-drop in `index.js` and the `POST /api/config` handler so a submitted `"â€¢â€¢â€¢"`
      token preserves the stored token while any other value overwrites it
    - _Requirements: 8.1, 8.2, 8.3_

  - [x]* 12.2 Write property test for Bot_Token redaction round-trip
    - **Property 18: Bot token redaction round-trip**
    - **Validates: Requirements 8.1, 8.2, 8.3**
    - File: `test/notifications/redaction-roundtrip.prop18.test.js`

  - [x] 12.3 Add the notification API endpoints to `buildServer`
    - Add a `notifications` dependency to `buildServer` and the routes: `GET /api/notifications`
      (grouped unread + count, LAN), `GET /api/notifications/unread` (LAN),
      `POST /api/notifications/:id/read` (`requireAdmin`, rebroadcast snapshot),
      `POST /api/notifications/read-all` (`requireAdmin`, rebroadcast),
      `POST /api/notifications/telegram/test` (`requireAdmin`, returns delivery outcome)
    - Preserve the existing LAN gate and `requireAdmin` middleware semantics
    - _Requirements: 4.5, 4.6, 5.2, 5.3, 5.4, 5.5, 5.7, 5.9, 8.4_

  - [x] 12.4 Extend SSE `buildPayload()` with the unread count
    - Add `unread: notifications.unreadCount()` to the `buildPayload()` object so every SSE
      `snapshot` carries the badge count; mark-read endpoints reuse `broadcast("snapshot", â€¦)`
      to push the decremented count live
    - _Requirements: 5.6, 5.7, 5.8_

  - [x]* 12.5 Write endpoint auth and SSE-unread tests
    - Assert mark-read, mark-all-read, config-change, and Telegram-test endpoints reject
      requests without an Admin_Session (401); assert the Telegram test endpoint returns the
      delivery outcome for an Admin_Session; assert the SSE `snapshot` payload includes the
      `unread` count end-to-end
    - _Requirements: 4.5, 4.6, 5.9, 8.4, 5.6_

- [x] 13. Frontend integration
  - [x] 13.1 Add the notifications tab and unread badge
    - Add a `"notifications"` entry to the `TABS` array and a matching
      `<section id="tab-notifications">` in `index.html`; render a count bubble from
      `state.unread` on the tab button; `activateTab("notifications")` calls
      `loadNotifications()` â†’ `GET /api/notifications`, rendering unread events grouped by
      category with the existing `dl()`/`escape()` helpers; mark-as-read and mark-all-read
      buttons use the existing `writeJSON()` (admin token + 401 handling)
    - _Requirements: 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8_

  - [x] 13.2 Add notification fields to the Config tab
    - Add category enable toggles, min severities, thresholds, grouping window, quiet hours,
      rate limit, and Telegram token/chat id fields; render the Bot_Token field with the
      `"â€¢â€¢â€¢"` placeholder when a token is stored (matching the cloudPassword/adminPassword UX);
      add a Telegram test button that calls the test endpoint via `writeJSON()`
    - _Requirements: 2.1, 2.2, 2.5, 4.1, 4.5, 8.1, 3.1, 7.1, 7.5_

- [x] 14. Final integration into the plugin entry point
  - [x] 14.1 Wire the subsystem into `index.js` and pass it to `buildServer`
    - After `poller` and `hcu` are constructed, call `notifications.init(config.get)` and
      `notifications.attach({ poller, hcu })` (adding listeners only, leaving the existing
      `snapshot` listener and `publishStatusEvents` untouched); pass the facade as the
      `notifications` dependency to `buildServer`; ensure detector callbacks are wrapped so a
      thrown error is logged and swallowed without disrupting existing listeners
    - _Requirements: 5.1, 5.2, 5.6, 9.5, 6.5_

  - [x] 14.2 Extend the lint script for the new files
    - Add `node --check` entries to the `lint` script in `package.json` for
      `src/notifications/{index,detector,grouping,dispatcher,telegram,store,format}.js` so the
      new files are syntax-checked alongside the existing ones
    - _Requirements: 9.1_

  - [x]* 14.3 Write a passive-subscription safety test
    - Assert that an exception thrown inside the notification `snapshot` listener does not
      prevent the existing `snapshot` listeners (`history.pushSnapshot` / `publishStatusEvents`)
      from running
    - _Requirements: 6.5_

- [x] 15. Final checkpoint - full suite and lint
  - Ensure all tests pass and `npm run lint` is clean, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP; core
  implementation tasks are never optional.
- Each correctness property (Properties 1â€“20) is implemented by exactly one property-based
  test, tagged `// Feature: telegram-notifications, Property N: ...`, living one-per-file under
  `test/notifications/` so they stay isolated and parallelizable.
- Property tests run with `fast-check` (numRuns â‰¥ 100) via the existing `node --test` runner;
  time-dependent logic uses an injected clock / fake timers for determinism.
- Every task references the specific requirements and/or design correctness properties it
  implements for traceability.
- The subsystem is strictly additive: it uses passive subscriptions and the existing security
  model (LAN gate + `requireAdmin`) and secret redaction, preserving all existing behavior.

## Property Coverage Map

| Property | Task | Module |
|----------|------|--------|
| 1 Category enable/disable | 8.2 | detector |
| 2 Severity filtering | 7.2 | dispatcher |
| 3 Absent config defaults | 2.2 | config |
| 4 SOC edge-triggering | 8.3 | detector |
| 5 Energy milestone | 8.4 | detector |
| 6 Threshold validation | 2.4 | config |
| 7 Digest completeness | 5.2 | grouping |
| 8 Critical immediate flush | 5.3 | grouping |
| 9 Telegram eligibility | 7.3 | dispatcher |
| 10 Unread partition by category | 3.4 | store |
| 11 Unread count correctness | 3.3 | store |
| 12 Store bounded / newest | 3.2 | store |
| 13 Bounded retries / backoff | 10.2 | telegram |
| 14 Store independent of delivery | 3.5 | store |
| 15 Quiet-hours routing | 7.5 | dispatcher |
| 16 Deferred delivered after quiet | 7.6 | dispatcher |
| 17 Rate-limit coalescing | 7.8 | dispatcher |
| 18 Bot token redaction round-trip | 12.2 | config/server |
| 19 Token never in logs | 10.3 | telegram |
| 20 Config serialization round-trip | 2.5 | config |

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "3.1", "4.1", "5.1", "7.1", "8.1", "10.1"] },
    { "id": 1, "tasks": ["2.2", "2.3", "3.2", "3.3", "3.4", "4.2", "5.2", "5.3", "7.2", "7.3", "7.4", "8.2", "8.3", "8.4", "8.5", "10.2", "10.3", "10.4"] },
    { "id": 2, "tasks": ["2.4", "2.5", "3.5", "7.5", "7.6", "7.7"] },
    { "id": 3, "tasks": ["7.8", "11.1", "12.1"] },
    { "id": 4, "tasks": ["12.2", "12.3"] },
    { "id": 5, "tasks": ["12.4"] },
    { "id": 6, "tasks": ["12.5", "13.1"] },
    { "id": 7, "tasks": ["13.2"] },
    { "id": 8, "tasks": ["14.1"] },
    { "id": 9, "tasks": ["14.2", "14.3"] }
  ]
}
```
