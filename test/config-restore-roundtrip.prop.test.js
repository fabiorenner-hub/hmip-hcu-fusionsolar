"use strict";

// Feature: persistent-history-and-enhancements, Property 15: Config backup/restore round-trip

const os = require("os");
const fs = require("fs");
const path = require("path");
process.env.HMIP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "hmip-cfg-rt-"));

const test = require("node:test");
const assert = require("node:assert");
const fc = require("fast-check");
const config = require("../src/config");

const base = JSON.parse(JSON.stringify(config.DEFAULTS));

test("Property 15: exporting a valid config and restoring it yields an equivalent config", () => {
	fc.assert(
		fc.property(
			fc.record({
				inverterHost: fc.string(),
				inverterPort: fc.integer({ min: 1, max: 65535 }),
				pollIntervalMs: fc.integer({ min: 1000, max: 60000 }),
				lanOnly: fc.boolean(),
				adminPassword: fc.string(),
			}),
			(overrides) => {
				const doc = { ...base, ...overrides };
				config.restore(doc);
				// Backup = the current full config (as the endpoint returns it).
				const backup = JSON.parse(JSON.stringify(config.get()));
				config.restore(backup);
				assert.deepStrictEqual(JSON.parse(JSON.stringify(config.get())), backup);
			}
		),
		{ numRuns: 100 }
	);
});
