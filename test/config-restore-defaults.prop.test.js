"use strict";

// Feature: persistent-history-and-enhancements, Property 16: Restore merges over defaults

const os = require("os");
const fs = require("fs");
const path = require("path");
process.env.HMIP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "hmip-cfg-def-"));

const test = require("node:test");
const assert = require("node:assert");
const fc = require("fast-check");
const config = require("../src/config");

const DEFAULTS = config.DEFAULTS;
const SCALARS = {
	inverterHost: fc.string(),
	inverterPort: fc.integer({ min: 1, max: 65535 }),
	pollIntervalMs: fc.integer({ min: 1000, max: 60000 }),
	dashboardPort: fc.integer({ min: 1, max: 65535 }),
	lanOnly: fc.boolean(),
	adminPassword: fc.string(),
};
const KEYS = Object.keys(SCALARS);

test("Property 16: keys absent from a partial document fall back to documented defaults", () => {
	fc.assert(
		fc.property(
			fc.uniqueArray(fc.constantFrom(...KEYS), { maxLength: KEYS.length }),
			fc.record(SCALARS),
			(present, values) => {
				const doc = {};
				for (const k of present) doc[k] = values[k];
				config.restore(doc);
				const c = config.get();
				for (const k of KEYS) {
					if (present.includes(k)) assert.deepStrictEqual(c[k], values[k]);
					else assert.deepStrictEqual(c[k], DEFAULTS[k]);
				}
				// A nested default block absent from the document equals the default.
				assert.deepStrictEqual(c.security, DEFAULTS.security);
				assert.deepStrictEqual(c.history, DEFAULTS.history);
			}
		),
		{ numRuns: 100 }
	);
});
