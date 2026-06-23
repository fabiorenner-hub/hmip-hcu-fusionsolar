"use strict";

// Feature: persistent-history-and-enhancements, Property 18: CSV export always has a stable header

const test = require("node:test");
const assert = require("node:assert");
const fc = require("fast-check");
const history = require("../src/history");

const HEADER = "tier,startOrDay,n,pvWh,houseWh,importWh,exportWh,battChargeWh,battDischargeWh,peakPv,peakHouse,minSoc,maxSoc";
const COLS = HEADER.split(",").length;

const energyGen = fc.record({
	pvWh: fc.double({ min: 0, max: 1000, noNaN: true }),
	houseWh: fc.double({ min: 0, max: 1000, noNaN: true }),
	importWh: fc.double({ min: 0, max: 1000, noNaN: true }),
	exportWh: fc.double({ min: 0, max: 1000, noNaN: true }),
	battChargeWh: fc.double({ min: 0, max: 1000, noNaN: true }),
	battDischargeWh: fc.double({ min: 0, max: 1000, noNaN: true }),
});
const hourlyGen = fc.record({ start: fc.integer(), n: fc.nat(), energy: energyGen, min: fc.constant({}), max: fc.constant({}) });
const dailyGen = fc.record({ day: fc.integer(), hours: fc.nat(), energy: energyGen, peakPv: fc.nat(), peakHouse: fc.nat(), minSoc: fc.constant(null), maxSoc: fc.constant(null) });

test("Property 18: first line is the fixed header and every row has the same column count", () => {
	fc.assert(
		fc.property(fc.array(hourlyGen, { maxLength: 50 }), fc.array(dailyGen, { maxLength: 50 }), (hourly, daily) => {
			const csv = history.historyToCsv({ hourly, daily });
			const lines = csv.split("\n");
			assert.strictEqual(lines[0], HEADER);
			for (const line of lines) {
				assert.strictEqual(line.split(",").length, COLS);
			}
			assert.strictEqual(lines.length, 1 + hourly.length + daily.length);
		}),
		{ numRuns: 100 }
	);
});

test("Property 18 (empty): header is always present even with no data", () => {
	assert.strictEqual(history.historyToCsv({}), HEADER);
	assert.strictEqual(history.historyToCsv({ hourly: [], daily: [] }), HEADER);
});
