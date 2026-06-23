"use strict";

// Feature: persistent-history-and-enhancements, Property 5: Raw-window selection

const test = require("node:test");
const assert = require("node:assert");
const fc = require("fast-check");
const history = require("../src/history");

const SIX_H = 6 * 60 * 60 * 1000;
const THIRTY_D = 30 * 24 * 60 * 60 * 1000;

// history is a singleton; advance the clock far between runs so samples from a
// previous iteration always fall outside any window <= 6 h we test here.
let clock = 1_700_000_000_000;

test("Property 5: serialize with includeRawWindowMs=w returns exactly the raw samples with t >= now-w", () => {
	fc.assert(
		fc.property(
			fc.array(fc.integer({ min: 0, max: SIX_H }), { maxLength: 60 }),
			fc.integer({ min: 1, max: SIX_H }),
			(ages, w) => {
				clock += THIRTY_D;
				const now = clock;
				const raw = ages.map((a) => ({ t: now - a, inputPower: 0 }));
				history.restore({ version: history.HISTORY_STORE_VERSION, savedAt: now, hourly: [], daily: [], raw }, { now });

				const out = history.serialize({ includeRawWindowMs: w, now });
				const got = out.raw || [];
				const expected = ages.filter((a) => a <= w).length;
				assert.strictEqual(got.length, expected);
				assert.ok(got.every((s) => s.t >= now - w));
			}
		),
		{ numRuns: 100 }
	);
});
