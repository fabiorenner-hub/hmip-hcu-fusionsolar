# Requirements Document

## Introduction

This feature set extends the existing `hmip-plugin-fusionsolar` Node.js HCU plugin with three groups of enhancements:

- **(A) Persistent history, long-term charts, and export** — The tiered history in `src/history.js` (raw 6 h ring, hourly ≤ 96 h, daily ≤ 30 d) is currently kept purely in memory and lost on every restart. This group persists the hourly and daily aggregate tiers (and optionally a recent raw window) to the `/data` volume, loads them on startup, and adds LAN-gated CSV/JSON export endpoints with Verlauf-tab download buttons.
- **(B) More Sun2000 data (alarms + MPPT)** — Adds inverter alarm/fault registers (32008/32009/32010 bitfields) to the register map, decodes active alarm bits to human-readable names, surfaces them in the Diagnose tab and the SSE snapshot, introduces a new edge-triggered `inverter-alarm` notification category, and optionally surfaces a small number of additional cheap read registers (e.g. optimizer count).
- **(C) Polish** — Extends the `I18N` table in `public/app.js` with English coverage for strings routed through `t()`, respects `prefers-color-scheme` for the initial theme when no stored preference exists, adds rate limiting for failed admin logins, adds admin-gated + LAN-gated config backup/restore endpoints, and adds an installable PWA manifest **without** a caching service worker.

The implementation MUST respect existing plugin patterns: the LAN network gate plus `requireAdmin` for writes and sensitive reads, secret redaction (`redactConfig`), config persistence and deep-merge in `config.js`, the SSE snapshot payload shape, bounded ring buffers, and `node:test` + `fast-check` for logic-level testing.

### Non-Goals (Explicitly Out of Scope)

The following are explicitly out of scope and SHALL NOT be implemented by this feature set:

- FusionSolar cloud true-fallback (using cloud data when Modbus is unavailable).
- Energy-flow diagram redesign.
- Multi-inverter support.
- Offline / service-worker caching of dashboard assets (the no-cache contract is preserved).

## Glossary

- **Plugin**: The `hmip-plugin-fusionsolar` Node.js process running inside the HCU container.
- **History_Module**: The module implemented in `src/history.js` that maintains the tiered raw/hourly/daily history.
- **Raw_Tier**: The full-resolution sample ring buffer (`MAX_SAMPLES` = 2160, ~6 h at 10 s).
- **Hourly_Tier**: The aggregate buckets of one entry per hour, retained up to 96 h.
- **Daily_Tier**: The condensed summaries of one entry per day, retained up to ~30 days.
- **History_Store**: The persisted representation of the History_Module tiers written to and read from the Data_Volume.
- **Data_Volume**: The `/data` directory (overridable via `HMIP_DATA_DIR`) that survives container restarts and plugin updates, where `config.json` already lives.
- **History_File**: The file under the Data_Volume that holds the persisted History_Store (e.g. `/data/history.json`).
- **Dashboard_Server**: The Express application built in `src/dashboard/server.js`.
- **LAN_Gate**: The network access control in `src/dashboard/access.js` (`classify`) that restricts requests to local/private/allow-listed source IPs when `lanOnly` is enabled.
- **Admin_Gate**: The `requireAdmin` middleware that requires an authenticated admin session token for writes and sensitive reads.
- **Config_Module**: The module implemented in `src/config.js` that loads, validates, deep-merges, and persists configuration to `config.json`.
- **Register_Map**: The `REG` table and `READ_BLOCKS` in `src/sun2000/registers.js`.
- **Alarm_Registers**: The Sun2000 alarm bitfield holding registers at addresses 32008, 32009, and 32010 (Alarm 1/2/3).
- **Active_Alarm**: A decoded alarm whose corresponding bit is set in an Alarm_Register at the time of a poll.
- **Snapshot**: The runtime state object produced by the poller and broadcast via SSE and `/api/snapshot`.
- **Event_Detector**: The `EventDetector` in `src/notifications/detector.js` that turns runtime state changes into edge-triggered Notification_Events.
- **Notification_Event**: A single notification record emitted by the Event_Detector.
- **Frontend**: The single-page dashboard UI in `src/dashboard/public/app.js` and `index.html`.
- **I18N_Table**: The `I18N` translation object in `public/app.js` consumed by the `t(key)` function.
- **Translation_Key**: A string key passed to `t()` and looked up in the I18N_Table.
- **Theme_Preference**: The dashboard color theme, either `dark` or `light`, stored in `localStorage` under `theme`.
- **Login_Rate_Limiter**: The mechanism that limits failed `/api/admin/login` attempts per source IP within a time window.
- **Config_Backup**: A downloadable JSON document containing the full plugin configuration produced by the backup endpoint.
- **PWA_Manifest**: The web app manifest file (`manifest.webmanifest`) that makes the dashboard installable.

