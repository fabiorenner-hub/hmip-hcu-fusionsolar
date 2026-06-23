"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { formatDigest, highestSeverity, TELEGRAM_MAX } = require("../../src/notifications/format");

test("single-event digest renders the message", () => {
	const txt = formatDigest({ events: [{ severity: "warning", t: Date.now(), title: "Batterie", message: "SOC 18%" }] });
	assert.ok(txt.includes("Batterie"));
	assert.ok(txt.includes("SOC 18%"));
	assert.ok(txt.includes("1 Ereignis"));
});

test("multi-event digest lists all events", () => {
	const txt = formatDigest({ events: [
		{ severity: "info", t: 0, title: "A", message: "a" },
		{ severity: "critical", t: 0, title: "B", message: "b" },
	] });
	assert.ok(txt.includes("2 Ereignisse"));
	assert.ok(txt.includes("A") && txt.includes("B"));
});

test("digest text is truncated to the Telegram limit", () => {
	const big = "x".repeat(10000);
	const txt = formatDigest({ events: [{ severity: "info", t: 0, title: "T", message: big }] });
	assert.ok(txt.length <= TELEGRAM_MAX);
});

test("highestSeverity picks the max", () => {
	assert.strictEqual(highestSeverity([{ severity: "info" }, { severity: "critical" }, { severity: "warning" }]), "critical");
	assert.strictEqual(highestSeverity([]), "info");
});
