# Requirements Document

## Introduction

This feature adds a comprehensive, highly configurable notification system to the
`hmip-plugin-fusionsolar` Node.js plugin. The plugin already runs 24/7 inside the
Homematic IP HCU container, polling a Sun2000 inverter over Modbus (~every 10 s),
maintaining connections to the HCU WebSocket and the Modbus dongle, and serving a
LAN-gated debug dashboard with an SSE live stream.

The notification system has two delivery surfaces:

1. **Telegram delivery** — outbound messages sent through the Telegram Bot HTTP API
   so the user receives alerts on their phone. Delivery MUST NOT depend on the Python
   ecosystem; it uses the Telegram Bot HTTP API directly (or a Node library such as
   `node-telegram-bot-api`).
2. **Dashboard Notification Center** — an in-dashboard list of unread notifications
   with grouping, mark-as-read, and an unread badge, integrated into the existing
   LAN-gated, admin-mode dashboard.

A central concern is configurability: the user MUST be able to enable or disable each
notification category individually, set thresholds, define quiet hours, and route
categories to specific channels. To avoid spam, related events occurring within a
configurable time window are coalesced into a single grouped digest message rather
than many individual messages.

All persistent settings are stored in `/data/config.json` via `src/config.js`. The
Telegram bot token is a secret and MUST be redacted on read like the existing
`cloudPassword` and `adminPassword` fields.

## Glossary

- **Plugin**: The `hmip-plugin-fusionsolar` Node.js process running inside the HCU container.
- **Notification_System**: The overall feature comprising the event detector, grouping engine, dispatcher, Telegram channel, store, and dashboard Notification Center.
- **Event_Detector**: The Notification_System component that observes runtime sources (poller snapshots, connection-state changes, Modbus errors, HCU WebSocket lifecycle, threshold crossings, milestones) and produces candidate notification events.
- **Notification_Event**: A single detected occurrence with a category, severity, timestamp, and human-readable content.
- **Notification_Category**: A named, independently configurable class of Notification_Event (for example: connection state, Modbus error, battery SOC threshold, daily energy milestone, power peak, device status change).
- **Severity**: The importance level of a Notification_Event. Allowed values: `info`, `warning`, `critical`.
- **Grouping_Engine**: The Notification_System component that coalesces related Notification_Events within a time window into a single Digest_Message.
- **Grouping_Window**: The configurable time span during which related Notification_Events are collected before being flushed into one Digest_Message.
- **Digest_Message**: A single message that combines one or more grouped Notification_Events.
- **Dispatcher**: The Notification_System component that routes Digest_Messages to enabled, eligible delivery channels subject to filtering, quiet hours, and rate limits.
- **Telegram_Channel**: The delivery channel that sends Digest_Messages via the Telegram Bot HTTP API.
- **Bot_Token**: The Telegram bot authentication secret. Treated as a secret like `cloudPassword`/`adminPassword`.
- **Chat_Id**: The Telegram chat identifier that receives messages from the Telegram_Channel.
- **Notification_Center**: The dashboard UI and supporting API that lists unread notifications, supports grouping display, mark-as-read, and an unread badge.
- **Notification_Store**: The in-memory, bounded, persisted-metadata store of Notification_Events and their read/unread state that backs the Notification_Center.
- **Quiet_Hours**: A configurable daily time window during which non-critical Digest_Messages are suppressed or deferred.
- **Config_Store**: The existing persistence layer (`src/config.js`) writing `/data/config.json`.
- **Dashboard**: The existing local web UI and `/api` server (`src/dashboard/server.js`), LAN-gated with admin-mode writes.
- **Admin_Session**: An authenticated dashboard session permitting write operations, per the existing `requireAdmin` gate.
- **Read_State**: The per-notification flag indicating whether the user has marked the Notification_Event as read in the Notification_Center.

## Requirements

### Requirement 1: Configurable Notification Catalog

**User Story:** As a plugin operator, I want a catalog of notification categories that I can individually enable or disable, so that I receive only the notifications I care about.

#### Acceptance Criteria

1. THE Notification_System SHALL provide a catalog of Notification_Categories that includes connection-state changes, Modbus error and reconnect-lockdown events, HCU WebSocket connect and disconnect events, battery State-of-Charge threshold crossings, daily energy milestones, power peak events, and device status changes.
2. THE Config_Store SHALL persist an enabled flag for each Notification_Category.
3. WHERE a Notification_Category is disabled, THE Event_Detector SHALL NOT produce Notification_Events for that Notification_Category.
4. WHERE a Notification_Category is enabled, THE Event_Detector SHALL produce a Notification_Event each time the corresponding source condition is detected.
5. THE Config_Store SHALL persist a minimum Severity per Notification_Category, with allowed values `info`, `warning`, and `critical`.
6. IF a Notification_Event has a Severity lower than the configured minimum Severity for the Notification_Category, THEN THE Dispatcher SHALL exclude that Notification_Event from delivery.
7. WHEN a configuration value for a Notification_Category is absent, THE Notification_System SHALL apply a documented default value for that Notification_Category.