## Requirements

### Requirement 1: Persist history tiers to the Data Volume

**User Story:** As a plugin operator, I want the long-term history tiers to be saved to durable storage, so that my Verlauf trend view and statistics survive plugin restarts.

#### Acceptance Criteria

1. THE History_Module SHALL serialize the Hourly_Tier and the Daily_Tier into a History_Store structure suitable for writing to the History_File.
2. WHERE a recent Raw_Tier persistence window is configured, THE History_Module SHALL include the most recent Raw_Tier samples within that window in the History_Store.
3. THE History_Module SHALL write the History_Store to the History_File under the Data_Volume at a configurable periodic interval.
4. WHEN the Plugin receives a SIGTERM signal, THE Plugin SHALL write the current History_Store to the History_File before the process exits.
5. WHEN the Plugin receives a SIGINT signal, THE Plugin SHALL write the current History_Store to the History_File before the process exits.
6. WHEN the Plugin starts, THE History_Module SHALL read the History_File and restore the Hourly_Tier and Daily_Tier from its contents.
7. THE History_Store SHALL record a schema version identifier so that future format changes are detectable on load.

### Requirement 2: History persistence round-trip integrity

**User Story:** As a plugin operator, I want reloaded history to match what was saved, so that trends and energy totals remain accurate across restarts.

#### Acceptance Criteria

1. WHEN the History_Module serializes the Hourly_Tier and Daily_Tier and then deserializes the resulting History_Store, THE History_Module SHALL produce Hourly_Tier and Daily_Tier collections equivalent to the originals (round-trip property).
2. WHEN the History_Module restores a History_Store on startup, THE History_Module SHALL discard restored Daily_Tier entries whose day is older than the Daily_Tier retention window.
3. WHEN the History_Module restores a History_Store on startup, THE History_Module SHALL discard restored Hourly_Tier entries whose start time is older than the combined retention window represented by the Daily_Tier.
4. WHEN the History_Module restores a History_Store and subsequently ingests a new Snapshot, THE History_Module SHALL continue aggregation without producing duplicate Hourly_Tier buckets for an already-restored hour.

### Requirement 3: Bounded and resilient history persistence

**User Story:** As a plugin operator, I want history persistence to be size-bounded and crash-safe, so that the plugin keeps running even when the history file is missing or damaged.

#### Acceptance Criteria

1. THE History_File SHALL be bounded to a documented maximum size determined by the Hourly_Tier retention (≤ 96 entries), Daily_Tier retention (≤ 30 entries), and any configured Raw_Tier window.
2. IF the History_File is missing when the Plugin starts, THEN THE History_Module SHALL start with empty history tiers and continue operation.
3. IF the History_File cannot be parsed when the Plugin starts, THEN THE History_Module SHALL start with empty history tiers and continue operation.
4. IF the History_File contains an unrecognized schema version when the Plugin starts, THEN THE History_Module SHALL start with empty history tiers and continue operation.
5. IF writing the History_File fails, THEN THE History_Module SHALL log the failure and continue operation without crashing the Plugin.
6. WHEN the History_Module restores history from a History_File, THE History_Module SHALL retain valid in-range entries even if individual entries are malformed and skipped.

### Requirement 4: History export endpoints

**User Story:** As a plugin operator, I want to download my history as CSV and JSON, so that I can analyze it in external tools.

#### Acceptance Criteria

1. WHEN a request for the history aggregate export in CSV format is received from a source permitted by the LAN_Gate, THE Dashboard_Server SHALL respond with the Hourly_Tier and Daily_Tier data formatted as CSV.
2. WHEN a request for the history aggregate export in JSON format is received from a source permitted by the LAN_Gate, THE Dashboard_Server SHALL respond with the Hourly_Tier and Daily_Tier data formatted as JSON.
3. IF a history export request originates from a source rejected by the LAN_Gate while `lanOnly` is enabled, THEN THE Dashboard_Server SHALL respond with HTTP status 403.
4. WHEN the Dashboard_Server responds to a history export request, THE Dashboard_Server SHALL set a `Content-Disposition` header that marks the response as a downloadable attachment with a filename.
5. THE history export endpoints SHALL be read-only and SHALL NOT require the Admin_Gate.
6. THE CSV history export SHALL include a header row naming each exported column.

### Requirement 5: Verlauf-tab export controls

**User Story:** As a dashboard user, I want download buttons in the Verlauf tab, so that I can export history without crafting URLs.

#### Acceptance Criteria

1. THE Frontend SHALL display a CSV download control and a JSON download control in the Verlauf (trend) tab.
2. WHEN a user activates the CSV download control, THE Frontend SHALL initiate a download from the CSV history export endpoint.
3. WHEN a user activates the JSON download control, THE Frontend SHALL initiate a download from the JSON history export endpoint.

