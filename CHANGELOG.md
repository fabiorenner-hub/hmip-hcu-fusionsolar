# Changelog

## 0.5.0
Configurable notifications: Telegram delivery + an in-dashboard Notification Center.

### Notifications
- **Configurable catalog**: each category can be enabled/disabled with a minimum
  severity — connection/standby transitions, Modbus errors and reconnect lockdown,
  HCU WebSocket connect/disconnect, battery SOC low/full, daily energy milestones,
  power peaks, and device-status changes.
- **Configurable thresholds**: low/full battery SOC, daily energy milestone
  increment, power-peak level (validated on save).
- **Grouping/batching**: related events within a configurable window are coalesced
  into a single digest message instead of many; critical events flush immediately,
  carrying along everything already collected.
- **Quiet hours & rate limiting**: during quiet hours only critical digests are
  delivered immediately, the rest are deferred and sent afterwards; once the rate
  limit is hit, further digests are coalesced and delivered (never dropped).
- **Telegram channel**: delivery via the Telegram Bot HTTP API using Node's built-in
  `https` (no Python, no new runtime), with bounded exponential-backoff retry that
  honours a 429 `retry_after`. A "Telegram testen" button verifies setup. The bot
  token is redacted like `cloudPassword`/`adminPassword` and never written to logs.
- **Notification Center**: a new "Meldungen" tab lists unread events grouped by
  category with mark-as-read / mark-all-read (admin-gated), and an unread badge on
  the tab that updates live via the existing SSE snapshot.

### Architecture & tooling
- New additive subsystem under `src/notifications/` (detector, grouping, dispatcher,
  telegram, store, format, facade) wired via passive subscriptions to the poller and
  HCU — existing flows are untouched.
- New `/api/notifications*` endpoints behind the LAN gate + `requireAdmin`.
- Config persists the full `notifications` block in `/data/config.json` with a
  deep-merge so absent keys fall back to defaults; hot-reloaded without restart.
- Added a `fast-check` property-test suite covering 20 correctness properties
  (digest completeness, critical immediate-flush, unread-count invariant, store
  bound, severity filtering, Telegram eligibility, quiet-hours routing, rate-limit
  coalescing without loss, SOC/milestone edges, bounded retries, token-never-logged,
  redaction and config round-trips).

## 0.4.1
- **Admin login was unreachable**: when an admin password was set, there was
  no visible field to enter it — unlocking relied solely on the header lock,
  which only prompted when the client's cached `adminProtected` flag happened
  to be set. Added a dedicated **Admin-Modus** card at the top of the Config
  tab (password field + Anmelden/Abmelden, with a live status line). Also made
  `ensureAdmin()` robust: a `403` from the server now always prompts for the
  password and retries, even if the cached state was stale.

## 0.4.0
Security and UI overhaul.

### Security
- **LAN-only access**: the dashboard and its API now reject requests from
  non-private source IPs (`lanOnly`, default on). This reliably blocks access
  from the internet even if the HCU's port gets forwarded. An optional
  `allowedSubnets` CIDR allowlist (e.g. `192.168.10.0/24`) narrows it further.
  `/healthz` stays open for the HCU's own probing. (NAT caveat: behind the
  HCU's port mapping the source IP may be the bridge gateway, so the practical
  guarantee is "block non-private", which is the property that matters.)
- **Admin mode**: every write — battery/charge control, register writes,
  config changes, resets, slave-id probe — now requires an authenticated admin
  session. Set `adminPassword` for real protection; when empty, admin mode is
  a soft guard against accidental writes. Login issues a 2 h token; secrets are
  redacted in `/api/config`.

### Reliability
- **Standby instead of red**: when the TCP link is up but the inverter is
  asleep (night mode), the status pill shows amber "Wechselrichter im Standby"
  and `/healthz` returns 200 — so the HCU no longer restart-loops overnight.
- **Block-read fallback**: if one unsupported/de-energised register fails an
  atomic block read (typical for PV strings at dusk) but the inverter is
  otherwise responsive, the block is retried register-by-register so the
  readable fields still come through.
- **Accurate daily energy** sourced from the inverter's own counters
  (daily yield, battery daily, meter deltas) rather than integrated power.

### UI / UX
- Chart **hover tooltips** with crosshair and per-series values.
- Smart **W/kW** unit formatting.
- New **Verlauf** tab visualising the long-term hourly/daily aggregates.
- **Autarky donut**, KPI **sparklines**, "Energie heute" card.
- Tab bar wraps on narrow screens; **favicon**; live "vor X s" ticker;
  loading state; keyboard-focus and ARIA tweaks.

### Tooling
- **ESLint** (flat config) and a **`node:test`** suite (decode/encode,
  history energy, Modbus reconnect state machine, server access/admin wiring).
