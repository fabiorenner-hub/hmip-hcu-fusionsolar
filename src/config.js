"use strict";

// Persistent config. Stored in /data which is preserved across container
// restarts and plugin updates (per HCU Connect API documentation 4.2).

const fs = require("fs");
const path = require("path");
const log = require("./logger");

const DATA_DIR = process.env.HMIP_DATA_DIR || "/data";
const CONFIG_FILE = path.join(DATA_DIR, "config.json");

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
};

let current = { ...DEFAULTS };

function ensureDir() {
	try {
		fs.mkdirSync(DATA_DIR, { recursive: true });
	} catch (e) {
		log.warn("Could not create data dir", DATA_DIR, e.message);
	}
}

function load() {
	ensureDir();
	try {
		if (fs.existsSync(CONFIG_FILE)) {
			const raw = fs.readFileSync(CONFIG_FILE, "utf8");
			const parsed = JSON.parse(raw);
			current = { ...DEFAULTS, ...parsed };
			log.info("Loaded config from", CONFIG_FILE);
		} else {
			log.info("No config file yet, using defaults");
		}
	} catch (e) {
		log.error("Failed to load config:", e.message);
	}
	return current;
}

function save(next) {
	current = { ...current, ...next };
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

function isReady(c = current) {
	return Boolean(c.inverterHost && c.inverterPort);
}

module.exports = { load, save, get, isReady, DEFAULTS };
