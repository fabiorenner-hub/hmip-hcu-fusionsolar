"use strict";

// Persistent config. Stored in /data which is preserved across container
// restarts and plugin updates (per HCU Connect API documentation 4.2).

const fs = require("fs");
const path = require("path");
const log = require("./logger");

const DATA_DIR = process.env.HMIP_DATA_DIR || "/data";
const CONFIG_FILE = path.join(DATA_DIR, "config.json");
const RESET_FLAG_FILE = path.join(DATA_DIR, ".reset_on_next_boot");

const DEFAULTS = {
	// Sun2000 inverter (Modbus TCP).
	inverterHost: "",
	inverterPort: 502,
	// Most Sun2000 inverters answer on slave 1 via SDongleA-05.
	inverterUnitId: 1,
	pollIntervalMs: 10000,
	// Optional hardware presence flags. We auto-detect when possible but
	// expose them so users can force-disable parts if a register read fails.
	hasBattery: true,
	hasMeter: true,
	enableBatteryForcedCharge: false,
	// FusionSolar cloud fallback (read-only). Off by default.
	cloudEnabled: false,
	cloudUser: "",
	cloudPassword: "",
	cloudSubdomain: "region01eu5",
	cloudCaptchaModelPath: "",
	// Persistent identity: stable inverter SN captured on first successful
	// static read. Keeps HmIP device IDs constant across plugin restarts,
	// even when the very first read fails (typical at night or during
	// firmware updates). Once set, never changed automatically.
	persistedSn: "",
	// Local dashboard.
	dashboardPort: 8088,
	dashboardEnabled: true,
	// ── Security ──────────────────────────────────────────────────
	// Restrict the dashboard/API to local networks. When true (default),
	// requests from non-private source IPs are rejected. Reliably blocks
	// exposure if the HCU port is forwarded to the internet. See
	// allowedSubnets for stricter, explicit control.
	lanOnly: true,
	// Optional comma-separated CIDR allowlist (e.g. "192.168.10.0/24").
	// When set, ONLY these ranges (plus loopback) may reach the API. Leave
	// empty to allow any private/same-subnet client.
	allowedSubnets: "",
	// Admin mode: write operations (control, register writes, config
	// changes) require an authenticated admin session. When a password is
	// set, login requires it; when empty, admin mode is a soft accidental-
	// write guard only (set a password for real protection).
	adminPassword: "",
	// ── Notifications ─────────────────────────────────────────────
	// Configurable alerting (Telegram + dashboard Notification Center).
	// Nested object; loaded with a deep-merge so absent keys fall back to
	// the documented defaults below.
	notifications: {
		categories: {
			connection: { enabled: true, minSeverity: "warning" },
			"modbus-error": { enabled: true, minSeverity: "warning" },
			hcu: { enabled: true, minSeverity: "warning" },
			"battery-soc-low": { enabled: true, minSeverity: "warning" },
			"battery-soc-full": { enabled: false, minSeverity: "info" },
			"energy-milestone": { enabled: false, minSeverity: "info" },
			"power-peak": { enabled: false, minSeverity: "info" },
			"device-status": { enabled: true, minSeverity: "info" },
			"inverter-alarm": { enabled: true, minSeverity: "warning" },
			"plugin-update": { enabled: true, minSeverity: "info" },
		},
		thresholds: {
			lowSocPct: 20, // 0..100
			fullSocPct: 98, // 0..100
			milestoneKwh: 5, // kWh increment (> 0)
			peakPowerW: 8000, // W (>= 0)
		},
		groupingWindowSec: 60, // grouping window (> 0)
		quietHours: { enabled: false, start: "22:00", end: "07:00" },
		rateLimit: { maxPerInterval: 10, intervalSec: 3600 },
		telegram: { enabled: false, botToken: "", chatId: "" },
	},
	// ── Security (login rate limiting) ────────────────────────────
	security: { loginRateLimit: { windowSec: 900, maxAttempts: 5 } },
	// ── History persistence ───────────────────────────────────────
	history: { persistIntervalSec: 300, rawWindowSec: 0 },
};

let current = { ...DEFAULTS };

const SEVERITIES = ["info", "warning", "critical"];

// Deep-merge of plain objects: override wins for non-objects; nested plain
// objects are merged recursively so an absent nested key falls back to base.
function deepMerge(base, override) {
	if (!isPlainObject(base) || !isPlainObject(override)) {
		return override === undefined ? base : override;
	}
	const out = { ...base };
	for (const k of Object.keys(override)) {
		out[k] = deepMerge(base[k], override[k]);
	}
	return out;
}

function isPlainObject(v) {
	return v !== null && typeof v === "object" && !Array.isArray(v);
}

