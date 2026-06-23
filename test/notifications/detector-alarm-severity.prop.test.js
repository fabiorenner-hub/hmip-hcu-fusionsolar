"use strict";

// Feature: persistent-history-and-enhancements, Property 10: Alarm severity mapping

const test = require("node:test");
const assert = require("node:assert");
const fc = require("fast-check");
const { EventDetector } = require("../../src/notifications/detector");

function det() {
	const conf = { notifications: { categories: { "inverter-alarm": { enabled: true, minSeverity: "info" } } } };
	const d = new EventDetector(() => conf, { now: () => 1 });
	const events = [];
	d.on("event", (e) => events.push(e));
	return { d, events };
}

test("Property 10: emitted severity is critical for critical alarms, warning otherwise", () => {
	fc.assert(
		fc.property(fc.constantFrom("critical", "warning", "info", undefined), (classification) => {
			const { d, events } = det();
			d.onSnapshot({ connected: true, values: {}, alarms: [{ code: "32008:0", name: "X", severity: classification }] }, { connected: true });
			const ev = events.find((e) => e.category === "inverter-alarm");
			assert.ok(ev, "expected an inverter-alarm event");
			assert.strictEqual(ev.severity, classification === "critical" ? "critical" : "warning");
		}),
		{ numRuns: 100 }
	);
});