### Requirement 2: Configurable Thresholds

**User Story:** As a plugin operator, I want to set numeric thresholds for value-based notifications, so that alerts fire at levels meaningful to my installation.

#### Acceptance Criteria

1. THE Config_Store SHALL persist a configurable low battery State-of-Charge threshold as a percentage between 0 and 100.
2. THE Config_Store SHALL persist a configurable full battery State-of-Charge threshold as a percentage between 0 and 100.
3. WHEN the battery State-of-Charge in a poller snapshot falls to or below the configured low threshold and the previous snapshot was above the low threshold, THE Event_Detector SHALL produce a low-battery Notification_Event.
4. WHEN the battery State-of-Charge in a poller snapshot rises to or above the configured full threshold and the previous snapshot was below the full threshold, THE Event_Detector SHALL produce a full-battery Notification_Event.
5. THE Config_Store SHALL persist a configurable daily energy milestone increment in kilowatt-hours.
6. WHEN the daily produced energy crosses an integer multiple of the configured milestone increment, THE Event_Detector SHALL produce a daily-energy-milestone Notification_Event.
7. IF a configured threshold value is outside its documented valid range, THEN THE Config_Store SHALL reject the configuration update and return a descriptive error.

### Requirement 3: Event Grouping and Batching

**User Story:** As a plugin operator, I want related events combined into a single message, so that I am not flooded with many individual notifications.

#### Acceptance Criteria

1. THE Config_Store SHALL persist a configurable Grouping_Window duration in seconds.
2. WHEN a Notification_Event is produced and no Grouping_Window is currently open, THE Grouping_Engine SHALL open a Grouping_Window and add the Notification_Event to it.
3. WHILE a Grouping_Window is open, THE Grouping_Engine SHALL add each newly produced Notification_Event to the open Grouping_Window.
4. WHEN the Grouping_Window duration elapses, THE Grouping_Engine SHALL produce one Digest_Message containing all Notification_Events collected during that Grouping_Window and SHALL deliver it to the Dispatcher.
5. WHEN a Grouping_Window contains exactly one Notification_Event at flush time, THE Grouping_Engine SHALL produce a Digest_Message representing that single Notification_Event.
6. WHEN a Grouping_Window is flushed, THE Digest_Message SHALL contain exactly every Notification_Event collected during that Grouping_Window such that the count of represented Notification_Events equals the count added.
7. IF a Notification_Event has Severity `critical`, THEN THE Grouping_Engine SHALL flush a Digest_Message containing that Notification_Event without waiting for the Grouping_Window to elapse.

### Requirement 4: Telegram Channel Setup

**User Story:** As a plugin operator, I want to configure a Telegram bot token and chat id and send a test message, so that I can confirm delivery works before relying on it.

#### Acceptance Criteria

1. THE Config_Store SHALL persist a Bot_Token and a Chat_Id for the Telegram_Channel.
2. THE Telegram_Channel SHALL send Digest_Messages using the Telegram Bot HTTP API without invoking any Python runtime or Python library.
3. WHERE the Telegram_Channel is enabled and a Bot_Token and Chat_Id are configured, THE Dispatcher SHALL route eligible Digest_Messages to the Telegram_Channel.
4. WHERE the Telegram_Channel is enabled and either the Bot_Token or the Chat_Id is empty, THE Notification_System SHALL report a configuration-incomplete state for the Telegram_Channel and SHALL NOT attempt Telegram delivery.
5. WHEN an Admin_Session requests a Telegram test message, THE Telegram_Channel SHALL send a test message to the configured Chat_Id and SHALL return the delivery outcome.
6. IF a Telegram test message request is made without an Admin_Session, THEN THE Dashboard SHALL reject the request with an authorization error.

### Requirement 5: Dashboard Notification Center

**User Story:** As a plugin operator, I want a Notification Center in the dashboard that shows unread notifications, so that I can review what happened even when I missed the Telegram message.

#### Acceptance Criteria

