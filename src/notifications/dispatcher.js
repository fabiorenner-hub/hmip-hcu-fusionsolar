"use strict";

// Dispatcher — routes Digest_Messages to channels through a pipeline:
//   1. severity filter   (drop events below their category's minSeverity)
//   2. quiet hours        (defer sub-critical digests; critical passes)
//   3. rate limit         (coalesce over-limit digests, never drop)
//   4. channel routing    (Telegram only when enabled & fully configured)
//
// Clock and timers are injectable for deterministic tests.

const { highestSeverity, severityRank } = require("./format");

function parseHHMM(s) {
	const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s || "");
	return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

class Dispatcher {
	constructor(getConfig, opts = {}) {
		this._getConfig = getConfig;
		this._telegram = opts.telegram || null;
		this._now = opts.now || Date.now;
		this._log = opts.log || null;
		this._sends = []; // timestamps (ms) of recent actual sends
		this._deferred = []; // digests held during quiet hours
		this._coalesced = null; // pending coalesced digest while rate-limited
		this._wasQuiet = this._inQuietHours();
	}

	// ── Public ────────────────────────────────────────────────────
	dispatch(digest) {
		const filtered = this._filterBySeverity(digest.events);
		if (!filtered.length) return { delivered: false, reason: "filtered-empty" };
		const d = { ...digest, events: filtered, highestSeverity: highestSeverity(filtered) };

		if (this._inQuietHours() && d.highestSeverity !== "critical") {
			this._deferred.push(d);
			return { deferred: true };
		}
		return this._rateLimited(d);
	}

	// Re-evaluate time-based state: flush deferred digests when quiet hours
	// end, and flush a pending coalesced digest once capacity returns. Called
	// on a low-frequency timer by the facade and directly in tests.
	pump() {
		const quietNow = this._inQuietHours();
		if (this._wasQuiet && !quietNow) this._flushDeferred();
		this._wasQuiet = quietNow;
		this._flushCoalesced();
	}

	// ── Pipeline steps ────────────────────────────────────────────
	_filterBySeverity(events) {
		const cats = (this._getConfig().notifications || {}).categories || {};
		return (events || []).filter((e) => {
			const min = (cats[e.category] && cats[e.category].minSeverity) || "info";
			return severityRank(e.severity) >= severityRank(min);
		});
	}

	_inQuietHours() {
		const q = (this._getConfig().notifications || {}).quietHours || {};
		if (!q.enabled) return false;
		const start = parseHHMM(q.start);
		const end = parseHHMM(q.end);
		if (start == null || end == null) return false;
		const d = new Date(this._now());
		const mins = d.getHours() * 60 + d.getMinutes();
		if (start === end) return false;
		return start < end ? mins >= start && mins < end : mins >= start || mins < end;
	}

	_flushDeferred() {
		const queued = this._deferred;
		this._deferred = [];
		for (const d of queued) this._rateLimited(d);
	}

	_rateLimited(d) {
		const now = this._now();
		this._pruneSends(now);
		const rl = (this._getConfig().notifications || {}).rateLimit || {};
		const max = rl.maxPerInterval || 10;
		if (this._sends.length >= max) {
			this._coalesce(d);
			return { coalesced: true };
		}
		return this._send(d, now);
	}

	_coalesce(d) {
		if (!this._coalesced) {
			this._coalesced = { id: d.id, events: [...d.events], coalesced: true, createdAt: d.createdAt, highestSeverity: d.highestSeverity };
		} else {
			this._coalesced.events.push(...d.events);
			this._coalesced.highestSeverity = highestSeverity(this._coalesced.events);
		}
	}

	_flushCoalesced() {
		if (!this._coalesced) return;
		const now = this._now();
		this._pruneSends(now);
		const rl = (this._getConfig().notifications || {}).rateLimit || {};
		const max = rl.maxPerInterval || 10;
		if (this._sends.length >= max) return; // still at capacity; keep holding
		const d = this._coalesced;
		this._coalesced = null;
		this._send(d, now);
	}

	_pruneSends(now) {
		const rl = (this._getConfig().notifications || {}).rateLimit || {};
		const intervalMs = (rl.intervalSec || 3600) * 1000;
		const cutoff = now - intervalMs;
		while (this._sends.length && this._sends[0] <= cutoff) this._sends.shift();
	}

	_send(d, now) {
		const tg = (this._getConfig().notifications || {}).telegram || {};
		if (!tg.enabled) return { delivered: false, reason: "telegram-disabled" };
		if (!this._telegram || !this._telegram.isConfigured()) return { delivered: false, reason: "config-incomplete" };
		this._sends.push(now);
		// Fire-and-forget: the channel owns its retry/outcome and never throws.
		Promise.resolve(this._telegram.send(d)).catch(() => {});
		return { delivered: true };
	}
}

module.exports = { Dispatcher, parseHHMM };
