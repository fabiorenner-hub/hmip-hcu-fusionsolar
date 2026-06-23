"use strict";

// Feature: persistent-history-and-enhancements, Property 1: History persistence round-trip

const test = require("node:test");
const assert = require("node:assert");
const fc = require("fast-check");
const history = require("../src/history");

const BUCKET_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

const energyGen = fc.record({
	pvWh: fc.double({ min: 0, max: 1000, noNaN: true }),
	houseWh: fc.double({ min: 0, max: 1000, noNaN: true }),
	importWh: fc.double({ min: 0, max: 1000, noNaN: true }),
	exportWh: fc.double({ min: 0, max: 1000, noNaN: true }),
	battChargeWh: fc.double({ min: 0, max: 1000, noNaN: true }),
	battDischargeWh: fc.double({ min: 0, max: 1000, noNaN: true }),
});

test("Property 1: serialize → JSON round-trip → restore yields equivalent in-window tiers", () => {
	fc.assert(
		fc.property(
			fc.array(energyGen, { maxLength: 96 }),
			fc.array(energyGen, { maxLength: 30 }),
			(hEnergies, dEnergies) => {
				// Build unique, in-window hourly/daily entries (oldest at the window edge).
				const hourly = hEnergies.map((energy, i) => ({
					start: NOW - (i + 1) * BUCKET_MS,
					n: i + 1,
					avg: {},
					min: {},
					max: {},
					energy,
				}));
				const daily = dEnergies.map((energy, i) => ({
					day: NOW - (i + 1) * DAY_MS,
					hours: 24,
					energy,
					peakPv: 0,
					peakHouse: 0,
					minSoc: null,
					maxSoc: null,
				}));
				const store = { version: history.HISTORY_STORE_VERSION, savedAt: NOW, hourly, daily };

				const wire = JSON.parse(JSON.stringify(store));
				const res = history.restore(wire, { now: NOW });
				assert.strictEqual(res.ok, true);

				const out = history.serialize({ now: NOW });
				const expectedHourly = [...wire.hourly].sort((a, b) => a.start - b.start);
				const expectedDaily = [...wire.daily].sort((a, b) => a.day - b.day);
				assert.deepStrictEqual(out.hourly, expectedHourly);
				assert.deepStrictEqual(out.daily, expectedDaily);
			}
		),
		{ numRuns: 100 }
	);
});