// Validate the notifications config. Throws a descriptive Error on the first
// out-of-range / malformed value, leaving the caller's stored config untouched.
function validateNotifications(n) {
	if (!isPlainObject(n)) throw new Error("notifications must be an object");
	const t = n.thresholds || {};
	const inRange = (v, lo, hi) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
	if (!inRange(t.lowSocPct, 0, 100)) throw new Error("notifications.thresholds.lowSocPct must be 0..100");
	if (!inRange(t.fullSocPct, 0, 100)) throw new Error("notifications.thresholds.fullSocPct must be 0..100");
	if (!(typeof t.milestoneKwh === "number" && t.milestoneKwh > 0)) throw new Error("notifications.thresholds.milestoneKwh must be > 0");
	if (!(typeof t.peakPowerW === "number" && t.peakPowerW >= 0)) throw new Error("notifications.thresholds.peakPowerW must be >= 0");
	if (!(typeof n.groupingWindowSec === "number" && n.groupingWindowSec > 0)) throw new Error("notifications.groupingWindowSec must be > 0");
	const rl = n.rateLimit || {};
	if (!(Number.isInteger(rl.maxPerInterval) && rl.maxPerInterval >= 1)) throw new Error("notifications.rateLimit.maxPerInterval must be an integer >= 1");
	if (!(typeof rl.intervalSec === "number" && rl.intervalSec > 0)) throw new Error("notifications.rateLimit.intervalSec must be > 0");
	const q = n.quietHours || {};
	const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
	if (!hhmm.test(q.start || "")) throw new Error("notifications.quietHours.start must be HH:MM");
	if (!hhmm.test(q.end || "")) throw new Error("notifications.quietHours.end must be HH:MM");
	for (const [key, c] of Object.entries(n.categories || {})) {
		if (!c || typeof c.enabled !== "boolean") throw new Error(`notifications.categories.${key}.enabled must be boolean`);
		if (!SEVERITIES.includes(c.minSeverity)) throw new Error(`notifications.categories.${key}.minSeverity must be one of ${SEVERITIES.join("/")}`);
	}
}

function ensureDir() {
	try {
		fs.mkdirSync(DATA_DIR, { recursive: true });
	} catch (e) {
		log.warn("Could not create data dir", DATA_DIR, e.message);
	}
}

function load() {
	ensureDir();

	// Honor a one-shot reset marker. Lets users force a clean slate without
	// digging into the container filesystem manually: the dashboard "Reset"
	// button drops this file, we wipe both it and the config on next boot.
	if (fs.existsSync(RESET_FLAG_FILE)) {
		try {
			fs.rmSync(CONFIG_FILE, { force: true });
			fs.rmSync(RESET_FLAG_FILE, { force: true });
			log.info("Reset flag found — config wiped, starting from defaults");
		} catch (e) {
			log.warn("Failed to honor reset flag:", e.message);
		}
	}

	try {
		if (fs.existsSync(CONFIG_FILE)) {
			const raw = fs.readFileSync(CONFIG_FILE, "utf8");
			let parsed;
			try {
				parsed = JSON.parse(raw);
			} catch (e) {
				// Fail-fast: a corrupt persisted config must not be silently
				// replaced with defaults — surface it so misconfiguration is
				// visible (Requirement 9.3).
				log.error(`Config file ${CONFIG_FILE} is corrupt and cannot be parsed: ${e.message}`);
				throw new Error(`Corrupt config file ${CONFIG_FILE}: ${e.message}`);
			}
			current = { ...DEFAULTS, ...parsed };
			// Deep-merge the nested notifications block so absent nested keys
			// fall back to documented defaults.
			current.notifications = deepMerge(DEFAULTS.notifications, parsed.notifications || {});
			log.info("Loaded config from", CONFIG_FILE);
		} else {
			log.info("No config file yet, using defaults");
		}
	} catch (e) {
		if (/Corrupt config file/.test(e.message)) throw e;
		log.error("Failed to load config:", e.message);
	}
	return current;
}

// Schedule a full config reset for the next plugin start. Does NOT touch
// the running configuration — the caller is expected to terminate the
// process so the HCU restarts the container.
function scheduleReset() {
	ensureDir();
	try {
		fs.writeFileSync(RESET_FLAG_FILE, new Date().toISOString(), "utf8");
		log.info("Reset scheduled for next boot");
	} catch (e) {
		log.error("Failed to schedule reset:", e.message);
		throw e;
	}
}

// Drop only the persisted SN (HmIP device-id anchor). Used when the user
// wants to regenerate device IDs after replacing the inverter or wiping
// HmIP devices — without losing the rest of the config.
function clearPersistedSn() {
	if (!current.persistedSn) return current;
	current = { ...current, persistedSn: "" };
	try {
		fs.writeFileSync(CONFIG_FILE, JSON.stringify(current, null, 2), "utf8");
		log.info("Cleared persistedSn — next successful read will set a fresh one");
	} catch (e) {
		log.error("Failed to clear persistedSn:", e.message);
	}
	return current;
}

function save(next) {
	// Deep-merge the notifications subtree so partial updates keep existing
	// nested values, then validate before persisting. Validation throws on
	// invalid input, leaving the in-memory config unchanged (Requirement 2.7).
	const merged = { ...current, ...next };
	merged.notifications = deepMerge(current.notifications || DEFAULTS.notifications, (next && next.notifications) || {});
	validateNotifications(merged.notifications);
	current = merged;
	ensureDir();
	try {
		fs.writeFileSync(CONFIG_FILE, JSON.stringify(current, null, 2), "utf8");
		log.info("Config saved");
	} catch (e) {
		log.error("Failed to save config:", e.message);
	}
	return current;
}

function get() {
	return current;
}

// Restore a full/partial configuration document (e.g. from a backup): validate,
// deep-merge over DEFAULTS so absent keys fall back to defaults, then persist.
// Throws on invalid input WITHOUT mutating the current config (Req 15.2/15.3).
function restore(document) {
	if (!document || typeof document !== "object" || Array.isArray(document)) {
		throw new Error("Invalid configuration document");
	}
	const merged = deepMerge(DEFAULTS, document);
	validateNotifications(merged.notifications); // throws → current unchanged
	current = merged;
	ensureDir();
	try {
		fs.writeFileSync(CONFIG_FILE, JSON.stringify(current, null, 2), "utf8");
		log.info("Config restored from backup");
	} catch (e) {
		log.error("Failed to persist restored config:", e.message);
	}
	return current;
}

function isReady(c = current) {
	return Boolean(c.inverterHost && c.inverterPort);
}

module.exports = { load, save, get, isReady, scheduleReset, clearPersistedSn, DEFAULTS, deepMerge, validateNotifications, restore };
