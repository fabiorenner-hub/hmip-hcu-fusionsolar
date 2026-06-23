"use strict";

// Durable persistence for the in-memory tiered history. Thin I/O layer — all
// policy (what to keep, how to prune) lives in history.js. Writes are atomic
// (temp file + fsync + rename) so a crash never leaves a torn history.json,
// and every failure is logged but non-fatal (history loss is acceptable).

const fs = require("fs");
const path = require("path");
const log = require("./logger");

const DATA_DIR = process.env.HMIP_DATA_DIR || "/data";
const HISTORY_FILE = path.join(DATA_DIR, "history.json");
const TMP_FILE = HISTORY_FILE + ".tmp";

function writeStoreAtomic(store, history) {
	try {
		fs.mkdirSync(DATA_DIR, { recursive: true });
		const fd = fs.openSync(TMP_FILE, "w");
		try {
			fs.writeSync(fd, JSON.stringify(store));
			fs.fsyncSync(fd);
		} finally {
			fs.closeSync(fd);
		}
		fs.renameSync(TMP_FILE, HISTORY_FILE);
		if (history && history.notePersistError) history.notePersistError(null);
		return { ok: true };
	} catch (e) {
		log.error("History persist failed:", e.message);
		if (history && history.notePersistError) history.notePersistError(e.message);
		try { fs.rmSync(TMP_FILE, { force: true }); } catch { /* ignore */ }
		return { ok: false, error: e.message };
	}
}

function readStore() {
	try {
		if (!fs.existsSync(HISTORY_FILE)) return null;
		return JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
	} catch (e) {
		log.warn("History file unreadable, starting empty:", e.message);
		return null;
	}
}

function persist(history, opts = {}) {
	return writeStoreAtomic(history.serialize(opts), history);
}

function loadInto(history, opts = {}) {
	const store = readStore();
	const res = history.restore(store, opts);
	if (res.ok) log.info(`History restored: ${res.restored.hourly} hourly, ${res.restored.daily} daily, ${res.restored.raw} raw (skipped ${res.skipped})`);
	else log.info(`History not restored (${res.reason}) — starting empty`);
	return res;
}

// Periodic, unref'd writer. Clock/timer injectable for tests.
function startPeriodicWriter(history, { intervalMs = 5 * 60 * 1000, setIntervalFn = setInterval, opts = {} } = {}) {
	const timer = setIntervalFn(() => persist(history, opts), intervalMs);
	if (timer && typeof timer.unref === "function") timer.unref();
	return function stop() {
		clearInterval(timer);
	};
}

module.exports = { writeStoreAtomic, readStore, persist, loadInto, startPeriodicWriter, HISTORY_FILE };
