"use strict";

// Feature: persistent-history-and-enhancements, Property 17: Invalid restore leaves configuration unchanged

const os = require("os");
const fs = require("fs");
const path = require("path");
process.env.HMIP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "hmip-cfg-inv-"));

const test = require("node:test");
const assert = require("node:assert");
const fc = require("fast-check");
const config = require("../src/config");

const base = JSON.parse(JSON.stringify(config.DEFAULTS));

// Build a document that fails validateNotifications in one specific way.
function invalidDoc(kind) {
	const doc = JSON.parse(JSON.stringify(base));
	switch (kind) {
		case "lowSoc": doc.notifications.thresholds.lowSocPct = 999; break;
		case "milestone": doc.notifications.thresholds.milestoneKwh = 0; break;
		case "grouping": doc.notifications.groupingWindowSec = -5; break;
		case "rate": doc.notifications.rateLimit.maxPerInterval = 0; break;
		case "quiet": doc.notifications.quietHours.start = "99:99"; break;
		case "severity": doc.notifications.categories.connection.minSeverity = "bogus"; break;
		case "enabled": doc.notifications.categories.connection.enabled = "yes"; break;
		default: doc.notifications.thresholds.fullSocPct = -1;
	}
	return doc;
}

test("Property 17: a document failing validation is rejected and the in-memory config is unchanged", () => {
	fc.assert(
		fc.property(fc.constantFrom("lowSoc", "milestone", "grouping", "rate", "quiet", "severity", "enabled", "fullSoc"), (kind) => {
			// Establish a known-good baseline.
			config.restore(JSON.parse(JSON.stringify(base)));
			const before = JSON.parse(JSON.stringify(config.get()));

			assert.throws(() => config.restore(invalidDoc(kind)));
			assert.deepStrictEqual(JSON.parse(JSON.stringify(config.get())), before);
		}),
		{ numRuns: 100 }
	);
});

test("Property 17 (non-object): null/array/string documents are rejected", () => {
	config.restore(JSON.parse(JSON.stringify(base)));
	const before = JSON.parse(JSON.stringify(config.get()));
	for (const bad of [null, undefined, [], "x", 42]) {
		assert.throws(() => config.restore(bad));
	}
	assert.deepStrictEqual(JSON.parse(JSON.stringify(config.get())), before);
});
