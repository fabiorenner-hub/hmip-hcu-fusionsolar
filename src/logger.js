"use strict";

// Tiny ring-buffered logger. Console output is captured by the HCU
// (logsEnabled in the metadata label), and the ring buffer is exposed via
// the debug dashboard at GET /api/logs.

const MAX = 500;
const buffer = [];

function ts() {
	return new Date().toISOString();
}

function push(level, args) {
	const line = `${ts()} [${level}] ${args
		.map((a) => (a instanceof Error ? a.stack || a.message : typeof a === "string" ? a : safe(a)))
		.join(" ")}`;
	buffer.push(line);
	if (buffer.length > MAX) buffer.shift();
	// eslint-disable-next-line no-console
	(console[level] || console.log)(line);
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
	tail: (n = 200) => buffer.slice(-n),
};
