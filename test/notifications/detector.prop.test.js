"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fc = require("fast-check");
const { EventDetector } = require("../../src/notifications/detector");

function det(categories, thresholds) {
	const conf = { notifications: { categories, thresholds: { lowSocPct: 20, fullSocPct: 98, milestoneKwh: 5, peakPowerW: 8000, ...thresholds } } };
	const d = new EventDetector(() => conf, { now: () => 1 });
	const events = [];
	d.on("event", (e) => events.push(e));
	return { d, events };
}

const conn = { connected: true };

// Feature: telegram-notifications, Property 1: Category enable/disable governs event production
test("Property 1: an enabled category produces an event on its condition; a disabled one does not", () => {
	fc.assert(
		fc.property(fc.boolean(), (enabled) => {
			const { d, events } = det({ "battery-soc-low": { enabled, minSeverity: "warning" } });
			d.onSnapshot({ connected: true, values: { batterySoc: 50 } }, conn); // establish prev
			d.onSnapshot({ connected: true, values: { batterySoc: 10 } }, conn); // crosses 20 downward
			const low = events.filter((e) => e.category === "battery-soc-low");
			assert.strictEqual(low.length, enabled ? 1 : 0);
		})
	);
});

// Feature: telegram-notifications, Property 4: Battery SOC threshold crossings are edge-triggered
test("Property 4: SOC low/full fire exactly on the edge crossing", () => {
	fc.assert(
		fc.property(
			fc.integer({ min: 0, max: 100 }),
			fc.integer({ min: 0, max: 100 }),
			fc.integer({ min: 0, max: 100 }),
			fc.integer({ min: 0, max: 100 }),
			(prev, next, low, full) => {
				const { d, events } = det(
					{ "battery-soc-low": { enabled: true, minSeverity: "info" }, "battery-soc-full": { enabled: true, minSeverity: "info" } },
					{ lowSocPct: low, fullSocPct: full }
				);
				d.onSnapshot({ connected: true, values: { batterySoc: prev } }, conn);
				d.onSnapshot({ connected: true, values: { batterySoc: next } }, conn);
				assert.strictEqual(events.some((e) => e.category === "battery-soc-low"), prev > low && next <= low);
				assert.strictEqual(events.some((e) => e.category === "battery-soc-full"), prev < full && next >= full);
			}
		)
	);
});

// Feature: telegram-notifications, Property 5: Daily energy milestone crossings produce events on multiple increase
test("Property 5: milestone fires iff floor(next/inc) > floor(prev/inc)", () => {
	fc.assert(
		fc.property(
			fc.double({ min: 0, max: 100, noNaN: true }),
			fc.double({ min: 0, max: 100, noNaN: true }),
			fc.integer({ min: 1, max: 20 }),
			(prev, next, inc) => {
				const { d, events } = det({ "energy-milestone": { enabled: true, minSeverity: "info" } }, { milestoneKwh: inc });
				d.onSnapshot({ connected: true, values: { dailyYield: prev } }, conn);
				d.onSnapshot({ connected: true, values: { dailyYield: next } }, conn);
				const fired = events.some((e) => e.category === "energy-milestone");
				assert.strictEqual(fired, Math.floor(next / inc) > Math.floor(prev / inc));
			}
		)
	);
});
