"use strict";

// Property + example tests for the GitHub update checker.

const test = require("node:test");
const assert = require("node:assert");
const fc = require("fast-check");
const update = require("../src/update-check");

const ver = fc.tuple(fc.nat(20), fc.nat(20), fc.nat(20));
const toStr = ([a, b, c]) => `${a}.${b}.${c}`;
function cmp(a, b) {
	for (let i = 0; i < 3; i += 1) {
		if (a[i] > b[i]) return 1;
		if (a[i] < b[i]) return -1;
	}
	return 0;
}

test("Property: isNewer is true exactly when latest > current (semantic version order)", () => {
	fc.assert(
		fc.property(ver, ver, fc.boolean(), (a, b, prefix) => {
			const latest = (prefix ? "v" : "") + toStr(a);
			const current = toStr(b);
			assert.strictEqual(update.isNewer(latest, current), cmp(a, b) === 1);
		}),
		{ numRuns: 200 }
	);
});

test("Property: unparseable inputs never report an update", () => {
	fc.assert(
		fc.property(fc.string(), fc.string(), (a, b) => {
			// Only assert the safe direction: garbage must not be 'newer'.
			if (!/\d+\.\d+\.\d+/.test(a) || !/\d+\.\d+\.\d+/.test(b)) {
				assert.strictEqual(update.isNewer(a, b), false);
			}
		}),
		{ numRuns: 100 }
	);
});

test("checkNow: newer GitHub release flips updateAvailable and notifies once", async () => {
	update._reset("0.6.0");
	let notifications = 0;
	let lastNotified = null;
	const fetchImpl = async () => ({ tag_name: "v0.7.0", html_url: "https://github.com/x/y/releases/tag/v0.7.0" });
	const notify = (s) => { notifications += 1; lastNotified = s; };

	const s1 = await update.checkNow({ fetchImpl, notify });
	assert.strictEqual(s1.updateAvailable, true);
	assert.strictEqual(s1.latest, "v0.7.0");
	assert.strictEqual(s1.releaseUrl, "https://github.com/x/y/releases/tag/v0.7.0");
	assert.strictEqual(notifications, 1);
	assert.strictEqual(lastNotified.latest, "v0.7.0");

	// Second check for the same latest must NOT notify again.
	await update.checkNow({ fetchImpl, notify });
	assert.strictEqual(notifications, 1);
});

test("checkNow: same/older release means no update and no notification", async () => {
	update._reset("0.6.0");
	let notifications = 0;
	const notify = () => { notifications += 1; };
	const s = await update.checkNow({ fetchImpl: async () => ({ tag_name: "v0.6.0" }), notify });
	assert.strictEqual(s.updateAvailable, false);
	assert.strictEqual(notifications, 0);
});

test("checkNow: a fetch failure is non-fatal and records the error", async () => {
	update._reset("0.6.0");
	const s = await update.checkNow({ fetchImpl: async () => { throw new Error("network down"); } });
	assert.strictEqual(s.updateAvailable, false);
	assert.strictEqual(s.error, "network down");
	assert.ok(s.checkedAt);
});
