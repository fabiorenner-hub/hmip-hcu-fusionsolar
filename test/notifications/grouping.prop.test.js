"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fc = require("fast-check");
const { GroupingEngine } = require("../../src/notifications/grouping");

function makeEngine() {
	let fired = null;
	const g = new GroupingEngine(() => ({ notifications: { groupingWindowSec: 60 } }), {
		now: () => 1000,
		setTimer: (fn) => { fired = fn; return 1; },
		clearTimer: () => { fired = null; },
	});
	const digests = [];
	g.on("digest", (d) => digests.push(d));
	return { g, digests, fire: () => fired && fired() };
}

// Feature: telegram-notifications, Property 7: Digest completeness
test("Property 7: flushed digest contains exactly every collected event", () => {
	fc.assert(
		fc.property(fc.array(fc.constantFrom("info", "warning"), { minLength: 1, maxLength: 40 }), (sevs) => {
			const { g, digests, fire } = makeEngine();
			sevs.forEach((s, i) => g.add({ id: "e" + i, category: "x", severity: s, t: i }));
			fire(); // window elapses
			assert.strictEqual(digests.length, 1);
			assert.strictEqual(digests[0].events.length, sevs.length);
		})
	);
});

// Feature: telegram-notifications, Property 8: Critical events flush immediately while preserving completeness
test("Property 8: a critical event flushes immediately with all collected events", () => {
	fc.assert(
		fc.property(fc.nat({ max: 15 }), (k) => {
			const { g, digests } = makeEngine();
			for (let i = 0; i < k; i += 1) g.add({ id: "n" + i, category: "x", severity: "info", t: i });
			g.add({ id: "crit", category: "x", severity: "critical", t: 999 });
			assert.strictEqual(digests.length, 1); // immediate, no timer fire
			assert.strictEqual(digests[0].events.length, k + 1);
			assert.ok(digests[0].events.some((e) => e.id === "crit"));
			assert.strictEqual(g.pending, 0);
		})
	);
});
