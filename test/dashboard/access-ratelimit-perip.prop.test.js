"use strict";

// Feature: persistent-history-and-enhancements, Property 14: Login rate-limit per-IP independence

const test = require("node:test");
const assert = require("node:assert");
const fc = require("fast-check");
const access = require("../../src/dashboard/access");

let ipSeq = 0;
function freshIp() { ipSeq += 1; return `10.2.${(ipSeq >> 8) & 0xff}.${ipSeq & 0xff}`; }

test("Property 14: exhausting one IP does not block another; reset clears only that IP", () => {
	fc.assert(
		fc.property(fc.integer({ min: 1, max: 8 }), fc.integer({ min: 1000, max: 3_600_000 }), (max, windowMs) => {
			const ipA = freshIp();
			const ipB = freshIp();
			const now = 5_000_000;
			access.resetLoginAttempts(ipA);
			access.resetLoginAttempts(ipB);

			for (let i = 0; i < max; i += 1) access.recordLoginFailure(ipA, { now, windowMs });
			assert.strictEqual(access.checkLoginAllowed(ipA, { now, max }).allowed, false);
			assert.strictEqual(access.checkLoginAllowed(ipB, { now, max }).allowed, true, "B must be unaffected by A");

			for (let i = 0; i < max; i += 1) access.recordLoginFailure(ipB, { now, windowMs });
			assert.strictEqual(access.checkLoginAllowed(ipA, { now, max }).allowed, false);
			assert.strictEqual(access.checkLoginAllowed(ipB, { now, max }).allowed, false);

			// A successful login on A resets only A.
			access.resetLoginAttempts(ipA);
			assert.strictEqual(access.checkLoginAllowed(ipA, { now, max }).allowed, true);
			assert.strictEqual(access.checkLoginAllowed(ipB, { now, max }).allowed, false);
		}),
		{ numRuns: 100 }
	);
});