### Requirement 6: Inverter alarm registers in the register map

**User Story:** As a developer, I want the Sun2000 alarm registers in the register map, so that alarm bitfields can be read alongside existing data.

#### Acceptance Criteria

1. THE Register_Map SHALL define read-only register entries for the Alarm_Registers at addresses 32008, 32009, and 32010.
2. THE Register_Map SHALL include the Alarm_Registers in a contiguous read block so that they are read during normal polling.
3. WHEN the poller reads the Alarm_Registers, THE Plugin SHALL retain the raw alarm bitfield values for decoding.

### Requirement 7: Decode active alarm bits to human-readable names

**User Story:** As a plugin operator, I want active alarms shown by name, so that I understand inverter faults without consulting a manual.

#### Acceptance Criteria

1. THE Plugin SHALL map each defined alarm bit position within each Alarm_Register to a human-readable Active_Alarm name.
2. WHEN an Alarm_Register value has one or more defined bits set, THE Plugin SHALL produce the list of corresponding Active_Alarm names.
3. WHEN an Alarm_Register value has no defined bits set, THE Plugin SHALL produce an empty list of Active_Alarm names.
4. WHERE a set bit has no defined mapping, THE Plugin SHALL represent that bit using a generic identifier that includes the register address and bit position.
5. THE Plugin SHALL include the current list of Active_Alarm names in the Snapshot.

### Requirement 8: Surface alarms in the Diagnose tab

**User Story:** As a dashboard user, I want active alarms in the Diagnose tab, so that I can see inverter problems at a glance.

#### Acceptance Criteria

1. WHILE one or more Active_Alarm names are present in the Snapshot, THE Frontend SHALL display the Active_Alarm names in the Diagnose tab.
2. WHILE no Active_Alarm names are present in the Snapshot, THE Frontend SHALL indicate that no active alarms are present in the Diagnose tab.

### Requirement 9: Inverter-alarm notification category

**User Story:** As a plugin operator, I want to be notified when a new inverter alarm becomes active, so that I can respond to faults promptly.

#### Acceptance Criteria

1. THE Event_Detector SHALL support a notification category named `inverter-alarm`.
2. WHEN an alarm bit that was not active in the previous Snapshot becomes active in the current Snapshot, THE Event_Detector SHALL emit one `inverter-alarm` Notification_Event for that newly active alarm (edge-triggered).
3. WHILE an alarm bit remains continuously active across consecutive Snapshots, THE Event_Detector SHALL NOT emit an additional `inverter-alarm` Notification_Event for that alarm.
4. IF the `inverter-alarm` category is disabled in the configuration, THEN THE Event_Detector SHALL NOT emit `inverter-alarm` Notification_Events.
5. THE Event_Detector SHALL assign a severity of `critical` to `inverter-alarm` Notification_Events that originate from alarms classified as critical, and a severity of `warning` to all other `inverter-alarm` Notification_Events.
6. THE Config_Module SHALL include the `inverter-alarm` category with documented default enabled state and default minimum severity in the notifications defaults.
7. WHEN a previously active alarm bit clears and later becomes active again, THE Event_Detector SHALL emit a new `inverter-alarm` Notification_Event upon the renewed activation.

### Requirement 10: Additional cheap read registers

**User Story:** As a plugin operator, I want a few more useful read values, so that I have richer diagnostics without significant added cost.

#### Acceptance Criteria

1. WHERE additional low-cost read registers are added, THE Register_Map SHALL define them as read-only entries within an existing or adjacent contiguous read block.
2. WHEN an added read register is successfully read, THE Plugin SHALL include its decoded value in the Snapshot.
3. THE additional read registers SHALL be limited to a modest set that does not require an additional Modbus read block beyond what existing blocks plus minimal extension allow.

### Requirement 11: English i18n coverage

**User Story:** As an English-speaking user, I want the UI in English, so that I can use the dashboard in my preferred language.

#### Acceptance Criteria

1. THE I18N_Table SHALL contain an English entry for every Translation_Key present in the German entry set.
2. THE I18N_Table SHALL contain a German entry for every Translation_Key present in the English entry set.
3. WHERE the feature adds new user-facing UI strings routed through `t()`, THE I18N_Table SHALL define a Translation_Key for each such string in both the German and English entry sets.
4. WHEN the active language is English and a Translation_Key is requested, THE Frontend SHALL return the English translation for that key.

### Requirement 12: Respect prefers-color-scheme for initial theme

**User Story:** As a first-time dashboard user, I want the theme to match my system preference, so that the dashboard looks right without manual configuration.

#### Acceptance Criteria

