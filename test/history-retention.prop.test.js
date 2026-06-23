"use strict";

// Feature: persistent-history-and-enhancements, Property 2: Retention pruning on restore

const test = require("node:test");
const assert = require("node:assert");
const fc = require("fast-check");
const history = require("../src/history");

const BUCKET_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;
const energy = { pvWh: 1, houseWh: 1, importWh: 1, exportWh: 1, battChargeWh: 1, battDischargeWh: 1 };

test("Property 2: restore keeps only in-window entries, discards out-of-window", () => {
	fc.assert(
		fc.property(
			fc.uniqueArray(fc.integer({ min: 1, max: 200 }), { maxLength: 80 }),
			fc.uniqueArray(fc.integer({ min: 1, max: 60 }), { maxLength: 40 }),
			(hoursAgo, daysAgo) => {
				const hourly = hoursAgo.map((h) => ({ start: NOW - h * BUCKET_MS, n: 1, energy, min: {}, max: {} }));
				const daily = daysAgo.map((d) => ({ day: NOW - d * DAY_MS, hours: 1, energy, peakPv: 0, peakHouse: 0, minSoc: null, maxSoc: null }));
				const store = { version: history.HISTORY_STORE_VERSION, savedAt: NOW, hourly, daily };

				history.restore(store, { now: NOW });
				const out = history.serialize({ now: NOW });

				// hourly within 96 h, daily within 30 d.
				const hCutoff = NOW - 96 * BUCKET_MS;
				const dCutoff = NOW - 30 * DAY_MS;
				const expectedH = hoursAgo.filter((h) => h <= 96).length;
				const expectedD = daysAgo.filter((d) => d <= 30).length;
				assert.strictEqual(out.hourly.length, expectedH);
				assert.strictEqual(out.daily.length, expectedD);
				assert.ok(out.hourly.every((e) => e.start >= hCutoff));
				assert.ok(out.daily.every((e) => e.day >= dCutoff));
			}
		),
		{ numRuns: 100 }
	);
});
