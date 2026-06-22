"use strict";

// Ring-buffered logger with age-based reduction.
//
// Console output is captured by the HCU (logsEnabled in the metadata label),
// and the ring buffer is exposed via the debug dashboard at GET /api/logs.
//
// Retention policy: recent lines are kept verbatim. Past 96 h we drop the
// chatty info/debug lines and keep only what matters for diagnosing a problem
// after the fact — warnings and errors. Two hard caps bound memory no matter
// what: MAX_RECENT total entries and MAX_IMPORTANT old warn/error lines.

const MAX_RECENT = 1000; // hard cap on total buffered lines
const MAX_IMPORTANT = 300; // cap on warn/error lines retained beyond 96 h
const REDUCE_AFTER_MS = 96 * 60 * 60 * 1000; // 96 h
const PRUNE_INTERVAL_MS = 60 * 1000; // throttle pruning to once a minute

const IMPORTANT = new Set(["warn", "error"]);

const buffer = []; // { t, level, line }
let lastPrune = 0;

function ts() {
	return new Date().toISOString();
}

function push(level, args) {
	const line = `${ts()} [${level}] ${args
		.map((a) => (a instanceof Error ? a.stack || a.message : typeof a === "string" ? a : safe(a)))
		.join(" ")}`;
	buffer.push({ t: Date.now(), level, line });
	prune();
	(console[level] || console.log)(line);
}

function prune() {
	const now = Date.now();
	if (now - lastPrune < PRUNE_INTERVAL_MS && buffer.length <= MAX_RECENT) return;
	lastPrune = now;

	const cutoff = now - REDUCE_AFTER_MS;
	let importantOld = 0;
	// Walk newest → oldest so we can keep the most recent important lines and
	// drop the surplus once MAX_IMPORTANT is exceeded.
	for (let i = buffer.length - 1; i >= 0; i -= 1) {
		const e = buffer[i];
		if (e.t >= cutoff) continue; // within 96 h — keep as-is
		if (!IMPORTANT.has(e.level)) {
			buffer.splice(i, 1); // old info/debug — reduce away
			continue;
		}
		importantOld += 1;
		if (importantOld > MAX_IMPORTANT) buffer.splice(i, 1);
	}

	// Final hard cap: trim oldest entries if still over budget.
	if (buffer.length > MAX_RECENT) buffer.splice(0, buffer.length - MAX_RECENT);
}

function safe(o) {
	try {
		return JSON.stringify(o);
	} catch {
		return String(o);
	}
}

module.exports = {
	info: (...a) => push("info", a),
	warn: (...a) => push("warn", a),
	error: (...a) => push("error", a),
	debug: (...a) => push("debug", a),
	tail: (n = 200) => buffer.slice(-n).map((e) => e.line),
};
