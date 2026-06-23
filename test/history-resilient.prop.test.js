"use strict";

// Feature: persistent-history-and-enhancements, Property 4: Resilient restore

const test = require("node:test");
const assert = require("node:assert");
const fc = require("fast-check");
const history = require("../src/history");

const BUCKET_MS = 60 * 60 * 1000;
const NOW = 1_700_000_000_000;
const VER = history.HISTORY_STORE_VERSION;
const energy = { pvWh: 1, houseWh: 1, importWh: 1, exportWh: 1, battChargeWh: 1, battDischargeWh: 1 };

test("Property 4: restore never throws; missing/garbage/wrong-version → empty tiers", () => {
	fc.assert(
		fc.property(fc.anything(), (input) => {
			let res;
			assert.doesNotThrow(() => { res = history.restore(input, { now: NOW }); });
			const out = history.serialize({ now: NOW });
			const isStore = input && typeof input === "object" && !Array.isArray(input) && input.version === VER;
			if (!isStore) {
				assert.strictEqual(res.ok, false);
				assert.strictEqual(out.hourly.length, 0);
				assert.strictEqual(out.daily.length, 0);
			} else {
				assert.strictEqual(res.ok, true);
			}
		}),
		{ numRuns: 100 }
	);
});

test("Property 4 (mixed): valid in-window entries kept, malformed skipped", () => {
	const valid = () => ({ start: NOW - (1 + Math.floor(Math.random() * 50)) * BUCKET_MS, n: 1, energy, min: {}, max: {} });
	const malformed = fc.oneof(
		fc.constant(null),
		fc.constant({}),
		fc.record({ start: fc.string(), energy: fc.constant(energy) }),
		fc.record({ start: fc.integer(), energy: fc.constant(null) })
	);
	fc.assert(
		fc.property(
			fc.uniqueArray(fc.integer({ min: 1, max: 50 }), { maxLength: 30 }),
			fc.array(malformed, { maxLength: 10 }),
			(validHours, bads) => {
				const good = validHours.map((h) => ({ start: NOW - h * BUCKET_MS, n: 1, energy, min: {}, max: {} }));
				const store = { version: VER, savedAt: NOW, hourly: [...good, ...bads], daily: [] };
				let res;
				assert.doesNotThrow(() => { res = history.restore(store, { now: NOW }); });
				assert.strictEqual(res.ok, true);
				const out = history.serialize({ now: NOW });
				assert.strictEqual(out.hourly.length, good.length);
			}
		),
		{ numRuns: 100 }
	);
});
