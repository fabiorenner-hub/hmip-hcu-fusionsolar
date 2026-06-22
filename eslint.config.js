"use strict";

// Pragmatic ESLint flat config. Focus: catch the bug classes that bit us —
// undefined identifiers (e.g. the modbus PEER_CLOSE_COOLDOWN_MS no-op),
// duplicate keys, unreachable code. Style is left to node --check + review.

const globals = require("globals");

const errorRules = {
	"no-undef": "error",
	"no-dupe-keys": "error",
	"no-dupe-args": "error",
	"no-redeclare": "error",
	"no-unreachable": "error",
	"no-cond-assign": "error",
	"no-constant-condition": ["error", { checkLoops: false }],
	"no-unused-vars": "off", // intentionally off to avoid churn
};

module.exports = [
	{
		// Node backend
		files: ["src/**/*.js"],
		ignores: ["src/dashboard/public/**"],
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: "commonjs",
			globals: { ...globals.node },
		},
		rules: errorRules,
	},
	{
		// Browser dashboard (no build step, plain scripts)
		files: ["src/dashboard/public/**/*.js"],
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: "script",
			// app.js intentionally defines its own `history` (app state) and
			// `escape` (HTML escaper), shadowing the legacy browser globals —
			// drop those from the global set so no-redeclare stays meaningful.
			globals: (() => {
				const b = { ...globals.browser, TimeChart: "writable" };
				delete b.history;
				delete b.escape;
				return b;
			})(),
		},
		rules: errorRules,
	},
	{
		files: ["test/**/*.js"],
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: "commonjs",
			globals: { ...globals.node },
		},
		rules: errorRules,
	},
];