- Backend performance: SSE payload is skipped when no client is connected;
  self-sufficiency is computed once per snapshot instead of per request.

## 0.3.10
- **Critical: debug dashboard was completely broken.** A stray ASCII double
  quote inside a German `confirm()` string (the "reset device identity"
  button introduced in 0.3.7) terminated the string early, causing a syntax
  error in `app.js`. The whole script aborted before `buildTabs()`/`render()`
  ran, so the dashboard showed only the base layout — no tabs, no data, and a
  permanently red status dot (the CSS default, not a real status). Fixed by
  escaping the quote. `app.js` and `chart.js` are now part of `npm run lint`
  (`node --check`), which would have caught this.
- **Model string NUL**: `decodeString` now cuts at the first NUL byte, so the
  inverter model reads as `SUN2000-8KTL-M1` instead of
  `SUN2000-8KTL-M1\u000001074314-006`. The clean value is what gets sent to
  the HCU as `modelType` and shown on the dashboard.
- **Tab bar**: wraps onto multiple rows on narrow screens instead of scrolling
  the last tabs (Logs, Diagnose) off the edge with no visible scrollbar.

## 0.3.9
- **Modbus reconnect protection fixed (real bug)**: the escalating cooldown
  after a `socket closed by peer` and the 10-minute lockdown were dead code —
  they referenced an undefined constant (`PEER_CLOSE_COOLDOWN_MS`) and the
  lockdown gate was never read. Under `"use strict"` this threw on the first
  reconnect after a peer-close, so the SDongle's rate-limiter was never
  actually respected. Now the cooldown escalates (30s → 60s → 120s …, capped
  at 5 min), the lockdown is enforced (no connect attempts for 10 min after
  repeated peer-closes), and both reset on the first successful read.
- **STATUS_EVENT only on real change**: device state is no longer re-sent to
  the HCU every poll when nothing changed. Cuts HCU traffic during flat
  periods (night/idle) and stops re-asserting controllable devices (the
  force-charge switch), which is the documented anti-pattern. Inclusion and
  post-control updates still force an emit.
- **Tiered, bounded data retention**: history keeps full 10s resolution for
  6h, hourly aggregates (avg/min/max + integrated energy) up to 96h, then one
  condensed summary per day for ~30 days. Logs and the HCU message log keep
  everything for 96h and are reduced to the essentials (warnings/errors and
  non-routine messages) beyond that. Memory stays bounded regardless of
  uptime. New `GET /api/history/aggregate` exposes the long-term tiers.
- **Cleanup**: removed dead `readMany` code; `npm run lint` now covers all
  Node-side modules (including `modbus.js`, which was previously unchecked).

## 0.3.8
- **Dashboard no-cache**: the dashboard HTML/JS/CSS were served with a
  1-hour cache header. After a plugin update the browser kept serving the
  old bundle, which called the newer backend API and showed only empty
  values (and a stale "v0.2" footer). Assets are now served with
  `Cache-Control: no-cache, must-revalidate` so a normal reload always
  picks up the running version.
- **Live version in footer**: new `GET /api/version` endpoint; the
  dashboard footer now shows the actually running plugin version instead
  of a hard-coded string. Makes "am I on the new build?" obvious.
- **Quiet nights**: Modbus exception 4 (Slave device failure) and
  exception 2 (Illegal data address) on PV/AC registers are the inverter's
  normal response while shutting down for the night. They are now treated
  like an "inverter asleep" timeout (throttled info) instead of a hard
  error, so the log stays clean overnight.

