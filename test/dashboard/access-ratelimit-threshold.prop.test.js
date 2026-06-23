"use strict";

// Feature: persistent-history-and-enhancements, Property 13: Login rate-limit threshold and window reset

const test = require("node:test");
const assert = require("node:assert");
const fc = require("fast-check");
const access = require("../../src/dashboard/access");

let ipSeq = 0;
function freshIp() { ipSeq += 1; return `10.1.${(ipSeq >> 8) & 0xff}.${ipSeq & 0xff}`; }

test("Property 13: allowed below max, rejected at max, re-permitted after the window elapses", () => {
	fc.assert(
		fc.property(
			fc.integer({ min: 1, max: 10 }),
			fc.integer({ min: 0, max: 10 }),
			fc.integer({ min: 1000, max: 3_600_000 }),
			(max, failures, windowMs) => {
				const ip = freshIp();
				const now = 1_000_000;
				access.resetLoginAttempts(ip);

				// With no recorded failures the IP is always allowed.
				assert.strictEqual(access.checkLoginAllowed(ip, { now, max }).allowed, true);

				const k = Math.min(failures, max);
				for (let i = 0; i < k; i += 1) access.recordLoginFailure(ip, { now, windowMs });

				const decision = access.checkLoginAllowed(ip, { now, max });
				assert.strictEqual(decision.allowed, k < max);
				if (!decision.allowed) assert.ok(decision.retryAfterMs > 0);

				// After the window elapses, attempts are permitted again.
				const after = access.checkLoginAllowed(ip, { now: now + windowMs, max });
				assert.strictEqual(after.allowed, true);
			}
		),
		{ numRuns: 100 }
	);
});
