"use strict";

// Feature: persistent-history-and-enhancements, Property 12: Initial-theme decision

const test = require("node:test");
const assert = require("node:assert");
const fc = require("fast-check");
const { initialTheme } = require("../../src/dashboard/public/i18n");

test("Property 12: stored preference wins; else light when UA reports light, else dark", () => {
	fc.assert(
		fc.property(
			fc.constantFrom(null, undefined, "light", "dark", "garbage", ""),
			fc.boolean(),
			(stored, prefersLight) => {
				const r = initialTheme(stored, prefersLight);
				const expected = stored === "light" || stored === "dark" ? stored : prefersLight ? "light" : "dark";
				assert.strictEqual(r, expected);
			}
		),
		{ numRuns: 100 }
	);
});
