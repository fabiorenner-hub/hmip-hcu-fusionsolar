"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fc = require("fast-check");
const { TelegramChannel } = require("../../src/notifications/telegram");

const silent = { warn() {}, error() {}, info() {} };
const HEX = "0123456789abcdef".split("");
const hexToken = (min, max) => fc.array(fc.constantFrom(...HEX), { minLength: min, maxLength: max }).map((a) => a.join(""));
const cfg = (token, chat) => () => ({ notifications: { telegram: { enabled: true, botToken: token, chatId: chat } } });
const digest = () => ({ events: [{ severity: "info", t: 0, title: "T", message: "m" }] });

// Feature: telegram-notifications, Property 13: Delivery retries are bounded with non-decreasing backoff
test("Property 13: retries bounded, backoff non-decreasing, stop at first success", async () => {
	await fc.assert(
		fc.asyncProperty(fc.array(fc.constantFrom("ok", "fail", "net"), { minLength: 1, maxLength: 6 }), async (tags) => {
			const results = tags.map((t) => (t === "ok" ? { status: 200, json: { ok: true } } : t === "fail" ? { status: 500, json: {} } : { throw: true }));
			let i = 0;
			const sleeps = [];
			const c = new TelegramChannel(cfg("t", "c"), {
				httpPost: async () => { const r = results[Math.min(i, results.length - 1)]; i += 1; if (r.throw) throw new Error("net"); return r; },
				sleep: async (ms) => { sleeps.push(ms); },
				maxAttempts: 4,
				baseDelayMs: 1000,
				capDelayMs: 60000,
				log: silent,
			});
			const res = await c.send(digest());
			assert.ok(res.attempts <= 4);
			for (let k = 1; k < sleeps.length; k += 1) assert.ok(sleeps[k] >= sleeps[k - 1]);
			const firstOk = tags.findIndex((t) => t === "ok");
			if (firstOk !== -1 && firstOk < 4) {
				assert.strictEqual(res.delivered, true);
				assert.strictEqual(res.attempts, firstOk + 1);
			} else {
				assert.strictEqual(res.delivered, false);
			}
		})
	);
});

// Feature: telegram-notifications, Property 19: Bot token never appears in log output
test("Property 19: the bot token never appears in any log line", async () => {
	await fc.assert(
		fc.asyncProperty(hexToken(12, 40), fc.constantFrom(500, 403, 429), async (token, status) => {
			const logs = [];
			const log = {
				warn: (...a) => logs.push(a.join(" ")),
				error: (...a) => logs.push(a.join(" ")),
				info: (...a) => logs.push(a.join(" ")),
			};
			const c = new TelegramChannel(cfg(token, "c"), {
				httpPost: async () => ({ status, json: { description: "err" } }),
				sleep: async () => {},
				maxAttempts: 3,
				baseDelayMs: 1,
				log,
			});
			await c.send(digest());
			for (const line of logs) assert.ok(!line.includes(token), `token leaked: ${line}`);
		})
	);
});

// Requirement 4.2 / 6.1: request shape + success → delivered (mock transport, no real network/Python)
test("send() posts chat_id+text to the bot sendMessage URL and records delivered on ok", async () => {
	let captured = null;
	const c = new TelegramChannel(cfg("BOTTOKEN", "12345"), {
		httpPost: async (url, body) => { captured = { url, body }; return { status: 200, json: { ok: true } }; },
		sleep: async () => {},
		log: silent,
	});
	const res = await c.send({ events: [{ severity: "info", t: 0, title: "Hi", message: "there" }] });
	assert.strictEqual(res.delivered, true);
	assert.ok(captured.url.startsWith("https://api.telegram.org/botBOTTOKEN/sendMessage"));
	assert.strictEqual(captured.body.chat_id, "12345");
	assert.ok(typeof captured.body.text === "string" && captured.body.text.length > 0);
});

test("isConfigured() reflects token+chat presence", () => {
	assert.strictEqual(new TelegramChannel(cfg("t", "c"), { log: silent }).isConfigured(), true);
	assert.strictEqual(new TelegramChannel(cfg("", "c"), { log: silent }).isConfigured(), false);
	assert.strictEqual(new TelegramChannel(cfg("t", ""), { log: silent }).isConfigured(), false);
});
