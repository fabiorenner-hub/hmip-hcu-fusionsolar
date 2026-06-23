"use strict";

// Feature: persistent-history-and-enhancements, Property 11: i18n bidirectional key parity

const test = require("node:test");
const assert = require("node:assert");
const fc = require("fast-check");
const { I18N, i18nKeyParity } = require("../../src/dashboard/public/i18n");

test("Property 11: the real translation table has no missing keys in either direction", () => {
	const { missingInEn, missingInDe } = i18nKeyParity(I18N);
	assert.deepStrictEqual(missingInEn, [], `keys missing in EN: ${missingInEn}`);
	assert.deepStrictEqual(missingInDe, [], `keys missing in DE: ${missingInDe}`);
});

test("Property 11 (generated): symmetric difference is detected for arbitrary tables", () => {
	fc.assert(
		fc.property(
			fc.uniqueArray(fc.string({ minLength: 1 }), { maxLength: 20 }),
			fc.uniqueArray(fc.string({ minLength: 1 }), { maxLength: 20 }),
			(deKeys, enKeys) => {
				const table = {
					de: Object.fromEntries(deKeys.map((k) => [k, "x"])),
					en: Object.fromEntries(enKeys.map((k) => [k, "y"])),
				};
				const { missingInEn, missingInDe } = i18nKeyParity(table);
				const deSet = new Set(deKeys);
				const enSet = new Set(enKeys);
				assert.deepStrictEqual(new Set(missingInEn), new Set(deKeys.filter((k) => !enSet.has(k))));
				assert.deepStrictEqual(new Set(missingInDe), new Set(enKeys.filter((k) => !deSet.has(k))));
			}
		),
		{ numRuns: 100 }
	);
});
