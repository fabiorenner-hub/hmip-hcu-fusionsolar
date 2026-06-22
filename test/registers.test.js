"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { decode, encode } = require("../src/sun2000/registers");

test("u16 scale roundtrip", () => {
	const reg = { type: "u16", length: 1, scale: 100 };
	assert.strictEqual(decode(reg, [5012]), 50.12);
	assert.deepStrictEqual(encode(reg, 50.12), [5012]);
});

test("i16 negative", () => {
	const reg = { type: "i16", length: 1, scale: 10 };
	// -123 raw = 0x10000 - 1230 = 64306
	assert.strictEqual(decode(reg, [64306]), -123);
	assert.deepStrictEqual(encode(reg, -123), [64306]);
});

test("i32 negative roundtrip", () => {
	const reg = { type: "i32", length: 2 };
	const words = encode(reg, -1053);
	assert.strictEqual(decode(reg, words), -1053);
});

test("u32 large value", () => {
	const reg = { type: "u32", length: 2, scale: 100 };
	// 30448 kWh -> raw 3044800
	const words = encode(reg, 30448);
	assert.strictEqual(decode(reg, words), 30448);
});

test("string cuts at first NUL", () => {
	const reg = { type: "string", length: 3 };
	// 'AB' \0 'CD'
	assert.strictEqual(decode(reg, [0x4142, 0x0043, 0x4400]), "AB");
});

test("string trims trailing spaces, no NUL", () => {
	const reg = { type: "string", length: 2 };
	assert.strictEqual(decode(reg, [0x4142, 0x2020]), "AB");
});

test("string clean passthrough", () => {
	const reg = { type: "string", length: 2 };
	assert.strictEqual(decode(reg, [0x4142, 0x4344]), "ABCD");
});
