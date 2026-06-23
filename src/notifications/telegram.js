"use strict";

// Telegram_Channel — delivers digests via the Telegram Bot HTTP API using
// Node's built-in https module (no fetch dependency, no Python). Bounded
// exponential-backoff retry honouring a 429 retry_after hint. The bot token
// is never written to logs (only HTTP status / description on failure).

const https = require("https");
const { formatDigest } = require("./format");

function defaultHttpPost(url, body) {
	return new Promise((resolve, reject) => {
		let u;
		try {
			u = new URL(url);
		} catch (e) {
			return reject(e);
		}
		const data = JSON.stringify(body);
		const req = https.request(
			{
				method: "POST",
				hostname: u.hostname,
				path: u.pathname + u.search,
				headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
			},
			(res) => {
				let b = "";
				res.on("data", (c) => (b += c));
				res.on("end", () => {
					let json = null;
					try { json = JSON.parse(b); } catch { /* non-JSON */ }
					resolve({ status: res.statusCode, json });
				});
			}
		);
		req.on("error", reject);
		req.write(data);
		req.end();
	});
}

class TelegramChannel {
	constructor(getConfig, opts = {}) {
		this._getConfig = getConfig;
		this._log = opts.log || require("../logger");
		this._httpPost = opts.httpPost || defaultHttpPost;
		this._sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
		this._maxAttempts = opts.maxAttempts || 4; // initial + retries
		this._baseDelayMs = opts.baseDelayMs || 1000;
		this._capDelayMs = opts.capDelayMs || 60000;
	}

	_tg() {
		return (this._getConfig().notifications || {}).telegram || {};
	}

	isConfigured() {
		const tg = this._tg();
		return !!(tg.botToken && tg.chatId);
	}

	async send(digest) {
		return this._sendText(formatDigest(digest));
	}

	async sendTest() {
		return this._sendText("✅ Sun2000 · Telegram-Testnachricht");
	}

	async _sendText(text) {
		const tg = this._tg();
		if (!tg.botToken || !tg.chatId) return { delivered: false, reason: "config-incomplete" };
		const url = `https://api.telegram.org/bot${tg.botToken}/sendMessage`;
		const body = { chat_id: tg.chatId, text };

		let delay = this._baseDelayMs;
		for (let attempt = 1; attempt <= this._maxAttempts; attempt += 1) {
			let res = null;
			try {
				res = await this._httpPost(url, body);
			} catch {
				// network error → fall through to retry
			}
			if (res && res.status === 200 && res.json && res.json.ok) {
				return { delivered: true, attempts: attempt };
			}
			// Permanent client errors (except 429) → stop early.
			if (res && res.status >= 400 && res.status < 500 && res.status !== 429) {
				this._log.warn(`Telegram delivery failed permanently: HTTP ${res.status} ${(res.json && res.json.description) || ""}`.trim());
				return { delivered: false, reason: `http-${res.status}`, attempts: attempt };
			}
			// Honour 429 retry_after.
			if (res && res.status === 429 && res.json && res.json.parameters && res.json.parameters.retry_after) {
				delay = Math.max(delay, res.json.parameters.retry_after * 1000);
			}
			if (attempt < this._maxAttempts) {
				await this._sleep(delay);
				delay = Math.min(delay * 2, this._capDelayMs);
			}
		}
		this._log.warn(`Telegram delivery failed after ${this._maxAttempts} attempts`);
		return { delivered: false, reason: "exhausted", attempts: this._maxAttempts };
	}
}

module.exports = { TelegramChannel, defaultHttpPost };