## 0.3.7
- Dashboard → Konfig: zwei neue Wartungs-Knöpfe.
  - **„Geräte-Identität zurücksetzen"** löscht nur die persistierte
    Inverter-SN. Der Rest der Konfig bleibt. Beim nächsten erfolgreichen
    Modbus-Read wird eine frische SN gespeichert. Sinnvoll wenn man die
    HmIP-Geräte komplett neu anlegen lassen will.
  - **„Komplett-Reset"** schreibt eine `/data/.reset_on_next_boot`-Marker-
    Datei und beendet das Plugin nach 2 s. Beim nächsten Start (HCU
    restartet den Container automatisch) wird `/data/config.json` gelöscht
    und das Plugin startet mit Default-Werten. Doppelt bestätigt
    (Confirm + „RESET" eintippen).
- API-Endpoints `POST /api/config/clear-sn` und `POST /api/config/reset`
  (letzterer braucht `{"confirm":"RESET"}` im Body).

## 0.3.6
- **Soft config updates**: changes to non-Modbus settings (dashboard,
  hardware flags, cloud) no longer tear down the Modbus TCP connection.
  The previous behavior triggered the SDongle's reconnect rate-limiter,
  which then RST'd every connection for 10+ minutes after every config
  save. Only changes to host / port / unit-id reset the poller now.
- **30 s cooldown after `socket closed by peer`**: the SDongle keeps a
  rate-limiter on rapid reconnects. When it RSTs us, we now wait 30 s
  before the next connect attempt instead of immediately reconnecting.
  This breaks the "connect → RST → connect → RST" loop that filled
  the logs every 11 s.
- **Static info merge instead of overwrite**: a flaky read no longer
  blanks out the previously known SN/model/FW. The "Inverter: ? SN ?
  FW ?" log line is gone for good — startup logs only the first
  successful identification.
- **Logs**: identical "closed by peer" warnings throttled to 1×/min.

## 0.3.5
- Stable HmIP device IDs across plugin restarts: the inverter serial number
  is now persisted to `/data/config.json` (`persistedSn`) on the first
  successful Modbus read. Later restarts always use the same value, so
  HmIP devices no longer get re-registered as duplicates when the very
  first static read fails (slow Modbus, night mode, firmware update).
- Config form: new read-only "Used serial number" entry under a new
  "Device identity" group, so users can verify which SN drives the IDs.
- Troubleshooting docs (DE + EN) extended:
  - "Comparing values: FusionSolar vs. plugin" — explains why DC vs AC,
    cloud lag and battery idle noise look like discrepancies.
  - "Duplicate devices in the HmIP app" — explains the pre-0.3.5 bug
    and how to clean up.
  - "Getting an installer account" — three concrete paths
    (your installer, self-register, Huawei support).
  - "Firmware update via the FusionSolar web portal" — full step-by-step.

## 0.3.4
- Modbus block reads: instead of issuing one request per register, contiguous
  registers are now read in a single Modbus call. A poll cycle that previously
  fired ~30 separate requests now fires 4–6, which is much friendlier to the
  SDongleA-05 when other Modbus masters (FusionSolar cloud sync, HA, etc.)
  share the inverter.
- Adaptive poll interval: failures back off exponentially (10s → 20s → 40s →
  60s) and reset to base on the next successful read.
- Diagnose: new "Verbindung stabil" check that detects the typical
  "socket closed by peer" pattern and points the user at the
  FusionSolar Modbus-TCP setting ("uneingeschränkt").

## 0.3.3
- Modbus: keep TCP socket open when reads time out (typical at night when
  the inverter is sleeping). Avoids the spammy "Modbus connected" log loop.
- Modbus: read timeout raised from 4 s to 8 s for slow wake-up responses.
- Modbus: identical warnings throttled to once per minute (less log noise).
- Modbus: socket-level errors now drop the connection (and reconnect),
  but timeouts no longer do.
- Dashboard → Diagnose: new "Modbus-Statistik" panel (reads / OK / timeouts /
  errors / writes / last error).
- Dashboard → Diagnose: TCP probe and Slave-ID probe buttons.
- Diagnose check now distinguishes between "TCP connected" and
  "inverter actually answers", with a clear hint pointing at night mode /
  wrong slave id / blocking master when only TCP is up.

## 0.3.0
- Plugin metadata: issuer set to Fabio Renner, GitHub URL and PayPal donation link appended to description rendered in the HCU plugin tile.
- README.md / README.de.md: plugin icon at the top, GitHub link, PayPal donate form, updated download link.
- New plugin icon (icon.svg).

## 0.2.0
- Massively expanded debug dashboard:
  - Server-Sent Events (SSE) for instant live updates.
  - 11 tabs: Overview, Live, Inverter, Battery, Grid, Control, Modbus, HCU, Config, Logs, Diagnostics.
  - Animated SVG energy-flow diagram.
  - Vanilla-canvas multi-series line charts (no external deps).
  - Light/dark theme toggle, DE/EN UI.
  - Per-string PV view, per-phase grid view, battery SOC gauge.
  - Control panel for storage mode, max charge/discharge, target SOC, active power limit.
  - Register browser with search/filter/hex toggle, CSV export, raw-range scanner.
  - HCU message log viewer.
  - Today's peaks (PV, house, import/export, charge/discharge, SOC min/max), self-sufficiency %.
- 6 h history ring buffer (10 s resolution).
- Additional Modbus registers: PV strings 1–4 (V/A), inverter per-phase voltage/current.

## 0.1.0
- Initial release.
- Modbus TCP polling of Sun2000 inverter, LUNA2000 battery, DTSU666-H smart meter.
- HCU Connect API integration: virtual INVERTER, BATTERY, GRID_CONNECTION_POINT, ENERGY_METER devices.
- Optional virtual SWITCH devices for battery forced-charge / forced-discharge.
- Optional FusionSolar cloud fallback (read-only).
- HCUweb config page with grouped properties.
- Local debug dashboard on port 8088 with live values, register browser and write-register tool.

