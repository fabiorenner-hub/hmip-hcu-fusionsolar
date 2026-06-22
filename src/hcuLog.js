"use strict";

// Ring buffer of WebSocket messages (HCU ↔ plugin) for the dashboard.
//
// Retention policy mirrors the logger: keep everything for 96 h, then reduce
// to the essentials. The high-volume routine traffic (status events, status
// and discover responses) is dropped past 96 h; control, config, errors and
// plugin-state messages — the things you actually look back at — are kept,
// bounded by MAX_IMPORTANT.

const MAX_RECENT = 400; // hard cap on total buffered messages
const MAX_IMPORTANT = 150; // cap on important messages retained beyond 96 h
const REDUCE_AFTER_MS = 96 * 60 * 60 * 1000; // 96 h
const PRUNE_INTERVAL_MS = 60 * 1000;

// Routine, high-frequency message types that carry little diagnostic value
// once they're old. Everything else (CONTROL_*, CONFIG_*, *ERROR*, PLUGIN_*)
// is treated as important and kept longer.
const ROUTINE = /STATUS_EVENT|STATUS_RESPONSE|DISCOVER_RESPONSE/i;

const buffer = [];
let lastPrune = 0;

function record(direction, message) {
	const trimmed = trimBody(message);
	buffer.push({
		t: Date.now(),
		dir: direction, // "in" or "out"
		type: message.type,
		id: message.id,
		body: trimmed,
	});
	prune();
}

function prune() {
	const now = Date.now();
	if (now - lastPrune < PRUNE_INTERVAL_MS && buffer.length <= MAX_RECENT) return;
	lastPrune = now;

	const cutoff = now - REDUCE_AFTER_MS;
	let importantOld = 0;
	for (let i = buffer.length - 1; i >= 0; i -= 1) {
		const e = buffer[i];
		if (e.t >= cutoff) continue; // within 96 h — keep as-is
		if (ROUTINE.test(e.type || "")) {
			buffer.splice(i, 1); // old routine traffic — reduce away
			continue;
		}
		importantOld += 1;
		if (importantOld > MAX_IMPORTANT) buffer.splice(i, 1);
	}

	if (buffer.length > MAX_RECENT) buffer.splice(0, buffer.length - MAX_RECENT);
}

function trimBody(msg) {
	try {
		const s = JSON.stringify(msg.body);
		return s.length > 4000 ? s.slice(0, 4000) + "…" : msg.body;
	} catch {
		return null;
	}
}

function tail(n = 200) {
	return buffer.slice(-n);
}

module.exports = { record, tail };
