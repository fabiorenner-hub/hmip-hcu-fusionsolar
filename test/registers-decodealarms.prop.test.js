"use strict";

// Feature: persistent-history-and-enhancements, Property 7: Alarm decode bit-correspondence

const test = require("node:test");
const assert = require("node:assert");
const fc = require("fast-check");
const { decodeAlarms, ALARM_BITS } = require("../src/sun2000/registers");

const u16 = fc.integer({ min: 0, max: 0xffff });

function expectedFor(addr, raw) {
	const out = [];
	for (let bit = 0; bit < 16; bit += 1) {
		if (!(raw & (1 << bit))) continue;
		const def = ALARM_BITS[addr] && ALARM_BITS[addr][bit];
		out.push({ code: `${addr}:${bit}`, name: def ? def.name : `alarm-${addr}-bit${bit}`, severity: def ? def.severity : "warning" });
	}
	return out;
}

test("Property 7: one alarm per set bit, catalog name when known else generic id, deterministic order", () => {
	fc.assert(
		fc.property(u16, u16, u16, (a1, a2, a3) => {
			const out = decodeAlarms({ alarm1: a1, alarm2: a2, alarm3: a3 });
			const expected = [...expectedFor(32008, a1), ...expectedFor(32009, a2), ...expectedFor(32010, a3)];
			assert.deepStrictEqual(out, expected);
			// One entry per set bit total.
			const bitCount = [a1, a2, a3].reduce((acc, w) => {
				let c = 0;
				for (let b = 0; b < 16; b += 1) if (w & (1 << b)) c += 1;
				return acc + c;
			}, 0);
			assert.strictEqual(out.length, bitCount);
		}),
		{ numRuns: 100 }
	);
});

test("Property 7 (zero/null): all-zero or null inputs produce an empty list", () => {
	assert.deepStrictEqual(decodeAlarms({ alarm1: 0, alarm2: 0, alarm3: 0 }), []);
	assert.deepStrictEqual(decodeAlarms({}), []);
	assert.deepStrictEqual(decodeAlarms(null), []);
	assert.deepStrictEqual(decodeAlarms({ alarm1: null, alarm2: undefined, alarm3: NaN }), []);
});
