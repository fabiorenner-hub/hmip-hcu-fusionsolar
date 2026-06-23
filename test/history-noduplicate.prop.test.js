"use strict";

// Feature: persistent-history-and-enhancements, Property 6: No duplicate hourly buckets after restore

const test = require("node:test");
const assert = require("node:assert");
const fc = require("fast-check");
const history = require("../src/history");

const BUCKET_MS = 60 * 60 * 1000;
const energy = { pvWh: 1, houseWh: 1, importWh: 1, exportWh: 1, battChargeWh: 1, battDischargeWh: 1 };

// Advance the clock by > 96 h per run so a leftover open bucket from the
// previous iteration is condensed into the daily tier instead of polluting.
let clock = 1_700_000_000_000;

test("Property 6: after restore + ingest, no two hourly buckets share the same start", () => {
	fc.assert(
		fc.property(fc.integer({ min: 1, max: 5 }), (back) => {
			clock += 200 * BUCKET_MS;
			const now = clock;
			const hourStart = Math.floor((now - 3 * BUCKET_MS) / BUCKET_MS) * BUCKET_MS;
			const hourly = [];
			for (let i = 0; i < back; i += 1) hourly.push({ start: hourStart - i * BUCKET_MS, n: 1, energy, min: {}, max: {} });
			history.restore({ version: history.HISTORY_STORE_VERSION, savedAt: now, hourly, daily: [] }, { now });

			// Ingest a sample in the restored hour, then one in the next hour to
			// close (and de-dupe) the bucket against the restored entry.
			history.pushSnapshot({ lastUpdate: hourStart + 60000, values: { inputPower: 100, activePower: 90, meterActivePower: -10, batterySoc: 50 } });
			history.pushSnapshot({ lastUpdate: hourStart + BUCKET_MS + 60000, values: { inputPower: 100, activePower: 90, meterActivePower: -10, batterySoc: 50 } });

			const starts = history.aggregates().hourly.map((h) => h.start);
			assert.strictEqual(new Set(starts).size, starts.length, `duplicate starts: ${starts}`);
		}),
		{ numRuns: 100 }
	);
});
