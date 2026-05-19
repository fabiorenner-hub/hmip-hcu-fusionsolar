"use strict";

// Ring buffer of WebSocket messages (HCU ↔ plugin) for the dashboard.

const MAX = 200;
const buffer = [];

function record(direction, message) {
	const trimmed = trimBody(message);
	buffer.push({
		t: Date.now(),
		dir: direction, // "in" or "out"
		type: message.type,
		id: message.id,
		body: trimmed,
	});
	if (buffer.length > MAX) buffer.shift();
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
