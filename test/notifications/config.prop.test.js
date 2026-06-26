"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fc = require("fast-check");

// Redirect the data dir so requiring config.js never touches /data.
const os = require("os");
const path = require("path");
process.env.HMIP_DATA_DIR = path.join(os.tmpdir(), "hmip-notif-test-" + Date.now());

const config = require("../../src/config");
const { redactConfig } = require("../../src/dashboard/server");
const { CATEGORIES } = require("../../src/notifications/detector");

const DEF = config.DEFAULTS.notifications;
const HEX = "0123456789abcdef".split("");
const hexStr = (min, max) => fc.array(fc.constantFrom(...HEX), { minLength: min, maxLength: max }).map((a) => a.join(""));

// A generator for a complete, valid notifications config (mirrors the schema).
const validNotifications = fc.record({
	categories: fc.constant(JSON.parse(JSON.stringify(DEF.categories))),
	thresholds: fc.record({
		lowSocPct: fc.integer({ min: 0, max: 100 }),
		fullSocPct: fc.integer({ min: 0, max: 100 }),
		milestoneKwh: fc.integer({ min: 1, max: 50 }),
		peakPowerW: fc.integer({ min: 0, max: 20000 }),
	}),
	groupingWindowSec: fc.integer({ min: 1, max: 600 }),
	quietHours: fc.record({ enabled: fc.boolean(), start: fc.constant("22:00"), end: fc.constant("07:00") }),
	rateLimit: fc.record({ maxPerInterval: fc.integer({ min: 1, max: 100 }), intervalSec: fc.integer({ min: 1, max: 7200 }) }),
	telegram: fc.record({ enabled: fc.boolean(), botToken: hexStr(0, 20), chatId: hexStr(0, 12) }),
});

// Feature: telegram-notifications, Property 3: Absent configuration values fall back to documented defaults
test("Property 3: omitted notification keys fall back to defaults via deep-merge", () => {
	fc.assert(
		fc.property(fc.integer({ min: 1, max: 600 }), (g) => {
			const merged = config.deepMerge(DEF, { groupingWindowSec: g });
			assert.strictEqual(merged.groupingWindowSec, g); // provided value kept
			assert.deepStrictEqual(merged.thresholds, DEF.thresholds); // omitted → default
			assert.deepStrictEqual(merged.telegram, DEF.telegram);
			assert.deepStrictEqual(merged.categories, DEF.categories);
		})
	);
	assert.deepStrictEqual(config.deepMerge(DEF, {}), DEF);
});

// Feature: telegram-notifications, Property 20: Notification configuration serialization round-trip
test("Property 20: serialize → load reproduces an equivalent config", () => {
	fc.assert(
		fc.property(validNotifications, (n) => {
			// The real round-trip goes through JSON (the persisted config file),
			// so compare against the JSON-normalised form.
			const serialized = JSON.parse(JSON.stringify(n));
			assert.deepStrictEqual(config.deepMerge(DEF, serialized), serialized);
		})
	);
});

// Feature: telegram-notifications, Property 6: Threshold validation rejects out-of-range updates
test("Property 6: validation accepts in-range and rejects out-of-range thresholds", () => {
	fc.assert(
		fc.property(fc.integer({ min: -50, max: 200 }), fc.integer({ min: -50, max: 200 }), (low, full) => {
			const n = config.deepMerge(DEF, { thresholds: { lowSocPct: low, fullSocPct: full } });
			const valid = low >= 0 && low <= 100 && full >= 0 && full <= 100;
			if (valid) {
				assert.doesNotThrow(() => config.validateNotifications(n));
			} else {
				assert.throws(() => config.validateNotifications(n));
			}
		})
	);
});

// Feature: telegram-notifications, Property 18: Bot token redaction round-trip
test("Property 18: bot token is redacted on read and preserved/overwritten correctly on write", () => {
	fc.assert(
		fc.property(hexStr(1, 30), (token) => {
			const cfg = config.deepMerge(DEF, { telegram: { enabled: true, botToken: token, chatId: "c" } });
			// Redaction never exposes the real token.
			const redacted = redactConfig({ notifications: cfg });
			assert.strictEqual(redacted.notifications.telegram.botToken, "•••");
			// Deep-merge with an absent token (the effect of dropping the "•••" placeholder) preserves it.
			const preserved = config.deepMerge(cfg, { telegram: { enabled: false } });
			assert.strictEqual(preserved.telegram.botToken, token);
			// A non-placeholder value overwrites.
			const changed = config.deepMerge(cfg, { telegram: { botToken: "NEWTOKEN" } });
			assert.strictEqual(changed.telegram.botToken, "NEWTOKEN");
		})
	);
	// Empty token redacts to empty string.
	assert.strictEqual(redactConfig({ notifications: { telegram: { botToken: "" } } }).notifications.telegram.botToken, "");
});

// Requirement 1.1 / 1.5: the category catalog lists every required category with documented defaults
test("category catalog contains all required categories with documented defaults", () => {
	const expected = {
		connection: { defaultEnabled: true, defaultMinSeverity: "warning" },
		"modbus-error": { defaultEnabled: true, defaultMinSeverity: "warning" },
		hcu: { defaultEnabled: true, defaultMinSeverity: "warning" },
		"battery-soc-low": { defaultEnabled: true, defaultMinSeverity: "warning" },
		"battery-soc-full": { defaultEnabled: false, defaultMinSeverity: "info" },
		"energy-milestone": { defaultEnabled: false, defaultMinSeverity: "info" },
		"power-peak": { defaultEnabled: false, defaultMinSeverity: "info" },
		"device-status": { defaultEnabled: true, defaultMinSeverity: "info" },
		"inverter-alarm": { defaultEnabled: true, defaultMinSeverity: "warning" },
		"plugin-update": { defaultEnabled: true, defaultMinSeverity: "info" },
	};
	assert.deepStrictEqual(CATEGORIES, expected);
	// The persisted DEFAULTS mirror the catalog keys.
	assert.deepStrictEqual(Object.keys(DEF.categories).sort(), Object.keys(expected).sort());
});
