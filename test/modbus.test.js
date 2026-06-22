"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { Sun2000Modbus } = require("../src/sun2000/modbus");

function freshClient() {
	const m = new Sun2000Modbus();
	m.opts = { host: "x", port: 502, unitId: 1 };
	m.connect = async () => { m.connected = true; }; // stub: no real socket
	return m;
}

test("cooldown escalates and caps", () => {
	const m = freshClient();
	m._consecutivePeerCloses = 1;
	assert.strictEqual(m._peerCloseCooldownMs(), 30000, "first close = BASE");
	m._consecutivePeerCloses = 3;
	assert.strictEqual(m._peerCloseCooldownMs(), 120000, "3rd close = 4x BASE");
	m._consecutivePeerCloses = 20;
	assert.strictEqual(m._peerCloseCooldownMs(), 300000, "capped at MAX 5min");
});

test("cooldown refuses connect right after a peer-close", async () => {
	const m = freshClient();
	m.connected = false;
	m._lastPeerCloseAt = Date.now();
	m._consecutivePeerCloses = 1;
	let connectCalls = 0;
	m.connect = async () => { connectCalls += 1; m.connected = true; };
	await assert.rejects(() => m._ensureConnected());
	assert.strictEqual(connectCalls, 0);
});

test("connect proceeds once cooldown elapsed", async () => {
	const m = freshClient();
	m.connected = false;
	m._consecutivePeerCloses = 1;
	m._lastPeerCloseAt = Date.now() - 40000; // > 30s
	let connectCalls = 0;
	m.connect = async () => { connectCalls += 1; m.connected = true; };
	await m._ensureConnected();
	assert.strictEqual(connectCalls, 1);
});

test("lockdown blocks connect entirely", async () => {
	const m = freshClient();
	m.connected = false;
	m._lockdownUntil = Date.now() + 60000;
	let connectCalls = 0;
	m.connect = async () => { connectCalls += 1; m.connected = true; };
	await assert.rejects(() => m._ensureConnected());
	assert.strictEqual(connectCalls, 0);
});

test("successful read resets escalation and lockdown", () => {
	const m = freshClient();
	m._lastPeerCloseAt = Date.now();
	m._consecutivePeerCloses = 7;
	m._lockdownUntil = Date.now() + 99999;
	m._onReadSuccess();
	assert.strictEqual(m._lastPeerCloseAt, 0);
	assert.strictEqual(m._consecutivePeerCloses, 0);
	assert.strictEqual(m._lockdownUntil, 0);
});

test("readEach tolerates per-register failures", async () => {
	const m = freshClient();
	m.connected = true;
	let n = 0;
	m.readRegister = async (name) => {
		n += 1;
		if (name === "bad") throw new Error("nope");
		return 42;
	};
	const out = await m.readEach(["activePower", "bad", "gridFrequency"]);
	assert.strictEqual(out.activePower, 42);
	assert.strictEqual(out.bad, null);
	assert.strictEqual(out.gridFrequency, 42);
});