1. IF no Theme_Preference is stored in `localStorage` AND the user agent reports a `prefers-color-scheme` of `light`, THEN THE Frontend SHALL initialize the Theme_Preference to `light`.
2. IF no Theme_Preference is stored in `localStorage` AND the user agent reports a `prefers-color-scheme` of `dark`, THEN THE Frontend SHALL initialize the Theme_Preference to `dark`.
3. IF no Theme_Preference is stored in `localStorage` AND the user agent reports no `prefers-color-scheme` preference, THEN THE Frontend SHALL initialize the Theme_Preference to `dark`.
4. WHILE a Theme_Preference is stored in `localStorage`, THE Frontend SHALL initialize the theme from the stored value and SHALL ignore `prefers-color-scheme`.
5. WHEN the user toggles the theme, THE Frontend SHALL store the selected Theme_Preference in `localStorage`.

### Requirement 13: Admin-login rate limiting

**User Story:** As a security-conscious operator, I want failed admin logins to be rate limited per source IP, so that password guessing is impractical.

#### Acceptance Criteria

1. THE Login_Rate_Limiter SHALL count failed `/api/admin/login` attempts per source IP within a configured time window.
2. IF the number of failed `/api/admin/login` attempts from a source IP within the time window reaches the configured maximum, THEN THE Dashboard_Server SHALL reject further `/api/admin/login` attempts from that source IP with HTTP status 429 and a descriptive error message until the window elapses.
3. WHEN a `/api/admin/login` attempt from a source IP succeeds, THE Login_Rate_Limiter SHALL reset the failed-attempt count for that source IP.
4. WHEN the configured time window elapses since a source IP became rate limited, THE Login_Rate_Limiter SHALL permit `/api/admin/login` attempts from that source IP again.
5. THE Login_Rate_Limiter SHALL track failed-attempt counts independently per source IP so that one source IP reaching the limit does not block a different source IP.
6. WHILE a source IP is rate limited, THE Dashboard_Server SHALL NOT evaluate the submitted password for `/api/admin/login` requests from that source IP.

### Requirement 14: Config backup export

**User Story:** As an admin, I want to export my full configuration as a JSON file, so that I can back it up before making changes.

#### Acceptance Criteria

1. WHEN an authenticated admin request for a Config_Backup is received from a source permitted by the LAN_Gate, THE Dashboard_Server SHALL respond with the full plugin configuration as a downloadable JSON document.
2. IF a Config_Backup request lacks a valid admin session, THEN THE Dashboard_Server SHALL respond with HTTP status 401.
3. IF a Config_Backup request originates from a source rejected by the LAN_Gate while `lanOnly` is enabled, THEN THE Dashboard_Server SHALL respond with HTTP status 403.
4. WHEN the Dashboard_Server responds with a Config_Backup, THE Dashboard_Server SHALL set a `Content-Disposition` header marking the response as a downloadable attachment with a filename.
5. THE Config_Backup SHALL contain the configuration secret values in unredacted form so that a restored configuration is fully functional.
6. THE documentation for the Config_Backup endpoint SHALL state that the exported document contains plaintext secrets and SHALL be handled securely.

### Requirement 15: Config restore import

**User Story:** As an admin, I want to restore a configuration from a backup file, so that I can recover my settings.

#### Acceptance Criteria

1. WHEN an authenticated admin request to restore a configuration is received from a source permitted by the LAN_Gate with a valid configuration document, THE Config_Module SHALL apply the configuration and persist it.
2. THE Config_Module SHALL validate a submitted configuration document before applying it.
3. IF a submitted configuration document fails validation, THEN THE Dashboard_Server SHALL reject the restore with HTTP status 400 and a descriptive error message AND THE Config_Module SHALL leave the existing configuration unchanged.
4. IF a configuration restore request lacks a valid admin session, THEN THE Dashboard_Server SHALL respond with HTTP status 401.
5. IF a configuration restore request originates from a source rejected by the LAN_Gate while `lanOnly` is enabled, THEN THE Dashboard_Server SHALL respond with HTTP status 403.
6. WHEN the Config_Module exports a Config_Backup and then restores the same document, THE Config_Module SHALL produce a configuration equivalent to the one that was exported (backup/restore round-trip property).
7. WHEN a configuration document is restored, THE Config_Module SHALL deep-merge it over the documented defaults so that keys absent from the document fall back to default values.

### Requirement 16: Installable PWA manifest without service worker

**User Story:** As a mobile user, I want to install the dashboard as an app, so that I can launch it from my home screen.

#### Acceptance Criteria

1. THE Dashboard_Server SHALL serve a PWA_Manifest at a stable path.
2. THE Frontend SHALL reference the PWA_Manifest from the dashboard HTML via a manifest link.
3. THE PWA_Manifest SHALL declare at minimum a name, a short name, a start URL, a display mode, and at least one icon.
4. THE Plugin SHALL NOT register a service worker for the dashboard.
5. THE Dashboard_Server SHALL continue to serve dashboard assets with the existing `Cache-Control: no-cache, must-revalidate` contract.
