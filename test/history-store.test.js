"use strict";

// Example tests for the atomic history store I/O (Tasks 1.3, 3.2, 3.3, 3.5).

const os = require("os");
const fs = require("fs");
const path = require("path");

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "hmip-hist-"));
process.env.HMIP_DATA_DIR = TMP_DIR;

const test = require("node:test");
const assert = require("node:assert");
const store = require("../src/history-store");

function fakeHistory(serialized) {
	return {
		serialize: () => serialized,
		restore: () => ({ ok: true, restored: { hourly: 0, daily: 0, raw: 0 }, skipped: 0 }),
		notePersistError() {},
	};
}

test("readStore returns null when the file is missing", () => {
	try { fs.rmSync(store.HISTORY_FILE, { force: true }); } catch { /* ignore */ }
	assert.strictEqual(store.readStore(), null);
});

test("writeStoreAtomic then readStore round-trips", () => {
	const payload = { version: 1, savedAt: 123, hourly: [{ start: 1 }], daily: [] };
	const res = store.writeStoreAtomic(payload, fakeHistory(payload));
	assert.strictEqual(res.ok, true);
	assert.deepStrictEqual(store.readStore(), payload);
});

test("readStore returns null for a corrupt file", () => {
	fs.writeFileSync(store.HISTORY_FILE, "{not valid json");
	assert.strictEqual(store.readStore(), null);
});

test("periodic writer fires exactly once per interval (injected timer)", () => {
	let captured = null;
	const setIntervalFn = (fn) => { captured = fn; return { unref() {} }; };
	let writes = 0;
	const hist = {
		serialize: () => { writes += 1; return { version: 1, savedAt: writes, hourly: [], daily: [] }; },
		notePersistError() {},
	};
	const stop = store.startPeriodicWriter(hist, { intervalMs: 1000, setIntervalFn });
	assert.strictEqual(writes, 0); // not called until the timer ticks
	captured();
	assert.strictEqual(writes, 1);
	captured();
	assert.strictEqual(writes, 2);
	stop();
});
