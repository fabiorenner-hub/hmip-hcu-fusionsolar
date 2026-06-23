"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fc = require("fast-check");
const { Dispatcher } = require("../../src/notifications/dispatcher");
const { severityRank } = require("../../src/notifications/format");

function setup(over) {
	const clock = { v: 0 };
	const conf = {
		notifications: {
			categories: { x: { enabled: true, minSeverity: "info" } },
			quietHours: { enabled: false, start: "22:00", end: "07:00" },
			rateLimit: { maxPerInterval: 100, intervalSec: 3600 },
			telegram: { enabled: true, botToken: "t", chatId: "c" },
			...over,
		},
	};
	const sent = [];
	const getConfig = () => conf;
	const telegram = {
		isConfigured: () => { const tg = conf.notifications.telegram; return !!(tg.botToken && tg.chatId); },
		send: (d) => { sent.push(d); return Promise.resolve({ delivered: true }); },
	};
	const d = new Dispatcher(getConfig, { telegram, now: () => clock.v });
	return { d, sent, clock, conf };
}

function digest(events) {
	return { id: "d", events, createdAt: 0 };
}

// Feature: telegram-notifications, Property 2: Severity filtering excludes low-severity events from delivery
test("Property 2: only events at/above the category min severity are delivered", () => {
	fc.assert(
		fc.property(
			fc.constantFrom("info", "warning", "critical"),
			fc.array(fc.constantFrom("info", "warning", "critical"), { minLength: 1, maxLength: 20 }),
			(min, sevs) => {
				const { d, sent } = setup({ categories: { x: { enabled: true, minSeverity: min } } });
				const events = sevs.map((s, i) => ({ id: "e" + i, category: "x", severity: s }));
				d.dispatch(digest(events));
				const expected = events.filter((e) => severityRank(e.severity) >= severityRank(min));
				if (expected.length === 0) {
					assert.strictEqual(sent.length, 0);
				} else {
					assert.strictEqual(sent.length, 1);
					assert.strictEqual(sent[0].events.length, expected.length);
					assert.ok(sent[0].events.every((e) => severityRank(e.severity) >= severityRank(min)));
				}
			}
		)
	);
});

// Feature: telegram-notifications, Property 9: Telegram channel eligibility
test("Property 9: delivery attempted iff enabled and fully configured", () => {
	fc.assert(
		fc.property(fc.boolean(), fc.boolean(), fc.boolean(), (enabled, hasToken, hasChat) => {
			const { d, sent } = setup({ telegram: { enabled, botToken: hasToken ? "t" : "", chatId: hasChat ? "c" : "" } });
			d.dispatch(digest([{ id: "e", category: "x", severity: "warning" }]));
			const eligible = enabled && hasToken && hasChat;
			assert.strictEqual(sent.length, eligible ? 1 : 0);
		})
	);
});

// Feature: telegram-notifications, Property 15: Quiet-hours routing by severity
test("Property 15: during quiet hours only critical digests deliver immediately", () => {
	const quietNow = new Date(2020, 0, 1, 23, 0, 0).getTime(); // 23:00 local, inside 22-07
	fc.assert(
		fc.property(fc.constantFrom("info", "warning", "critical"), (sev) => {
			const { d, sent, clock } = setup({ quietHours: { enabled: true, start: "22:00", end: "07:00" } });
			clock.v = quietNow;
			d.dispatch(digest([{ id: "e", category: "x", severity: sev }]));
			if (sev === "critical") assert.strictEqual(sent.length, 1);
			else assert.strictEqual(sent.length, 0); // deferred
		})
	);
});

// Feature: telegram-notifications, Property 16: Deferred digests are delivered after quiet hours end
test("Property 16: deferred digests deliver once quiet hours end", () => {
	fc.assert(
		fc.property(fc.integer({ min: 1, max: 10 }), (k) => {
			const quietNow = new Date(2020, 0, 1, 23, 0, 0).getTime();
			const dayNow = new Date(2020, 0, 1, 12, 0, 0).getTime();
			const { d, sent, clock } = setup({ quietHours: { enabled: true, start: "22:00", end: "07:00" } });
			clock.v = quietNow;
			for (let i = 0; i < k; i += 1) d.dispatch(digest([{ id: "e" + i, category: "x", severity: "info" }]));
			assert.strictEqual(sent.length, 0); // all deferred
			clock.v = dayNow;
			d.pump();
			assert.strictEqual(sent.length, k);
		})
	);
});

// Feature: telegram-notifications, Property 17: Rate-limit coalescing delivers without dropping events
test("Property 17: over-limit digests are coalesced and delivered, no events lost", () => {
	fc.assert(
		fc.property(fc.integer({ min: 1, max: 30 }), (k) => {
			const { d, sent, clock } = setup({ rateLimit: { maxPerInterval: 2, intervalSec: 10 } });
			clock.v = 1000;
			for (let i = 0; i < k; i += 1) d.dispatch(digest([{ id: "e" + i, category: "x", severity: "info" }]));
			clock.v = 1000 + 11000; // beyond the rate interval
			d.pump();
			const totalDelivered = sent.reduce((acc, dg) => acc + dg.events.length, 0);
			assert.strictEqual(totalDelivered, k);
		})
	);
});
