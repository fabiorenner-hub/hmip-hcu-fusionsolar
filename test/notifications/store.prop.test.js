"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fc = require("fast-check");
const { createStore } = require("../../src/notifications/store");

const CATS = ["connection", "modbus-error", "hcu", "battery-soc-low", "device-status"];

function evt(i, cat) {
	return { id: "e" + i, category: cat || CATS[i % CATS.length], severity: "info", title: "t", message: "m", t: i, read: false };
}

// Feature: telegram-notifications, Property 12: Notification store is bounded and retains the newest events
test("Property 12: store is bounded and keeps the newest", () => {
	fc.assert(
		fc.property(fc.integer({ min: 1, max: 20 }), fc.integer({ min: 0, max: 200 }), (max, n) => {
			const s = createStore(max);
			for (let i = 0; i < n; i += 1) s.append(evt(i));
			assert.ok(s.size() <= max);
			// The retained events are the most recent ones.
			const expected = Math.min(n, max);
			assert.strictEqual(s.size(), expected);
			if (n > 0) {
				const unread = s.listUnread(); // newest first
				assert.strictEqual(unread[0].id, "e" + (n - 1));
			}
		})
	);
});

// Feature: telegram-notifications, Property 11: Unread count tracks reality across all operations
test("Property 11: unread count always matches reality", () => {
	fc.assert(
		fc.property(fc.array(fc.constantFrom("append", "markOne", "markAll"), { maxLength: 100 }), (ops) => {
			const s = createStore(500);
			let i = 0;
			for (const op of ops) {
				if (op === "append") s.append(evt(i++));
				else if (op === "markOne") {
					const u = s.listUnread();
					if (u.length) s.markRead(u[0].id);
				} else {
					s.markAllRead();
				}
				// Invariant: counter equals actual unread list length.
				assert.strictEqual(s.unreadCount(), s.listUnread().length);
			}
			s.markAllRead();
			assert.strictEqual(s.unreadCount(), 0);
		})
	);
});

// Feature: telegram-notifications, Property 10: Unread events partition exactly by category
test("Property 10: grouped-unread partitions exactly by category", () => {
	fc.assert(
		fc.property(fc.array(fc.nat({ max: CATS.length - 1 }), { maxLength: 80 }), (catIdx) => {
			const s = createStore(500);
			catIdx.forEach((c, i) => s.append(evt(i, CATS[c])));
			const groups = s.listGrouped();
			let total = 0;
			for (const [cat, items] of Object.entries(groups)) {
				for (const e of items) assert.strictEqual(e.category, cat);
				total += items.length;
			}
			assert.strictEqual(total, s.listUnread().length);
		})
	);
});

// Feature: telegram-notifications, Property 14: Store contents are independent of Telegram delivery outcome
test("Property 14: stored events are retained regardless of delivery outcome", () => {
	fc.assert(
		fc.property(fc.array(fc.boolean(), { minLength: 1, maxLength: 50 }), (deliveries) => {
			const s = createStore(500);
			deliveries.forEach((delivered, i) => {
				const e = evt(i);
				s.append(e);
				// Simulate a delivery outcome that must not affect the store.
				e.deliveredFlag = delivered;
			});
			assert.strictEqual(s.size(), deliveries.length);
			assert.strictEqual(s.unreadCount(), deliveries.length);
		})
	);
});
