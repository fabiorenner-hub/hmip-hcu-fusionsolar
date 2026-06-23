"use strict";

// Feature: persistent-history-and-enhancements, Property 3: Bounded store

const test = require("node:test");
const assert = require("node:assert");
const fc = require("fast-check");
const history = require("../src/history");

const BUCKET_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;
const energy = { pvWh: 1, houseWh: 1, importWh: 1, exportWh: 1, battChargeWh: 1, battDischargeWh: 1 };

test("Property 3: restore-then-serialize never exceeds 96 hourly / 30 daily, even for oversized inputs", () => {
	fc.assert(
		fc.property(
			fc.integer({ min: 0, max: 300 }),
			fc.integer({ min: 0, max: 120 }),
			(nHourly, nDaily) => {
				// All entries are in-window (consecutive hours/days back from NOW),
				// so the only thing that can drop them is the size cap.
				const hourly = [];
				for (let i = 0; i < nHourly; i += 1) hourly.push({ start: NOW - i * BUCKET_MS, n: 1, energy, min: {}, max: {} });
				const daily = [];
				for (let i = 0; i < nDaily; i += 1) daily.push({ day: NOW - i * DAY_MS, hours: 1, energy, peakPv: 0, peakHouse: 0, minSoc: null, maxSoc: null });
				const store = { version: history.HISTORY_STORE_VERSION, savedAt: NOW, hourly, daily };

				history.restore(store, { now: NOW });
				const out = history.serialize({ now: NOW });
				assert.ok(out.hourly.length <= 96, `hourly ${out.hourly.length} > 96`);
				assert.ok(out.daily.length <= 30, `daily ${out.daily.length} > 30`);
				// In-window entries below the cap are fully retained.
				assert.strictEqual(out.hourly.length, Math.min(nHourly, 96));
				assert.strictEqual(out.daily.length, Math.min(nDaily, 30));
			}
		),
		{ numRuns: 100 }
	);
});
