"use strict";

// Grouping_Engine — coalesces related notification events occurring within a
// configurable time window into a single Digest_Message. Exactly one window is
// open at a time. A critical event flushes immediately, carrying along every
// event already collected in the open window (no loss).
//
// Timers and the clock are injectable so the window is deterministic in tests.

const { EventEmitter } = require("events");
const { highestSeverity } = require("./format");

let seq = 0;
function digestId(now) {
	seq = (seq + 1) % 1e6;
	return `dig_${now}_${seq}`;
}

class GroupingEngine extends EventEmitter {
	constructor(getConfig, opts = {}) {
		super();
		this._getConfig = getConfig;
		this._now = opts.now || Date.now;
		this._setTimer = opts.setTimer || ((fn, ms) => setTimeout(fn, ms));
		this._clearTimer = opts.clearTimer || clearTimeout;
		this._window = null; // array of events, or null when idle
		this._timer = null;
	}

	_windowSec() {
		const n = this._getConfig().notifications || {};
		return n.groupingWindowSec > 0 ? n.groupingWindowSec : 60;
	}

	add(event) {
		if (!this._window) this._window = [];
		this._window.push(event);

		if (event.severity === "critical") {
			// Flush immediately, including everything collected so far.
			this.flush();
			return;
		}
		if (!this._timer) {
			this._timer = this._setTimer(() => this.flush(), this._windowSec() * 1000);
			if (this._timer && typeof this._timer.unref === "function") this._timer.unref();
		}
	}

	flush() {
		if (this._timer) {
			this._clearTimer(this._timer);
			this._timer = null;
		}
		const events = this._window || [];
		this._window = null;
		if (!events.length) return null;
		const digest = {
			id: digestId(this._now()),
			events,
			highestSeverity: highestSeverity(events),
			coalesced: false,
			createdAt: this._now(),
		};
		this.emit("digest", digest);
		return digest;
	}

	get pending() {
		return this._window ? this._window.length : 0;
	}
}

module.exports = { GroupingEngine };
