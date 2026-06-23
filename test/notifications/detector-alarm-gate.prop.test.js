"use strict";

// Feature: persistent-history-and-enhancements, Property 9: Alarm category enable gate

const test = require("node:test");
const assert = require("node:assert");
const fc = require("fast-check");
const { EventDetector } = require("../../src/notifications/detector");

const CODES = ["32008:0", "32008:1", "32009:3", "32010:4"];

function det(enabled) {
	const conf = { notifications: { categories: { "inverter-alarm": { enabled, minSeverity: "warning" } } } };
	const d = new EventDetector(() => conf, { now: () => 1 });
	const events = [];
	d.on("event", (e) => events.push(e));
	return { d, events };
}

function snap(codes) {
	return { connected: true, values: {}, alarms: codes.map((c) => ({ code: c, name: c, severity: "warning" })) };
}

test("Property 9: disabled category emits nothing; enabled follows the edge-trigger rule", () => {
	fc.assert(
		fc.property(fc.boolean(), fc.array(fc.uniqueArray(fc.constantFrom(...CODES)), { maxLength: 12 }), (enabled, sequence) => {
			const { d, events } = det(enabled);
			let prev = new Set();
			let expected = 0;
			for (const codes of sequence) {
				const curr = new Set(codes);
				for (const c of curr) if (!prev.has(c)) expected += 1;
				prev = curr;
				d.onSnapshot(snap(codes), { connected: true });
			}
			const fired = events.filter((e) => e.category === "inverter-alarm").length;
			assert.strictEqual(fired, enabled ? expected : 0);
		}),
		{ numRuns: 100 }
	);
});