1. THE Notification_Store SHALL retain produced Notification_Events together with their Read_State.
2. THE Notification_Center SHALL expose an API endpoint that returns the list of unread Notification_Events.
3. THE Notification_Center SHALL display unread Notification_Events grouped by Notification_Category.
4. WHEN an Admin_Session marks a Notification_Event as read, THE Notification_Store SHALL set the Read_State of that Notification_Event to read.
5. WHEN an Admin_Session marks all Notification_Events as read, THE Notification_Store SHALL atomically set the Read_State of every Notification_Event to read such that no Notification_Event remains unread after the operation completes.
6. THE Notification_Center SHALL display an unread badge whose count equals the number of Notification_Events with Read_State unread.
7. WHEN a Notification_Event is marked as read, THE Notification_Center SHALL decrease the unread badge count by the number of newly-read Notification_Events.
8. WHEN a new Notification_Event is produced and added to the Notification_Store with Read_State unread, THE Notification_Center SHALL increase the unread badge count by one.
9. IF a mark-as-read request is made without an Admin_Session, THEN THE Dashboard SHALL reject the request with an authorization error.
10. THE Notification_Store SHALL bound the number of retained Notification_Events to a documented maximum and SHALL discard the oldest Notification_Events when the maximum is exceeded.

### Requirement 6: Delivery Reliability and Retry

**User Story:** As a plugin operator, I want failed Telegram deliveries retried, so that transient network errors do not cause me to miss notifications.

#### Acceptance Criteria

1. WHEN the Telegram_Channel sends a Digest_Message and the Telegram Bot HTTP API returns a success response, THE Telegram_Channel SHALL record the Digest_Message as delivered.
2. IF the Telegram_Channel sends a Digest_Message and the delivery fails, THEN THE Telegram_Channel SHALL retry delivery using increasing delays between attempts until a documented maximum number of total attempts, counting the initial attempt and all retries, is reached.
3. IF the documented maximum number of total delivery attempts is exhausted, THEN THE Telegram_Channel SHALL record the delivery as failed and SHALL log the failure reason.
4. THE Notification_Store SHALL retain a Notification_Event regardless of whether its Telegram delivery succeeded or failed.
5. WHILE the Telegram_Channel is unreachable, THE Notification_System SHALL continue producing Notification_Events and updating the Notification_Center.

### Requirement 7: Quiet Hours and Rate Limiting

**User Story:** As a plugin operator, I want quiet hours and rate limiting, so that I am not disturbed at night or overwhelmed during event storms.

#### Acceptance Criteria

1. THE Config_Store SHALL persist a Quiet_Hours start time and end time.
2. WHILE the current time is within Quiet_Hours, THE Dispatcher SHALL defer delivery of Digest_Messages whose highest Severity is below `critical`.
3. WHEN Quiet_Hours end, THE Dispatcher SHALL deliver Digest_Messages that were deferred during Quiet_Hours.
4. WHILE the current time is within Quiet_Hours, THE Dispatcher SHALL deliver Digest_Messages whose highest Severity is `critical`.
5. THE Config_Store SHALL persist a configurable maximum number of Telegram messages per a documented time interval.
6. IF the configured maximum number of Telegram messages within the time interval is reached, THEN THE Dispatcher SHALL combine further Digest_Messages into a single coalesced Digest_Message and SHALL deliver that coalesced Digest_Message rather than suppressing delivery.

### Requirement 8: Security and Secret Handling

**User Story:** As a plugin operator, I want the Telegram bot token treated as a secret, so that it is not exposed through the dashboard or API.

#### Acceptance Criteria

1. WHEN the configuration is returned by any read endpoint of the Dashboard, THE Dashboard SHALL replace the Bot_Token value with a redaction placeholder.
2. WHEN a configuration update submits the redaction placeholder as the Bot_Token value, THE Config_Store SHALL retain the previously stored Bot_Token unchanged.
3. WHEN a configuration update submits a non-placeholder Bot_Token value, THE Config_Store SHALL store the submitted Bot_Token value.
4. IF a request to change notification configuration is made without an Admin_Session, THEN THE Dashboard SHALL reject the request with an authorization error.
5. THE Notification_System SHALL exclude the Bot_Token value from log output.

### Requirement 9: Configuration Persistence and Defaults

**User Story:** As a plugin operator, I want my notification settings to survive restarts and updates, so that I do not have to reconfigure after every container restart.

#### Acceptance Criteria

1. THE Config_Store SHALL persist all notification configuration values in `/data/config.json`.
2. WHEN the Plugin starts and a persisted notification configuration exists, THE Notification_System SHALL load the persisted configuration.
3. IF the Plugin starts and a persisted notification configuration exists but cannot be read or parsed, THEN THE Plugin SHALL fail to start and SHALL log the failure reason.
4. WHEN the Plugin starts and a notification configuration value is absent, THE Notification_System SHALL apply the documented default value for that configuration value.
5. WHEN a notification configuration update is applied, THE Notification_System SHALL use the updated configuration for subsequent Notification_Events without requiring a Plugin restart.
6. THE Notification_System SHALL serialize and load notification configuration such that loading a previously saved configuration reproduces an equivalent configuration (round-trip property).
